// THE VENDOR'S ARCHIVE against kernel.json (opt-in: CLOAK_ARCHIVE=<the downloaded cloakbrowser-linux-x64.tar.gz>; 217 MB,
// never fetched by the suite): its length and sha256 are the pin, and — with VIBESPACE_DIR — its tar listing passes
// VibeSpace's own reader and layout verdict (tarParser + tarShapeVerdict) with kernel.json's layout, the way VibeSpace's
// kernel road judges it BEFORE anything is extracted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { vibespaceDir } from './harness.mjs';
const require = createRequire(import.meta.url);
const kernel = require('../kernel.json');
const ARCHIVE = process.env.CLOAK_ARCHIVE && fs.existsSync(process.env.CLOAK_ARCHIVE) ? path.resolve(process.env.CLOAK_ARCHIVE) : null;
const VS = vibespaceDir();
const P = kernel.platforms['linux-x64'];

test('the archive is the one kernel.json pins: its length and its sha256', ARCHIVE ? {} : { skip: 'CLOAK_ARCHIVE is not set' }, async () => {
  assert.equal(fs.statSync(ARCHIVE).size, P.bytes);
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(ARCHIVE)) h.update(c);
  assert.equal(h.digest('hex'), P.sha256);
});

test('VibeSpace\'s tar reader + layout verdict accept the archive with kernel.json\'s layout (no top folder: stripComponents 0)', ARCHIVE && VS ? {} : { skip: 'CLOAK_ARCHIVE and VIBESPACE_DIR are not both set' }, async (t) => {
  const EK = require(path.join(VS, 'src/engine-kernel.js'));
  const parser = EK.tarParser();
  const entries = [];
  const sink = new Writable({ write(chunk, _e, cb) { for (const ev of parser.write(chunk)) { if (ev.type === 'error') return cb(new Error(ev.why)); if (ev.type === 'entry') entries.push(ev.entry); } cb(); } });
  await pipeline(fs.createReadStream(ARCHIVE), zlib.createGunzip(), sink);
  assert.ok(parser.end().ok);
  const layout = { ...kernel.layout, requiredFiles: ['chrome', ...kernel.layout.requiredFiles] };
  const v = EK.tarShapeVerdict(entries, { layout, id: 'vibespace.cloak-browser', label: 'CloakBrowser' });
  assert.ok(v.ok, v.error);
  const chrome = v.entries.find((e) => e.rel === 'chrome');
  assert.ok(chrome && chrome.kind === 'file' && (chrome.mode & 0o100), 'chrome: a regular, executable file at the top');
  t.diagnostic(`${entries.length} entries · ${v.files} files · ${v.dirs} folders · ${v.unpacked} bytes unpacked · chrome ${chrome.size} bytes`);
  const one = EK.tarShapeVerdict(entries, { layout: { ...layout, stripComponents: 1 } });
  assert.ok(!one.ok, 'stripComponents 1 (a top folder the archive does not have) is refused — the measured layout is 0');
});
