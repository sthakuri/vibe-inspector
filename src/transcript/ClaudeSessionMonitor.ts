import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectContextManager } from '../context/ProjectContextManager';
import { SessionManager } from '../context/SessionManager';
import { AIAnalyzer, analyzePromptWithAI, analyzeCodeWithAI } from '../analysis/aiAnalyzer';

const ENABLED_STATE_KEY = 'vibeInspector.chatMonitorEnabled';
const MAX_CAPTURE_CHARS = 20000;
const MIN_PROMPT_LENGTH = 8;
const MIN_CODE_LENGTH = 20;

const IGNORED_TEXT_PREFIXES = ['<ide_', '<system-reminder>', '[Request interrupted'];

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  py: 'python', java: 'java', go: 'go', rb: 'ruby', php: 'php', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', rs: 'rust', json: 'json',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', sh: 'shellscript', md: 'markdown',
};

interface CodeChange {
  filePath: string;
  code: string;
}

function sanitizeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/[\\/:]/g, '-');
}

/**
 * Resolves the Claude Code transcript directory for a workspace folder.
 *
 * VS Code may report a workspace folder path with different drive-letter
 * casing (e.g. `W:\...`) than the `cwd` Claude Code recorded (e.g. `w:\...`),
 * which would otherwise produce a differently-named (and non-existent)
 * sanitized directory. Fall back to a case-insensitive match against the
 * existing directories under `~/.claude/projects`.
 */
function resolveTranscriptDir(workspacePath: string): string {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const expected = sanitizeWorkspacePath(workspacePath);
  const exactPath = path.join(projectsRoot, expected);
  if (fs.existsSync(exactPath)) { return exactPath; }

  try {
    const match = fs.readdirSync(projectsRoot).find((entry) => entry.toLowerCase() === expected.toLowerCase());
    if (match) { return path.join(projectsRoot, match); }
  } catch {
    // projects root may not exist yet
  }

  return exactPath;
}

function languageFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || ext || 'plaintext';
}

function extractPromptText(content: unknown): string | undefined {
  let blocks: string[];

  if (typeof content === 'string') {
    blocks = [content];
  } else if (Array.isArray(content)) {
    blocks = content
      .filter((c) => c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
  } else {
    return undefined;
  }

  const parts = blocks
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !IGNORED_TEXT_PREFIXES.some((prefix) => t.startsWith(prefix)));

  const joined = parts.join('\n\n').trim();
  return joined.length > 0 ? joined : undefined;
}

function extractCodeChanges(content: unknown): CodeChange[] {
  if (!Array.isArray(content)) { return []; }

  const changes: CodeChange[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'tool_use') { continue; }
    const input = block.input ?? {};
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
    if (!filePath) { continue; }

    if (block.name === 'Write' && typeof input.content === 'string') {
      changes.push({ filePath, code: input.content });
    } else if (block.name === 'Edit' && typeof input.new_string === 'string') {
      changes.push({ filePath, code: input.new_string });
    } else if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
      const code = input.edits
        .map((edit: unknown) => (edit && typeof edit === 'object' && typeof (edit as any).new_string === 'string' ? (edit as any).new_string : ''))
        .filter((s: string) => s.length > 0)
        .join('\n');
      if (code) { changes.push({ filePath, code }); }
    }
  }
  return changes;
}

/**
 * Watches Claude Code's on-disk session transcripts
 * (~/.claude/projects/<sanitized-workspace-path>/*.jsonl) and, when enabled,
 * runs pre-generation (prompt) inspection on user turns and post-generation
 * (code) inspection on Write/Edit/MultiEdit tool calls from the assistant.
 */
export class ClaudeSessionMonitor implements vscode.Disposable {
  private enabled: boolean;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly offsets = new Map<string, number>();
  private readonly transcriptDir: string | undefined;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly contextManager: ProjectContextManager,
    private readonly sessionManager: SessionManager,
    private readonly aiAnalyzer: AIAnalyzer,
    private readonly statusBar: vscode.StatusBarItem,
    private readonly onResult: () => void,
    private readonly output: vscode.OutputChannel
  ) {
    this.enabled = this.extensionContext.workspaceState.get<boolean>(ENABLED_STATE_KEY, false);

    const folder = vscode.workspace.workspaceFolders?.[0];
    this.transcriptDir = folder ? resolveTranscriptDir(folder.uri.fsPath) : undefined;

    this.output.appendLine(
      `[init] workspaceFolder=${folder?.uri.fsPath ?? '(none)'} transcriptDir=${this.transcriptDir ?? '(none)'} ` +
      `exists=${this.transcriptDir ? fs.existsSync(this.transcriptDir) : false} enabled=${this.enabled}`
    );

    this.updateStatusBar();
  }

  register(): vscode.Disposable {
    if (!this.transcriptDir) {
      this.output.appendLine('[register] no transcriptDir (no workspace folder open) — chat monitor disabled');
      return this;
    }

    this.seedExistingFiles();

    const pattern = new vscode.RelativePattern(vscode.Uri.file(this.transcriptDir), '*.jsonl');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.output.appendLine(`[register] watching ${this.transcriptDir}\\*.jsonl`);
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => {
        this.output.appendLine(`[watcher] onDidCreate ${uri.fsPath}`);
        this.processFile(uri.fsPath);
      }),
      watcher.onDidChange((uri) => {
        this.output.appendLine(`[watcher] onDidChange ${uri.fsPath}`);
        this.processFile(uri.fsPath);
      })
    );

    return this;
  }

  private seedExistingFiles(): void {
    if (!this.transcriptDir || !fs.existsSync(this.transcriptDir)) {
      this.output.appendLine(`[seed] transcriptDir does not exist: ${this.transcriptDir}`);
      return;
    }

    let count = 0;
    for (const entry of fs.readdirSync(this.transcriptDir)) {
      if (entry.endsWith('.jsonl')) {
        const fullPath = path.join(this.transcriptDir, entry);
        try {
          this.offsets.set(fullPath, fs.statSync(fullPath).size);
          count++;
        } catch {
          // file may have disappeared between readdir and stat; ignore
        }
      }
    }
    this.output.appendLine(`[seed] seeded ${count} existing .jsonl file(s) in ${this.transcriptDir}`);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.extensionContext.workspaceState.update(ENABLED_STATE_KEY, this.enabled);
    this.output.appendLine(`[toggle] chat inspection ${this.enabled ? 'enabled' : 'disabled'} (transcriptDir=${this.transcriptDir ?? '(none)'})`);

    if (this.enabled) {
      // Don't replay history that accumulated while disabled.
      this.seedExistingFiles();
    }

    this.updateStatusBar();
    vscode.window.showInformationMessage(
      `Vibe Inspector: chat inspection ${this.enabled ? 'enabled' : 'disabled'}.`
    );
  }

  private updateStatusBar(): void {
    this.statusBar.text = this.enabled ? '$(comment-discussion) VI Chat: On' : '$(comment-discussion) VI Chat: Off';
    this.statusBar.tooltip = this.transcriptDir
      ? 'Vibe Inspector — click to toggle automatic pre/post inspection of Claude Code chat turns'
      : 'Vibe Inspector — no workspace folder open, chat inspection unavailable';
    this.statusBar.command = 'vibeInspector.toggleChatInspection';
    this.statusBar.show();
  }

  private processFile(filePath: string): void {
    if (!this.enabled) {
      this.output.appendLine(`[processFile] skipped (chat inspection is off): ${filePath}`);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    const lastOffset = this.offsets.get(filePath) ?? 0;
    if (stat.size <= lastOffset) {
      this.offsets.set(filePath, stat.size);
      return;
    }

    this.output.appendLine(`[processFile] ${filePath} grew ${lastOffset} -> ${stat.size} bytes`);

    const stream = fs.createReadStream(filePath, { start: lastOffset, end: stat.size - 1, encoding: 'utf-8' });
    let buf = '';
    stream.on('data', (chunk) => { buf += chunk; });
    stream.on('error', () => { /* ignore transient read errors */ });
    stream.on('end', () => {
      const endsWithNewline = buf.endsWith('\n');
      const lines = buf.split('\n');
      if (!endsWithNewline) {
        const partial = lines.pop() ?? '';
        this.offsets.set(filePath, lastOffset + buf.length - partial.length);
      } else {
        this.offsets.set(filePath, lastOffset + buf.length);
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) { this.handleLine(trimmed); }
      }
    });
  }

  private handleLine(line: string): void {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      this.output.appendLine(`[handleLine] JSON parse error: ${err}`);
      return;
    }

    if (entry.isSidechain) {
      this.output.appendLine(`[handleLine] skipped sidechain entry (type=${entry.type})`);
      return;
    }

    if (entry.type === 'user' && entry.message?.role === 'user') {
      const text = extractPromptText(entry.message.content);
      if (text && text.length >= MIN_PROMPT_LENGTH) {
        this.output.appendLine(`[handleLine] user prompt (${text.length} chars) -> inspecting`);
        this.inspectPrompt(text);
      } else {
        this.output.appendLine(`[handleLine] user entry produced no inspectable prompt text (length=${text?.length ?? 0})`);
      }
    } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      const changes = extractCodeChanges(entry.message.content);
      this.output.appendLine(`[handleLine] assistant entry -> ${changes.length} code change(s)`);
      for (const change of changes) {
        if (change.code.trim().length >= MIN_CODE_LENGTH) {
          this.inspectCode(change.filePath, change.code);
        }
      }
    } else {
      this.output.appendLine(`[handleLine] ignored entry type=${entry.type} role=${entry.message?.role}`);
    }
  }

  private async inspectPrompt(prompt: string): Promise<void> {
    const ctx = this.contextManager.get();
    const result = await analyzePromptWithAI(prompt, ctx, this.aiAnalyzer);
    this.sessionManager.addPromptInspection(result);

    const config = vscode.workspace.getConfiguration('vibeInspector');
    if (config.get<boolean>('preGeneration.blockOnHighRisk') &&
        (result.overallRisk === 'high' || result.overallRisk === 'critical')) {
      vscode.window.showWarningMessage(
        `⚠️ Vibe Inspector: ${result.overallRisk.toUpperCase()} risk prompt sent to Claude Code! (${result.findings.length} issues found)`
      );
    }

    const icon = result.overallRisk === 'low' || result.overallRisk === 'medium' ? '✅' : '⚠️';
    const msg = `${icon} Chat prompt inspected — Risk score ${result.riskScore}/100 (${result.overallRisk}) · ${result.findings.length} findings`;

    vscode.window.showInformationMessage(msg, 'Open Dashboard').then((choice) => {
      if (choice === 'Open Dashboard') { vscode.commands.executeCommand('vibeInspector.openDashboard'); }
    });

    this.onResult();
  }

  private async inspectCode(filePath: string, code: string): Promise<void> {
    const ctx = this.contextManager.get();
    const language = languageFromFilePath(filePath);
    const truncated = code.length > MAX_CAPTURE_CHARS ? code.slice(0, MAX_CAPTURE_CHARS) : code;

    const result = await analyzeCodeWithAI(truncated, language, filePath, ctx, this.aiAnalyzer);
    this.sessionManager.addCodeInspection(result);

    const icon = result.overallScore >= 80 ? '✅' : result.overallScore >= 60 ? '🟡' : '🔴';
    const msg = `${icon} Chat-generated code inspected (${path.basename(filePath)}) — Score: ${result.overallScore}/100 · ${result.findings.length} findings`;

    this.statusBar.tooltip = `Vibe Inspector — last chat-generated code score: ${result.overallScore}/100`;

    vscode.window.showInformationMessage(msg, 'Open Dashboard').then((choice) => {
      if (choice === 'Open Dashboard') { vscode.commands.executeCommand('vibeInspector.openDashboard'); }
    });

    this.onResult();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
