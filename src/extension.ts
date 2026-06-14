import * as vscode from 'vscode';
import { ProjectContextManager } from './context/ProjectContextManager';
import { SessionManager } from './context/SessionManager';
import { DiagnosticsProvider } from './providers/DiagnosticsProvider';
import { SessionTreeProvider, ContextTreeProvider } from './providers/TreeProviders';
import { AIAnalyzer, analyzePromptWithAI, analyzeCodeWithAI } from './analysis/aiAnalyzer';
import { buildDashboardHtml } from './ui/DashboardPanel';

// ─── State ────────────────────────────────────────────────────────────────────

let dashboardPanel: vscode.WebviewPanel | undefined;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSelectedText(editor: vscode.TextEditor): string {
  const selection = editor.selection;
  if (!selection.isEmpty) {
    return editor.document.getText(selection);
  }
  return editor.document.getText();
}

function detectLanguage(editor: vscode.TextEditor): string {
  return editor.document.languageId || 'plaintext';
}

async function getPromptInput(selectedText: string): Promise<string | undefined> {
  if (selectedText && selectedText.trim().length > 10) {
    const choice = await vscode.window.showInformationMessage(
      `Inspect selected text as vibe coding prompt?`,
      { modal: false },
      'Inspect Selection',
      'Type New Prompt'
    );
    if (choice === 'Inspect Selection') { return selectedText.trim(); }
  }

  return vscode.window.showInputBox({
    prompt: 'Enter the vibe coding prompt you want to inspect',
    placeHolder: 'e.g. "Add user authentication with JWT to the Express app"',
    ignoreFocusOut: true,
  });
}

// ─── Activation ───────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Vibe Inspector activating…');

  // Core services
  const contextManager = new ProjectContextManager(context);
  const sessionManager = new SessionManager(context);
  const diagnosticsProvider = new DiagnosticsProvider();
  const aiAnalyzer = new AIAnalyzer();

  // Tree views
  const sessionTreeProvider = new SessionTreeProvider(sessionManager);
  const contextTreeProvider = new ContextTreeProvider(contextManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('vibeInspector.sessionView', sessionTreeProvider),
    vscode.window.registerTreeDataProvider('vibeInspector.contextView', contextTreeProvider),
    diagnosticsProvider
  );

  // Load context on startup
  await contextManager.load();
  const contextWatcher = contextManager.watchForChanges();
  context.subscriptions.push(contextWatcher);

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(shield) Vibe Inspector';
  statusBar.tooltip = 'Vibe Inspector — Click to open dashboard';
  statusBar.command = 'vibeInspector.openDashboard';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── Commands ────────────────────────────────────────────────────────────────

  // 1. Inspect Prompt (Pre-Generation)
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.inspectPrompt', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor ? getSelectedText(editor) : '';

      const prompt = await getPromptInput(selected);
      if (!prompt) { return; }

      const ctx = contextManager.get();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Vibe Inspector: Analyzing prompt…', cancellable: false },
        async () => {
          const result = await analyzePromptWithAI(prompt, ctx, aiAnalyzer);
          sessionManager.addPromptInspection(result);

          // Config: block on high risk
          const config = vscode.workspace.getConfiguration('vibeInspector');
          if (config.get<boolean>('preGeneration.blockOnHighRisk') &&
              (result.overallRisk === 'high' || result.overallRisk === 'critical')) {
            await vscode.window.showWarningMessage(
              `⚠️ Vibe Inspector: ${result.overallRisk.toUpperCase()} risk prompt detected! (${result.findings.length} issues found)\n${result.findings[0]?.title || ''}`,
              { modal: true },
              'Proceed Anyway',
              'Refine Prompt'
            );
          }

          const summaryMsg = result.overallRisk === 'low' || result.overallRisk === 'medium'
            ? `✅ Prompt inspected — ${result.findings.length} findings (Risk: ${result.overallRisk})`
            : `⚠️ Prompt inspected — ${result.findings.length} findings (Risk: ${result.overallRisk})`;

          vscode.window.showInformationMessage(summaryMsg, 'Open Dashboard').then((choice) => {
            if (choice === 'Open Dashboard') {
              vscode.commands.executeCommand('vibeInspector.openDashboard');
            }
          });

          refreshDashboard(sessionManager, context);
        }
      );
    })
  );

  // 2. Inspect Code (Post-Generation)
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.inspectCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Vibe Inspector: Open a file with generated code first.');
        return;
      }

      const code = getSelectedText(editor);
      if (!code.trim()) {
        vscode.window.showWarningMessage('Vibe Inspector: No code found. Select generated code or open a file.');
        return;
      }

      const language = detectLanguage(editor);
      const filePath = editor.document.fileName;
      const ctx = contextManager.get();

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Vibe Inspector: Analyzing generated code…', cancellable: false },
        async () => {
          const result = await analyzeCodeWithAI(code, language, filePath, ctx, aiAnalyzer);
          sessionManager.addCodeInspection(result);
          diagnosticsProvider.apply(result, editor.document);

          const icon = result.overallScore >= 80 ? '✅' : result.overallScore >= 60 ? '🟡' : '🔴';
          const msg = `${icon} Code inspected — Score: ${result.overallScore}/100 · ${result.findings.length} findings`;

          statusBar.text = `$(shield) VI: ${result.overallScore}/100`;

          vscode.window.showInformationMessage(msg, 'Open Dashboard', 'Show Problems').then((choice) => {
            if (choice === 'Open Dashboard') {
              vscode.commands.executeCommand('vibeInspector.openDashboard');
            } else if (choice === 'Show Problems') {
              vscode.commands.executeCommand('workbench.action.problems.focus');
            }
          });

          refreshDashboard(sessionManager, context);
        }
      );
    })
  );

  // 3. Open Dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.openDashboard', () => {
      if (dashboardPanel) {
        dashboardPanel.reveal(vscode.ViewColumn.One);
        return;
      }

      dashboardPanel = vscode.window.createWebviewPanel(
        'vibeInspectorDashboard',
        '🛡 Vibe Inspector',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      dashboardPanel.webview.html = buildDashboardHtml(
        dashboardPanel.webview,
        sessionManager.get(),
        sessionManager.getSummaryStats()
      );

      dashboardPanel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.command) {
          case 'inspectPrompt': vscode.commands.executeCommand('vibeInspector.inspectPrompt'); break;
          case 'inspectCode': vscode.commands.executeCommand('vibeInspector.inspectCode'); break;
          case 'refresh': refreshDashboard(sessionManager, context); break;
          case 'clearSession':
            const confirm = await vscode.window.showWarningMessage(
              'Clear all inspection history?', { modal: true }, 'Yes, Clear'
            );
            if (confirm === 'Yes, Clear') {
              sessionManager.clear();
              refreshDashboard(sessionManager, context);
            }
            break;
        }
      });

      dashboardPanel.onDidDispose(() => { dashboardPanel = undefined; });
      context.subscriptions.push(dashboardPanel);
    })
  );

  // 4. Init Project Context
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.initProjectContext', async () => {
      try {
        await contextManager.initialize();
        vscode.window.showInformationMessage(
          '✅ Vibe Inspector: Project Context Store created! Fill in the details and save.',
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Vibe Inspector: ${err}`);
      }
    })
  );

  // 5. Edit Project Context
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.editProjectContext', async () => {
      const filePath = contextManager.getFilePath();
      if (!filePath) {
        const init = await vscode.window.showWarningMessage(
          'No Project Context Store found. Initialize one?', 'Initialize'
        );
        if (init) { vscode.commands.executeCommand('vibeInspector.initProjectContext'); }
        return;
      }
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    })
  );

  // 6. Clear Session
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.clearSession', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Vibe Inspector session history?', { modal: true }, 'Yes, Clear'
      );
      if (confirm === 'Yes, Clear') {
        sessionManager.clear();
        diagnosticsProvider.clear();
        statusBar.text = '$(shield) Vibe Inspector';
        refreshDashboard(sessionManager, context);
      }
    })
  );

  // Internal commands for tree view
  context.subscriptions.push(
    vscode.commands.registerCommand('vibeInspector.showPromptResult', (result) => {
      vscode.commands.executeCommand('vibeInspector.openDashboard');
    }),
    vscode.commands.registerCommand('vibeInspector.showCodeResult', (result) => {
      vscode.commands.executeCommand('vibeInspector.openDashboard');
    })
  );

  // Show welcome message if first time
  const hasShownWelcome = context.globalState.get<boolean>('vibeInspector.welcomeShown');
  if (!hasShownWelcome) {
    context.globalState.update('vibeInspector.welcomeShown', true);
    vscode.window.showInformationMessage(
      '🛡️ Vibe Inspector is active! Initialize your Project Context Store to enable context-aware analysis.',
      'Initialize Context',
      'Open Dashboard'
    ).then((choice) => {
      if (choice === 'Initialize Context') {
        vscode.commands.executeCommand('vibeInspector.initProjectContext');
      } else if (choice === 'Open Dashboard') {
        vscode.commands.executeCommand('vibeInspector.openDashboard');
      }
    });
  }

  console.log('Vibe Inspector activated ✓');
}

function refreshDashboard(
  sessionManager: SessionManager,
  context: vscode.ExtensionContext
): void {
  if (dashboardPanel) {
    dashboardPanel.webview.html = buildDashboardHtml(
      dashboardPanel.webview,
      sessionManager.get(),
      sessionManager.getSummaryStats()
    );
  }
}

export function deactivate(): void {
  console.log('Vibe Inspector deactivated.');
}
