import {
  CodeFinding,
  CodeInspectionResult,
  ProjectContextStore,
  SecurityMetrics,
  Severity,
  TechnicalDebtMetrics,
} from '../types';

// ─── CWE Security Rules ───────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  cweId: string;
  cweName: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  languages?: string[];   // if set, only applies to these languages
  description: (match: string) => string;
  remediation: string;
  references: string[];
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: 'SEC-001',
    cweId: 'CWE-89',
    cweName: 'SQL Injection',
    severity: 'critical',
    title: 'Potential SQL Injection',
    pattern: /(`|'|")\s*\+\s*(?:req\.|request\.|params\.|query\.|body\.|input|user)/g,
    description: (m) => `String concatenation into what appears to be a query: \`${m}\``,
    remediation: 'Use parameterised queries or a prepared statement. Never concatenate user-controlled values into SQL strings.',
    references: ['https://owasp.org/www-community/attacks/SQL_Injection', 'https://cwe.mitre.org/data/definitions/89.html'],
  },
  {
    id: 'SEC-002',
    cweId: 'CWE-79',
    cweName: 'Cross-site Scripting (XSS)',
    severity: 'error',
    title: 'Potential XSS — innerHTML Assignment',
    pattern: /\.innerHTML\s*=/g,
    description: () => 'Direct innerHTML assignment can execute arbitrary scripts if the value contains user-controlled data.',
    remediation: 'Use textContent instead, or sanitise with a library like DOMPurify before assigning innerHTML.',
    references: ['https://owasp.org/www-community/attacks/xss/', 'https://cwe.mitre.org/data/definitions/79.html'],
  },
  {
    id: 'SEC-003',
    cweId: 'CWE-78',
    cweName: 'OS Command Injection',
    severity: 'critical',
    title: 'Potential Command Injection',
    pattern: /exec\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*(?:req\.|request\.|params\.|input|user))/g,
    description: (m) => `exec() called with what may be user-controlled input: \`${m}\``,
    remediation: 'Never pass user-controlled data to shell commands. Use allowlists and argument arrays (execFile/spawn with args array).',
    references: ['https://cwe.mitre.org/data/definitions/78.html'],
  },
  {
    id: 'SEC-004',
    cweId: 'CWE-798',
    cweName: 'Use of Hard-coded Credentials',
    severity: 'error',
    title: 'Hard-coded Secret Detected',
    pattern: /(?:password|passwd|secret|api_?key|apikey|token|auth)\s*[=:]\s*['"][^'"]{6,}['"]/gi,
    description: (m) => `Hard-coded credential-like value: \`${m.slice(0, 60)}\``,
    remediation: 'Move secrets to environment variables or a secrets manager. Never commit credentials to source control.',
    references: ['https://cwe.mitre.org/data/definitions/798.html'],
  },
  {
    id: 'SEC-005',
    cweId: 'CWE-327',
    cweName: 'Use of Weak Cryptographic Algorithm',
    severity: 'error',
    title: 'Weak Cryptographic Algorithm',
    pattern: /(?:createHash|createCipher)\s*\(\s*['"](?:md5|sha1|des|rc4)['"]/gi,
    description: (m) => `Weak cryptographic algorithm in use: \`${m}\``,
    remediation: 'Use SHA-256 or stronger for hashing; AES-256-GCM for encryption.',
    references: ['https://cwe.mitre.org/data/definitions/327.html'],
  },
  {
    id: 'SEC-006',
    cweId: 'CWE-22',
    cweName: 'Path Traversal',
    severity: 'critical',
    title: 'Potential Path Traversal',
    pattern: /(?:readFile|readFileSync|writeFile|writeFileSync|existsSync)\s*\([^)]*(?:req\.|request\.|params\.|query\.|body\.|input|user)/g,
    description: (m) => `File system operation with potentially user-controlled path: \`${m.slice(0, 80)}\``,
    remediation: 'Validate and sanitise file paths. Use path.resolve() and confirm the resolved path is within the allowed directory.',
    references: ['https://cwe.mitre.org/data/definitions/22.html'],
  },
  {
    id: 'SEC-007',
    cweId: 'CWE-601',
    cweName: 'Open Redirect',
    severity: 'warning',
    title: 'Potential Open Redirect',
    pattern: /res\.redirect\s*\([^)]*(?:req\.|request\.|params\.|query\.|body\.)/g,
    description: (m) => `redirect() called with possibly user-controlled URL: \`${m.slice(0, 80)}\``,
    remediation: 'Validate redirect URLs against an allowlist of known-safe destinations.',
    references: ['https://cwe.mitre.org/data/definitions/601.html'],
  },
  {
    id: 'SEC-008',
    cweId: 'CWE-400',
    cweName: 'Uncontrolled Resource Consumption',
    severity: 'warning',
    title: 'Missing Rate Limit / Resource Guard',
    pattern: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g,
    description: () => 'Infinite loop detected — ensure there is a proper exit condition and resource budget.',
    remediation: 'Add exit conditions, timeouts, and resource limits to prevent denial-of-service scenarios.',
    references: ['https://cwe.mitre.org/data/definitions/400.html'],
  },
  {
    id: 'SEC-009',
    cweId: 'CWE-502',
    cweName: 'Deserialization of Untrusted Data',
    severity: 'error',
    title: 'Unsafe Deserialisation',
    pattern: /eval\s*\(|Function\s*\(|new\s+Function\s*\(/g,
    description: (m) => `Dynamic code execution via \`${m.trim()}\` can execute attacker-controlled code.`,
    remediation: 'Never use eval() or the Function constructor with external data. Use JSON.parse() for data exchange.',
    references: ['https://cwe.mitre.org/data/definitions/502.html'],
  },
  {
    id: 'SEC-010',
    cweId: 'CWE-311',
    cweName: 'Missing Encryption of Sensitive Data',
    severity: 'warning',
    title: 'Sensitive Data in Console / Log',
    pattern: /console\.(?:log|info|debug|error)\s*\([^)]*(?:password|token|secret|key|auth|credential)/gi,
    description: (m) => `Sensitive field name in console output: \`${m.slice(0, 80)}\``,
    remediation: 'Never log sensitive values. Use structured logging with redaction middleware.',
    references: ['https://cwe.mitre.org/data/definitions/311.html'],
  },
];

// ─── Technical Debt Rules ─────────────────────────────────────────────────────

interface DebtRule {
  id: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  description: (m: string) => string;
  remediation: string;
  countField: keyof TechnicalDebtMetrics;
}

const DEBT_RULES: DebtRule[] = [
  {
    id: 'DEBT-001',
    severity: 'warning',
    title: 'TODO / FIXME Left in Generated Code',
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX|TEMP)[\s:]/gi,
    description: (m) => `Unresolved marker: "${m.trim()}"`,
    remediation: 'Resolve this marker before committing. AI-generated stubs should not be shipped as-is.',
    countField: 'hardcodedValues',
  },
  {
    id: 'DEBT-002',
    severity: 'warning',
    title: 'Magic Number / Hard-coded Value',
    pattern: /(?<!=)\b(?!0|1|2|100|true|false)\d{3,}\b/g,
    description: (m) => `Magic number: ${m}`,
    remediation: 'Extract to a named constant to improve readability and maintainability.',
    countField: 'hardcodedValues',
  },
  {
    id: 'DEBT-003',
    severity: 'info',
    title: 'Empty Catch Block',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    description: () => 'Empty catch block silently swallows errors.',
    remediation: 'Log or re-throw caught errors. Silently swallowing exceptions hides bugs.',
    countField: 'missingErrorHandling',
  },
  {
    id: 'DEBT-004',
    severity: 'warning',
    title: 'Missing Error Handling in Async',
    pattern: /await\s+\w+[^;]*(?<!\s*\.catch\s*\(|\s*try\s*\{)[;\n]/g,
    description: () => 'await expression without apparent try/catch or .catch() handler.',
    remediation: 'Wrap await calls in try/catch or chain .catch() to handle rejections.',
    countField: 'missingErrorHandling',
  },
  {
    id: 'DEBT-005',
    severity: 'info',
    title: 'Use of `any` Type (TypeScript)',
    pattern: /:\s*any\b/g,
    description: () => 'Use of TypeScript `any` type disables type checking.',
    remediation: 'Replace `any` with a specific type or `unknown`. Use `unknown` if the type is genuinely unknown.',
    countField: 'missingTypes',
  },
  {
    id: 'DEBT-006',
    severity: 'info',
    title: 'Non-null Assertion (`!`) Overuse',
    pattern: /\w+!\./g,
    description: (m) => `Non-null assertion: ${m}`,
    remediation: 'Use optional chaining (?.) or explicit null checks instead of non-null assertions.',
    countField: 'missingTypes',
  },
];

// ─── Utility helpers ──────────────────────────────────────────────────────────

function getLineColumn(code: string, index: number): { line: number; column: number } {
  const before = code.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1] || '').length + 1 };
}

function countLines(code: string): number {
  return code.split('\n').filter((l) => l.trim().length > 0).length;
}

// ─── Context drift ────────────────────────────────────────────────────────────

function detectContextDrift(
  code: string,
  ctx: ProjectContextStore | null
): { findings: CodeFinding[]; score: number } {
  if (!ctx) { return { findings: [], score: 1.0 }; }

  const findings: CodeFinding[] = [];
  const lower = code.toLowerCase();

  // Forbidden library usage
  for (const lib of ctx.security.forbiddenLibraries) {
    if (lower.includes(`require('${lib}')`) ||
        lower.includes(`require("${lib}")`) ||
        lower.includes(`from '${lib}'`) ||
        lower.includes(`from "${lib}"`)) {
      findings.push({
        id: `CTX-DRIFT-LIB-${lib}`,
        category: 'context-drift',
        severity: 'error',
        title: `Forbidden Library: ${lib}`,
        description: `The library "${lib}" is forbidden according to your Project Context Store.`,
        remediation: `Remove "${lib}" and use the approved alternative from your project context.`,
      });
    }
  }

  // Forbidden code patterns
  for (const pattern of ctx.architecture.forbiddenPatterns) {
    if (code.includes(pattern)) {
      findings.push({
        id: `CTX-DRIFT-PAT-${pattern}`,
        category: 'context-drift',
        severity: 'error',
        title: `Forbidden Pattern: ${pattern}`,
        description: `Pattern "${pattern}" is explicitly forbidden in your Project Context Store.`,
        remediation: 'Remove this pattern and use the architectural alternatives defined in your project context.',
      });
    }
  }

  // Sensitive data field exposure
  for (const field of ctx.security.sensitiveDataFields) {
    const sensitiveRegex = new RegExp(`console\\.(?:log|info|debug)\\([^)]*${field}`, 'gi');
    if (sensitiveRegex.test(code)) {
      findings.push({
        id: `CTX-DRIFT-SENS-${field}`,
        category: 'context-drift',
        severity: 'warning',
        title: `Sensitive Field Logged: ${field}`,
        description: `Field "${field}" is classified as sensitive in your context but appears in a log statement.`,
        remediation: 'Remove sensitive fields from logs or apply redaction.',
      });
    }
  }

  const driftPenalty = findings.reduce((sum, f) => {
    const w: Record<Severity, number> = { info: 0.05, warning: 0.1, error: 0.2, critical: 0.4 };
    return sum + w[f.severity];
  }, 0);

  return { findings, score: Math.max(0, 1 - driftPenalty) };
}

// ─── Metrics calculation ──────────────────────────────────────────────────────

function buildSecurityMetrics(findings: CodeFinding[], loc: number): SecurityMetrics {
  const secFindings = findings.filter((f) => f.category === 'security');
  const cweCounts: Record<string, { cweName: string; count: number }> = {};

  for (const f of secFindings) {
    if (f.cweId) {
      if (!cweCounts[f.cweId]) { cweCounts[f.cweId] = { cweName: f.cweName || '', count: 0 }; }
      cweCounts[f.cweId].count++;
    }
  }

  return {
    cweInstanceDensity: loc > 0 ? (secFindings.length / loc) * 100 : 0,
    criticalCount: secFindings.filter((f) => f.severity === 'critical').length,
    errorCount: secFindings.filter((f) => f.severity === 'error').length,
    warningCount: secFindings.filter((f) => f.severity === 'warning').length,
    infoCount: secFindings.filter((f) => f.severity === 'info').length,
    topCwes: Object.entries(cweCounts)
      .map(([cweId, { cweName, count }]) => ({ cweId, cweName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

function buildDebtMetrics(findings: CodeFinding[], loc: number): TechnicalDebtMetrics {
  const debtFindings = findings.filter((f) => f.category === 'technical-debt');
  return {
    debtDensity: loc > 0 ? (debtFindings.length / loc) * 100 : 0,
    duplicatedBlocks: 0, // requires AST-level analysis
    longFunctions: 0,    // requires AST-level analysis
    missingErrorHandling: debtFindings.filter((f) => f.id.startsWith('DEBT-00') &&
      ['DEBT-003', 'DEBT-004'].includes(f.id.split('-').slice(0, 2).join('-'))).length,
    hardcodedValues: debtFindings.filter((f) => ['DEBT-001', 'DEBT-002'].includes(f.id.split('-').slice(0, 2).join('-'))).length,
    missingTypes: debtFindings.filter((f) => ['DEBT-005', 'DEBT-006'].includes(f.id.split('-').slice(0, 2).join('-'))).length,
    complexityScore: Math.min(10, debtFindings.length / 2),
  };
}

function computeOverallScore(
  secMetrics: SecurityMetrics,
  debtMetrics: TechnicalDebtMetrics,
  contextDriftScore: number
): number {
  let score = 100;
  score -= secMetrics.criticalCount * 20;
  score -= secMetrics.errorCount * 10;
  score -= secMetrics.warningCount * 5;
  score -= debtMetrics.debtDensity * 2;
  score -= (1 - contextDriftScore) * 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Positive checks ──────────────────────────────────────────────────────────

const CODE_PASSED_TESTS: Array<{ label: string; test: (code: string) => boolean }> = [
  { label: 'Uses try/catch for error handling', test: (c) => /try\s*\{/.test(c) },
  { label: 'Includes JSDoc or inline comments', test: (c) => /\/\*\*|\/\/\s*[A-Z]/.test(c) },
  { label: 'Uses const / let instead of var', test: (c) => !/\bvar\b/.test(c) },
  { label: 'No eval() usage', test: (c) => !/\beval\s*\(/.test(c) },
  { label: 'No innerHTML assignments', test: (c) => !/.innerHTML\s*=/.test(c) },
  { label: 'Parameterised queries used', test: (c) => /\?\s*,|\$\d+|:(?:name|id|value)/.test(c) },
  { label: 'Input validation present', test: (c) => /validate|sanitize|sanitise|escape|isValid/i.test(c) },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzeCodeStatic(
  code: string,
  language: string,
  filePath: string,
  ctx: ProjectContextStore | null
): CodeInspectionResult {
  const findings: CodeFinding[] = [];
  const loc = countLines(code);

  // Security scan
  for (const rule of SECURITY_RULES) {
    if (rule.languages && !rule.languages.includes(language.toLowerCase())) { continue; }

    let match: RegExpExecArray | null;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    while ((match = re.exec(code)) !== null) {
      const { line, column } = getLineColumn(code, match.index);
      findings.push({
        id: `${rule.id}-L${line}`,
        category: 'security',
        cweId: rule.cweId,
        cweName: rule.cweName,
        severity: rule.severity,
        title: rule.title,
        description: rule.description(match[0]),
        line,
        column,
        snippet: match[0].slice(0, 80),
        remediation: rule.remediation,
        references: rule.references,
      });
    }
  }

  // Debt scan
  for (const rule of DEBT_RULES) {
    let match: RegExpExecArray | null;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    while ((match = re.exec(code)) !== null) {
      const { line, column } = getLineColumn(code, match.index);
      findings.push({
        id: `${rule.id}-L${line}`,
        category: 'technical-debt',
        severity: rule.severity,
        title: rule.title,
        description: rule.description(match[0]),
        line,
        column,
        snippet: match[0].slice(0, 80),
        remediation: rule.remediation,
      });
    }
  }

  // Context drift scan
  const { findings: driftFindings, score: contextDriftScore } = detectContextDrift(code, ctx);
  findings.push(...driftFindings);

  // Metrics
  const securityMetrics = buildSecurityMetrics(findings, loc);
  const debtMetrics = buildDebtMetrics(findings, loc);
  const overallScore = computeOverallScore(securityMetrics, debtMetrics, contextDriftScore);

  const passedChecks = CODE_PASSED_TESTS
    .filter((c) => c.test(code))
    .map((c) => c.label);

  const critCount = findings.filter((f) => f.severity === 'critical').length;
  const errCount = findings.filter((f) => f.severity === 'error').length;
  let summary: string;
  if (critCount > 0) {
    summary = `⛔ ${critCount} critical issue(s) found. Do not merge without remediation.`;
  } else if (errCount > 0) {
    summary = `🔴 ${errCount} error-level issue(s) found. Review before committing.`;
  } else if (findings.length > 0) {
    summary = `🟡 ${findings.length} finding(s) at warning/info level. Review recommended.`;
  } else {
    summary = '✅ No static issues detected. Consider AI-powered deep analysis for edge cases.';
  }

  return {
    filePath,
    language,
    timestamp: Date.now(),
    linesOfCode: loc,
    overallScore,
    findings,
    securityMetrics,
    debtMetrics,
    contextDriftScore,
    summary,
    passedChecks,
  };
}
