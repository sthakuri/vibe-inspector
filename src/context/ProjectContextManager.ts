import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectContextStore } from '../types';

const DEFAULT_CONTEXT: ProjectContextStore = {
  version: '1.0',
  projectName: 'My Project',
  description: 'Describe your project here so Vibe Inspector can validate AI-generated code against your architecture.',
  lastUpdated: Date.now(),
  architecture: {
    pattern: 'MVC',
    layers: ['presentation', 'business', 'data'],
    entryPoints: ['src/index.ts', 'src/app.ts'],
    forbiddenPatterns: ['eval(', 'document.write(', 'innerHTML ='],
  },
  security: {
    authMechanism: 'JWT',
    sensitiveDataFields: ['password', 'token', 'secret', 'apiKey', 'ssn', 'creditCard'],
    forbiddenLibraries: [],
    requiredSanitization: ['user input', 'query parameters', 'form data'],
  },
  codeStyle: {
    language: 'TypeScript',
    framework: 'Node.js / Express',
    namingConventions: 'camelCase for variables, PascalCase for classes',
    errorHandlingPattern: 'try/catch with typed errors, no swallowed exceptions',
    testingFramework: 'Jest',
  },
  scope: {
    inScope: ['feature implementation', 'bug fixes', 'refactoring'],
    outOfScope: ['database schema changes', 'CI/CD configuration', 'infrastructure'],
    criticalFiles: ['src/auth/', 'src/database/', 'src/config/'],
  },
  customRules: [],
};

export class ProjectContextManager {
  private context: ProjectContextStore | null = null;
  private contextFilePath: string | null = null;
  private _onDidChange = new vscode.EventEmitter<ProjectContextStore | null>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  private getContextFilePath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return null; }
    return path.join(folders[0].uri.fsPath, '.vibe-inspector', 'context.json');
  }

  async load(): Promise<ProjectContextStore | null> {
    const filePath = this.getContextFilePath();
    if (!filePath) { return null; }

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        this.context = JSON.parse(raw) as ProjectContextStore;
        this.contextFilePath = filePath;
        return this.context;
      } catch {
        vscode.window.showWarningMessage('Vibe Inspector: Failed to parse context.json — using defaults.');
      }
    }
    return null;
  }

  async initialize(): Promise<ProjectContextStore> {
    const filePath = this.getContextFilePath();
    if (!filePath) {
      throw new Error('No workspace folder open. Open a folder first.');
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }

    const initial = { ...DEFAULT_CONTEXT, lastUpdated: Date.now() };
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), 'utf8');
    this.context = initial;
    this.contextFilePath = filePath;
    this._onDidChange.fire(this.context);

    // Open it in editor for the user to fill out
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);

    return initial;
  }

  get(): ProjectContextStore | null {
    return this.context;
  }

  getFilePath(): string | null {
    return this.contextFilePath;
  }

  async save(ctx: ProjectContextStore): Promise<void> {
    const filePath = this.getContextFilePath();
    if (!filePath) { throw new Error('No workspace folder open.'); }
    ctx.lastUpdated = Date.now();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, JSON.stringify(ctx, null, 2), 'utf8');
    this.context = ctx;
    this._onDidChange.fire(this.context);
  }

  watchForChanges(): vscode.Disposable {
    const filePath = this.getContextFilePath();
    if (!filePath) { return { dispose: () => {} }; }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        path.dirname(filePath),
        path.basename(filePath)
      )
    );

    const reload = async () => {
      await this.load();
      this._onDidChange.fire(this.context);
    };

    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    return watcher;
  }
}
