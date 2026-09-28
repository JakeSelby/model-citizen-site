import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The brand half of scripts/smoke.mjs, exercised against a synthetic dist. The submodule and
// route checks are satisfied by a throwaway git repo so only the social-image failures show.
const VERSION = '9.9.9';

const head = (overrides = {}) => {
  const tags = {
    'og:image': 'https://model-citizen.dev/og.png',
    'twitter:image': 'https://model-citizen.dev/og.png',
    'og:image:alt': 'Agent Harness. Your way of working, across AI agents.',
    'twitter:card': 'summary_large_image',
    ...overrides,
  };
  return Object.entries(tags)
    .filter(([, content]) => content !== null)
    .map(([key, content]) => {
      const attr = key.startsWith('og:') ? 'property' : 'name';
      return `<meta ${attr}="${key}" content="${content}">`;
    })
    .join('\n');
};

const BANNER =
  '<aside class="rename" aria-label="Name change">\n  <p>Model Citizen was formerly ' +
  '<a href="https://github.com/JakeSelby/model-citizen">agent-harness</a>: same project, new name.</p>\n</aside>';

const page = (overrides, banner = BANNER) =>
  `<!doctype html><html><head>${head(overrides)}</head><body>${banner}</body></html>`;

function smoke({ overrides = {}, assets = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og.png'], banner = BANNER, notFound = page() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-smoke-test-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('../smoke.mjs', import.meta.url), join(root, 'scripts/smoke.mjs'));

    const vendor = join(root, 'vendor/agent-harness');
    mkdirSync(vendor, { recursive: true });
    writeFileSync(join(vendor, 'VERSION'), `${VERSION}\n`);
    const git = (args) => spawnSync('git', args, { cwd: vendor, encoding: 'utf8' });
    git(['init', '--quiet']);
    git(['-c', 'user.name=t', '-c', 'user.email=tester', 'commit', '--quiet', '--allow-empty', '-m', 'v']);
    git(['tag', `v${VERSION}`]);
    const commit = git(['rev-parse', 'HEAD']).stdout.trim();

    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'docs'), { recursive: true });
    mkdirSync(join(dist, 'pagefind'), { recursive: true });
    for (const asset of assets) writeFileSync(join(dist, asset), 'x');
    for (const must of ['pagefind/pagefind.js', 'sitemap-index.xml']) {
      writeFileSync(join(dist, must), 'x');
    }
    writeFileSync(join(dist, '404.html'), notFound);
    writeFileSync(join(dist, 'index.html'), page(overrides, banner));
    writeFileSync(join(dist, 'docs/index.html'), page());
    writeFileSync(
      join(dist, 'manifest.json'),
      JSON.stringify({
        version: VERSION,
        release: { commit, tag: `v${VERSION}` },
        routes: [
          { route: '/', kind: 'page', id: 'home' },
          { route: '/docs/', kind: 'page', id: 'docs' },
        ],
      }),
    );

    const result = spawnSync(process.execPath, [join(root, 'scripts/smoke.mjs')], { cwd: root, encoding: 'utf8' });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a dist with the card, the icons and same-origin image tags passes', () => {
  const { status, out } = smoke();
  assert.equal(status, 0, out);
});

test('a missing og.png fails', () => {
  const { status, out } = smoke({ assets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'] });
  assert.equal(status, 1);
  assert.match(out, /dist\/og\.png missing/);
  assert.match(out, /social image https:\/\/model-citizen\.dev\/og\.png has no file/);
});

test('a missing icon fails', () => {
  const { status, out } = smoke({ assets: ['favicon.svg', 'apple-touch-icon.png', 'og.png'] });
  assert.equal(status, 1);
  assert.match(out, /dist\/favicon\.ico missing/);
});

test('an off-origin social image fails', () => {
  const { status, out } = smoke({ overrides: { 'og:image': 'https://example.com/og.png' } });
  assert.equal(status, 1);
  assert.match(out, /is not on https:\/\/model-citizen\.dev\//);
});

test('a relative social image fails', () => {
  const { status, out } = smoke({ overrides: { 'twitter:image': '/og.png' } });
  assert.equal(status, 1);
  assert.match(out, /social image \/og\.png is not on/);
});

test('a page with no social image tags fails', () => {
  const { status, out } = smoke({ overrides: { 'og:image': null, 'twitter:image': null } });
  assert.equal(status, 1);
  assert.match(out, /carries 0 social image tag\(s\)/);
});

test('the small twitter card fails', () => {
  const { status, out } = smoke({ overrides: { 'twitter:card': 'summary' } });
  assert.equal(status, 1);
  assert.match(out, /twitter:card is not summary_large_image/);
});

test('an em dash in og:image:alt fails', () => {
  const { status, out } = smoke({ overrides: { 'og:image:alt': `Agent Harness ${String.fromCharCode(0x2014)} the reference` } });
  assert.equal(status, 1);
  assert.match(out, /carries an em dash/);
});

test('a page without the name-change banner fails', () => {
  const { status, out } = smoke({ banner: '' });
  assert.equal(status, 1);
  assert.match(out, /index\.html has no name-change banner/);
});

test('the 404 page needs the banner too', () => {
  const { status, out } = smoke({ notFound: '<!doctype html><html><body></body></html>' });
  assert.equal(status, 1);
  assert.match(out, /404\.html has no name-change banner/);
});

test('a banner with other words fails', () => {
  const { status, out } = smoke({ banner: BANNER.replace('same project', 'a new project') });
  assert.equal(status, 1);
  assert.match(out, /banner reads "Model Citizen was formerly agent-harness: a new project, new name\."/);
});

test('a banner that does not link to the old repository fails', () => {
  const { status, out } = smoke({ banner: BANNER.replace('https://github.com/JakeSelby/model-citizen', 'https://example.com') });
  assert.equal(status, 1);
  assert.match(out, /banner does not link to the Model Citizen repository/);
});
