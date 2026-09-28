import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkCodeLinks, remarkEscapeAngle, remarkHarnessLinks, remarkLiftTitle } from './remark.ts';
import { VENDOR } from './paths.ts';

const exists = (rel: string) => fs.existsSync(path.join(VENDOR, rel));

async function render(md: string, repoPath: string) {
  const file = { path: path.join(VENDOR, repoPath), value: md, data: {} as Record<string, unknown> };
  const out = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkEscapeAngle)
    .use(remarkLiftTitle)
    .use(remarkHarnessLinks, { version: '0.2.0', exists })
    .use(remarkCodeLinks, { version: '0.2.0', exists })
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(file as never);
  const frontmatter = ((file.data as { astro?: { frontmatter?: Record<string, unknown> } }).astro?.frontmatter) ?? {};
  return { html: String(out), frontmatter };
}

const decode = (html: string) => html.replace(/&#x3C;|&lt;/g, '<').replace(/&#x3E;|&gt;/g, '>');

describe('the markdown pipeline', () => {
  it('lifts the H1 into frontmatter and drops it from the body', async () => {
    const { html, frontmatter } = await render('# Secret hygiene\n\nBody text.\n\n## Later\n', 'claude/rules/secrets.md');
    expect(frontmatter.title).toBe('Secret hygiene');
    expect(html).not.toContain('<h1');
    expect(html).toContain('<h2>Later</h2>');
  });

  it('keeps bare placeholders like <pref> as visible text', async () => {
    const { html } = await render('Link one variant per `<pref>` and <v> to it.\n', 'docs/how-it-works.md');
    expect(decode(html)).toContain('<v>');
    expect(html).not.toContain('<v>');
  });

  it('rewrites relative links to site routes and GitHub blobs', async () => {
    const md = [
      '[how](docs/how-it-works.md#the-layers) · [rule](claude/rules/secrets.md) · [licence](LICENSE)',
      '· [outside](https://example.com/x.md) · [anchor](#top) · [skill](claude/skills/sandbox/SKILL.md)',
    ].join('\n');
    const { html } = await render(md, 'README.md');
    expect(html).toContain('href="/docs/how-it-works/#the-layers"');
    expect(html).toContain('href="/rules/secrets/"');
    expect(html).toContain('href="https://github.com/JakeSelby/model-citizen/blob/v0.2.0/LICENSE"');
    expect(html).toContain('href="https://example.com/x.md"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('href="/skills/sandbox/"');
  });

  it('resolves links relative to the file that carries them', async () => {
    const { html } = await render('See [the docs](../../docs/usage.md).', 'claude/rules/x.md');
    expect(html).toContain('href="/docs/usage/"');
  });

  it('renders a link to a file the harness does not carry as its text', async () => {
    const { html } = await render('A quoted README points at [**TAGS**.md](TAGS.md#top) here.', '_bmad-output/research/digest.md');
    expect(html).not.toContain('href=');
    expect(html).toContain('A quoted README points at TAGS.md here.');
  });

  it('turns inline code naming a harness file into a link, and leaves placeholders alone', async () => {
    const { html } = await render('Read `docs/usage.md`, edit `claude/rules/secrets.md`, not `claude/skills/<name>/` or `docs/nope.md`.', 'README.md');
    expect(html).toContain('<a href="/docs/usage/"><code>docs/usage.md</code></a>');
    expect(html).toContain('<a href="/rules/secrets/"><code>claude/rules/secrets.md</code></a>');
    expect(decode(html)).toContain('<code>claude/skills/<name>/</code>');
    expect(html).toContain('<code>docs/nope.md</code>');
    expect(html).not.toContain('href="/docs/nope/"');
  });
});

describe('every markdown file in the harness', () => {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const name of fs.readdirSync(path.join(VENDOR, rel))) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = rel ? `${rel}/${name}` : name;
      if (fs.statSync(path.join(VENDOR, p)).isDirectory()) walk(p);
      else if (p.endsWith('.md')) files.push(p);
    }
  };
  walk('');

  it('is a non-trivial list', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s renders without dropping placeholders or leaving .md links', async (rel) => {
    const md = fs.readFileSync(path.join(VENDOR, rel), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const { html } = await render(md, rel);
    expect(html.length).toBeGreaterThan(0);
    // No link may still point at a markdown file inside the repo.
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^https?:/.test(href) || href.startsWith('#')) continue;
      expect(href, `${rel} links to ${href}`).not.toMatch(/\.md(#|$)/);
    }
    // Every bare <word> written in prose survives as visible text. An HTML comment is
    // not prose: it renders to nothing by design, placeholders and all.
    const prose = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const decoded = decode(html);
    for (const m of prose.matchAll(/<([a-z][\w-]*)>/g)) {
      const tag = m[1];
      if (['a', 'br', 'code', 'details', 'summary', 'em', 'strong', 'kbd', 'sub', 'sup', 'p', 'div', 'span'].includes(tag)) continue;
      expect(decoded, `${rel} lost <${tag}>`).toContain(`<${tag}>`);
    }
  });
});
