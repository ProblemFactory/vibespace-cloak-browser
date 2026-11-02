// THE SANDBOX — the plugin runs under `node --permission` with read on its package + its state folder, write on the
// latter, no child processes. The oracle is the permission model itself: an access outside those two folders throws
// ERR_ACCESS_DENIED. The planted copies prove the oracle is armed (each turns RED under the sandbox and GREEN without it),
// so the clean package's GREEN means its import and its verbs touch nothing else.
//
// THE HANDED PROGRAM — the plugin never reads the path VibeSpace hands it (the program you installed; VibeSpace judges the
// file). The permission model alone cannot prove that: a denied access throws BEFORE any system call, and a swallowed
// throw looks like silence. So the trace legs run the server under `strace -f` — sandboxed AND unsandboxed — and count the
// system calls that name a handed path: zero. A planted copy that stats the handed path shows up in the unsandboxed trace
// (the tracing oracle is armed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, start, STRACE } from './harness.mjs';

const OUTSIDE = '/etc/hostname'; // any path outside both folders: under --permission even existsSync throws
const prepend = (file, line) => (dir) => { const f = path.join(dir, file); fs.writeFileSync(f, line + '\n' + fs.readFileSync(f, 'utf8')); };
const inProbe = (line) => (dir) => { const f = path.join(dir, 'server.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('function probe(input) {', `function probe(input) { ${line}`)); };
const inHealth = (line) => (dir) => { const f = path.join(dir, 'server.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('function health() {', `function health() { ${line}`)); };

test('the clean package: hello, every verb answered about a program outside its folders, nothing denied', async (t) => {
  const s = scratch(t);
  const p = await start(s);
  t.after(() => p.stop());
  assert.equal(p.first.t, 'hello');
  assert.equal((await p.ask('GET', '/health')).status, 200);
  assert.equal((await p.ask('GET', '/probe', { query: { binaryPath: s.program } })).status, 200);
  assert.equal((await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: s.program } })).status, 200);
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED|Error/);
});

test('planted RED: an import-time existsSync outside the sandbox in lib/engine.js ⇒ every verb 500 ERR_ACCESS_DENIED (and GREEN without --permission)', async (t) => {
  const s = scratch(t, { plant: prepend('lib/engine.js', `require('fs').existsSync(${JSON.stringify(OUTSIDE)});`) });
  const p = await start(s);
  t.after(() => p.stop());
  assert.equal(p.first.t, 'hello', 'the server still says hello — the failure is answered by code, not a crash');
  const r = await p.ask('GET', '/probe', { query: { binaryPath: s.program } });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
  const l = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: s.program } });
  assert.equal(l.status, 500);
  assert.equal(l.body.code, 'ERR_ACCESS_DENIED');
  const c = await start({ ...s, sandbox: false });
  t.after(() => c.stop());
  assert.equal((await c.ask('GET', '/probe', { query: { binaryPath: s.program } })).status, 200, 'control: the same copy outside the sandbox answers');
});

test('planted RED: an import-time existsSync outside the sandbox in server.js ⇒ the process dies before hello with ERR_ACCESS_DENIED', async (t) => {
  const s = scratch(t, { plant: prepend('server.js', `require('fs').existsSync(${JSON.stringify(OUTSIDE)});`) });
  const p = await start(s);
  t.after(() => p.stop());
  assert.ok(p.first.exited, 'no hello: it exited');
  assert.match(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('planted RED: a request-time read outside the sandbox ⇒ 500 ERR_ACCESS_DENIED', async (t) => {
  const s = scratch(t, { plant: inHealth(`fs.readFileSync(${JSON.stringify(OUTSIDE)});`) });
  const p = await start(s);
  t.after(() => p.stop());
  const r = await p.ask('GET', '/health');
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
});

test('planted RED: a probe that stats the handed program ⇒ 500 ERR_ACCESS_DENIED (the program lies outside the sandbox — only VibeSpace can judge it)', async (t) => {
  const s = scratch(t, { plant: inProbe('fs.statSync(input.binaryPath);') });
  const p = await start(s);
  t.after(() => p.stop());
  const r = await p.ask('GET', '/probe', { query: { binaryPath: s.program } });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ERR_ACCESS_DENIED');
});

test('planted RED: starting a program is denied (capabilities.server = {} — no child-process grant)', async (t) => {
  const s = scratch(t, { plant: inHealth("require('child_process').execFileSync('/bin/true');") });
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
  // the handed program is never given to the file API: no stat / access / open / realpath / exists on binaryPath
  assert.doesNotMatch(src, /\b(?:stat|lstat|access|open|realpath|exists|readFile|readlink)(?:Sync)?\([^)]*binaryPath/);
});

// ── the trace legs (strace) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Hand every path to every verb under strace; → the trace's lines that name one of them (quoted, as strace prints a path). */
async function traced(t, s, { sandbox }) {
  const trace = path.join(s.root, `trace-${sandbox ? 'sandboxed' : 'bare'}.txt`);
  const missing = path.join(s.root, 'nowhere', 'chrome');
  const inside = path.join(s.dataDir, 'kernel', 'linux-x64', 'chrome'); // even a path INSIDE its state folder is not looked at
  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, '#!/bin/sh\n', { mode: 0o755 });
  const handed = [s.program, missing, inside];
  const p = await start({ ...s, sandbox, trace });
  t.after(() => p.stop());
  if (!(p.first && p.first.t === 'hello')) {
    if (/ptrace|Operation not permitted/i.test(p.stderr())) { t.skip(`strace cannot trace here (${p.stderr().trim().split('\n')[0]})`); return null; }
    assert.fail(`no hello under strace: ${p.stderr().slice(0, 400)}`);
  }
  const answers = [];
  for (const binaryPath of handed) {
    answers.push(await p.ask('GET', '/probe', { query: { binaryPath, platform: 'linux' } }));
    answers.push(await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-0000e0e1', binaryPath } }));
    answers.push(await p.ask('POST', '/launch-options', { body: { profileId: 'bk-0000e0e2', binaryPath } }));
  }
  await p.stop();
  const lines = fs.readFileSync(trace, 'utf8').split('\n');
  return { answers, lines, handed, hits: lines.filter((l) => handed.some((h) => l.includes(JSON.stringify(h)))), seedsLines: lines.filter((l) => l.includes(JSON.stringify(path.join(s.dataDir, 'seeds.json')))) };
}

for (const sandbox of [true, false]) {
  test(`strace, ${sandbox ? 'under the loader\'s --permission flags' : 'WITHOUT the sandbox (nothing to hide behind)'}: zero system calls name a handed program — outside its folders, missing, or inside its state folder`, STRACE ? {} : { skip: 'strace is not on PATH' }, async (t) => {
    const s = scratch(t);
    const r = await traced(t, s, { sandbox });
    if (!r) return;
    assert.ok(r.answers.every((a) => a.status === 200), JSON.stringify(r.answers.map((a) => [a.status, a.body.code])));
    assert.ok(r.answers.filter((a) => 'executablePath' in a.body).every((a) => r.handed.includes(a.body.executablePath)), 'every launch names the handed program');
    assert.ok(r.seedsLines.length > 0, 'the tracer sees the plugin\'s file calls (its seeds.json) — the trace is live');
    assert.deepEqual(r.hits, [], 'no stat, access, open or readlink of a handed program');
    t.diagnostic(`${r.lines.length} traced path calls · ${r.seedsLines.length} on seeds.json · ${r.hits.length} on the ${r.handed.length} handed programs over ${r.answers.length} asks`);
  });
}

test('strace planted RED: a probe that stats the handed program (its throw swallowed) shows in the unsandboxed trace — the tracing oracle is armed', STRACE ? {} : { skip: 'strace is not on PATH' }, async (t) => {
  const s = scratch(t, { plant: inProbe('try { fs.statSync(input.binaryPath); } catch { /* planted */ }') });
  const r = await traced(t, s, { sandbox: false });
  if (!r) return;
  assert.ok(r.answers.every((a) => a.status === 200), 'the swallowed stat changes no answer — only the trace sees it');
  assert.ok(r.hits.some((l) => l.includes(JSON.stringify(s.program))), `the planted stat of the handed program is in the trace (${r.hits.length} lines)`);
  t.diagnostic(`planted: ${r.hits.length} traced calls on the handed programs, e.g. ${r.hits[0].replace(/^\d+\s+/, '').slice(0, 60)}…`);
});
