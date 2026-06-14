import * as vscode from 'vscode';
import { PromptInspectionResult, CodeInspectionResult, InspectionSession, Severity } from '../types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function severityColor(s: Severity): string {
  switch (s) {
    case 'critical': return '#ff3b30';
    case 'error': return '#ff6b35';
    case 'warning': return '#ffd60a';
    case 'info': return '#48cae4';
  }
}

function severityBg(s: Severity): string {
  switch (s) {
    case 'critical': return 'rgba(255,59,48,0.12)';
    case 'error': return 'rgba(255,107,53,0.10)';
    case 'warning': return 'rgba(255,214,10,0.10)';
    case 'info': return 'rgba(72,202,228,0.10)';
  }
}

function riskBadge(risk: PromptInspectionResult['overallRisk']): string {
  const colors: Record<string, string> = {
    critical: '#ff3b30', high: '#ff6b35', medium: '#ffd60a', low: '#34c759'
  };
  return `<span style="background:${colors[risk]};color:#000;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${risk}</span>`;
}

function scoreRing(score: number): string {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? '#34c759' : score >= 60 ? '#ffd60a' : '#ff3b30';
  return `
<svg width="100" height="100" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="${r}" fill="none" stroke="#2a2a3a" stroke-width="8"/>
  <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="8"
    stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
    stroke-linecap="round"
    transform="rotate(-90 50 50)"/>
  <text x="50" y="56" text-anchor="middle" font-size="18" font-weight="700" fill="${color}">${score}</text>
</svg>`;
}

function findingCard(f: { severity: Severity; title: string; description: string; remediation?: string; suggestion?: string; cweId?: string; line?: number }): string {
  const fix = f.remediation || f.suggestion || '';
  return `
<div style="border-left:3px solid ${severityColor(f.severity)};background:${severityBg(f.severity)};
  border-radius:6px;padding:12px 16px;margin-bottom:8px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <span style="background:${severityColor(f.severity)};color:#000;padding:1px 8px;border-radius:8px;
      font-size:10px;font-weight:700;text-transform:uppercase;">${f.severity}</span>
    ${f.cweId ? `<span style="color:${severityColor(f.severity)};font-size:11px;font-weight:600;">${escapeHtml(f.cweId)}</span>` : ''}
    ${f.line ? `<span style="color:#888;font-size:11px;">Line ${f.line}</span>` : ''}
    <strong style="font-size:13px;color:#e8e8f0;">${escapeHtml(f.title)}</strong>
  </div>
  <p style="margin:4px 0;color:#b0b0c0;font-size:12px;">${escapeHtml(f.description)}</p>
  ${fix ? `<p style="margin:4px 0;color:#7ec8e3;font-size:12px;">💡 ${escapeHtml(fix)}</p>` : ''}
</div>`;
}

export function buildDashboardHtml(
  webview: vscode.Webview,
  session: InspectionSession,
  stats: ReturnType<import('../context/SessionManager').SessionManager['getSummaryStats']>
): string {
  const promptResults = session.promptInspections.slice(0, 5);
  const codeResults = session.codeInspections.slice(0, 5);

  const promptCards = promptResults.map((r) => `
<div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:10px;padding:16px;margin-bottom:12px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
    <div>
      <span style="font-size:11px;color:#666;">${new Date(r.timestamp).toLocaleString()}</span>
      <p style="margin:4px 0;color:#e8e8f0;font-size:13px;font-weight:600;">${escapeHtml(r.intentSummary)}</p>
    </div>
    <div style="text-align:right;">
      ${riskBadge(r.overallRisk)}
      <div style="font-size:11px;color:#888;margin-top:4px;">Score: ${r.riskScore}/100</div>
    </div>
  </div>
  <div style="background:#111122;border-radius:6px;padding:10px;margin-bottom:8px;">
    <code style="font-size:11px;color:#a0a0c0;white-space:pre-wrap;">${escapeHtml(r.promptText.slice(0, 300))}${r.promptText.length > 300 ? '…' : ''}</code>
  </div>
  ${r.findings.map((f) => findingCard(f)).join('')}
  ${r.suggestedRefinements.length > 0 ? `
  <div style="margin-top:8px;">
    <div style="font-size:11px;color:#7ec8e3;font-weight:600;margin-bottom:4px;">SUGGESTED REFINEMENTS</div>
    ${r.suggestedRefinements.map((s) => `<div style="font-size:12px;color:#a0c8e0;margin-bottom:3px;">→ ${escapeHtml(s)}</div>`).join('')}
  </div>` : ''}
</div>`).join('') || '<p style="color:#555;text-align:center;padding:32px 0;">No prompt inspections yet. Use Ctrl+Shift+V P to inspect a prompt.</p>';

  const codeCards = codeResults.map((r) => `
<div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:10px;padding:16px;margin-bottom:12px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
    <div>
      <div style="font-size:11px;color:#666;">${new Date(r.timestamp).toLocaleString()}</div>
      <div style="font-size:13px;font-weight:600;color:#e8e8f0;margin-top:2px;">${escapeHtml(r.filePath.split('/').pop() || r.filePath)}</div>
      <div style="font-size:11px;color:#888;">${r.language} · ${r.linesOfCode} LOC</div>
    </div>
    ${scoreRing(r.overallScore)}
  </div>
  
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
    <div style="background:#0f0f1e;border-radius:6px;padding:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#ff3b30;">${r.securityMetrics.criticalCount + r.securityMetrics.errorCount}</div>
      <div style="font-size:10px;color:#666;">Security</div>
    </div>
    <div style="background:#0f0f1e;border-radius:6px;padding:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#ffd60a;">${r.findings.filter(f=>f.category==='technical-debt').length}</div>
      <div style="font-size:10px;color:#666;">Tech Debt</div>
    </div>
    <div style="background:#0f0f1e;border-radius:6px;padding:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#48cae4;">${Math.round(r.securityMetrics.cweInstanceDensity * 10) / 10}</div>
      <div style="font-size:10px;color:#666;">CWE/100 LOC</div>
    </div>
    <div style="background:#0f0f1e;border-radius:6px;padding:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#34c759;">${Math.round(r.contextDriftScore * 100)}%</div>
      <div style="font-size:10px;color:#666;">Ctx Align</div>
    </div>
  </div>

  <p style="color:#a0a0c0;font-size:12px;margin-bottom:8px;">${escapeHtml(r.summary)}</p>
  
  ${r.findings.slice(0, 4).map((f) => findingCard(f)).join('')}
  ${r.findings.length > 4 ? `<div style="color:#666;font-size:12px;text-align:center;padding:4px;">+${r.findings.length - 4} more findings</div>` : ''}
</div>`).join('') || '<p style="color:#555;text-align:center;padding:32px 0;">No code inspections yet. Use Ctrl+Shift+V C to inspect generated code.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Vibe Inspector Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0d0d1a;
    color: #e8e8f0;
    min-height: 100vh;
  }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0d0d1a; }
  ::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 3px; }
  
  .header {
    background: linear-gradient(135deg, #0d0d1a 0%, #1a0a2e 100%);
    border-bottom: 1px solid #2a2a4a;
    padding: 20px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo-shield {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #7b2ff7, #4a90e2);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .logo-text { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
  .logo-sub { font-size: 11px; color: #666; letter-spacing: 1px; text-transform: uppercase; }
  
  .actions { display: flex; gap: 8px; }
  .btn {
    background: #1e1e3a;
    border: 1px solid #3a3a5a;
    color: #c0c0d8;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover { background: #2a2a4a; color: #e8e8f0; }
  .btn-primary { background: #7b2ff7; border-color: #7b2ff7; color: #fff; }
  .btn-primary:hover { background: #6a20e0; }
  
  .stats-bar {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 1px;
    background: #1a1a2e;
    border-bottom: 1px solid #2a2a4a;
  }
  .stat {
    background: #0d0d1a;
    padding: 16px 20px;
    text-align: center;
  }
  .stat-value { font-size: 24px; font-weight: 800; color: #e8e8f0; }
  .stat-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .stat-critical .stat-value { color: #ff3b30; }
  .stat-score .stat-value { color: #34c759; }
  
  .layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    min-height: calc(100vh - 140px);
  }
  .panel {
    padding: 20px 24px;
    border-right: 1px solid #1a1a2e;
    overflow-y: auto;
    max-height: calc(100vh - 140px);
  }
  .panel:last-child { border-right: none; }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #1e1e3a;
  }
  .panel-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #a0a0c0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: #444;
  }
  .empty-state .icon { font-size: 40px; margin-bottom: 12px; }
  .empty-state .title { font-size: 14px; color: #666; margin-bottom: 8px; }
  .empty-state .hint { font-size: 12px; color: #444; line-height: 1.5; }
  .empty-state kbd {
    background: #1e1e3a;
    border: 1px solid #3a3a5a;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    color: #a0a0c0;
  }
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-shield">🛡️</div>
    <div>
      <div class="logo-text">Vibe Inspector</div>
      <div class="logo-sub">Bidirectional Guardrails for Vibe Coding</div>
    </div>
  </div>
  <div class="actions">
    <button class="btn" onclick="vscodePost('inspectPrompt')">⬆ Inspect Prompt</button>
    <button class="btn" onclick="vscodePost('inspectCode')">⬇ Inspect Code</button>
    <button class="btn" onclick="vscodePost('refresh')">↻ Refresh</button>
    <button class="btn" onclick="vscodePost('clearSession')" style="color:#ff6b6b;">⚠ Clear Session</button>
  </div>
</div>

<div class="stats-bar">
  <div class="stat">
    <div class="stat-value">${stats.totalPromptInspections}</div>
    <div class="stat-label">Prompts Inspected</div>
  </div>
  <div class="stat">
    <div class="stat-value">${stats.totalCodeInspections}</div>
    <div class="stat-label">Code Inspected</div>
  </div>
  <div class="stat">
    <div class="stat-value">${stats.totalFindings}</div>
    <div class="stat-label">Total Findings</div>
  </div>
  <div class="stat stat-critical">
    <div class="stat-value">${stats.criticalFindings}</div>
    <div class="stat-label">Critical Issues</div>
  </div>
  <div class="stat stat-score">
    <div class="stat-value">${stats.avgCodeScore ?? '—'}</div>
    <div class="stat-label">Avg Code Score</div>
  </div>
  <div class="stat">
    <div class="stat-value">${stats.highRiskPrompts}</div>
    <div class="stat-label">High-Risk Prompts</div>
  </div>
</div>

<div class="layout">
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">⬆ PRE-GENERATION · Prompt Inspector</div>
      <button class="btn btn-primary" onclick="vscodePost('inspectPrompt')" style="font-size:11px;padding:5px 10px;">Inspect Prompt</button>
    </div>
    ${promptResults.length === 0 ? `
    <div class="empty-state">
      <div class="icon">📝</div>
      <div class="title">No prompt inspections yet</div>
      <div class="hint">Select your vibe coding prompt text in the editor,<br>then press <kbd>Ctrl+Shift+V P</kbd> to inspect it<br>before submitting to an AI assistant.</div>
    </div>` : promptCards}
  </div>
  
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">⬇ POST-GENERATION · Code Inspector</div>
      <button class="btn btn-primary" onclick="vscodePost('inspectCode')" style="font-size:11px;padding:5px 10px;">Inspect Code</button>
    </div>
    ${codeResults.length === 0 ? `
    <div class="empty-state">
      <div class="icon">🔍</div>
      <div class="title">No code inspections yet</div>
      <div class="hint">After your AI assistant generates code,<br>select it in the editor and press <kbd>Ctrl+Shift+V C</kbd><br>to run security and quality analysis.</div>
    </div>` : codeCards}
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
function vscodePost(cmd) { vscode.postMessage({ command: cmd }); }
</script>
</body>
</html>`;
}
