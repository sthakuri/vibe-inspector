// ─────────────────────────────────────────────────────────────────────────────
// Vibe Inspector — Agent transcript provider contract
//
// Each AI coding CLI (Claude Code, Codex CLI, ...) persists its session
// transcripts to disk in its own location and JSON-lines format. A provider
// knows how to locate the transcript files for a given workspace and how to
// turn a single transcript line into zero or more inspectable turns.
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptTurn {
  kind: 'prompt';
  text: string;
}

export interface CodeTurn {
  kind: 'code';
  filePath: string;
  code: string;
}

export type ParsedTurn = PromptTurn | CodeTurn;

export interface WatchRoot {
  /** Absolute directory to watch/scan. */
  dir: string;
  /** Whether transcript files may live in nested subdirectories (e.g. date-bucketed). */
  recursive: boolean;
}

export interface AgentProvider {
  /** Stable identifier, used for logging. */
  readonly id: string;
  /** Human-readable name, used for logging. */
  readonly label: string;

  /** Directories to scan/watch for this provider's transcript files for the given workspace. */
  getWatchRoots(workspacePath: string): WatchRoot[];

  /** Cheap filename-based check, applied before any file content is read. */
  isCandidateFile(filePath: string): boolean;

  /**
   * Confirms (by inspecting file content, if necessary) that a candidate file
   * belongs to the given workspace's session history.
   */
  belongsToWorkspace(filePath: string, workspacePath: string): boolean;

  /** Parses a single transcript line into zero or more inspectable turns. */
  parseLine(line: string): ParsedTurn[];
}

export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
