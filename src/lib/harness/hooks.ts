import fs from 'node:fs';
import path from 'node:path';
import { VENDOR, sourceDir } from './paths.ts';

/**
 * How a release registers its hooks. `per-hook`: one settings entry per script, each with its own
 * matcher and timeout (up to 0.12). `dispatcher`: sync registers one coordinator command per
 * event, which routes by tool and calls each policy itself, so no policy has a matcher or timeout.
 */
export type Registration = 'per-hook' | 'dispatcher';

export interface Hook {
  id: string;
  file: string; // <hooks dir>/<name>.py
  event: string;
  matcher: string | null;
  timeout: number | null;
  statusMessage: string | null;
  always: boolean;
  stance: string | null;
  variant: string | null;
  registration: Registration;
  /** The per-event entrypoint the dispatcher shape registers, when the release ships one. */
  dispatcher: string | null;
  summary: string;
  docstring: string;
  source: string;
  lines: number;
  helper: string | null;
}

interface SettingsHook { command?: string; timeout?: number; statusMessage?: string }
interface SettingsEntry { matcher?: string; hooks?: SettingsHook[] }
interface OwnedHook { event?: string; always?: boolean; stance?: string; variant?: string }
interface Ownership { claude?: { hook_ids?: Record<string, OwnedHook> } }

const EVENT_ORDER = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];
const DISPATCHER = 'adapters/claude-code/hook.py';

function docstringOf(source: string): string {
  const m = source.match(/"""([\s\S]*?)"""/);
  return m ? m[1].trim() : '';
}

/**
 * The script a policy id names. An id is the script's stem (`stop-gate`), its legacy
 * `harness-<id>` name, or a shortening whose words all appear in it
 * (`tier-spawns` → `tier-agent-spawns.py`). Anything else, or two candidates, throws: a hook page
 * with the wrong source is worse than a failed build.
 */
export function scriptFor(id: string, scripts: string[]): string {
  if (scripts.includes(`${id}.py`)) return `${id}.py`;
  if (scripts.includes(`harness-${id}.py`)) return `harness-${id}.py`;
  const words = id.split('-');
  const hits = scripts.filter((s) => {
    const parts = s.replace(/\.py$/, '').split('-');
    return words.every((w) => parts.includes(w));
  });
  if (hits.length !== 1) throw new Error(`hook id ${id} matches ${hits.length} scripts: ${hits.join(', ') || 'none'}`);
  return hits[0];
}

/**
 * The hooks are Python, not markdown, so they are joined by hand. OWNERSHIP.json lists each
 * policy id with its event and whether a stance gates it; the script's docstring is the summary.
 * A release whose settings.template.json still carries per-hook entries (each command ends in
 * `# harness:<id>`) also supplies the script, matcher and timeout from there; a dispatcher
 * release registers per event, so the script is resolved from the id.
 */
export function listHooks(root = VENDOR): Hook[] {
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'claude/settings.template.json'), 'utf8')) as { hooks?: Record<string, SettingsEntry[]> | null };
  const ownership = JSON.parse(fs.readFileSync(path.join(root, 'claude/OWNERSHIP.json'), 'utf8')) as Ownership;
  const ids = ownership.claude?.hook_ids ?? {};
  const dir = sourceDir('hooks', root);
  const helperFile = `${dir}/filter-lines.py`;
  const hasHelper = fs.existsSync(path.join(root, helperFile));
  const dispatcher = fs.existsSync(path.join(root, DISPATCHER)) ? DISPATCHER : null;

  type Found = { id: string; script: string; event: string; matcher: string | null; timeout: number | null; statusMessage: string | null };
  const found: Found[] = [];
  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        const cmd = h.command ?? '';
        const id = cmd.match(/#\s*harness:([\w-]+)/)?.[1];
        const script = cmd.match(/hooks\/harness\/([\w-]+\.py)/)?.[1];
        if (!id || !script) continue;
        found.push({ id, script, event, matcher: entry.matcher ?? null, timeout: h.timeout ?? null, statusMessage: h.statusMessage ?? null });
      }
    }
  }
  const registration: Registration = found.length > 0 ? 'per-hook' : 'dispatcher';
  if (registration === 'dispatcher') {
    const scripts = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.py'));
    for (const [id, own] of Object.entries(ids)) {
      if (!own.event) throw new Error(`hook id ${id} names no event in OWNERSHIP.json`);
      found.push({ id, script: scriptFor(id, scripts), event: own.event, matcher: null, timeout: null, statusMessage: null });
    }
  }

  const out: Hook[] = found.map((f) => {
    const file = `${dir}/${f.script}`;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const docstring = docstringOf(source);
    const own = ids[f.id] ?? {};
    return {
      id: f.id,
      file,
      event: own.event ?? f.event,
      matcher: f.matcher,
      timeout: f.timeout,
      statusMessage: f.statusMessage,
      always: own.always === true,
      stance: own.stance ?? null,
      variant: own.variant ?? null,
      registration,
      dispatcher: registration === 'dispatcher' ? dispatcher : null,
      summary: docstring.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(),
      docstring,
      source,
      lines: source.split('\n').length,
      helper: f.id === 'filter-output' && hasHelper ? helperFile : null,
    };
  });

  out.sort((a, b) => EVENT_ORDER.indexOf(a.event) - EVENT_ORDER.indexOf(b.event) || a.id.localeCompare(b.id));
  return out;
}
