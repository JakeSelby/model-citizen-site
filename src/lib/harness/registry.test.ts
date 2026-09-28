import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENDOR, sourceDir } from './paths.ts';
import { listHooks } from './hooks.ts';
import { honesty, listCli } from './cli.ts';
import {
  COMMAND_ORDER,
  entriesOf,
  firstParagraph,
  firstSentence,
  flatten,
  getCounts,
  getRegistry,
  getTree,
  manifest,
  neighbours,
  parseFrontmatter,
  sourceUrl,
  version,
} from './registry.ts';

describe('the submodule', () => {
  it('is checked out at the tag named by VERSION', () => {
    expect(fs.existsSync(path.join(VENDOR, 'VERSION'))).toBe(true);
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('parseFrontmatter', () => {
  it('reads flat key: value pairs and returns the body', () => {
    const { data, body } = parseFrontmatter('---\nname: x\ndescription: Does a thing. Use when y.\nargument-hint: <topic>\n---\n# Title\n\nBody');
    expect(data).toEqual({ name: 'x', description: 'Does a thing. Use when y.', 'argument-hint': '<topic>' });
    expect(body).toBe('# Title\n\nBody');
  });
  it('returns the whole text when there is no frontmatter', () => {
    expect(parseFrontmatter('# Only\n').data).toEqual({});
  });
});

describe('summaries', () => {
  it('takes the first sentence in plain text', () => {
    expect(firstSentence('Prove **it** is `real`. Use when x.')).toBe('Prove it is real.');
  });
  it('takes the first paragraph or bullet after the H1', () => {
    expect(firstParagraph('\n- **Read narrowly.** Never cat a whole file.\n- second\n')).toBe('Read narrowly. Never cat a whole file.');
  });
});

describe('the registry', () => {
  const r = getRegistry();
  const c = getCounts();

  it('derives inventory from the pinned source rather than a historical release count', () => {
    const defaults = JSON.parse(fs.readFileSync(path.join(VENDOR, 'config.example.json'), 'utf8')).stances;
    expect(c.stanceDimensions).toBe(Object.keys(defaults).length);
    expect(c.stanceVariants).toBe(r.stances.reduce((sum, dimension) => sum + dimension.variants.length, 0));
    expect(c.rules).toBeGreaterThan(0);
    expect(c.skills).toBeGreaterThan(0);
  });

  it('gives every entry a title, a route and a source file that exists', () => {
    for (const e of flatten()) {
      expect(e.title, e.id).not.toBe('');
      expect(e.route).toMatch(/^\/.+\/$/);
      expect(fs.existsSync(path.join(VENDOR, e.sourcePath)), e.sourcePath).toBe(true);
    }
  });

  it('has unique routes in a stable reading order', () => {
    const routes = flatten().map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes[0]).toBe('/rules/cache-hygiene/');
    expect(routes.at(-1)).toBe('/contributing/');
    expect(flatten()).toEqual(flatten());
  });

  it('marks the default variant of each stance from config.example.json', () => {
    const testing = r.stances.find((d) => d.id === 'testing')!;
    expect(testing.defaultVariant).toBe('required');
    expect(testing.variants.map((v) => v.variant)).toEqual(['off', 'pragmatic', 'required']);
    expect(testing.variants.find((v) => v.isDefault)?.variant).toBe('required');
    expect(r.stances.every((d) => d.defaultVariant && d.variants.some((v) => v.variant === d.defaultVariant))).toBe(true);
  });

  it('reads agent frontmatter into the meta strip', () => {
    const builder = r.agents.find((a) => a.id === 'builder')!;
    if (builder.frontmatter.authority) {
      expect(builder.frontmatter.authority).toBe('workspace-write');
      expect(builder.meta.find((m) => m.label === 'Model')?.value).toBe('runtime adapter');
    } else {
      expect(builder.frontmatter.model).toBe('opus');
      expect(builder.meta.find((m) => m.label === 'Tools')?.values).toContain('Edit');
    }
  });

  it('orders commands as the delivery loop runs', () => {
    const ids = r.commands.map((cmd) => cmd.id);
    const files = fs.readdirSync(path.join(VENDOR, sourceDir('commands'))).filter((f) => f.endsWith('.md'));
    expect(ids).toHaveLength(files.length);
    const known = ids.filter((id) => COMMAND_ORDER.includes(id));
    expect(known).toEqual(COMMAND_ORDER.filter((id) => ids.includes(id)));
    expect(ids.slice(0, known.length)).toEqual(known);
    expect(known.slice(0, 4)).toEqual(['research', 'plan', 'build', 'review']);
    for (const cmd of r.commands) {
      const step = cmd.meta.find((m) => m.label === 'Step')?.value;
      if (COMMAND_ORDER.includes(cmd.id)) expect(step).toMatch(/^[1-9]\d* of \d+ in the delivery loop$/);
      else expect(step).toBeUndefined();
    }
  });

  it('lists the files a skill ships', () => {
    const plan = r.skills.find((s) => s.id === 'plan-authoring')!;
    expect(plan.files).toEqual(['EXAMPLE.md', 'TEMPLATE.md']);
    expect(plan.summary).toMatch(/^Write or revise a plan file/);
  });

  it('walks the pager across kinds', () => {
    const { prev, next } = neighbours('/rules/working-style/');
    expect(prev?.route).toBe('/rules/voice-and-format/');
    expect(next?.route).toBe('/stances/autonomy/ask/');
    expect(neighbours('/nope/')).toEqual({ prev: null, next: null });
  });

  it('builds a tree with one group per kind and a nested stance dimension', () => {
    const tree = getTree();
    expect(tree.map((g) => g.kind)).toEqual(['start', 'rules', 'stances', 'skills', 'agents', 'commands', 'hooks', 'output-styles', 'docs']);
    const stances = tree.find((g) => g.kind === 'stances')!;
    expect(stances.items.find((i) => i.label === 'testing')?.children?.map((v) => v.label)).toEqual(['off', 'pragmatic', 'required']);
    expect(entriesOf('stances')).toHaveLength(c.stanceVariants);
  });

  it('points source links at the pinned tag', () => {
    expect(sourceUrl('claude/skills/plan-authoring/SKILL.md')).toBe(`https://github.com/JakeSelby/model-citizen/blob/v${version()}/claude/skills/plan-authoring/SKILL.md`);
    expect(sourceUrl('claude/stances/testing')).toBe(`https://github.com/JakeSelby/model-citizen/tree/v${version()}/claude/stances/testing`);
  });

  it('publishes a manifest with one route per page', () => {
    const m = manifest();
    expect(m.name).toBe('model-citizen');
    expect(m.repo).toBe('https://github.com/JakeSelby/model-citizen');
    expect(m.version).toBe(version());
    const routes = m.routes.map((x) => x.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toContain('/skills/plan-authoring/');
    expect(routes).toContain('/stances/testing/');
    expect(routes).toContain('/hooks/stop-gate/');
    expect(routes).toContain('/cli/');
  });
});

describe('hooks', () => {
  const hooks = listHooks();
  it('joins ownership and docstrings into the 13 policies the dispatcher calls', () => {
    expect(hooks).toHaveLength(13);
    expect(hooks.map((h) => h.id).sort()).toEqual(['brief-guard', 'filter-output', 'grade-bash', 'intent-overlap', 'neutralize', 'plan-card', 'plan-webfetch', 'readonly-bash', 'session', 'stage-files', 'stop-gate', 'tier-spawns', 'usage-log']);
  });
  it('knows which hook a stance gates', () => {
    const card = hooks.find((h) => h.id === 'plan-card')!;
    expect(card.always).toBe(false);
    expect(card.stance).toBe('plan-ceremony');
    expect(card.variant).toBe('review-card');
    expect(card.event).toBe('PostToolUse');
    expect(card.registration).toBe('dispatcher');
    expect(card.matcher).toBeNull();
    expect(card.timeout).toBeNull();
    expect(card.dispatcher).toBe('adapters/claude-code/hook.py');
    expect(hooks.filter((h) => h.always)).toHaveLength(12);
  });
  it('carries the docstring and the helper', () => {
    const gate = hooks.find((h) => h.id === 'stop-gate')!;
    expect(gate.summary).toMatch(/^Stop hook: run the repository's own gate/);
    expect(gate.source).toContain('MAX_BLOCKS');
    expect(hooks.find((h) => h.id === 'tier-spawns')?.file).toBe(`${sourceDir('hooks')}/tier-agent-spawns.py`);
    expect(hooks.find((h) => h.id === 'filter-output')?.helper).toBe(`${sourceDir('hooks')}/filter-lines.py`);
  });
});

describe('the CLI and the honesty strip', () => {
  it('finds every subcommand in bin/harness', () => {
    const names = listCli().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['install', 'sync', 'diff', 'doctor', 'uninstall', 'lint', 'usage', 'trust', 'workspace', 'config', 'bmad']));
    expect(new Set(names).size).toBe(names.length);
    expect(listCli().every((c) => c.help.length > 0)).toBe(true);
  });
  it('reads the always-loaded cap and counts the tests', () => {
    const h = honesty();
    expect(h.cap).toBe(225);
    expect(h.tests).toBeGreaterThan(150);
    expect(h.testFiles).toBeGreaterThan(10);
    expect(h.ci).toBe(true);
  });
});
