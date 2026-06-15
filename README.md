# Vibe Inspector

A VS Code extension that adds bidirectional guardrails to AI-assisted ("vibe") coding. It checks your prompts *before* you send them to an AI assistant, and scans the generated code *afterwards* for security issues, technical debt, and architectural drift.

## How It Works

```
Your Prompt --> Pre-Generation Inspection --> AI Assistant --> Generated Code --> Post-Generation Inspection
```

- **Pre-Generation**: Scores your prompt for risk (0-100), flags ambiguity, scope creep, and intent mismatches, and suggests refinements.
- **Post-Generation**: Runs CWE-mapped security rules, technical debt heuristics, and compares the code against your Project Context Store. Findings show up as inline diagnostics and in the dashboard.

## Features

- **Pre-Generation**: risk scoring, ambiguity/scope-creep detection, intent classification, context alignment, refinement suggestions
- **Post-Generation**: 10 CWE-mapped security rules (SQLi, XSS, command injection, hard-coded secrets, weak crypto, path traversal, open redirect, resource exhaustion, unsafe deserialization, sensitive data in logs), technical debt heuristics, architectural drift detection, inline diagnostics, composite quality score
- **Optional**: AI-enhanced semantic analysis via the Anthropic API
- **Dashboard & Sidebar**: session view of all inspections, running stats, live Project Context Store tree

## Requirements

- VS Code 1.85+
- Node.js 18+ (for building from source only)
- Anthropic API key (optional, for AI-enhanced analysis)

## Installation

### From VSIX

```bash
code --install-extension vibe-inspector-0.1.0.vsix
```

Or via the UI: Command Palette (`Ctrl+Shift+P`) > `Extensions: Install from VSIX`.

### From the Marketplace

Not yet published.

## Project Context Store

A JSON file at `.vibe-inspector/context.json` describing your project's architecture, security rules, conventions, and scope boundaries. Context-aware checks (forbidden libraries/patterns, out-of-scope topics, critical files, sensitive fields, custom rules) all read from this file.

Create it with `Vibe Inspector: Initialize Project Context Store` from the Command Palette, then edit it with `Vibe Inspector: Edit Project Context Store`. Changes are picked up on save, no restart needed.

## Usage

| Action | Shortcut | Command |
|---|---|---|
| Inspect prompt | `Ctrl+Shift+V P` | `Vibe Inspector: Inspect Prompt Before Generation` |
| Inspect generated code | `Ctrl+Shift+V C` | `Vibe Inspector: Inspect Generated Code` |
| Open dashboard | `Ctrl+Shift+V D` | `Vibe Inspector: Open Dashboard` |

Select text and run the prompt/code commands to inspect just that selection, or run with nothing selected to inspect interactively (prompt) or the whole file (code). Both commands are also available via right-click when text is selected.

## Configuration

All settings live under `Extensions > Vibe Inspector` in VS Code Settings:

| Setting | Default | Description |
|---|---|---|
| `vibeInspector.apiKey` | `""` | Anthropic API key for AI-enhanced analysis (set in user settings, not workspace) |
| `vibeInspector.preGeneration.enabled` | `true` | Enable prompt inspection |
| `vibeInspector.preGeneration.blockOnHighRisk` | `false` | Block on high/critical risk prompts |
| `vibeInspector.postGeneration.enabled` | `true` | Enable code inspection |
| `vibeInspector.postGeneration.securityScan` | `true` | Run CWE security rules |
| `vibeInspector.postGeneration.debtScan` | `true` | Run technical debt heuristics |
| `vibeInspector.postGeneration.contextDrift` | `true` | Compare against Project Context Store |
| `vibeInspector.diagnostics.enabled` | `true` | Show inline squiggles |
| `vibeInspector.severity.minDisplay` | `"info"` | Minimum severity shown (`info`/`warning`/`error`) |

## Building from Source

```bash
git clone https://github.com/sthakuri/vibe-inspector.git
cd vibe-inspector
npm install
npm run compile
```

To develop with live recompilation, run `npm run watch`, then open the project in VS Code and press `F5` to launch the Extension Development Host.

To package as a `.vsix`:

```bash
npm install -g @vscode/vsce
mkdir distributions
vsce package --allow-missing-repository -o distributions/
```

This produces `distributions/vibe-inspector-0.1.0.vsix`.

## Contributing

Bug reports and pull requests are welcome. For false positives/negatives, include the code snippet, the finding received vs. expected, and the file's language mode.

- Security rules: extend `SECURITY_RULES` in `src/analysis/codeAnalyzer.ts`
- Prompt rules: extend `PROMPT_RULES` in `src/analysis/promptAnalyzer.ts`

## License

MIT License. See [LICENSE.txt](LICENSE.txt) for the full text.
