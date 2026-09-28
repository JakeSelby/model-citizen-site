import { describe, expect, it } from 'vitest';
import { docLink, isExternalHref, resolveRelative, routeForRepoPath, sourceRoutes } from './links.ts';
import { getRegistry, siteRoutes } from './registry.ts';

const exists = (p: string) => ['LICENSE', 'bin/harness', 'tests/test_lint.py', 'docs/usage.md'].includes(p);
const V = '0.2.0';

describe('routeForRepoPath', () => {
  it('maps each kind of harness file to its page', () => {
    expect(routeForRepoPath('docs/how-it-works.md', V, exists)).toBe('/docs/how-it-works/');
    expect(routeForRepoPath('claude/skills/plan-authoring/SKILL.md', V, exists)).toBe('/skills/plan-authoring/');
    expect(routeForRepoPath('claude/skills/plan-authoring/', V, exists)).toBe('/skills/plan-authoring/');
    expect(routeForRepoPath('claude/rules/secrets.md', V, exists)).toBe('/rules/secrets/');
    expect(routeForRepoPath('claude/stances/testing/required.md', V, exists)).toBe('/stances/testing/required/');
    expect(routeForRepoPath('claude/stances/testing', V, exists)).toBe('/stances/testing/');
    expect(routeForRepoPath('claude/agents/builder.md', V, exists)).toBe('/agents/builder/');
    expect(routeForRepoPath('claude/commands/plan.md', V, exists)).toBe('/commands/plan/');
    expect(routeForRepoPath('claude/output-styles/scannable.md', V, exists)).toBe('/output-styles/scannable/');
    expect(routeForRepoPath('claude/hooks/stop-gate.py', V, exists)).toBe('/hooks/#stop-gate');
    expect(routeForRepoPath('CHANGELOG.md', V, exists)).toBe('/changelog/');
    expect(routeForRepoPath('CONTRIBUTING.md', V, exists)).toBe('/contributing/');
    expect(routeForRepoPath('README.md', V, exists)).toBe('/');
    expect(routeForRepoPath('claude/rules/', V, exists)).toBe('/rules/');
  });

  it('sends files without a page to GitHub at the pinned tag', () => {
    expect(routeForRepoPath('LICENSE', V, exists)).toBe('https://github.com/JakeSelby/model-citizen/blob/v0.2.0/LICENSE');
    expect(routeForRepoPath('tests/test_lint.py', V, exists)).toBe('https://github.com/JakeSelby/model-citizen/blob/v0.2.0/tests/test_lint.py');
  });

  it('leaves unknown and out-of-repo paths alone', () => {
    expect(routeForRepoPath('src/parse.py', V, exists)).toBeNull();
    expect(routeForRepoPath('../other-repo/x.md', V, exists)).toBeNull();
    expect(routeForRepoPath('', V, exists)).toBeNull();
  });
});

describe('resolveRelative', () => {
  it('resolves against the source file directory and keeps the fragment', () => {
    expect(resolveRelative('claude/skills/sandbox/SKILL.md', '../../../docs/sandboxing.md#limits')).toEqual({ rel: 'docs/sandboxing.md', suffix: '#limits' });
    expect(resolveRelative('README.md', 'docs/usage.md')).toEqual({ rel: 'docs/usage.md', suffix: '' });
    expect(resolveRelative('docs/how-it-works.md', './preferences.md')).toEqual({ rel: 'docs/preferences.md', suffix: '' });
  });
  it('refuses paths that escape the repository', () => {
    expect(resolveRelative('README.md', '../secrets.txt')).toBeNull();
    expect(resolveRelative('README.md', '#only-a-fragment')).toBeNull();
  });
});

describe('isExternalHref', () => {
  it('recognises absolute URLs, anchors and site-absolute paths', () => {
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('mailto:someone@example.com')).toBe(true);
    expect(isExternalHref('#anchor')).toBe(true);
    expect(isExternalHref('/rules/')).toBe(true);
    expect(isExternalHref('docs/usage.md')).toBe(false);
    expect(isExternalHref('../x.md')).toBe(false);
  });
});

describe('docLink through the registry source map', () => {
  const routes = siteRoutes();
  const bySource = sourceRoutes(getRegistry().hooks);

  /**
   * The pinned product.json carries no capability copy, so the hook doc paths the overview
   * links are listed here and resolved against the real registry.
   */
  const HOOK_DOCS = [
    'claude/hooks/brief-guard.py',
    'claude/hooks/grade-bash.py',
    'claude/hooks/stop-gate.py',
    'claude/hooks/neutralize-tool-output.py',
  ];

  it('resolves every hook doc path to a page the site builds', () => {
    for (const doc of HOOK_DOCS) {
      const href = docLink(doc, routes, bySource);
      expect(href, doc).not.toBeNull();
      expect(routes.has(href!), doc).toBe(true);
    }
  });

  it('links a hook by its registered id, not the stem of its script', () => {
    expect(docLink('claude/hooks/neutralize-tool-output.py', routes, bySource)).toBe('/hooks/neutralize/');
    expect(docLink('claude/hooks/neutralize-tool-output.py', routes)).toBeNull();
  });

  it('accepts the policy spelling of the hooks directory', () => {
    expect(docLink('policy/hooks/allow-readonly-bash.py', routes, bySource)).toBe('/hooks/readonly-bash/');
    expect(docLink('policy/hooks/validate-plan-card.py', routes, bySource)).toBe('/hooks/plan-card/');
  });

  it('leaves every path that is not a hook where it was', () => {
    for (const doc of ['primitives/rules/secrets.md', 'claude/skills/plan-authoring/SKILL.md', 'docs/usage.md', 'bin/harness']) {
      expect(docLink(doc, routes, bySource), doc).toBe(docLink(doc, routes));
    }
    expect(docLink('primitives/rules/secrets.md', routes, bySource)).toBe('/rules/secrets/');
    expect(docLink(undefined, routes, bySource)).toBeNull();
  });
});
