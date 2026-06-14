import {
  PromptFinding,
  PromptInspectionResult,
  ProjectContextStore,
  Severity,
} from '../types';

// ─── Heuristic rule sets ──────────────────────────────────────────────────────

interface PromptRule {
  id: string;
  category: PromptFinding['category'];
  severity: Severity;
  title: string;
  test: (prompt: string, ctx: ProjectContextStore | null) => string | null;
  suggestion: string;
}

const PROMPT_RULES: PromptRule[] = [
  // Ambiguity checks
  {
    id: 'AMB-001',
    category: 'ambiguity',
    severity: 'warning',
    title: 'Vague action verb',
    test: (p) => {
      const vague = ['fix it', 'make it work', 'do the thing', 'handle it', 'update stuff'];
      const lower = p.toLowerCase();
      const match = vague.find((v) => lower.includes(v));
      return match ? `Contains vague phrase: "${match}"` : null;
    },
    suggestion: 'Specify exactly what behaviour you want. E.g. "fix the null pointer exception on line 42" instead of "fix it".',
  },
  {
    id: 'AMB-002',
    category: 'ambiguity',
    severity: 'info',
    title: 'No acceptance criterion',
    test: (p) => {
      const hasExpected = /should|must|expect|return|output|result/i.test(p);
      return !hasExpected ? 'No expected output or success criterion detected.' : null;
    },
    suggestion: 'Add what success looks like: "the function should return X when given Y".',
  },
  {
    id: 'AMB-003',
    category: 'ambiguity',
    severity: 'warning',
    title: 'Missing language / framework context',
    test: (p, ctx) => {
      if (ctx) { return null; } // Context Store covers this
      const hasLang = /typescript|javascript|python|java|go|rust|react|vue|angular/i.test(p);
      return !hasLang ? 'No language or framework mentioned in the prompt.' : null;
    },
    suggestion: 'Specify the language and framework: "In TypeScript with Express…"',
  },

  // Scope creep checks
  {
    id: 'SCP-001',
    category: 'scope-creep',
    severity: 'warning',
    title: 'Multiple unrelated concerns in one prompt',
    test: (p) => {
      const conjunctions = (p.match(/\band\b/gi) || []).length;
      const also = (p.match(/\balso\b|\badditionally\b|\bmoreover\b/gi) || []).length;
      return (conjunctions + also) >= 4
        ? `Prompt contains ${conjunctions + also} conjunction(s)/additive clause(s) — may span multiple concerns.`
        : null;
    },
    suggestion: 'Break compound prompts into focused single-responsibility requests to avoid architectural drift.',
  },
  {
    id: 'SCP-002',
    category: 'scope-creep',
    severity: 'error',
    title: 'Out-of-scope area mentioned',
    test: (p, ctx) => {
      if (!ctx) { return null; }
      const lower = p.toLowerCase();
      const match = ctx.scope.outOfScope.find((area) => lower.includes(area.toLowerCase()));
      return match ? `Prompt references out-of-scope area: "${match}"` : null;
    },
    suggestion: 'This topic is marked out-of-scope in your Project Context Store. Consult your team before proceeding.',
  },
  {
    id: 'SCP-003',
    category: 'scope-creep',
    severity: 'critical',
    title: 'Critical file area targeted',
    test: (p, ctx) => {
      if (!ctx) { return null; }
      const lower = p.toLowerCase();
      const match = ctx.scope.criticalFiles.find((f) =>
        lower.includes(f.toLowerCase().replace(/^src\//, '').replace(/\/$/, ''))
      );
      return match ? `Prompt targets a critical file/module area: "${match}"` : null;
    },
    suggestion: 'This touches a critical system area. Ensure peer review and additional testing before applying AI-generated code here.',
  },

  // Intent mismatch checks
  {
    id: 'INT-001',
    category: 'intent-mismatch',
    severity: 'warning',
    title: 'Security-sensitive action detected',
    test: (p) => {
      const secKeywords = ['delete all', 'drop table', 'truncate', 'bypass auth', 'skip validation', 'disable security', 'remove check'];
      const lower = p.toLowerCase();
      const match = secKeywords.find((k) => lower.includes(k));
      return match ? `Security-sensitive phrase detected: "${match}"` : null;
    },
    suggestion: 'Review this action carefully. Security-bypassing or destructive operations from AI prompts carry high risk.',
  },
  {
    id: 'INT-002',
    category: 'intent-mismatch',
    severity: 'info',
    title: 'Broad refactor scope',
    test: (p) => {
      const lower = p.toLowerCase();
      const broad = ['refactor everything', 'rewrite the whole', 'restructure all', 'clean up all'];
      const match = broad.find((b) => lower.includes(b));
      return match ? `Broad refactoring scope: "${match}"` : null;
    },
    suggestion: 'Broad rewrites from AI prompts can introduce architectural drift. Consider targeted refactors with explicit boundaries.',
  },

  // Context drift checks
  {
    id: 'CTX-001',
    category: 'context-drift',
    severity: 'warning',
    title: 'Forbidden library mentioned',
    test: (p, ctx) => {
      if (!ctx || ctx.security.forbiddenLibraries.length === 0) { return null; }
      const lower = p.toLowerCase();
      const match = ctx.security.forbiddenLibraries.find((lib) =>
        lower.includes(lib.toLowerCase())
      );
      return match ? `Forbidden library "${match}" mentioned in prompt.` : null;
    },
    suggestion: 'This library is marked forbidden in your Project Context Store. Use the approved alternative.',
  },
  {
    id: 'CTX-002',
    category: 'context-drift',
    severity: 'warning',
    title: 'Auth mechanism mismatch',
    test: (p, ctx) => {
      if (!ctx) { return null; }
      const authMechanisms = ['session', 'cookie auth', 'basic auth', 'oauth', 'jwt', 'api key'];
      const lower = p.toLowerCase();
      const mentioned = authMechanisms.find((m) => lower.includes(m));
      if (!mentioned) { return null; }
      if (ctx.security.authMechanism && !lower.includes(ctx.security.authMechanism.toLowerCase())) {
        return `Prompt mentions "${mentioned}" but project uses "${ctx.security.authMechanism}".`;
      }
      return null;
    },
    suggestion: 'Align the auth mechanism with the one defined in your Project Context Store.',
  },
];

// ─── Positive checks (what's good) ───────────────────────────────────────────

const PASSED_CHECK_TESTS: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'Specifies target file or function', test: (p) => /file|function|method|class|component|module/i.test(p) },
  { label: 'Includes example or expected output', test: (p) => /example|e\.g\.|for instance|return|output|result/i.test(p) },
  { label: 'Mentions testing requirement', test: (p) => /test|spec|unit test|coverage/i.test(p) },
  { label: 'Mentions error handling', test: (p) => /error|exception|catch|handle|fallback/i.test(p) },
  { label: 'References specific requirement', test: (p) => /requirement|ticket|issue|story|acceptance/i.test(p) },
];

// ─── Risk scoring ─────────────────────────────────────────────────────────────

function computeRisk(findings: PromptFinding[]): { score: number; level: PromptInspectionResult['overallRisk'] } {
  const weights: Record<Severity, number> = { info: 5, warning: 20, error: 40, critical: 60 };
  const raw = findings.reduce((sum, f) => sum + weights[f.severity], 0);
  const score = Math.min(100, raw);

  let level: PromptInspectionResult['overallRisk'];
  if (score >= 70) { level = 'critical'; }
  else if (score >= 45) { level = 'high'; }
  else if (score >= 20) { level = 'medium'; }
  else { level = 'low'; }

  return { score, level };
}

// ─── Context alignment ────────────────────────────────────────────────────────

function computeContextAlignment(prompt: string, ctx: ProjectContextStore | null): number {
  if (!ctx) { return 0.5; } // neutral when no context

  let hits = 0;
  let checks = 0;

  const lower = prompt.toLowerCase();

  // Language / framework alignment
  checks++;
  if (lower.includes(ctx.codeStyle.language.toLowerCase()) ||
      lower.includes(ctx.codeStyle.framework.toLowerCase())) { hits++; }

  // Architecture pattern alignment
  checks++;
  if (lower.includes(ctx.architecture.pattern.toLowerCase())) { hits++; }

  // No forbidden libraries
  if (ctx.security.forbiddenLibraries.length > 0) {
    checks++;
    const hasForbidden = ctx.security.forbiddenLibraries.some((lib) =>
      lower.includes(lib.toLowerCase())
    );
    if (!hasForbidden) { hits++; }
  }

  // No out-of-scope topics
  if (ctx.scope.outOfScope.length > 0) {
    checks++;
    const hasOutOfScope = ctx.scope.outOfScope.some((area) =>
      lower.includes(area.toLowerCase())
    );
    if (!hasOutOfScope) { hits++; }
  }

  return checks > 0 ? hits / checks : 0.5;
}

// ─── Refinement suggestions ───────────────────────────────────────────────────

function buildRefinements(prompt: string, findings: PromptFinding[], ctx: ProjectContextStore | null): string[] {
  const suggestions: string[] = [];

  if (findings.some((f) => f.category === 'ambiguity')) {
    suggestions.push('Add a concrete acceptance criterion: describe the expected output or behaviour.');
  }
  if (findings.some((f) => f.category === 'scope-creep')) {
    suggestions.push('Narrow the scope: focus on one function, one file, or one concern per prompt.');
  }
  if (ctx && !prompt.toLowerCase().includes(ctx.codeStyle.language.toLowerCase())) {
    suggestions.push(`Specify the language: "${ctx.codeStyle.language}".`);
  }
  if (ctx && !prompt.toLowerCase().includes(ctx.codeStyle.errorHandlingPattern.toLowerCase().split(' ')[0])) {
    suggestions.push(`Mention the error-handling pattern from your context: "${ctx.codeStyle.errorHandlingPattern}".`);
  }
  if (!/test|spec/i.test(prompt)) {
    suggestions.push('Append: "Include unit tests." to ensure test coverage is considered.');
  }

  return suggestions.slice(0, 4);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzePromptStatic(
  prompt: string,
  ctx: ProjectContextStore | null
): PromptInspectionResult {
  const findings: PromptFinding[] = [];
  let idx = 0;

  for (const rule of PROMPT_RULES) {
    const msg = rule.test(prompt, ctx);
    if (msg) {
      findings.push({
        id: `${rule.id}-${idx++}`,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        description: msg,
        suggestion: rule.suggestion,
      });
    }
  }

  const passedChecks = PASSED_CHECK_TESTS
    .filter((c) => c.test(prompt))
    .map((c) => c.label);

  const { score, level } = computeRisk(findings);
  const contextAlignment = computeContextAlignment(prompt, ctx);
  const suggestedRefinements = buildRefinements(prompt, findings, ctx);

  // Simple intent summary
  const lower = prompt.toLowerCase();
  let intentSummary = 'General code generation request.';
  if (/refactor|rewrite|restructure/i.test(lower)) { intentSummary = 'Code refactoring intent detected.'; }
  else if (/add|create|implement|build/i.test(lower)) { intentSummary = 'New feature / implementation intent detected.'; }
  else if (/fix|debug|resolve|bug/i.test(lower)) { intentSummary = 'Bug fix intent detected.'; }
  else if (/test|spec|coverage/i.test(lower)) { intentSummary = 'Test generation intent detected.'; }
  else if (/optimize|improve|performance|speed/i.test(lower)) { intentSummary = 'Performance optimization intent detected.'; }
  else if (/document|comment|explain/i.test(lower)) { intentSummary = 'Documentation / explanation intent detected.'; }

  return {
    promptText: prompt,
    timestamp: Date.now(),
    overallRisk: level,
    riskScore: score,
    findings,
    intentSummary,
    contextAlignment,
    suggestedRefinements,
    passedChecks,
  };
}
