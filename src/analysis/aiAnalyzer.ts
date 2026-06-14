import * as vscode from 'vscode';
import { PromptInspectionResult, CodeInspectionResult, ProjectContextStore } from '../types';
import { analyzePromptStatic } from './promptAnalyzer';
import { analyzeCodeStatic } from './codeAnalyzer';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }] as AnthropicMessage[],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  return data.content.map((c) => c.text || '').join('');
}

// ─── AI Prompt Analysis ───────────────────────────────────────────────────────

const PROMPT_SYSTEM = `You are Vibe Inspector, an expert code review AI specializing in analyzing vibe coding prompts (natural language instructions to AI coding assistants).

Your job is to assess a prompt BEFORE the code is generated to:
1. Identify ambiguities that could lead to incorrect implementations
2. Detect scope creep or unintended side-effects
3. Check alignment with the provided Project Context Store
4. Suggest concrete improvements

Respond ONLY with a valid JSON object matching this schema:
{
  "intentSummary": "string - one sentence",
  "additionalFindings": [
    {
      "category": "ambiguity|scope-creep|intent-mismatch|context-drift",
      "severity": "info|warning|error|critical",
      "title": "string",
      "description": "string",
      "suggestion": "string"
    }
  ],
  "suggestedRefinements": ["string", ...],
  "confidenceScore": number (0-1),
  "aiInsight": "string - 2-3 sentence expert take on this prompt"
}`;

// ─── AI Code Analysis ─────────────────────────────────────────────────────────

const CODE_SYSTEM = `You are Vibe Inspector, an expert security and code-quality AI that reviews AI-generated (vibe) code.

Your job is to find issues MISSED by static analysis, including:
- Logic errors that pattern matching cannot detect
- Subtle security vulnerabilities (business logic flaws, auth bypass patterns)
- Architectural violations relative to the Project Context Store
- Technical debt patterns that need semantic understanding

Respond ONLY with a valid JSON object:
{
  "additionalFindings": [
    {
      "category": "security|technical-debt|context-drift",
      "severity": "info|warning|error|critical",
      "title": "string",
      "cweId": "string or null",
      "cweName": "string or null",
      "description": "string",
      "line": number or null,
      "remediation": "string"
    }
  ],
  "aiInsight": "string - 2-3 sentence expert assessment",
  "confidenceScore": number (0-1),
  "qualityAssessment": "string - overall quality of the generated code"
}`;

export class AIAnalyzer {
  private getApiKey(): string | null {
    const config = vscode.workspace.getConfiguration('vibeInspector');
    const key = config.get<string>('apiKey') || '';
    return key.trim() || null;
  }

  async enhancePromptAnalysis(
    staticResult: PromptInspectionResult,
    ctx: ProjectContextStore | null
  ): Promise<PromptInspectionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) { return staticResult; }

    try {
      const userMessage = `
PROJECT CONTEXT STORE:
${ctx ? JSON.stringify(ctx, null, 2) : 'None provided.'}

VIBE CODING PROMPT TO INSPECT:
"""
${staticResult.promptText}
"""

STATIC ANALYSIS ALREADY FOUND:
${JSON.stringify(staticResult.findings, null, 2)}

Please provide your AI analysis to catch issues the static rules may have missed.
`.trim();

      const raw = await callClaude(apiKey, PROMPT_SYSTEM, userMessage);

      let parsed: {
        intentSummary?: string;
        additionalFindings?: PromptInspectionResult['findings'];
        suggestedRefinements?: string[];
        aiInsight?: string;
      };

      try {
        const clean = raw.replace(/```json\n?|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        return staticResult;
      }

      return {
        ...staticResult,
        intentSummary: parsed.intentSummary || staticResult.intentSummary,
        findings: [
          ...staticResult.findings,
          ...(parsed.additionalFindings || []).map((f, i) => ({
            ...f,
            id: `AI-PRE-${i}`,
          })),
        ],
        suggestedRefinements: [
          ...staticResult.suggestedRefinements,
          ...(parsed.suggestedRefinements || []),
        ].slice(0, 6),
        // Store AI insight in the summary field (we extend it)
        passedChecks: [
          ...staticResult.passedChecks,
          ...(parsed.aiInsight ? [`AI Insight: ${parsed.aiInsight}`] : []),
        ],
      };
    } catch (err) {
      console.error('Vibe Inspector AI error (prompt):', err);
      return staticResult;
    }
  }

  async enhanceCodeAnalysis(
    staticResult: CodeInspectionResult,
    ctx: ProjectContextStore | null
  ): Promise<CodeInspectionResult & { aiInsight?: string }> {
    const apiKey = this.getApiKey();
    if (!apiKey) { return staticResult; }

    try {
      const userMessage = `
PROJECT CONTEXT STORE:
${ctx ? JSON.stringify(ctx, null, 2) : 'None provided.'}

FILE: ${staticResult.filePath} (${staticResult.language})
LINES OF CODE: ${staticResult.linesOfCode}

STATIC ANALYSIS FINDINGS (already found — don't repeat):
${JSON.stringify(staticResult.findings.map((f) => f.title), null, 2)}

Please identify additional issues requiring semantic understanding, then provide your overall assessment.
`.trim();

      const raw = await callClaude(apiKey, CODE_SYSTEM, userMessage);

      let parsed: {
        additionalFindings?: CodeInspectionResult['findings'];
        aiInsight?: string;
        qualityAssessment?: string;
      };

      try {
        const clean = raw.replace(/```json\n?|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        return staticResult;
      }

      const allFindings = [
        ...staticResult.findings,
        ...(parsed.additionalFindings || []).map((f, i) => ({
          ...f,
          id: `AI-POST-${i}`,
        })),
      ];

      return {
        ...staticResult,
        findings: allFindings,
        summary: parsed.qualityAssessment || staticResult.summary,
        aiInsight: parsed.aiInsight,
      };
    } catch (err) {
      console.error('Vibe Inspector AI error (code):', err);
      return staticResult;
    }
  }
}

// ─── Combined entry point ─────────────────────────────────────────────────────

export async function analyzePromptWithAI(
  prompt: string,
  ctx: ProjectContextStore | null,
  aiAnalyzer: AIAnalyzer
): Promise<PromptInspectionResult> {
  const staticResult = analyzePromptStatic(prompt, ctx);
  return aiAnalyzer.enhancePromptAnalysis(staticResult, ctx);
}

export async function analyzeCodeWithAI(
  code: string,
  language: string,
  filePath: string,
  ctx: ProjectContextStore | null,
  aiAnalyzer: AIAnalyzer
): Promise<CodeInspectionResult> {
  const staticResult = analyzeCodeStatic(code, language, filePath, ctx);
  return aiAnalyzer.enhanceCodeAnalysis(staticResult, ctx);
}
