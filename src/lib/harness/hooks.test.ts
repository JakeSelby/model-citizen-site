import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listHooks, scriptFor } from './hooks.ts';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

/** A minimal harness checkout: OWNERSHIP.json, a settings template and the named policy scripts. */
function harness(settingsHooks: unknown, hookIds: Record<string, object>, scripts: string[], dispatcher = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'claude'), { recursive: true });
  fs.mkdirSync(path.join(root, 'policy/hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'claude/settings.template.json'), JSON.stringify(settingsHooks === undefined ? {} : { hooks: settingsHooks }));
  fs.writeFileSync(path.join(root, 'claude/OWNERSHIP.json'), JSON.stringify({ claude: { hook_ids: hookIds } }));
  for (const s of scripts) fs.writeFileSync(path.join(root, 'policy/hooks', s), `"""${s} summary.\n\nMore."""\n`);
  if (dispatcher) {
    fs.mkdirSync(path.join(root, 'adapters/claude-code'), { recursive: true });
    fs.writeFileSync(path.join(root, 'adapters/claude-code/hook.py'), '');
  }
  return root;
}

describe('scriptFor', () => {
  const scripts = ['stop-gate.py', 'tier-agent-spawns.py', 'allow-readonly-bash.py', 'grade-bash.py', 'harness-session.py', 'workspace-session.py', 'posture.py'];
  it('takes the stem, then the one script carrying every word of the id', () => {
    expect(scriptFor('stop-gate', scripts)).toBe('stop-gate.py');
    expect(scriptFor('tier-spawns', scripts)).toBe('tier-agent-spawns.py');
    expect(scriptFor('readonly-bash', scripts)).toBe('allow-readonly-bash.py');
    expect(scriptFor('session', scripts)).toBe('harness-session.py');
  });
  it('refuses an id with no script or more than one', () => {
    expect(() => scriptFor('missing', scripts)).toThrow(/matches 0 scripts/);
    expect(() => scriptFor('bash', scripts)).toThrow(/matches 2 scripts/);
  });
});

describe('listHooks', () => {
  it('reads a dispatcher release from OWNERSHIP.json, with no matcher or timeout', () => {
    const root = harness(undefined, {
      'stop-gate': { event: 'Stop', always: true },
      'plan-card': { event: 'PostToolUse', stance: 'plan-ceremony', variant: 'review-card' },
      session: { event: 'SessionStart', always: true },
    }, ['stop-gate.py', 'validate-plan-card.py', 'harness-session.py', 'posture.py']);
    const hooks = listHooks(root);
    expect(hooks.map((h) => [h.id, h.event, h.file])).toEqual([
      ['session', 'SessionStart', 'policy/hooks/harness-session.py'],
      ['plan-card', 'PostToolUse', 'policy/hooks/validate-plan-card.py'],
      ['stop-gate', 'Stop', 'policy/hooks/stop-gate.py'],
    ]);
    expect(hooks.every((h) => h.registration === 'dispatcher' && h.matcher === null && h.timeout === null)).toBe(true);
    expect(hooks.every((h) => h.dispatcher === 'adapters/claude-code/hook.py')).toBe(true);
    const card = hooks.find((h) => h.id === 'plan-card')!;
    expect([card.always, card.stance, card.variant]).toEqual([false, 'plan-ceremony', 'review-card']);
    expect(card.summary).toBe('validate-plan-card.py summary.');
  });
  it('treats an explicit null hooks key as the dispatcher shape', () => {
    const root = harness(null, { 'stop-gate': { event: 'Stop', always: true } }, ['stop-gate.py'], false);
    const [gate] = listHooks(root);
    expect(gate.registration).toBe('dispatcher');
    expect(gate.dispatcher).toBeNull();
  });
  it('fails the build when an owned id has no event', () => {
    const root = harness(undefined, { 'stop-gate': { always: true } }, ['stop-gate.py']);
    expect(() => listHooks(root)).toThrow(/names no event/);
  });
  it('still reads a per-hook release from its settings entries', () => {
    const root = harness({
      PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'python3 ~/.claude/hooks/harness/validate-plan-card.py # harness:plan-card', timeout: 10, statusMessage: 'Checking' }] }],
    }, { 'plan-card': { event: 'PostToolUse', stance: 'plan-ceremony', variant: 'review-card' } }, ['validate-plan-card.py']);
    const [card] = listHooks(root);
    expect(card).toMatchObject({ id: 'plan-card', registration: 'per-hook', matcher: 'Write|Edit', timeout: 10, statusMessage: 'Checking', dispatcher: null });
  });
});
