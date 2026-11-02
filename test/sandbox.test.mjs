// THE SANDBOX — the plugin runs under `node --permission` with read on its package + its state folder, write on the
// latter, no child processes. The oracle is the permission model itself: an access outside those two folders throws
// ERR_ACCESS_DENIED. The planted copies prove the oracle is armed (each turns RED under the sandbox and GREEN without it),
// so the clean package's GREEN means its import and its verbs touch nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, start, placeKernel } from './harness.mjs';

const OUTSIDE = '/etc/hostname'; // any path outside both folders: under --permission even existsSync throws
const prepend = (file, line) => (dir) => { const f = path.join(dir, file); fs.writeFileSync(f, line + '\n' + fs.readFileSync(f, 'utf8')); };

test('the clean package: hello, every verb answered, nothing denied', async (t) => {
  const s = scratch(t);
  const p = await start(s);
  t.after(() => p.stop());
  assert.equal(p.first.t, 'hello');
  placeKernel(s.kernelPath);
  assert.equal((await p.ask('GET', '/health')).status, 200);
  assert.equal((await p.ask('GET', '/probe', { query: { binaryPath: s.kernelPath } })).status, 200);
  assert.equal((await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: s.kernelPath } })).status, 200);
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED|Error/);
});

test('planted RED: an import-time existsSync outside the sandbox in lib/engine.js ⇒ every verb 500 ERR_ACCESS_DENIED (and GREEN without --permission)', async (t) => {
  const s = scratch(t, { plant: prepend('lib/engine.js', `require('fs').existsSync(${JSON.stringify(OUTSIDE)});`) });
  const p = await start(s);
  t.after(() => p.stop());
  assert.equal(p.first.t, 'hello', 'the server still says hello — the failure is answered by code, not a crash');
  const r = await p.ask('GET', '/probe', { query: { binaryPath: s.kernelPath } });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
  const l = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: s.kernelPath } });
  assert.equal(l.status, 500);
  assert.equal(l.body.code, 'ERR_ACCESS_DENIED');
  const c = await start({ ...s, sandbox: false });
  t.after(() => c.stop());
  assert.equal((await c.ask('GET', '/probe', { query: { binaryPath: s.kernelPath } })).status, 200, 'control: the same copy outside the sandbox answers');
});

test('planted RED: an import-time existsSync outside the sandbox in server.js ⇒ the process dies before hello with ERR_ACCESS_DENIED', async (t) => {
  const s = scratch(t, { plant: prepend('server.js', `require('fs').existsSync(${JSON.stringify(OUTSIDE)});`) });
  const p = await start(s);
  t.after(() => p.stop());
  assert.ok(p.first.exited, 'no hello: it exited');
  assert.match(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('planted RED: a request-time read outside the sandbox ⇒ 500 ERR_ACCESS_DENIED', async (t) => {
  const s = scratch(t, { plant: (dir) => { const f = path.join(dir, 'server.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("function health() {", `function health() { fs.readFileSync(${JSON.stringify(OUTSIDE)});`)); } });
  const p = await start(s);
  t.after(() => p.stop());
  const r = await p.ask('GET', '/health');
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
});

test('planted RED: starting a program is denied (capabilities.server = {} — no child-process grant)', async (t) => {
  const s = scratch(t, { plant: (dir) => { const f = path.join(dir, 'server.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("function health() {", "function health() { require('child_process').execFileSync('/bin/true');")); } });
  const p = await start(s);
  t.after(() => p.stop());
  const r = await p.ask('GET', '/health');
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
});

test('the package requires nothing but node built-ins and its own lib (no dependency to install, nothing that probes the box)', () => {
  const src = ['server.js', 'lib/engine.js'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reqs)].sort(), ['./lib/engine.js', 'crypto', 'fs', 'path']);
  assert.doesNotMatch(src, /child_process|process\.binding|\bspawn\(|\bexec(File)?(Sync)?\(/);
});
