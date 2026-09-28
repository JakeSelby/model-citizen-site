import path from 'node:path';

/**
 * Map a repo-relative path inside Model Citizen to a route on this site, or to the
 * file on GitHub when the site has no page for it. Returns null for paths that
 * resolve outside the repository, which the caller leaves untouched.
 */
export function routeForRepoPath(
  rel: string,
  version: string,
  exists: (rel: string) => boolean,
  repoUrl = 'https://github.com/JakeSelby/model-citizen',
): string | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('../') || p === '..' || p === '') return null;

  const shared = p.replace(/^primitives\/roles(?=\/|$)/, 'claude/agents')
    .replace(/^primitives\/workflows(?=\/|$)/, 'claude/commands')
    .replace(/^primitives\/presentation(?=\/|$)/, 'claude/output-styles')
    .replace(/^primitives\//, 'claude/').replace(/^policy\/hooks(?=\/|$)/, 'claude/hooks');
  if (shared !== p) {
    const route = routeForRepoPath(shared, version, () => false, repoUrl);
    if (route) return route;
  }

  let m: RegExpMatchArray | null;
  if ((m = p.match(/^docs\/([\w.-]+)\.md$/))) return `/docs/${m[1]}/`;
  if ((m = p.match(/^claude\/skills\/([\w-]+)\/SKILL\.md$/))) return `/skills/${m[1]}/`;
  if ((m = p.match(/^claude\/skills\/([\w-]+)\/?$/))) return `/skills/${m[1]}/`;
  if ((m = p.match(/^claude\/rules\/([\w-]+)\.md$/))) return `/rules/${m[1]}/`;
  if ((m = p.match(/^claude\/stances\/([\w-]+)\/([\w-]+)\.md$/))) return `/stances/${m[1]}/${m[2]}/`;
  if ((m = p.match(/^claude\/stances\/([\w-]+)\/?$/))) return `/stances/${m[1]}/`;
  if ((m = p.match(/^claude\/agents\/([\w-]+)\.md$/))) return `/agents/${m[1]}/`;
  if ((m = p.match(/^claude\/commands\/([\w-]+)\.md$/))) return `/commands/${m[1]}/`;
  if ((m = p.match(/^claude\/output-styles\/([\w-]+)\.md$/))) return `/output-styles/${m[1]}/`;
  if ((m = p.match(/^claude\/hooks\/([\w-]+)\.py$/))) return `/hooks/#${m[1]}`;
  if (p === 'CHANGELOG.md') return '/changelog/';
  if (p === 'CONTRIBUTING.md') return '/contributing/';
  if (p === 'README.md') return '/';
  if (p === 'claude/rules' || p === 'claude/rules/') return '/rules/';
  if (p === 'claude/skills' || p === 'claude/skills/') return '/skills/';
  if (p === 'claude/agents' || p === 'claude/agents/') return '/agents/';
  if (p === 'claude/commands' || p === 'claude/commands/') return '/commands/';
  if (p === 'claude/hooks' || p === 'claude/hooks/') return '/hooks/';
  if (p === 'claude/stances' || p === 'claude/stances/') return '/stances/';
  if (p === 'docs' || p === 'docs/') return '/docs/';

  if (exists(p)) return `${repoUrl}/blob/v${version}/${p}`;
  return null;
}

/** Directories the harness keeps a kind in, in both the shared and the `claude/` spelling. */
const DOC_DIRS: Record<string, string> = {
  'primitives/rules': 'rules',
  'claude/rules': 'rules',
  'primitives/stances': 'stances',
  'claude/stances': 'stances',
  'primitives/skills': 'skills',
  'claude/skills': 'skills',
  'primitives/roles': 'agents',
  'claude/agents': 'agents',
  'primitives/workflows': 'commands',
  'claude/commands': 'commands',
  'primitives/presentation': 'output-styles',
  'claude/output-styles': 'output-styles',
  'policy/hooks': 'hooks',
  'claude/hooks': 'hooks',
  docs: 'docs',
};

const NAME = /^[\w.-]+$/;
const stem = (name: string) => name.replace(/\.(md|py)$/, '');

/**
 * Map a `doc` value in product.json, a repo-relative path or directory, to a site route by
 * its directory kind and its basename. Returns null when no kind owns the path, which the
 * caller renders as plain text rather than a dead link.
 */
export function routeForDocPath(rel: string): string | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (p === '' || p.startsWith('../') || p.includes('/../')) return null;

  for (const [dir, kind] of Object.entries(DOC_DIRS)) {
    if (p === dir) return `/${kind}/`;
    if (!p.startsWith(`${dir}/`)) continue;
    const parts = p.slice(dir.length + 1).split('/');
    if (!parts.every((part) => NAME.test(part))) return null;

    if (kind === 'skills') {
      if (parts.length === 1 || (parts.length === 2 && parts[1] === 'SKILL.md')) return `/skills/${parts[0]}/`;
      return null;
    }
    if (kind === 'stances') {
      if (parts.length === 1) return `/stances/${parts[0]}/`;
      if (parts.length === 2) return `/stances/${parts[0]}/${stem(parts[1])}/`;
      return null;
    }
    return parts.length === 1 ? `/${kind}/${stem(parts[0])}/` : null;
  }
  return null;
}

/** A registry entry as far as the source-path map is concerned. */
interface SourceRouted { sourcePath: string; route: string }

/** Both spellings the harness keeps its hooks under; `sourceDir` returns either one. */
const HOOK_DIRS = ['claude/hooks', 'policy/hooks'];

/**
 * A source-path to route map for entries whose route is not derivable from their filename.
 * Hooks are the case: a hook page is built under its registered id, which for six of the
 * eleven differs from the stem of the script that implements it, so `routeForDocPath` alone
 * would point a `doc` value at a page the site never builds.
 */
export function sourceRoutes(entries: readonly SourceRouted[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    const file = entry.sourcePath.replace(/\\/g, '/').split('/').pop();
    if (!file) continue;
    for (const dir of HOOK_DIRS) out.set(`${dir}/${file}`, entry.route);
  }
  return out;
}

/**
 * The route for a `doc` value, but only when the site actually builds that page. `bySource`
 * maps a repository source path to the route built from it and wins over the filename
 * mapping; see `sourceRoutes`.
 */
export function docLink(
  rel: string | undefined,
  routes: ReadonlySet<string>,
  bySource?: ReadonlyMap<string, string>,
): string | null {
  if (!rel) return null;
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const route = bySource?.get(p) ?? routeForDocPath(rel);
  return route && routes.has(route) ? route : null;
}

/**
 * Resolve an href written in a markdown file at `fromRepoPath` to a repo-relative path.
 * Strips the fragment and query; returns null when the target escapes the repo.
 */
export function resolveRelative(fromRepoPath: string, href: string): { rel: string; suffix: string } | null {
  const hashAt = href.search(/[#?]/);
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const suffix = hashAt === -1 ? '' : href.slice(hashAt);
  if (target === '') return null;
  const dir = path.posix.dirname(fromRepoPath.replace(/\\/g, '/'));
  const joined = path.posix.normalize(path.posix.join(dir, target));
  if (joined.startsWith('..')) return null;
  return { rel: joined === '.' ? '' : joined, suffix };
}

/** True for hrefs the rewriter must leave alone: absolute URLs, anchors, site-absolute paths. */
export function isExternalHref(href: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href);
}
