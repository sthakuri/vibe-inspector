import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectContextManager } from '../context/ProjectContextManager';
import { SessionManager } from '../context/SessionManager';
import { AIAnalyzer, analyzePromptWithAI, analyzeCodeWithAI } from '../analysis/aiAnalyzer';
import { AgentProvider } from './providers/types';
import { ClaudeCodeProvider } from './providers/claudeCodeProvider';
import { CodexCliProvider } from './providers/codexCliProvider';

const ENABLED_STATE_KEY = 'vibeInspector.chatMonitorEnabled';
const MAX_CAPTURE_CHARS = 20000;
const MIN_PROMPT_LENGTH = 8;
const MIN_CODE_LENGTH = 20;

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  py: 'python', java: 'java', go: 'go', rb: 'ruby', php: 'php', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', rs: 'rust', json: 'json',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', sh: 'shellscript', md: 'markdown',
};

function languageFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || ext || 'plaintext';
}

function walkJsonlFiles(dir: string, recursive: boolean): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) { files.push(...walkJsonlFiles(fullPath, recursive)); }
    } else if (entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Watches on-disk session transcripts from AI coding CLIs (Claude Code,
 * Codex CLI, ...) and, when enabled, runs pre-generation (prompt) inspection
 * on user turns and post-generation (code) inspection on file edits.
 */
export class AgentSessionMonitor implements vscode.Disposable {
  private enabled: boolean;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly offsets = new Map<string, number>();
  private readonly fileProviders = new Map<string, AgentProvider>();
  private readonly providers: AgentProvider[];
  private readonly workspacePath: string | undefined;

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
    this.providers = [new ClaudeCodeProvider(), new CodexCliProvider()];

    const folder = vscode.workspace.workspaceFolders?.[0];
    this.workspacePath = folder?.uri.fsPath;

    this.output.appendLine(
      `[init] workspaceFolder=${this.workspacePath ?? '(none)'} enabled=${this.enabled} ` +
      `providers=${this.providers.map((p) => p.id).join(', ')}`
    );

    this.updateStatusBar();
  }

  register(): vscode.Disposable {
    if (!this.workspacePath) {
      this.output.appendLine('[register] no workspaceFolder open — chat monitor disabled');
      return this;
    }

    this.seedExistingFiles();

    for (const provider of this.providers) {
      for (const root of provider.getWatchRoots(this.workspacePath)) {
        if (!fs.existsSync(root.dir)) {
          this.output.appendLine(`[register] ${provider.id}: watch root does not exist: ${root.dir}`);
          continue;
        }

        const globPattern = root.recursive ? '**/*.jsonl' : '*.jsonl';
        const pattern = new vscode.RelativePattern(vscode.Uri.file(root.dir), globPattern);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.output.appendLine(`[register] ${provider.id}: watching ${root.dir}\\${globPattern}`);

        this.disposables.push(
          watcher,
          watcher.onDidCreate((uri) => {
            this.output.appendLine(`[watcher:${provider.id}] onDidCreate ${uri.fsPath}`);
            this.processFile(uri.fsPath);
          }),
          watcher.onDidChange((uri) => {
            this.output.appendLine(`[watcher:${provider.id}] onDidChange ${uri.fsPath}`);
            this.processFile(uri.fsPath);
          })
        );
      }
    }

    return this;
  }

  private seedExistingFiles(): void {
    if (!this.workspacePath) { return; }

    for (const provider of this.providers) {
      let count = 0;
      for (const root of provider.getWatchRoots(this.workspacePath)) {
        if (!fs.existsSync(root.dir)) {
          this.output.appendLine(`[seed:${provider.id}] watch root does not exist: ${root.dir}`);
          continue;
        }

        for (const filePath of walkJsonlFiles(root.dir, root.recursive)) {
          if (!provider.belongsToWorkspace(filePath, this.workspacePath)) { continue; }
          try {
            this.offsets.set(filePath, fs.statSync(filePath).size);
            this.fileProviders.set(filePath, provider);
            count++;
          } catch {
            // file may have disappeared between scan and stat; ignore
          }
        }
      }
      this.output.appendLine(`[seed:${provider.id}] seeded ${count} existing .jsonl file(s)`);
    }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.extensionContext.workspaceState.update(ENABLED_STATE_KEY, this.enabled);
    this.output.appendLine(`[toggle] chat inspection ${this.enabled ? 'enabled' : 'disabled'}`);

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
    this.statusBar.tooltip = this.workspacePath
      ? 'Vibe Inspector — click to toggle automatic pre/post inspection of AI coding CLI chat turns'
      : 'Vibe Inspector — no workspace folder open, chat inspection unavailable';
    this.statusBar.command = 'vibeInspector.toggleChatInspection';
    this.statusBar.show();
  }

  /** Resolves (and caches) which provider, if any, owns a given transcript file. */
  private resolveProvider(filePath: string): AgentProvider | undefined {
    const cached = this.fileProviders.get(filePath);
    if (cached) { return cached; }
    if (!this.workspacePath) { return undefined; }

    for (const provider of this.providers) {
      if (provider.isCandidateFile(filePath) && provider.belongsToWorkspace(filePath, this.workspacePath)) {
        this.fileProviders.set(filePath, provider);
        return provider;
      }
    }
    return undefined;
  }

  private processFile(filePath: string): void {
    if (!this.enabled) {
      this.output.appendLine(`[processFile] skipped (chat inspection is off): ${filePath}`);
      return;
    }

    const provider = this.resolveProvider(filePath);
    if (!provider) {
      this.output.appendLine(`[processFile] no provider claims ${filePath}`);
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

    this.output.appendLine(`[processFile:${provider.id}] ${filePath} grew ${lastOffset} -> ${stat.size} bytes`);

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
        if (trimmed) { this.handleLine(provider, trimmed); }
      }
    });
  }

  private handleLine(provider: AgentProvider, line: string): void {
    let turns;
    try {
      turns = provider.parseLine(line);
    } catch (err) {
      this.output.appendLine(`[handleLine:${provider.id}] parse error: ${err}`);
      return;
    }

    for (const turn of turns) {
      if (turn.kind === 'prompt') {
        if (turn.text.length >= MIN_PROMPT_LENGTH) {
          this.output.appendLine(`[handleLine:${provider.id}] user prompt (${turn.text.length} chars) -> inspecting`);
          this.inspectPrompt(turn.text);
        }
      } else if (turn.kind === 'code') {
        if (turn.code.trim().length >= MIN_CODE_LENGTH) {
          this.output.appendLine(`[handleLine:${provider.id}] code change (${turn.filePath}) -> inspecting`);
          this.inspectCode(turn.filePath, turn.code);
        }
      }
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
        `⚠️ Vibe Inspector: ${result.overallRisk.toUpperCase()} risk prompt sent to AI coding assistant! (${result.findings.length} issues found)`
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
