import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { REPO_URL, VENDOR, sourceDir, compatibility } from './paths.ts';
import { listHooks, type Hook } from './hooks.ts';

export type Kind = 'rules' | 'stances' | 'skills' | 'agents' | 'commands' | 'hooks' | 'output-styles' | 'docs';

export interface MetaField { label: string; value?: string; values?: string[]; mono?: boolean; tone?: 'amber' }

export interface Entry {
  kind: Kind;
  /** Route id: `plan-authoring`, `testing/required`, `how-it-works`. */
  id: string;
  /** Sidebar label. */
  label: string;
  /** Page title. */
  title: string;
  summary: string;
  route: string;
  /** Repo-relative path of the source file. */
  sourcePath: string;
  /** Astro content collection and id, when the body is markdown rendered by Astro. */
  collection: string | null;
  collectionId: string | null;
  lines: number;
  meta: MetaField[];
  frontmatter: Record<string, string>;
  dimension?: string;
  variant?: string;
  isDefault?: boolean;
  /** Skills: the other files the skill ships. */
  files?: string[];
  hook?: Hook;
}

export interface Dimension {
  id: string;
  title: string;
  route: string;
  sourcePath: string;
  defaultVariant: string | null;
  variants: Entry[];
}

export interface TreeItem { label: string; route: string; mono?: boolean; tag?: string; tagTone?: 'amber'; children?: TreeItem[] }
export interface TreeGroup { label: string; kind: Kind | 'start'; route: string | null; count: string | null; items: TreeItem[] }

export const KIND_LABEL: Record<Kind, string> = {
  rules: 'Rules',
  stances: 'Stances',
  skills: 'Skills',
  agents: 'Roles',
  commands: 'Workflows',
  hooks: 'Hooks',
  'output-styles': 'Output style',
  docs: 'Docs',
};

export const KIND_SINGULAR: Record<Kind, string> = {
  rules: 'Rule',
  stances: 'Stance',
  skills: 'Skill',
  agents: 'Agent',
  commands: 'Command',
  hooks: 'Hook',
  'output-styles': 'Output style',
  docs: 'Doc',
};

export const KIND_BLURB: Record<Kind, string> = {
  rules: 'Short, operative, and loaded on every turn. Each rule carries its lines and a pointer to the skill holding the reasoning.',
  stances: 'Preferences a reasonable engineer might hold the other way. One variant per dimension is linked into every session.',
  skills: 'Procedures loaded on invocation. They carry the reasoning and the examples the rules point at.',
  agents: 'Shared responsibility and authority contracts. Runtime adapters bind native models, effort and tools.',
  commands: 'The delivery loop, from a question to a merged pull request and a closed-out session.',
  hooks: 'Shared policy checks composed by runtime lifecycle adapters. Native activation and enforcement are qualified separately.',
  'output-styles': 'The shape of every reply.',
  docs: 'The longer explanations: how the layers compose, what the sync touches, what the harness leaves out.',
};

// ── File helpers ─────────────────────────────────────────────────────────────

const read = (rel: string) => fs.readFileSync(path.join(VENDOR, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(VENDOR, rel));
const lineCount = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** Parse the flat `key: value` frontmatter the harness uses. Returns the body too. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { data, body: text.slice(m[0].length) };
}

export function firstH1(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Markdown inline syntax → plain text, for summaries and labels. */
export function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max = 170): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, at > 60 ? at : max).replace(/[,.;:]$/, '') + '…';
}

/** First sentence of a description, for cards and the sidebar. */
export function firstSentence(text: string): string {
  const t = plain(text);
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return truncate(m ? m[1] : t);
}

/** The first paragraph or bullet after the H1, as plain text. */
export function firstParagraph(body: string): string {
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('#'))) i++;
  const para: string[] = [];
  const bullet = /^\s*[-*]\s+/;
  const startsAsBullet = i < lines.length && bullet.test(lines[i]);
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.startsWith('#') || l.startsWith('```') || l.startsWith('|')) break;
    if (para.length > 0 && startsAsBullet && bullet.test(l)) break;
    para.push(l.replace(bullet, ''));
  }
  return truncate(plain(para.join(' ')));
}

function listDir(rel: string, filter: (name: string) => boolean): string[] {
  return fs.readdirSync(path.join(VENDOR, rel)).filter(filter).sort((a, b) => a.localeCompare(b));
}

function walkFiles(rel: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(VENDOR, rel)).sort()) {
    if (name === '__pycache__' || name.startsWith('.')) continue;
    const p = `${rel}/${name}`;
    if (fs.statSync(path.join(VENDOR, p)).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function titleFromDimension(id: string): string {
  const words = id.split('-').map((w) => (w === 'vs' ? 'vs' : w));
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

// ── Readers ──────────────────────────────────────────────────────────────────

export function version(): string {
  return read('VERSION').trim();
}

export function sourceUrl(rel: string): string {
  const isDir = exists(rel) && fs.statSync(path.join(VENDOR, rel)).isDirectory();
  return `${REPO_URL}/${isDir ? 'tree' : 'blob'}/v${version()}/${rel}`;
}

function stanceDefaults(): Record<string, string> {
  try {
    const cfg = JSON.parse(read('config.example.json')) as { stances?: Record<string, string> };
    return cfg.stances ?? {};
  } catch {
    return {};
  }
}

function rules(): Entry[] {
  return listDir(sourceDir('rules'), (f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const text = read(`${sourceDir('rules')}/${f}`);
    const { body } = parseFrontmatter(text);
    return {
      kind: 'rules',
      id,
      label: id,
      title: firstH1(body) ?? id,
      summary: firstParagraph(body.replace(/^#.*$/m, '')),
      route: `/rules/${id}/`,
      sourcePath: `${sourceDir('rules')}/${f}`,
      collection: 'rules',
      collectionId: id,
      lines: lineCount(text),
      meta: [
        { label: 'Path', value: `${sourceDir('rules')}/${f}`, mono: true },
        { label: 'Loaded', value: 'every turn', tone: 'amber' },
        { label: 'Lines', value: String(lineCount(text)) },
      ],
      frontmatter: {},
    };
  });
}

function stances(): Dimension[] {
  const defaults = stanceDefaults();
  return listDir(sourceDir('stances'), (d) => fs.statSync(path.join(VENDOR, sourceDir('stances'), d)).isDirectory()).map((dim) => {
    const defaultVariant = defaults[dim] ?? null;
    const variants: Entry[] = listDir(`${sourceDir('stances')}/${dim}`, (f) => f.endsWith('.md')).map((f) => {
      const variant = f.replace(/\.md$/, '');
      const text = read(`${sourceDir('stances')}/${dim}/${f}`);
      const { body } = parseFrontmatter(text);
      const isDefault = variant === defaultVariant;
      return {
        kind: 'stances',
        id: `${dim}/${variant}`,
        label: variant,
        title: firstH1(body) ?? `${titleFromDimension(dim)} stance: ${variant}`,
        summary: firstParagraph(body.replace(/^#.*$/m, '')),
        route: `/stances/${dim}/${variant}/`,
        sourcePath: `${sourceDir('stances')}/${dim}/${f}`,
        collection: 'stances',
        collectionId: `${dim}/${variant}`,
        lines: lineCount(text),
        meta: [
          { label: 'Dimension', value: dim, mono: true },
          { label: 'Variant', value: variant, mono: true },
          ...(isDefault ? [{ label: 'Default', value: 'in config.example.json', tone: 'amber' as const }] : []),
          { label: 'Linked as', value: 'selected policy → native runtime projection', mono: true },
          { label: 'Path', value: `${sourceDir('stances')}/${dim}/${f}`, mono: true },
        ],
        frontmatter: {},
        dimension: dim,
        variant,
        isDefault,
      };
    });
    return {
      id: dim,
      title: titleFromDimension(dim),
      route: `/stances/${dim}/`,
      sourcePath: `${sourceDir('stances')}/${dim}`,
      defaultVariant,
      variants,
    };
  });
}

function skills(): Entry[] {
  return listDir(sourceDir('skills'), (d) => exists(`${sourceDir('skills')}/${d}/SKILL.md`)).map((name) => {
    const text = read(`${sourceDir('skills')}/${name}/SKILL.md`);
    const { data } = parseFrontmatter(text);
    const files = walkFiles(`${sourceDir('skills')}/${name}`).filter((f) => !f.endsWith('/SKILL.md')).map((f) => f.replace(`${sourceDir('skills')}/${name}/`, ''));
    return {
      kind: 'skills',
      id: name,
      label: name,
      title: data.name ?? name,
      summary: firstSentence(data.description ?? ''),
      route: `/skills/${name}/`,
      sourcePath: `${sourceDir('skills')}/${name}/SKILL.md`,
      collection: 'skills',
      collectionId: name,
      lines: lineCount(text),
      meta: [
        { label: 'Path', value: `${sourceDir('skills')}/${name}/SKILL.md`, mono: true },
        { label: 'Loaded', value: 'on invocation' },
        { label: 'Lines', value: String(lineCount(text)) },
        ...(files.length ? [{ label: 'Ships', values: files, mono: true }] : []),
      ],
      frontmatter: data,
      files,
    };
  });
}

function agents(): Entry[] {
  return listDir(sourceDir('agents'), (f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const text = read(`${sourceDir('agents')}/${f}`);
    const { data } = parseFrontmatter(text);
    const tools = (data.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    return {
      kind: 'agents',
      id,
      label: id,
      title: data.name ?? id,
      summary: firstSentence(data.description ?? ''),
      route: `/agents/${id}/`,
      sourcePath: `${sourceDir('agents')}/${f}`,
      collection: 'agents',
      collectionId: id,
      lines: lineCount(text),
      meta: [
        { label: 'Authority', value: data.authority ?? 'legacy native definition', mono: true },
        { label: 'Model', value: data.model ?? 'runtime adapter', mono: true },
        { label: 'Effort', value: data.effort ?? 'inherit', mono: true },
        { label: 'Tools', values: tools, mono: true },
        { label: 'Path', value: `${sourceDir('agents')}/${f}`, mono: true },
      ],
      frontmatter: { ...data, tools: tools.join(', ') },
    };
  });
}

// The delivery loop in the order the harness README gives it. A command this list does not
// know yet sorts after it, by name, and carries no step, rather than claiming step 0.
export const COMMAND_ORDER = ['research', 'plan', 'build', 'review', 'land', 'handoff', 'close-out'];

const commandRank = (id: string) => {
  const i = COMMAND_ORDER.indexOf(id);
  return i === -1 ? COMMAND_ORDER.length : i;
};

function commands(): Entry[] {
  const list = listDir(sourceDir('commands'), (f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const text = read(`${sourceDir('commands')}/${f}`);
    const { data } = parseFrontmatter(text);
    return {
      kind: 'commands' as const,
      id,
      label: `/${id}`,
      title: `/${id}`,
      summary: firstSentence(data.description ?? ''),
      route: `/commands/${id}/`,
      sourcePath: `${sourceDir('commands')}/${f}`,
      collection: 'commands',
      collectionId: id,
      lines: lineCount(text),
      meta: [
        { label: 'Invoke', value: `/${id}${data['argument-hint'] ? ' ' + data['argument-hint'] : ''}`, mono: true },
        ...(COMMAND_ORDER.includes(id)
          ? [{ label: 'Step', value: `${COMMAND_ORDER.indexOf(id) + 1} of ${COMMAND_ORDER.length} in the delivery loop` }]
          : []),
        { label: 'Path', value: `${sourceDir('commands')}/${f}`, mono: true },
      ],
      frontmatter: data,
    };
  });
  return list.sort((a, b) => commandRank(a.id) - commandRank(b.id) || a.id.localeCompare(b.id));
}

function outputStyles(): Entry[] {
  return listDir(sourceDir('output-styles'), (f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const text = read(`${sourceDir('output-styles')}/${f}`);
    const { data } = parseFrontmatter(text);
    return {
      kind: 'output-styles',
      id,
      label: id,
      title: data.name ?? id,
      summary: firstSentence(data.description ?? ''),
      route: `/output-styles/${id}/`,
      sourcePath: `${sourceDir('output-styles')}/${f}`,
      collection: 'outputStyles',
      collectionId: id,
      lines: lineCount(text),
      meta: [
        { label: 'Linked as', value: `~/.claude/output-styles/${f}`, mono: true },
        { label: 'Selected by', value: 'settings.json outputStyle, an owned key', mono: true },
        { label: 'Path', value: `${sourceDir('output-styles')}/${f}`, mono: true },
      ],
      frontmatter: data,
    };
  });
}

function hooks(): Entry[] {
  return listHooks().map((h) => ({
    kind: 'hooks' as const,
    id: h.id,
    label: h.id,
    title: h.id,
    summary: truncate(h.summary),
    route: `/hooks/${h.id}/`,
    sourcePath: h.file,
    collection: null,
    collectionId: null,
    lines: h.lines,
    meta: [
      { label: 'Event', value: h.event, mono: true },
      ...(h.matcher ? [{ label: 'Matcher', value: h.matcher, mono: true }] : []),
      { label: h.registration === 'dispatcher' ? 'Runs' : 'Registered', value: h.always ? 'always' : `when ${h.stance} = ${h.variant}`, tone: h.always ? undefined : ('amber' as const), mono: !h.always },
      ...(h.dispatcher ? [{ label: 'Dispatcher', value: h.dispatcher, mono: true }] : []),
      ...(h.timeout ? [{ label: 'Timeout', value: `${h.timeout}s` }] : []),
      { label: 'Script', value: h.file, mono: true },
      ...(h.helper ? [{ label: 'Helper', value: h.helper, mono: true }] : []),
    ],
    frontmatter: {},
    hook: h,
  }));
}

function docs(): Entry[] {
  const inDocs = listDir('docs', (f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const text = read(`docs/${f}`);
    const { body } = parseFrontmatter(text);
    return {
      kind: 'docs' as const,
      id,
      label: firstH1(body) ?? id,
      title: firstH1(body) ?? id,
      summary: firstParagraph(body.replace(/^#.*$/m, '')),
      route: `/docs/${id}/`,
      sourcePath: `docs/${f}`,
      collection: 'docs',
      collectionId: id,
      lines: lineCount(text),
      meta: [{ label: 'Path', value: `docs/${f}`, mono: true }, { label: 'Lines', value: String(lineCount(text)) }],
      frontmatter: {},
    };
  });
  const root = (['CHANGELOG.md', 'CONTRIBUTING.md'] as const).filter(exists).map((f) => {
    const id = f.replace(/\.md$/, '').toLowerCase();
    const text = read(f);
    const { body } = parseFrontmatter(text);
    return {
      kind: 'docs' as const,
      id,
      label: firstH1(body) ?? id,
      title: firstH1(body) ?? id,
      summary: firstParagraph(body.replace(/^#.*$/m, '')),
      route: `/${id}/`,
      sourcePath: f,
      collection: 'meta',
      collectionId: id,
      lines: lineCount(text),
      meta: [{ label: 'Path', value: f, mono: true }, { label: 'Lines', value: String(lineCount(text)) }],
      frontmatter: {},
    };
  });
  return [...inDocs, ...root];
}

// ── The registry ─────────────────────────────────────────────────────────────

export interface Registry {
  version: string;
  rules: Entry[];
  stances: Dimension[];
  skills: Entry[];
  agents: Entry[];
  commands: Entry[];
  hooks: Entry[];
  outputStyles: Entry[];
  docs: Entry[];
}

let cache: Registry | null = null;

export function getRegistry(): Registry {
  cache ??= {
    version: version(),
    rules: rules(),
    stances: stances(),
    skills: skills(),
    agents: agents(),
    commands: commands(),
    hooks: hooks(),
    outputStyles: outputStyles(),
    docs: docs(),
  };
  return cache;
}

export function getCounts() {
  const r = getRegistry();
  return {
    rules: r.rules.length,
    stanceDimensions: r.stances.length,
    stanceVariants: r.stances.reduce((n, d) => n + d.variants.length, 0),
    skills: r.skills.length,
    agents: r.agents.length,
    commands: r.commands.length,
    hooks: r.hooks.length,
    outputStyles: r.outputStyles.length,
    docs: r.docs.filter((d) => d.collection === 'docs').length,
  };
}

export function entriesOf(kind: Kind): Entry[] {
  const r = getRegistry();
  switch (kind) {
    case 'rules': return r.rules;
    case 'stances': return r.stances.flatMap((d) => d.variants);
    case 'skills': return r.skills;
    case 'agents': return r.agents;
    case 'commands': return r.commands;
    case 'hooks': return r.hooks;
    case 'output-styles': return r.outputStyles;
    case 'docs': return r.docs;
  }
}

/** Every detail page in reading order; the pager walks this list. */
export function flatten(): Entry[] {
  const r = getRegistry();
  return [
    ...r.rules,
    ...r.stances.flatMap((d) => d.variants),
    ...r.skills,
    ...r.agents,
    ...r.commands,
    ...r.hooks,
    ...r.outputStyles,
    ...r.docs,
  ];
}

export function neighbours(route: string): { prev: Entry | null; next: Entry | null } {
  const all = flatten();
  const i = all.findIndex((e) => e.route === route);
  if (i === -1) return { prev: null, next: null };
  return { prev: all[i - 1] ?? null, next: all[i + 1] ?? null };
}

const KINDS: Kind[] = ['rules', 'stances', 'skills', 'agents', 'commands', 'hooks', 'output-styles', 'docs'];

/** Every route the site builds, so a link can be checked before it is rendered. */
export function siteRoutes(): Set<string> {
  const r = getRegistry();
  return new Set<string>([
    '/',
    '/install/',
    '/compatibility/',
    '/cli/',
    ...KINDS.map((k) => `/${k}/`),
    ...r.stances.map((d) => d.route),
    ...flatten().map((e) => e.route),
  ]);
}

export function getTree(): TreeGroup[] {
  const r = getRegistry();
  const c = getCounts();
  const item = (e: Entry, tag?: string, tagTone?: 'amber'): TreeItem => ({ label: e.label, route: e.route, mono: e.kind !== 'docs', tag, tagTone });
  return [
    {
      label: 'Start here',
      kind: 'start',
      route: null,
      count: null,
      items: [
        { label: 'Overview', route: '/' },
        { label: 'Install and configure', route: '/install/' },
        { label: 'The CLI', route: '/cli/' },
        { label: 'Compatibility', route: '/compatibility/' },
      ],
    },
    { label: 'Rules', kind: 'rules', route: '/rules/', count: String(c.rules), items: r.rules.map((e) => item(e)) },
    {
      label: 'Stances',
      kind: 'stances',
      route: '/stances/',
      count: `${c.stanceDimensions} · ${c.stanceVariants}`,
      items: r.stances.map((d) => ({
        label: d.id,
        route: d.route,
        mono: true,
        tag: String(d.variants.length),
        children: d.variants.map((v) => item(v, v.isDefault ? 'default' : undefined, v.isDefault ? 'amber' : undefined)),
      })),
    },
    { label: 'Skills', kind: 'skills', route: '/skills/', count: String(c.skills), items: r.skills.map((e) => item(e)) },
    { label: 'Roles', kind: 'agents', route: '/agents/', count: String(c.agents), items: r.agents.map((e) => item(e, e.frontmatter.model)) },
    { label: 'Workflows', kind: 'commands', route: '/commands/', count: String(c.commands), items: r.commands.map((e) => item(e)) },
    { label: 'Hooks', kind: 'hooks', route: '/hooks/', count: String(c.hooks), items: r.hooks.map((e) => item(e, e.hook?.event)) },
    { label: 'Output style', kind: 'output-styles', route: '/output-styles/', count: String(c.outputStyles), items: r.outputStyles.map((e) => item(e)) },
    { label: 'Docs', kind: 'docs', route: '/docs/', count: String(c.docs), items: r.docs.map((e) => item(e)) },
  ];
}

export interface ManifestRoute { route: string; kind: string; id: string; title: string; source: string }

/** The machine-readable index the site publishes at /manifest.json; the smoke test reads it. */
export function manifest() {
  const r = getRegistry();
  const routes: ManifestRoute[] = [
    { route: '/', kind: 'page', id: 'overview', title: 'Overview', source: 'README.md' },
    { route: '/install/', kind: 'page', id: 'install', title: 'Install and configure', source: 'README.md' },
    { route: '/compatibility/', kind: 'page', id: 'compatibility', title: 'Compatibility', source: 'compatibility/catalog.json' },
    { route: '/cli/', kind: 'page', id: 'cli', title: 'The CLI', source: 'bin/harness' },
    ...(['rules', 'stances', 'skills', 'agents', 'commands', 'hooks', 'output-styles', 'docs'] as Kind[]).map((k) => ({
      route: `/${k}/`,
      kind: 'index',
      id: k,
      title: KIND_LABEL[k],
      source: sourceDir(k),
    })),
    ...r.stances.map((d) => ({ route: d.route, kind: 'stance-dimension', id: d.id, title: d.title, source: d.sourcePath })),
    ...flatten().map((e) => ({ route: e.route, kind: e.kind, id: e.id, title: e.title, source: e.sourcePath })),
  ];
  return { name: 'model-citizen', version: r.version, repo: REPO_URL, counts: getCounts(), routes,
    compatibility: compatibility(), release: { tag: `v${r.version}`,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: VENDOR, encoding: 'utf8' }).trim() } };
}
