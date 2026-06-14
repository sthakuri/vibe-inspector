import * as vscode from 'vscode';
import { SessionManager } from '../context/SessionManager';
import { ProjectContextManager } from '../context/ProjectContextManager';
import { PromptInspectionResult, CodeInspectionResult, Severity } from '../types';

// ─── Severity Icon Map ────────────────────────────────────────────────────────

function severityIcon(s: Severity): vscode.ThemeIcon {
  switch (s) {
    case 'critical': return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    case 'error': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsErrorIcon.foreground'));
    case 'warning': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    case 'info': return new vscode.ThemeIcon('info');
  }
}

function riskIcon(risk: PromptInspectionResult['overallRisk']): string {
  switch (risk) {
    case 'critical': return '⛔';
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🟢';
  }
}

// ─── Session Tree ─────────────────────────────────────────────────────────────

class SessionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'root' | 'promptGroup' | 'codeGroup' | 'promptEntry' | 'codeEntry' | 'finding',
    public readonly data?: PromptInspectionResult | CodeInspectionResult | unknown,
    description?: string,
    icon?: vscode.ThemeIcon | string
  ) {
    super(label, collapsible);
    if (description) { this.description = description; }
    if (icon instanceof vscode.ThemeIcon) {
      this.iconPath = icon;
    } else if (typeof icon === 'string') {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly sessionManager: SessionManager) {
    sessionManager.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: SessionTreeItem): SessionTreeItem[] {
    const session = this.sessionManager.get();

    if (!element) {
      const stats = this.sessionManager.getSummaryStats();
      return [
        new SessionTreeItem(
          '📝 Prompt Inspections',
          vscode.TreeItemCollapsibleState.Expanded,
          'promptGroup',
          undefined,
          `${stats.totalPromptInspections} total`
        ),
        new SessionTreeItem(
          '🔍 Code Inspections',
          vscode.TreeItemCollapsibleState.Expanded,
          'codeGroup',
          undefined,
          `${stats.totalCodeInspections} total, avg score: ${stats.avgCodeScore ?? 'N/A'}`
        ),
      ];
    }

    if (element.itemType === 'promptGroup') {
      return session.promptInspections.slice(0, 20).map((r, i) => {
        const label = `${riskIcon(r.overallRisk)} ${new Date(r.timestamp).toLocaleTimeString()}`;
        const item = new SessionTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'promptEntry',
          r,
          `Score: ${r.riskScore} · ${r.findings.length} findings`
        );
        item.tooltip = r.promptText.slice(0, 200);
        item.command = {
          command: 'vibeInspector.showPromptResult',
          title: 'Show Result',
          arguments: [r],
        };
        return item;
      });
    }

    if (element.itemType === 'codeGroup') {
      return session.codeInspections.slice(0, 20).map((r) => {
        const scoreIcon = r.overallScore >= 80 ? '🟢' : r.overallScore >= 60 ? '🟡' : '🔴';
        const item = new SessionTreeItem(
          `${scoreIcon} ${r.filePath.split('/').pop() || r.filePath}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          'codeEntry',
          r,
          `Score: ${r.overallScore} · ${r.findings.length} findings`
        );
        item.tooltip = r.summary;
        item.command = {
          command: 'vibeInspector.showCodeResult',
          title: 'Show Result',
          arguments: [r],
        };
        return item;
      });
    }

    if (element.itemType === 'promptEntry' && element.data) {
      const r = element.data as PromptInspectionResult;
      return r.findings.map((f, i) => {
        const item = new SessionTreeItem(
          f.title,
          vscode.TreeItemCollapsibleState.None,
          'finding',
          f,
          f.category,
          severityIcon(f.severity)
        );
        item.tooltip = `${f.description}\n\nSuggestion: ${f.suggestion}`;
        return item;
      });
    }

    if (element.itemType === 'codeEntry' && element.data) {
      const r = element.data as CodeInspectionResult;
      return r.findings.map((f) => {
        const item = new SessionTreeItem(
          f.title,
          vscode.TreeItemCollapsibleState.None,
          'finding',
          f,
          f.line ? `Line ${f.line}` : f.category,
          severityIcon(f.severity)
        );
        item.tooltip = `${f.description}\n\nRemediation: ${f.remediation}`;
        return item;
      });
    }

    return [];
  }
}

// ─── Context Store Tree ───────────────────────────────────────────────────────

class ContextTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    description?: string,
    icon?: string
  ) {
    super(label, collapsible);
    if (description) { this.description = description; }
    if (icon) { this.iconPath = new vscode.ThemeIcon(icon); }
  }
}

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ContextTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly contextManager: ProjectContextManager) {
    contextManager.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: ContextTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: ContextTreeItem): ContextTreeItem[] {
    const ctx = this.contextManager.get();

    if (!element) {
      if (!ctx) {
        const item = new ContextTreeItem(
          'No context store found',
          vscode.TreeItemCollapsibleState.None,
          'Run "Initialize Project Context"',
          'warning'
        );
        item.command = {
          command: 'vibeInspector.initProjectContext',
          title: 'Initialize',
        };
        return [item];
      }

      return [
        new ContextTreeItem('Architecture', vscode.TreeItemCollapsibleState.Collapsed, ctx.architecture.pattern, 'symbol-structure'),
        new ContextTreeItem('Security', vscode.TreeItemCollapsibleState.Collapsed, ctx.security.authMechanism, 'shield'),
        new ContextTreeItem('Code Style', vscode.TreeItemCollapsibleState.Collapsed, ctx.codeStyle.language, 'symbol-color'),
        new ContextTreeItem('Scope', vscode.TreeItemCollapsibleState.Collapsed, `${ctx.scope.inScope.length} in / ${ctx.scope.outOfScope.length} out`, 'target'),
        new ContextTreeItem('Custom Rules', vscode.TreeItemCollapsibleState.Collapsed, `${ctx.customRules.length} rules`, 'checklist'),
      ];
    }

    if (!ctx) { return []; }

    if (element.label === 'Architecture') {
      return [
        new ContextTreeItem('Pattern', vscode.TreeItemCollapsibleState.None, ctx.architecture.pattern),
        new ContextTreeItem('Layers', vscode.TreeItemCollapsibleState.None, ctx.architecture.layers.join(', ')),
        new ContextTreeItem('Forbidden', vscode.TreeItemCollapsibleState.None, ctx.architecture.forbiddenPatterns.join(', ') || 'none'),
      ];
    }

    if (element.label === 'Security') {
      return [
        new ContextTreeItem('Auth', vscode.TreeItemCollapsibleState.None, ctx.security.authMechanism),
        new ContextTreeItem('Sensitive Fields', vscode.TreeItemCollapsibleState.None, ctx.security.sensitiveDataFields.join(', ')),
        new ContextTreeItem('Forbidden Libs', vscode.TreeItemCollapsibleState.None, ctx.security.forbiddenLibraries.join(', ') || 'none'),
      ];
    }

    if (element.label === 'Code Style') {
      return [
        new ContextTreeItem('Language', vscode.TreeItemCollapsibleState.None, ctx.codeStyle.language),
        new ContextTreeItem('Framework', vscode.TreeItemCollapsibleState.None, ctx.codeStyle.framework),
        new ContextTreeItem('Testing', vscode.TreeItemCollapsibleState.None, ctx.codeStyle.testingFramework),
      ];
    }

    if (element.label === 'Scope') {
      return [
        ...ctx.scope.inScope.map((s) => new ContextTreeItem('✓ ' + s, vscode.TreeItemCollapsibleState.None, undefined, 'check')),
        ...ctx.scope.outOfScope.map((s) => new ContextTreeItem('✗ ' + s, vscode.TreeItemCollapsibleState.None, undefined, 'close')),
      ];
    }

    if (element.label === 'Custom Rules') {
      if (ctx.customRules.length === 0) {
        return [new ContextTreeItem('No custom rules', vscode.TreeItemCollapsibleState.None, 'Add rules in context.json')];
      }
      return ctx.customRules.map((r) => new ContextTreeItem(r.name, vscode.TreeItemCollapsibleState.None, r.severity));
    }

    return [];
  }
}
