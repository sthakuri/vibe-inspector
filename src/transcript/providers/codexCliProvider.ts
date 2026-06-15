import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentProvider, CodeTurn, ParsedTurn, PromptTurn, WatchRoot, normalizeFsPath } from './types';

const IGNORED_TEXT_PREFIXES = ['<environment_context', '<user_instructions', '<system-reminder'];

// How many bytes from the start of a rollout file to scan for the
// `session_meta` event that records the session's working directory.
const META_SCAN_BYTES = 8192;

function extractCodexText(content: unknown): string | undefined {
  if (!Array.isArray(content)) { return undefined; }

  const parts = content
    .filter((c) => c && typeof c === 'object' && typeof c.text === 'string' &&
      (c.type === 'input_text' || c.type === 'text'))
    .map((c) => (c.text as string).trim())
    .filter((t) => t.length > 0 && !IGNORED_TEXT_PREFIXES.some((prefix) => t.startsWith(prefix)));

  const joined = parts.join('\n\n').trim();
  return joined.length > 0 ? joined : undefined;
}

/**
 * Best-effort extraction of file edits from a Codex `apply_patch` invocation.
 * Codex uses a V4A-style patch format:
 *
 *   *** Begin Patch
 *   *** Update File: src/foo.ts
 *   @@
 *   -old line
 *   +new line
 *   *** End Patch
 *
 * This is invoked either via a dedicated `apply_patch` tool or embedded in a
 * `shell`/`exec_command`/`local_shell` invocation's command/heredoc.
 */
function extractApplyPatchChanges(text: string): CodeTurn[] {
  if (!text.includes('*** Begin Patch')) { return []; }

  const changes: CodeTurn[] = [];
  let currentFile: string | undefined;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentFile && currentLines.length > 0) {
      changes.push({ kind: 'code', filePath: currentFile, code: currentLines.join('\n') });
    }
    currentLines = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (header) {
      flush();
      currentFile = header[1].trim();
      continue;
    }
    if (line.startsWith('*** ')) {
      flush();
      currentFile = undefined;
      continue;
    }
    if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
      currentLines.push(line.slice(1));
    }
  }
  flush();

  return changes;
}

function extractCodeFromFunctionCall(payload: any): ParsedTurn[] {
  const name = typeof payload.name === 'string' ? payload.name : '';
  if (!['apply_patch', 'shell', 'exec_command', 'local_shell'].includes(name)) { return []; }

  let argsText = '';
  if (typeof payload.arguments === 'string') {
    argsText = payload.arguments;
  } else {
    try { argsText = JSON.stringify(payload.arguments ?? ''); } catch { return []; }
  }

  return extractApplyPatchChanges(argsText);
}

/**
 * Watches Codex CLI's on-disk rollout transcripts:
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
 *
 * Unlike Claude Code, Codex buckets transcripts by date rather than by
 * workspace, so membership is determined by reading each file's
 * `session_meta` event and comparing its `cwd` to the workspace folder.
 */
export class CodexCliProvider implements AgentProvider {
  readonly id = 'codex-cli';
  readonly label = 'Codex CLI';

  getWatchRoots(_workspacePath: string): WatchRoot[] {
    return [{ dir: path.join(os.homedir(), '.codex', 'sessions'), recursive: true }];
  }

  isCandidateFile(filePath: string): boolean {
    return path.basename(filePath).endsWith('.jsonl');
  }

  belongsToWorkspace(filePath: string, workspacePath: string): boolean {
    const cwd = this.readSessionCwd(filePath);
    return cwd !== undefined && normalizeFsPath(cwd) === normalizeFsPath(workspacePath);
  }

  private readSessionCwd(filePath: string): string | undefined {
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return undefined;
    }

    try {
      const buf = Buffer.alloc(META_SCAN_BYTES);
      const bytesRead = fs.readSync(fd, buf, 0, META_SCAN_BYTES, 0);
      const text = buf.toString('utf-8', 0, bytesRead);

      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) { continue; }
        let entry: any;
        try {
          entry = JSON.parse(trimmed);
        } catch {
          // Likely a truncated final line within the scan window; skip.
          continue;
        }
        if (entry.type === 'session_meta' && typeof entry.payload?.cwd === 'string') {
          return entry.payload.cwd;
        }
      }
    } catch {
      return undefined;
    } finally {
      fs.closeSync(fd);
    }

    return undefined;
  }

  parseLine(line: string): ParsedTurn[] {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return [];
    }

    if (entry.type !== 'response_item') { return []; }
    const payload = entry.payload;
    if (!payload || typeof payload !== 'object') { return []; }

    if (payload.type === 'message' && payload.role === 'user') {
      const text = extractCodexText(payload.content);
      return text ? [{ kind: 'prompt', text } as PromptTurn] : [];
    }

    if (payload.type === 'function_call') {
      return extractCodeFromFunctionCall(payload);
    }

    return [];
  }
}
