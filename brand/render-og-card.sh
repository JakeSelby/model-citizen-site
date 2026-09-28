#!/bin/sh
# Renders og-card.html to ../public/og.png at 1200 x 630 through headless Chrome.
# Needs network: the card loads Inter and Source Serif 4 from Google Fonts at render time.
set -eu
cd "$(dirname "$0")"
node --input-type=module <<'JS'
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profile = await mkdtemp(join(tmpdir(), 'model-citizen-og-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-pipe',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
const pending = new Map();
let loaded;
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.method === 'Page.loadEventFired') loaded?.();
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  }
});
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
async function render() {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1200, height: 630, deviceScaleFactor: 1, mobile: false,
  });
  const load = new Promise((resolve) => { loaded = resolve; });
  const navigation = await page('Page.navigate', { url: pathToFileURL(resolve('og-card.html')).href });
  if (navigation.errorText) throw new Error(navigation.errorText);
  await load;
  const fonts = await page('Runtime.evaluate', {
    expression: `(async () => {
      await document.fonts.ready;
      const required = ['700 84px "Source Serif 4"', 'italic 600 40px "Source Serif 4"', '700 22px Inter'];
      for (const font of required) {
        const faces = await document.fonts.load(font);
        if (!faces.length || !document.fonts.check(font)) throw new Error('Font failed to load: ' + font);
      }
      await document.fonts.ready;
      return { status: document.fonts.status, families: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (fonts.exceptionDetails) throw new Error(JSON.stringify(fonts.exceptionDetails));
  const { data } = await page('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
  });
  await writeFile('../public/og.png', Buffer.from(data, 'base64'));
  console.log('Fonts ready:', fonts.result.value);
}
let timeout;
try {
  await Promise.race([
    render(),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Card render timed out after 45 seconds')), 45000);
      chrome.once('error', reject);
      chrome.once('exit', (code) => reject(new Error(`Chrome exited before capture: ${code}`)));
    }),
  ]);
} finally {
  clearTimeout(timeout);
  const stopped = new Promise((resolve) => chrome.once('exit', resolve));
  if (chrome.exitCode === null && chrome.pid) { chrome.kill(); await stopped; }
  await rm(profile, { recursive: true, force: true });
}
JS
python3 - <<'PY'
from PIL import Image
im = Image.open("../public/og.png")
assert im.size == (1200, 630), im.size
print("og.png", im.size)
PY
