// ─────────────────────────────────────────────────────────────────────────────
// Vibe Inspector — Core Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export type FindingCategory =
  | 'security'          // CWE-mapped vulnerability
  | 'technical-debt'    // Code quality / maintainability
  | 'context-drift'     // Deviates from Project Context Store
  | 'intent-mismatch'   // Prompt intent validation
  | 'scope-creep'       // Prompt touching unintended areas
  | 'ambiguity';        // Under-specified prompt

// ── Pre-Generation (Prompt Inspection) ───────────────────────────────────────

export interface PromptFinding {
  id: string;
  category: 'ambiguity' | 'scope-creep' | 'intent-mismatch' | 'context-drift';
  severity: Severity;
  title: string;
  description: string;
  suggestion: string;
}

export interface PromptInspectionResult {
  promptText: string;
  timestamp: number;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;           // 0–100
  findings: PromptFinding[];
  intentSummary: string;
  contextAlignment: number;    // 0–1, alignment with Project Context Store
  suggestedRefinements: string[];
  passedChecks: string[];
}

// ── Post-Generation (Code Inspection) ────────────────────────────────────────

export interface CodeFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  cweId?: string;              // e.g. "CWE-89"
  cweName?: string;            // e.g. "SQL Injection"
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;
  remediation: string;
  references?: string[];
}

export interface TechnicalDebtMetrics {
  debtDensity: number;         // findings per 100 LOC
  duplicatedBlocks: number;
  longFunctions: number;
  missingErrorHandling: number;
  hardcodedValues: number;
  missingTypes: number;
  complexityScore: number;     // 0–10
}

export interface SecurityMetrics {
  cweInstanceDensity: number;  // CWE findings per 100 LOC
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  topCwes: Array<{ cweId: string; cweName: string; count: number }>;
}

export interface CodeInspectionResult {
  filePath: string;
  language: string;
  timestamp: number;
  linesOfCode: number;
  overallScore: number;        // 0–100, higher = better
  findings: CodeFinding[];
  securityMetrics: SecurityMetrics;
  debtMetrics: TechnicalDebtMetrics;
  contextDriftScore: number;   // 0–1, 1 = perfect alignment
  summary: string;
  passedChecks: string[];
}

// ── Project Context Store ─────────────────────────────────────────────────────

export interface ProjectContextStore {
  version: string;
  projectName: string;
  description: string;
  lastUpdated: number;
  architecture: {
    pattern: string;           // e.g. "MVC", "Hexagonal", "Microservices"
    layers: string[];
    entryPoints: string[];
    forbiddenPatterns: string[];
  };
  security: {
    authMechanism: string;
    sensitiveDataFields: string[];
    forbiddenLibraries: string[];
    requiredSanitization: string[];
  };
  codeStyle: {
    language: string;
    framework: string;
    namingConventions: string;
    errorHandlingPattern: string;
    testingFramework: string;
  };
  scope: {
    inScope: string[];
    outOfScope: string[];
    criticalFiles: string[];
  };
  customRules: CustomRule[];
}

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  pattern?: string;            // regex
  check: 'contains' | 'missing' | 'pattern' | 'custom';
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface InspectionSession {
  id: string;
  startTime: number;
  promptInspections: PromptInspectionResult[];
  codeInspections: CodeInspectionResult[];
}

// ── Analysis Engine ───────────────────────────────────────────────────────────

export interface AnalysisEngine {
  analyzePrompt(prompt: string, context: ProjectContextStore | null): Promise<PromptInspectionResult>;
  analyzeCode(code: string, language: string, context: ProjectContextStore | null): Promise<CodeInspectionResult>;
}
