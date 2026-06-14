import * as vscode from 'vscode';
import { CodeInspectionResult, Severity } from '../types';

export class DiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('vibeInspector');
  }

  apply(result: CodeInspectionResult, document: vscode.TextDocument): void {
    const config = vscode.workspace.getConfiguration('vibeInspector');
    if (!config.get<boolean>('diagnostics.enabled')) {
      this.collection.clear();
      return;
    }

    const minSeverity = config.get<Severity>('severity.minDisplay') || 'info';
    const severityOrder: Record<Severity, number> = { info: 0, warning: 1, error: 2, critical: 3 };
    const minLevel = severityOrder[minSeverity];

    const diagnostics: vscode.Diagnostic[] = [];

    for (const finding of result.findings) {
      if (severityOrder[finding.severity] < minLevel) { continue; }
      if (!finding.line) { continue; }

      const lineIndex = Math.max(0, finding.line - 1);
      const line = document.lineAt(Math.min(lineIndex, document.lineCount - 1));
      const col = finding.column ? finding.column - 1 : 0;
      const endCol = finding.endColumn
        ? finding.endColumn - 1
        : line.range.end.character;

      const range = new vscode.Range(lineIndex, col, lineIndex, endCol);

      const diag = new vscode.Diagnostic(
        range,
        `[Vibe Inspector] ${finding.title}: ${finding.description}`,
        this.mapSeverity(finding.severity)
      );

      diag.source = 'Vibe Inspector';
      diag.code = finding.cweId || finding.id;

      if (finding.references && finding.references.length > 0) {
        diag.relatedInformation = finding.references.map(
          (url) => new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, range),
            url
          )
        );
      }

      diagnostics.push(diag);
    }

    this.collection.set(document.uri, diagnostics);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.collection.delete(uri);
    } else {
      this.collection.clear();
    }
  }

  dispose(): void {
    this.collection.dispose();
  }

  private mapSeverity(s: Severity): vscode.DiagnosticSeverity {
    switch (s) {
      case 'critical':
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'info': return vscode.DiagnosticSeverity.Information;
    }
  }
}
