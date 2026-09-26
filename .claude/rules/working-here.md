---
paths:
  - "**/*"
---

# Working in agent-harness-site

## Commands

```bash
git submodule update --init   # once, after cloning
npm ci
npm test            # vitest over src/lib/harness, including the pipeline over every harness .md
npm run dev         # localhost:4321; search needs one prior build
npm run build       # astro build + Pagefind
npm run smoke       # one page per manifest route, 404, search index, submodule at the tag
npm run check       # astro check
```

## Rules

- Conventional Commits for every commit.
- Work in a worktree branched off `main`; push to `main` directly. CI deploys every push.
- Run the gate on `HEAD` in the exact checkout before pushing.
- Every colour comes from the tokens at the top of `src/styles/global.css`; no hex elsewhere.

## Keeping the page current

- **The landing copy lives in `vendor/agent-harness/product.json`** and is changed upstream in the
  harness, then released. Never edit it here; a repin would drop the edit.
- **`.github/workflows/repin.yml` owns the submodule bump.** Hourly and on demand it compares the
  latest harness release with the pinned tag, checks out anything newer, runs the gate against it,
  and only then commits `chore(vendor): pin agent-harness vX.Y.Z` to `main`. A red gate pushes
  nothing and fails the run. `scripts/repin.mjs` decides, so the version compare has tests.
- **`.github/workflows/drift.yml` watches the outcome.** Every two hours `scripts/drift.mjs`
  compares the live `/manifest.json` with the latest harness release and keeps one
  `release-drift` issue open while they differ — at once when a repin run for the release has
  failed, otherwise after six hours — and closes it once the site is current. A red repin gate
  usually means new harness content the site's tests do not expect yet: fix the site against
  that tag, then dispatch `repin`.
- **A hand repin is allowed only to a release tag** — never a branch, never a bare commit. The
  smoke test refuses any other commit and so does the workflow.
- **After any repin, confirm the live `/manifest.json` names the new version and commit:**
  `node scripts/drift.mjs --dry-run` reports the decision without touching issues.

## Things that will bite you

- **The submodule is the content.** A fresh clone without `git submodule update --init` builds
  zero harness pages; `deploy.sh` and the smoke test both refuse that. Bump it only to a tag.
- **`glob()` in `src/content.config.ts` reads outside `src/`.** `base` resolves against the
  project root, so `./vendor/agent-harness/claude/skills` is fine. It skips `.py` files with a
  warning, which is why hooks come from `src/lib/harness/hooks.ts` instead.
- **Bare `<placeholder>` tokens in harness prose.** Markdown parses `<pref>` as HTML and a
  browser drops it. `remarkEscapeAngle` runs first in `astro.config.mjs` and turns them back
  into text; `remark.test.ts` checks every file in the submodule for lost placeholders.
- **The H1 is lifted out of every body** into `remarkPluginFrontmatter.title`; pages render it
  themselves. Do not add a second H1 in a template.
- **Search is a build artifact.** `astro-pagefind` indexes `dist/` after the build and serves
  that index in dev. No build, no results.
- **Astro is pinned to 6.4.5.** 6.4.8 resolves Vite 8; keep `overrides.vite` at 7.3.5, the same
  pin as jakeselby-com and sovereign-library.
- **The routing CloudFront Function rewrites clean URLs to `index.html`.** `trailingSlash` is
  `always`, so every internal link ends in `/`; the smoke test checks each one resolves.
- **The commands follow the harness README's delivery loop.** `COMMAND_ORDER` in
  `src/lib/harness/registry.ts` lists them; a command it does not know sorts last with no step.
- **Harness 0.13.0 and later register hooks through one dispatcher per event.** Their
  `settings.template.json` has no per-hook entries, so `listHooks` reads each policy id and event
  from `claude/OWNERSHIP.json` and resolves its script with `scriptFor`; older pins still read the
  per-hook entries. An id that matches no script, or two, fails the tests and the build.

## Deploying

1. Configure `.env.infra` as documented in README first. From a Mac:
   `cd infra && npx cdk deploy AgentHarnessSite`. ACM validation takes a few minutes.
   Copy the `DeployRoleArn` output into the
   repository variable `AWS_DEPLOY_ROLE_ARN` on GitHub.
2. Every push to `main` after that: `.github/workflows/deploy.yml` builds, smoke-tests and syncs.
3. Infrastructure changes and manual syncs: `./scripts/deploy.sh` (guards: clean tree, `main`,
   submodule at the recorded commit, tests, build, smoke).
