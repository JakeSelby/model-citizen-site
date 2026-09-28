#!/usr/bin/env node
// Post-build smoke test. Reads the manifest the site publishes and refuses a
// build that is missing a page, a search index, a 404, or that renders a
// submodule commit which is not the tagged release VERSION claims.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const vendor = path.join(root, 'vendor/agent-harness');
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

const htmlPages = () => {
  const out = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) visit(p);
      else if (name === 'index.html') out.push(p);
    }
  };
  visit(dist);
  return out;
};

const manifestFile = path.join(dist, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  fail('dist/manifest.json missing — did the build run?');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

// Every route in the manifest is a page on disk.
const fileFor = (route) => {
  const clean = route.replace(/[#?].*$/, '');
  if (clean === '/') return path.join(dist, 'index.html');
  if (clean.endsWith('/')) return path.join(dist, clean.slice(1), 'index.html');
  if (path.extname(clean)) return path.join(dist, clean.slice(1));
  return path.join(dist, clean.slice(1), 'index.html');
};
for (const r of manifest.routes) {
  if (!fs.existsSync(fileFor(r.route))) fail(`route ${r.route} (${r.kind} ${r.id}) has no index.html`);
}

for (const must of ['404.html', 'pagefind/pagefind.js', 'sitemap-index.xml', 'manifest.json']) {
  if (!fs.existsSync(path.join(dist, must))) fail(`dist/${must} missing`);
}

// The brand assets the head points at are built and served.
const ORIGIN = 'https://model-citizen.dev/';
for (const asset of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og.png']) {
  if (!fs.existsSync(path.join(dist, asset))) fail(`dist/${asset} missing`);
}

// Every social image URL is absolute, on this origin, and resolves to a file in dist.
const metaContents = (html, key, attr) => {
  const re = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"[^>]*>`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
};
const socialPages = [...new Set(['/', ...manifest.routes.map((r) => r.route)])];
for (const route of socialPages) {
  const file = fileFor(route);
  if (!file.endsWith('.html') || !fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const images = [...metaContents(html, 'og:image', 'property'), ...metaContents(html, 'twitter:image', 'name')];
  if (images.length < 2) fail(`${route} carries ${images.length} social image tag(s), expected og:image and twitter:image`);
  for (const url of images) {
    if (!url.startsWith(ORIGIN)) {
      fail(`${route} social image ${url} is not on ${ORIGIN}`);
      continue;
    }
    const asset = path.join(dist, url.slice(ORIGIN.length));
    if (!fs.existsSync(asset)) fail(`${route} social image ${url} has no file at dist/${path.relative(dist, asset)}`);
  }
  if (metaContents(html, 'twitter:card', 'name')[0] !== 'summary_large_image') {
    fail(`${route} twitter:card is not summary_large_image`);
  }
}

// No em dash (U+2014) in the copy this change owns. The title and og:description still carry
// one from Layout.astro:15 and the pinned submodule's product.json; widen this to <title> and
// og:description once the repin PR (fix/repin-v0.11.1) lands its title fix.
for (const file of htmlPages()) {
  const html = fs.readFileSync(file, 'utf8');
  const owned = [
    ...metaContents(html, 'og:image', 'property'),
    ...metaContents(html, 'twitter:image', 'name'),
    ...metaContents(html, 'og:image:alt', 'property'),
    ...[...html.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map((m) => m[0]),
  ];
  for (const text of owned) {
    if (text.includes('\u2014')) fail(`${path.relative(dist, file)} carries an em dash in ${text}`);
  }
}

// Every built page carries the name-change banner, with its exact text and its link to the
// old repository.
const BANNER_TEXT = 'Model Citizen was formerly agent-harness: same project, new name.';
const BANNER_LINK = 'href="https://github.com/JakeSelby/model-citizen"';
const htmlUnder = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? htmlUnder(p) : e.name.endsWith('.html') ? [p] : [];
  });
for (const file of htmlUnder(dist)) {
  const html = fs.readFileSync(file, 'utf8');
  const aside = html.match(/<aside[^>]*aria-label="Name change"[^>]*>([\s\S]*?)<\/aside>/);
  const text = aside?.[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!aside) fail(`${path.relative(dist, file)} has no name-change banner`);
  else if (text !== BANNER_TEXT) fail(`${path.relative(dist, file)} banner reads "${text}"`);
  else if (!aside[1].includes(BANNER_LINK)) fail(`${path.relative(dist, file)} banner does not link to the Model Citizen repository`);
}

// The submodule is at the tagged release the site claims to render.
const version = fs.readFileSync(path.join(vendor, 'VERSION'), 'utf8').trim();
if (manifest.version !== version) fail(`manifest version ${manifest.version} ≠ VERSION ${version}`);
// A CI checkout of the submodule is shallow and carries no tags, so fetch the one
// tag VERSION names before asking whether HEAD is it.
const git = (args) => execSync(`git ${args}`, { cwd: vendor, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
try {
  git(`fetch --quiet --depth=1 origin tag v${version}`);
} catch {
  /* offline or already present: describe below decides */
}
if (manifest.release?.commit !== git('rev-parse HEAD')) fail('manifest source commit differs from the pinned submodule');
if (manifest.release?.tag !== `v${version}`) fail('manifest tag differs from VERSION');

try {
  const tag = git('describe --tags --exact-match');
  if (tag !== `v${version}`) fail(`submodule is at ${tag}, VERSION says v${version}`);
} catch {
  fail(`submodule commit is not the v${version} tag that VERSION names (checkout vendor/agent-harness at that tag)`);
}

// Every internal link resolves to a file in dist.
const htmlFiles = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.html')) htmlFiles.push(p);
  }
};
walk(dist);
let links = 0;
const seen = new Set();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    links++;
    const target = fileFor(href);
    if (seen.has(target)) continue;
    seen.add(target);
    if (!fs.existsSync(target)) fail(`${path.relative(dist, file)} links to ${href}, which is not in dist`);
  }
}

const pages = htmlFiles.length;
if (pages < manifest.routes.length) fail(`only ${pages} html files for ${manifest.routes.length} routes`);

if (failures) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exit(1);
}
console.log(`✓ v${version}: ${manifest.routes.length} routes, ${pages} pages, ${links} internal links resolve, search index and 404 present`);
