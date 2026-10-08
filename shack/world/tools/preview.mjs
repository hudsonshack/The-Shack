#!/usr/bin/env node
// Dev preview for The Shack world: rebuilds world.html, opens it in headless Chromium,
// takes a screenshot and prints console errors.
//
//   node shack/world/tools/preview.mjs --out /tmp/x.png [options]
//
// Options:
//   --sample              use tools/sample-data.json (example data, not real)
//   --time ISO            fake New York clock, e.g. 2026-10-09T21:15:00-04:00
//   --season NAME         spring | summer | autumn | winter
//   --status a=b,...      weather per biome, e.g. monastery=warn,mine=critical
//   --growth a=n,...      growth per biome 0..3
//   --zoom Z              camera zoom (screen px per native px)
//   --center X,Y          camera centre in tiles
//   --ceremony            start the cycle ceremony on load
//   --wait MS             wait before the screenshot (default 2500)
//   --click X,Y           click at a screen point before the screenshot
//   --eval JS             run JS in the page before the screenshot
//   --width W --height H  viewport (default 1440x900)
//   --only a.js,b.js      load only these modules (00-core.js is always included)
//
// Each run assembles its own temporary page (same logic as render_dashboard.py's
// build_world), so several previews can run at once without touching world.html.
import { execSync } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const kv = (s) => Object.fromEntries(String(s).split(',').map((p) => p.split('=')).map(([k, v]) => [k, isNaN(+v) ? v : +v]));

function buildPage(data) {
  const worldDir = path.join(repo, 'shack/world');
  const shell = fs.readFileSync(path.join(worldDir, 'shell.html'), 'utf8');
  const only = opt('only') ? String(opt('only')).split(',').concat(['00-core.js']) : null;
  const files = fs.readdirSync(path.join(worldDir, 'src')).filter((f) => f.endsWith('.js') && (!only || only.includes(f))).sort();
  const scripts = files.map((f) => `<script>/* ${f} */\n${fs.readFileSync(path.join(worldDir, 'src', f), 'utf8').replaceAll('</script', '<\\/script')}\n</script>`);
  scripts.push('<script>SHACK.boot();</script>');
  const blob = JSON.stringify(data).replaceAll('</', '<\\/');
  const html = shell.replace('__SHACK_DATA__', () => blob).replace('__SHACK_SCRIPTS__', () => scripts.join('\n'));
  const file = path.join(os.tmpdir(), `shack-preview-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  return file;
}
const realData = JSON.parse(execSync('python3 shack/scripts/render_dashboard.py --data-json', { cwd: repo }).toString());

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { const g = execSync('npm root -g').toString().trim(); playwright = createRequire(path.join(g, 'x'))('playwright'); }

const debug = {};
if (opt('sample', false)) debug.data = JSON.parse(fs.readFileSync(path.join(here, 'sample-data.json'), 'utf8'));
if (opt('time')) debug.now = opt('time');
if (opt('season')) debug.season = opt('season');
if (opt('status')) debug.status = kv(opt('status'));
if (opt('growth')) debug.growth = kv(opt('growth'));
if (opt('zoom')) debug.zoom = +opt('zoom');
if (opt('center')) debug.center = opt('center').split(',').map(Number);
if (opt('ceremony', false)) debug.ceremony = true;

const width = +opt('width', 1440), height = +opt('height', 900);
const out = opt('out', path.join(repo, 'preview.png'));
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.addInitScript((d) => { window.SHACK_DEBUG = d; }, debug);
const pageFile = buildPage(realData);
await page.goto('file://' + pageFile);
await page.waitForTimeout(+opt('wait', 2500));
if (opt('click')) { const [x, y] = opt('click').split(',').map(Number); await page.mouse.click(x, y); await page.waitForTimeout(600); }
if (opt('eval')) { await page.evaluate(opt('eval')); await page.waitForTimeout(600); }
await page.screenshot({ path: out });
const fps = await page.evaluate(() => (window.SHACK ? window.SHACK.frame : -1));
console.log(JSON.stringify({ out, frames: fps, errors: errors.filter((e) => !/fonts\.g/.test(e)) }, null, 1));
await browser.close();
fs.unlinkSync(pageFile);
