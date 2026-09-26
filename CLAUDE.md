# agent-harness-site

Public reference site for the agent-harness repository, at
**https://agent-harness.jakeselby.com**. Astro 6, static, no client framework, hand-written CSS
carrying the jakeselby.com paper palette with an amber accent.

Nothing about the harness is authored here. `vendor/agent-harness` is a git submodule pinned to
a release tag; `src/content.config.ts` globs its markdown and `src/lib/harness/registry.ts`
reads its structure. A page cannot drift from the file it describes.

## For other repositories

- The landing copy is the harness's `product.json` at the pinned release tag. Change it in the harness and release;
  the site repins itself, and an open `release-drift` issue means it is behind.
- Work in a worktree off `main` and push straight to `main`; every push deploys.

Before changing anything here from a session started in another folder, read
`.claude/rules/working-here.md`. Claude Code loads it by itself only in sessions started in this
repository, on their first file read; every other session and tool must read it.

## Gate

```sh
npm --prefix infra ci
npm --prefix infra test
npm --prefix infra run build
npm test
npm run build
node scripts/smoke.mjs
```

Expected clean-tree result: all tests and the build pass, the smoke test reports no failures,
and `git status --porcelain` is empty (generated output and local config are ignored).

- **`AGENTS.md` is a symlink to this file.** Edit `CLAUDE.md`.
