import * as os from 'os';
import * as path from 'path';
import { AgentProvider, CodeTurn, ParsedTurn, PromptTurn, WatchRoot } from './types';

const IGNORED_TEXT_PREFIXES = ['<ide_', '<system-reminder>', '[Request interrupted'];

/**
 * Mirrors Claude Code's own sanitization of a workspace path into a
 * directory name under `~/.claude/projects`.
 */
function sanitizeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}

function extractPromptText(content: unknown): string | undefined {
  let blocks: string[];

  if (typeof content === 'string') {
    blocks = [content];
  } else if (Array.isArray(content)) {
    blocks = content
      .filter((c) => c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
  } else {
    return undefined;
  }

  const parts = blocks
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !IGNORED_TEXT_PREFIXES.some((prefix) => t.startsWith(prefix)));

  const joined = parts.join('\n\n').trim();
  return joined.length > 0 ? joined : undefined;
}

function extractCodeChanges(content: unknown): CodeTurn[] {
  if (!Array.isArray(content)) { return []; }

  const changes: CodeTurn[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'tool_use') { continue; }
    const input = block.input ?? {};
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
    if (!filePath) { continue; }

    if (block.name === 'Write' && typeof input.content === 'string') {
      changes.push({ kind: 'code', filePath, code: input.content });
    } else if (block.name === 'Edit' && typeof input.new_string === 'string') {
      changes.push({ kind: 'code', filePath, code: input.new_string });
    } else if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
      const code = input.edits
        .map((edit: unknown) => (edit && typeof edit === 'object' && typeof (edit as any).new_string === 'string' ? (edit as any).new_string : ''))
        .filter((s: string) => s.length > 0)
        .join('\n');
      if (code) { changes.push({ kind: 'code', filePath, code }); }
    }
  }
  return changes;
}

/**
 * Watches Claude Code's on-disk session transcripts:
 * `~/.claude/projects/<sanitized-workspace-path>/*.jsonl`
 *
 * The workspace-specific subdirectory under `~/.claude/projects` is created
 * lazily by Claude Code on first use, so it may not exist yet when VS Code
 * starts. Watch the `~/.claude/projects` root recursively instead of the
 * (possibly nonexistent) workspace subdirectory, and filter to files whose
 * parent directory matches this workspace's sanitized name. This also
 * absorbs drive-letter casing differences between VS Code's workspace path
 * and the `cwd` Claude Code recorded.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code';
  readonly label = 'Claude Code';

  getWatchRoots(_workspacePath: string): WatchRoot[] {
    return [{ dir: path.join(os.homedir(), '.claude', 'projects'), recursive: true }];
  }

  isCandidateFile(filePath: string): boolean {
    return filePath.endsWith('.jsonl');
  }

  belongsToWorkspace(filePath: string, workspacePath: string): boolean {
    const expected = sanitizeWorkspacePath(workspacePath).toLowerCase();
    const actual = path.basename(path.dirname(filePath)).toLowerCase();
    return actual === expected;
  }

  parseLine(line: string): ParsedTurn[] {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return [];
    }

    if (entry.isSidechain) { return []; }

    if (entry.type === 'user' && entry.message?.role === 'user') {
      const text = extractPromptText(entry.message.content);
      return text ? [{ kind: 'prompt', text } as PromptTurn] : [];
    }

    if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      return extractCodeChanges(entry.message.content);
    }

    return [];
  }
}
