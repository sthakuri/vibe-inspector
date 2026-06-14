# Vibe Inspector

A VS Code extension that adds a bidirectional guardrails layer to AI-assisted (vibe) coding workflows. It validates prompts before you send them to an AI assistant, and inspects the generated code afterwards for security vulnerabilities, technical debt, and architectural drift.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Project Context Store](#project-context-store)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Security Rules](#security-rules)
- [Technical Debt Rules](#technical-debt-rules)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Building from Source](#building-from-source)
- [Research Context](#research-context)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Vibe coding — writing software by describing intent in natural language to an AI assistant rather than writing code line by line — introduces two failure points that traditional static analysis does not cover: an underspecified or risky prompt that produces bad code before a single line exists, and generated code that may contain security vulnerabilities or violate the project's architectural conventions.

Vibe Inspector addresses both. It intercepts at the prompt stage to catch ambiguity, scope creep, and context misalignment, then intercepts again after generation to run CWE-mapped security scans, technical debt heuristics, and architectural drift detection against a project-specific context file.

---

## How It Works

```
Your Prompt
    |
    v
Pre-Generation Inspection     <-- Vibe Inspector (Stage 1)
    |
    v
AI Assistant (Copilot, Cursor, etc.)
    |
    v
Generated Code
    |
    v
Post-Generation Inspection    <-- Vibe Inspector (Stage 2)
    |
    v
Reviewed, Safe Output
```

**Stage 1 — Pre-Generation.** You write a natural-language prompt and run the prompt inspector before submitting it to any AI tool. Vibe Inspector scores the prompt for risk, flags ambiguities, scope creep, and intent mismatches, and suggests concrete refinements.

**Stage 2 — Post-Generation.** After your AI assistant produces code, you run the code inspector on the output. Vibe Inspector applies CWE-mapped regex rules, technical debt heuristics, and compares the code against your Project Context Store. Findings appear as inline diagnostics and in the dashboard.

---

## Features

### Pre-Generation

- Risk scoring from 0 to 100 with a low, medium, high, or critical classification
- Ambiguity detection for vague action verbs, missing acceptance criteria, and absent language context
- Scope creep detection for compound prompts and references to out-of-scope areas
- Intent classification into feature, bug-fix, refactor, test, or documentation categories
- Context alignment scoring against the Project Context Store
- Suggested prompt refinements

### Post-Generation

- Ten CWE-mapped security rules covering SQL injection, XSS, command injection, hard-coded credentials, weak cryptography, path traversal, open redirect, resource exhaustion, unsafe deserialization, and sensitive data in logs
- Technical debt heuristics for TODOs, magic numbers, empty catch blocks, unhandled async rejections, and TypeScript `any` type usage
- Architectural drift detection comparing generated code against forbidden patterns, forbidden libraries, and sensitive field exposure defined in the Project Context Store
- Inline VS Code diagnostics with line-precise location
- Composite quality score with CWE density, debt density, and context alignment breakdown
- Optional AI-enhanced semantic analysis via the Anthropic API

### Dashboard and Sidebar

- Side-by-side session view of all prompt and code inspections
- Running statistics for total findings, critical issues, and average code score
- Project Context Store tree view with live reload on file save

---

## Requirements

- VS Code version 1.85 or later
- Node.js version 18 or later (for building from source only)
- An Anthropic API key (optional; required only for AI-enhanced analysis)

---

## Installation

### From VSIX

Download the latest `vibe-inspector-x.x.x.vsix` from the [Releases](https://github.com/your-username/vibe-inspector/releases) page, then install it in one of two ways.

**Via the command line:**

```bash
code --install-extension vibe-inspector-0.1.0.vsix
```

**Via the VS Code UI:**

Open the Command Palette with `Ctrl+Shift+P`, run `Extensions: Install from VSIX`, and select the downloaded file.

Reload VS Code when prompted. The extension activates automatically on startup.

### From the VS Code Marketplace

```
ext install your-publisher.vibe-inspector
```

*(Not yet published. Use the VSIX method above.)*

---

## Project Context Store

The Project Context Store is a JSON file at `.vibe-inspector/context.json` in your workspace root. It tells Vibe Inspector about your project's architecture, security requirements, coding conventions, and scope boundaries. All context-aware checks — forbidden libraries, out-of-scope topic detection, critical file warnings, sensitive field tracking — read from this file.

### Initializing the Store

Open the Command Palette and run:

```
Vibe Inspector: Initialize Project Context Store
```

This creates `.vibe-inspector/context.json` with a pre-filled template and opens it for editing. The file is watched for changes; edits take effect on save without restarting VS Code.

### Schema

```jsonc
{
  "version": "1.0",
  "projectName": "My App",
  "description": "Express + TypeScript REST API",

  "architecture": {
    "pattern": "MVC",
    "layers": ["presentation", "business", "data"],
    "entryPoints": ["src/index.ts"],
    "forbiddenPatterns": ["eval(", "document.write(", "innerHTML ="]
  },

  "security": {
    "authMechanism": "JWT",
    "sensitiveDataFields": ["password", "token", "ssn", "creditCard"],
    "forbiddenLibraries": ["moment", "lodash"],
    "requiredSanitization": ["user input", "query parameters"]
  },

  "codeStyle": {
    "language": "TypeScript",
    "framework": "Express",
    "namingConventions": "camelCase variables, PascalCase classes",
    "errorHandlingPattern": "try/catch with typed errors",
    "testingFramework": "Jest"
  },

  "scope": {
    "inScope": ["feature implementation", "bug fixes", "refactoring"],
    "outOfScope": ["database schema changes", "CI/CD", "infrastructure"],
    "criticalFiles": ["src/auth/", "src/database/"]
  },

  "customRules": [
    {
      "id": "CUSTOM-001",
      "name": "No direct DB calls in controllers",
      "description": "Controllers must go through the service layer",
      "severity": "warning",
      "pattern": "db\\.(query|execute)\\(",
      "check": "pattern"
    }
  ]
}
```

### Field Reference

| Field | Effect |
|---|---|
| `architecture.forbiddenPatterns` | Exact string matches in generated code trigger a context-drift error finding |
| `security.forbiddenLibraries` | Import or require of a listed library triggers an error finding |
| `security.sensitiveDataFields` | Listed field names appearing in console calls trigger a warning finding |
| `scope.outOfScope` | Prompt containing a listed topic triggers a scope-creep error finding |
| `scope.criticalFiles` | Prompt targeting a listed path triggers a critical severity finding |
| `customRules` | Regex-based rules appended to the post-generation scan |

---

## Usage

### Inspect a Prompt

1. Write your vibe coding prompt in any editor tab, or type it fresh.
2. Select the text if it is in a file, or leave nothing selected to type it interactively.
3. Press `Ctrl+Shift+V P` or run `Vibe Inspector: Inspect Prompt Before Generation` from the Command Palette.
4. If text is selected, confirm whether to inspect it or type a new prompt.
5. Review the risk score and findings in the notification and dashboard.

### Inspect Generated Code

1. Open the file containing AI-generated code, or paste the code into any editor tab.
2. Select the code you want to inspect, or leave nothing selected to inspect the entire file.
3. Press `Ctrl+Shift+V C` or run `Vibe Inspector: Inspect Generated Code`.
4. Findings appear as inline squiggles immediately. Open the Problems panel or the dashboard for the full report.

### Open the Dashboard

Press `Ctrl+Shift+V D` or click the shield icon in the Activity Bar. The dashboard shows all inspections from the current session side by side, with per-inspection finding cards, quality scores, and running session statistics.

### Right-Click Menu

When text is selected in any editor, right-clicking shows two Vibe Inspector entries at the bottom of the context menu: Inspect Prompt Before Generation and Inspect Generated Code.

---

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Inspect prompt | `Ctrl+Shift+V P` | `Cmd+Shift+V P` |
| Inspect code | `Ctrl+Shift+V C` | `Cmd+Shift+V C` |
| Open dashboard | `Ctrl+Shift+V D` | `Cmd+Shift+V D` |

All shortcuts can be rebound in VS Code's Keyboard Shortcuts editor (`Ctrl+K Ctrl+S`).

### Command Palette Reference

| Command | Description |
|---|---|
| `Vibe Inspector: Inspect Prompt Before Generation` | Analyze a prompt for risk, ambiguity, and context alignment |
| `Vibe Inspector: Inspect Generated Code` | Run security and quality analysis on the selected code or active file |
| `Vibe Inspector: Open Dashboard` | Open the full inspection dashboard panel |
| `Vibe Inspector: Initialize Project Context Store` | Create `.vibe-inspector/context.json` with a pre-filled template |
| `Vibe Inspector: Edit Project Context Store` | Open `context.json` for editing |
| `Vibe Inspector: Clear Session History` | Reset all inspection results for this workspace session |

---

## Configuration

All settings are available under `Extensions > Vibe Inspector` in VS Code Settings, or directly in `settings.json`.

### API

| Setting | Type | Default | Description |
|---|---|---|---|
| `vibeInspector.apiKey` | string | `""` | Anthropic API key for AI-enhanced analysis. Store in user settings, not workspace settings, to avoid committing it to source control. |

### Pre-Generation

| Setting | Type | Default | Description |
|---|---|---|---|
| `vibeInspector.preGeneration.enabled` | boolean | `true` | Enable or disable prompt inspection. |
| `vibeInspector.preGeneration.blockOnHighRisk` | boolean | `false` | Show a blocking modal dialog when a prompt scores high or critical risk. |

### Post-Generation

| Setting | Type | Default | Description |
|---|---|---|---|
| `vibeInspector.postGeneration.enabled` | boolean | `true` | Enable or disable code inspection. |
| `vibeInspector.postGeneration.securityScan` | boolean | `true` | Run the CWE-mapped security rule scan. |
| `vibeInspector.postGeneration.debtScan` | boolean | `true` | Run technical debt heuristic rules. |
| `vibeInspector.postGeneration.contextDrift` | boolean | `true` | Compare generated code against the Project Context Store. |

### Display

| Setting | Type | Default | Description |
|---|---|---|---|
| `vibeInspector.diagnostics.enabled` | boolean | `true` | Show findings as inline VS Code squiggles. |
| `vibeInspector.severity.minDisplay` | string | `"info"` | Minimum severity to display. Options: `info`, `warning`, `error`. |

### Example settings.json

```json
{
  "vibeInspector.apiKey": "sk-ant-...",
  "vibeInspector.preGeneration.blockOnHighRisk": true,
  "vibeInspector.postGeneration.securityScan": true,
  "vibeInspector.postGeneration.contextDrift": true,
  "vibeInspector.severity.minDisplay": "warning",
  "vibeInspector.diagnostics.enabled": true
}
```

---

## Security Rules

Each rule fires when its pattern matches anywhere in the inspected code. Findings include the CWE identifier, line number, matched snippet, and a remediation note.

| Rule ID | CWE | Name | Severity | What It Detects |
|---|---|---|---|---|
| SEC-001 | CWE-89 | SQL Injection | critical | String concatenation of request parameters into a query string |
| SEC-002 | CWE-79 | Cross-site Scripting | error | Direct `.innerHTML =` assignment |
| SEC-003 | CWE-78 | OS Command Injection | critical | Template literal or concatenated user input passed to `exec()` |
| SEC-004 | CWE-798 | Hard-coded Credentials | error | Password, token, secret, or API key assigned as a string literal |
| SEC-005 | CWE-327 | Weak Cryptographic Algorithm | error | `createHash` or `createCipher` called with `md5`, `sha1`, `des`, or `rc4` |
| SEC-006 | CWE-22 | Path Traversal | critical | File system functions called with request parameters as path arguments |
| SEC-007 | CWE-601 | Open Redirect | warning | `res.redirect()` called with a request-parameter-derived value |
| SEC-008 | CWE-400 | Uncontrolled Resource Consumption | warning | Infinite loop patterns without guarded exit conditions |
| SEC-009 | CWE-502 | Unsafe Deserialization | error | Use of `eval()`, `Function()`, or `new Function()` |
| SEC-010 | CWE-311 | Sensitive Data in Logs | warning | Sensitive field names appearing in `console.log` or `console.info` calls |

---

## Technical Debt Rules

| Rule ID | Name | Severity | What It Detects |
|---|---|---|---|
| DEBT-001 | TODO / FIXME Left in Generated Code | warning | Unresolved `TODO`, `FIXME`, `HACK`, `XXX`, or `TEMP` comment markers |
| DEBT-002 | Magic Number | warning | Numeric literals of three or more digits not assigned to a named constant |
| DEBT-003 | Empty Catch Block | info | `catch` block with an empty body that silently swallows errors |
| DEBT-004 | Missing Async Error Handling | warning | `await` expression with no apparent `try/catch` or `.catch()` handler |
| DEBT-005 | Use of `any` Type | info | TypeScript `: any` annotation that disables type checking |
| DEBT-006 | Non-null Assertion Overuse | info | Non-null assertion operator `!.` used in place of a proper null check |

---

## Testing

The tests below verify each major capability after installation. Each entry specifies what to do and what to expect.

### Pre-Generation Tests

**PT-001 — Vague prompt**

Input: `fix it and make it work`

Action: `Ctrl+Shift+V P`, then type the input when prompted.

Expected: Finding "Vague action verb" at warning severity. Risk score at or above 20. Suggestion to be more specific.

---

**PT-002 — No acceptance criterion**

Input: `Add pagination to the user list endpoint`

Action: `Ctrl+Shift+V P`

Expected: Finding "No acceptance criterion" at info severity. Suggestion to describe expected output.

---

**PT-003 — Out-of-scope topic**

Setup: Ensure `context.json` contains `"outOfScope": ["database schema changes"]`

Input: `Add a new column to the users table for database schema changes`

Action: `Ctrl+Shift+V P`

Expected: Finding "Out-of-scope area mentioned" at error severity, category scope-creep.

---

**PT-004 — Critical file targeted**

Setup: Ensure `context.json` contains `"criticalFiles": ["src/auth/"]`

Input: `Refactor the auth module to remove the token validation check`

Action: `Ctrl+Shift+V P`

Expected: Finding "Critical file area targeted" at critical severity. Overall risk level: critical.

---

**PT-005 — Clean, well-formed prompt**

Input: `In TypeScript with Express, add a GET /users/:id endpoint that returns the user object. It should return 404 if not found. Include Jest unit tests.`

Action: `Ctrl+Shift+V P`

Expected: Risk level low. Score at or below 15. Passed checks include "Specifies target file or function", "Includes example or expected output", and "Mentions testing requirement".

---

### Post-Generation Security Tests

For each test: create a new `.ts` file, paste the snippet, then press `Ctrl+Shift+V C`.

**ST-001 — SQL Injection (CWE-89)**

```typescript
const result = await db.query("SELECT * FROM users WHERE id = " + req.params.id);
```

Expected: Finding "Potential SQL Injection", CWE-89, critical severity, inline squiggle on the concatenation line.

---

**ST-002 — XSS via innerHTML (CWE-79)**

```typescript
document.getElementById('output').innerHTML = userInput;
```

Expected: Finding "Potential XSS — innerHTML Assignment", CWE-79, error severity.

---

**ST-003 — Hard-coded Credentials (CWE-798)**

```typescript
const apiKey = "sk-prod-abc123secret456";
```

Expected: Finding "Hard-coded Secret Detected", CWE-798, error severity.

---

**ST-004 — Command Injection (CWE-78)**

```typescript
exec(`ls -la ${req.query.path}`, callback);
```

Expected: Finding "Potential Command Injection", CWE-78, critical severity.

---

**ST-005 — Weak Cryptography (CWE-327)**

```typescript
const hash = crypto.createHash('md5').update(password).digest('hex');
```

Expected: Finding "Weak Cryptographic Algorithm", CWE-327, error severity.

---

**ST-006 — Path Traversal (CWE-22)**

```typescript
const content = fs.readFileSync(req.query.filename, 'utf8');
```

Expected: Finding "Potential Path Traversal", CWE-22, critical severity.

---

**ST-007 — Unsafe Deserialization (CWE-502)**

```typescript
const result = eval(userProvidedExpression);
```

Expected: Finding "Unsafe Deserialisation", CWE-502, error severity.

---

**ST-008 — Sensitive Data in Logs (CWE-311)**

```typescript
console.log("User auth token:", user.token);
```

Expected: Finding "Sensitive Data in Console / Log", CWE-311, warning severity.

---

**ST-009 — Open Redirect (CWE-601)**

```typescript
res.redirect(req.query.returnUrl);
```

Expected: Finding "Potential Open Redirect", CWE-601, warning severity.

---

**ST-010 — Clean, secure code (control)**

```typescript
const result = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
```

Expected: No security findings. Passed checks include "Parameterised queries used". Overall score at or above 90.

---

### Technical Debt Tests

**DT-001 — TODO marker**

```typescript
// TODO: implement rate limiting here
```

Expected: Finding "TODO / FIXME Left in Generated Code", warning severity, category technical-debt.

---

**DT-002 — Empty catch block**

```typescript
try { await riskyOperation(); } catch (e) {}
```

Expected: Finding "Empty Catch Block", info severity.

---

**DT-003 — TypeScript any type**

```typescript
function processData(input: any): any { return input; }
```

Expected: Two findings for "Use of `any` Type", info severity.

---

**DT-004 — Magic number**

```typescript
if (users.length > 500) { throw new Error("Limit exceeded"); }
```

Expected: Finding "Magic Number / Hard-coded Value" for the literal 500, warning severity.

---

**DT-005 — Debt density metric**

Input: A 50-line file containing 3 TODO comments and 2 uses of `any`.

Expected: `debtMetrics.debtDensity` approximately 10.0, calculated as 5 findings divided by 50 lines multiplied by 100. Visible in the dashboard code card.

---

### Context Store Tests

**CT-001 — Forbidden library import**

Setup: Set `"security.forbiddenLibraries": ["moment"]` in `context.json`.

```typescript
import moment from 'moment';
```

Expected: Finding "Forbidden Library: moment", context-drift category, error severity.

---

**CT-002 — Forbidden pattern**

Setup: Set `"architecture.forbiddenPatterns": ["innerHTML ="]` in `context.json`.

```typescript
el.innerHTML = data;
```

Expected: Finding "Forbidden Pattern: innerHTML =", context-drift category, error severity, in addition to the CWE-79 finding.

---

**CT-003 — Context hot-reload**

Action: Add a new library name to `security.forbiddenLibraries` in `context.json` and save the file.

Expected: The Project Context Store sidebar refreshes automatically. The next inspection uses the updated rule. No VS Code restart needed.

---

## Project Structure

```
vibe-inspector/
├── src/
│   ├── extension.ts                      Entry point and command registration
│   ├── types.ts                          All shared TypeScript interfaces
│   ├── analysis/
│   │   ├── promptAnalyzer.ts             Pre-generation heuristic rule engine
│   │   ├── codeAnalyzer.ts               CWE and debt static analysis rules
│   │   └── aiAnalyzer.ts                 Anthropic API layer for semantic analysis
│   ├── context/
│   │   ├── ProjectContextManager.ts      context.json read, write, and file watch
│   │   └── SessionManager.ts             Inspection history and session statistics
│   ├── providers/
│   │   ├── DiagnosticsProvider.ts        VS Code inline diagnostics
│   │   └── TreeProviders.ts              Sidebar session and context tree views
│   └── ui/
│       └── DashboardPanel.ts             WebView HTML generator for the dashboard
├── media/
│   ├── shield.svg                        Activity bar icon
│   └── icon.png                          Extension marketplace icon
├── .vibe-inspector/
│   └── context.json                      Project context (commit or gitignore as preferred)
├── package.json                          Extension manifest and VS Code contribution points
└── tsconfig.json                         TypeScript compiler configuration
```

---

## Building from Source

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-username/vibe-inspector.git
cd vibe-inspector
npm install
```

Compile TypeScript:

```bash
npm run compile
```

To watch for changes during development:

```bash
npm run watch
```

Launch in the Extension Development Host by opening the project folder in VS Code and pressing `F5`. A new VS Code window opens with the extension loaded.

To package as a distributable `.vsix` file:

```bash
npm install -g @vscode/vsce
vsce package --allow-missing-repository
```

This produces `vibe-inspector-0.1.0.vsix` in the project root.

---

## Research Context

Vibe Inspector is the implementation artifact for an empirical study targeting ICSE 2027. The evaluation design is a preregistered controlled experiment comparing two participant groups: one using Vibe Inspector during vibe coding sessions and one without. The primary outcome measures are CWE instance density and technical debt density in the produced code.

### Metrics Recorded Per Inspection

| Metric | Location in Session Data | Description |
|---|---|---|
| `cweInstanceDensity` | `codeInspections[n].securityMetrics` | CWE findings per 100 lines of code |
| `debtDensity` | `codeInspections[n].debtMetrics` | Debt findings per 100 lines of code |
| `contextDriftScore` | `codeInspections[n]` | 0 to 1 float; 1 indicates full alignment with the context store |
| `overallScore` | `codeInspections[n]` | Composite 0 to 100 quality score |
| `riskScore` | `promptInspections[n]` | Weighted prompt risk score from 0 to 100 |
| `contextAlignment` | `promptInspections[n]` | 0 to 1 float; fraction of context checks the prompt passes |
| `overallRisk` | `promptInspections[n]` | Derived risk level: low, medium, high, or critical |

### Accessing Session Data

Session data is persisted in VS Code workspace state and can be extracted as follows:

```typescript
const session = context.workspaceState.get('vibeInspectorSession');
// session.codeInspections[n].securityMetrics.cweInstanceDensity
// session.codeInspections[n].debtMetrics.debtDensity
// session.codeInspections[n].contextDriftScore
// session.promptInspections[n].riskScore
```

### Publication Targets

| Venue | Track | Role |
|---|---|---|
| ICSE 2027 | Technical Research | Primary target |
| FSE 2027 | Technical Research | Backup |
| RAISE / RAIE at ICSE | Workshop | Condensed 4 to 8 page parallel submission |
| EMSE / IEEE TSE | Journal | Long-form path |

---

## Contributing

Bug reports and pull requests are welcome.

When reporting a false positive or false negative, include the exact code snippet, the finding you received or expected to receive, and the language identifier VS Code assigned to the file (`Ctrl+Shift+P` > "Change Language Mode" shows the current value).

To add a security rule, extend the `SECURITY_RULES` array in `src/analysis/codeAnalyzer.ts`. Each entry requires an `id`, `cweId`, `cweName`, `severity`, `title`, regex `pattern`, `description` function, `remediation` string, and `references` array.

To add a prompt rule, extend the `PROMPT_RULES` array in `src/analysis/promptAnalyzer.ts`. Each entry requires an `id`, `category`, `severity`, `title`, `test` function receiving the prompt text and context store, and a `suggestion` string.

---

## License

MIT License. See [LICENSE.txt](LICENSE.txt) for the full text.
