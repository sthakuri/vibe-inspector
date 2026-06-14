import * as vscode from 'vscode';
import { InspectionSession, PromptInspectionResult, CodeInspectionResult } from '../types';

export class SessionManager {
  private session: InspectionSession;
  private _onDidChange = new vscode.EventEmitter<InspectionSession>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.session = this.loadOrCreate();
  }

  private loadOrCreate(): InspectionSession {
    const stored = this.extensionContext.workspaceState.get<InspectionSession>('vibeInspectorSession');
    if (stored) { return stored; }
    return this.createNew();
  }

  private createNew(): InspectionSession {
    return {
      id: `session-${Date.now()}`,
      startTime: Date.now(),
      promptInspections: [],
      codeInspections: [],
    };
  }

  addPromptInspection(result: PromptInspectionResult): void {
    this.session.promptInspections.unshift(result);
    if (this.session.promptInspections.length > 50) {
      this.session.promptInspections = this.session.promptInspections.slice(0, 50);
    }
    this.persist();
    this._onDidChange.fire(this.session);
  }

  addCodeInspection(result: CodeInspectionResult): void {
    this.session.codeInspections.unshift(result);
    if (this.session.codeInspections.length > 50) {
      this.session.codeInspections = this.session.codeInspections.slice(0, 50);
    }
    this.persist();
    this._onDidChange.fire(this.session);
  }

  clear(): void {
    this.session = this.createNew();
    this.persist();
    this._onDidChange.fire(this.session);
  }

  get(): InspectionSession {
    return this.session;
  }

  private persist(): void {
    this.extensionContext.workspaceState.update('vibeInspectorSession', this.session);
  }

  getSummaryStats() {
    const { promptInspections: pi, codeInspections: ci } = this.session;
    const totalFindings = ci.reduce((s, r) => s + r.findings.length, 0);
    const criticalFindings = ci.reduce(
      (s, r) => s + r.findings.filter((f) => f.severity === 'critical').length,
      0
    );
    const avgScore = ci.length > 0
      ? Math.round(ci.reduce((s, r) => s + r.overallScore, 0) / ci.length)
      : null;

    return {
      totalPromptInspections: pi.length,
      totalCodeInspections: ci.length,
      totalFindings,
      criticalFindings,
      avgCodeScore: avgScore,
      highRiskPrompts: pi.filter((r) => r.overallRisk === 'high' || r.overallRisk === 'critical').length,
    };
  }
}
