// THE SERVER over IPC, under the same `node --permission` flags VibeSpace's loader uses (test/harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, start, placeKernel } from './harness.mjs';

const OWN_OR_PROXY = /^--(?:proxy-server|proxy-bypass-list|proxy-pac-url|winhttp-proxy-resolver|remote-debugging-(?:port|pipe|address)|user-data-dir)(?:=|$)|proxy/i;

async function up(t, opts) {
  const s = scratch(t, opts);
  const p = await start(s);
  t.after(() => p.stop());
  assert.equal(p.first && p.first.t, 'hello', `the server says hello under --permission (stderr: ${p.stderr().slice(0, 400)})`);
  assert.deepEqual(p.first, { t: 'hello', api: 1 });
  return { ...s, p };
}

test('GET /health', async (t) => {
  const { p } = await up(t);
  const r = await p.ask('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: 'vibespace.cloak-browser', version: '0.1.0', protocol: 1, kernel: '146.0.7680.177.5' });
});

test('GET /probe before the kernel is there: 200, installed:false about the path it was handed, the features word, no surfaces', async (t) => {
  const { p, kernelPath } = await up(t);
  const r = await p.ask('GET', '/probe', { query: { binaryPath: kernelPath, platform: 'linux' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: 'vibespace.cloak-browser', installed: false, executable: false, binaryPath: kernelPath, version: null, declaredVersion: '146.0.7680.177.5', integrity: null, protocol: 1, kinds: [], features: ['egress-allowlist'] });
  const d = await p.ask('GET', '/probe');
  assert.equal(d.body.binaryPath, kernelPath, 'nothing handed ⇒ the kernel\'s own place in the state folder');
});

test('GET /probe with the kernel in its place: installed, executable, the receipt read (verified + pinned), version still null', async (t) => {
  const { p, kernelPath } = await up(t);
  const size = placeKernel(kernelPath);
  const r = await p.ask('GET', '/probe', { query: { binaryPath: kernelPath } });
  assert.equal(r.status, 200);
  assert.equal(r.body.installed, true);
  assert.equal(r.body.executable, true);
  assert.equal(r.body.version, null);
  assert.deepEqual(r.body.integrity, { verified: true, sha256: '4a12bcde95fa1bb1beef2b41ab5e5c27c36be78e3be3d0dac8c64d705216670e', verifiedAt: 1793600000000, pinned: true });
  fs.appendFileSync(kernelPath, '# changed\n');
  const c = await p.ask('GET', '/probe', { query: { binaryPath: kernelPath } });
  assert.equal(c.body.integrity.verified, false, `the program is no longer the ${size} bytes the receipt says`);
});

test('GET /probe: a kernel that is not executable says so; one without a receipt has no integrity', async (t) => {
  const { p, kernelPath } = await up(t);
  placeKernel(kernelPath, { receipt: false, mode: 0o644 });
  const r = await p.ask('GET', '/probe', { query: { binaryPath: kernelPath } });
  assert.equal(r.body.installed, true);
  assert.equal(r.body.executable, false);
  assert.equal(r.body.integrity, null);
});

test('GET /probe about a path outside the state folder: installed:false, the path never touched (no sandbox error)', async (t) => {
  const { p } = await up(t);
  const r = await p.ask('GET', '/probe', { query: { binaryPath: '/usr/bin/env' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.installed, false);
  assert.equal(r.body.binaryPath, '/usr/bin/env');
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('POST /resolve-launch: 409 no_binary before the kernel is there; 400 without a profile', async (t) => {
  const { p, kernelPath } = await up(t);
  const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-0000e0e1', binaryPath: kernelPath, platform: 'linux' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'no_binary');
  placeKernel(kernelPath);
  for (const body of [{ binaryPath: kernelPath }, { profileId: '../x', binaryPath: kernelPath }, { profileId: 42, binaryPath: kernelPath }]) {
    const b = await p.ask('POST', '/resolve-launch', { body });
    assert.equal(b.status, 400, JSON.stringify(body));
    assert.equal(b.body.code, 'bad_profile');
  }
  const o = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: '/usr/bin/env' } });
  assert.equal(o.status, 409, 'a program outside the state folder is not this plugin\'s kernel');
});

test('POST /resolve-launch: the seed is stable per profile, distinct across profiles, recorded in seeds.json, kept across a restart', async (t) => {
  const s = scratch(t);
  let p = await start(s);
  t.after(() => p.stop());
  placeKernel(s.kernelPath);
  const ask = (profileId) => p.ask('POST', '/resolve-launch', { body: { profileId, binaryPath: s.kernelPath, userDataDir: '/somewhere/profile', platform: 'linux' } });
  const a1 = await ask('bk-0000e0e1');
  assert.equal(a1.status, 200);
  assert.equal(a1.body.executablePath, s.kernelPath);
  assert.deepEqual(a1.body.env, {});
  assert.equal(a1.body.args.length, 2);
  assert.equal(a1.body.args[0], '--no-sandbox');
  const seedA = Number(/^--fingerprint=(\d+)$/.exec(a1.body.args[1])[1]);
  assert.ok(seedA >= 1 && seedA <= 0x7fffffff);
  const a2 = await ask('bk-0000e0e1');
  assert.deepEqual(a2.body, a1.body, 'asked again: the same answer');
  const seeds = new Set([seedA]);
  for (let i = 0; i < 24; i++) { const r = await ask(`bk-${String(i).padStart(8, '0')}`); seeds.add(Number(r.body.args[1].split('=')[1])); }
  assert.equal(seeds.size, 25, 'every profile its own seed');
  const table = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'seeds.json'), 'utf8'));
  assert.equal(table['bk-0000e0e1'], seedA);
  assert.equal(Object.keys(table).length, 25);
  assert.equal(fs.statSync(path.join(s.dataDir, 'seeds.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(s.dataDir).filter((f) => /\.tmp$/.test(f)), [], 'no temporary file left');
  await p.stop();
  p = await start(s);
  const a3 = await ask('bk-0000e0e1');
  assert.deepEqual(a3.body, a1.body, 'a restarted plugin answers the same seed');
});

test('POST /launch-options is the same verb as /resolve-launch', async (t) => {
  const { p, kernelPath } = await up(t);
  placeKernel(kernelPath);
  const a = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-2', binaryPath: kernelPath } });
  const b = await p.ask('POST', '/launch-options', { body: { profileId: 'bk-2', binaryPath: kernelPath } });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body);
});

test('never a proxy argument, never the debugging endpoint or the profile dir — whatever the request carries', async (t) => {
  const { p, kernelPath } = await up(t);
  placeKernel(kernelPath);
  for (const extra of [{}, { proxy: 'http://127.0.0.1:9' }, { egressAllowlist: 'example.com' }, { userDataDir: '/x' }, { args: ['--proxy-server=x'] }]) {
    const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-3', binaryPath: kernelPath, ...extra } });
    assert.equal(r.status, 200);
    assert.ok(!r.body.args.some((a) => OWN_OR_PROXY.test(a)), JSON.stringify(r.body.args));
    assert.deepEqual(r.body.env, {});
  }
});

test('a migrated seeds.json is honoured; an unreadable one is refused by name and left as it is', async (t) => {
  const { p, kernelPath, dataDir } = await up(t);
  placeKernel(kernelPath);
  const file = path.join(dataDir, 'seeds.json');
  fs.writeFileSync(file, JSON.stringify({ 'bk-old': 1234567 }));
  const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-old', binaryPath: kernelPath } });
  assert.deepEqual(r.body.args, ['--no-sandbox', '--fingerprint=1234567']);
  fs.writeFileSync(file, '{ not json');
  const u = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: kernelPath } });
  assert.equal(u.status, 500);
  assert.equal(u.body.code, 'seeds_unreadable');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'never overwritten');
});

test('seeds.json present but unreadable (mode 000, a folder): 500 seeds_unreadable with the errno as cause, nothing written', async (t) => {
  const { p, kernelPath, dataDir } = await up(t);
  placeKernel(kernelPath);
  const file = path.join(dataDir, 'seeds.json');
  fs.writeFileSync(file, JSON.stringify({ 'bk-old': 1234567 }), { mode: 0o600 });
  fs.chmodSync(file, 0o000);
  t.after(() => { try { fs.chmodSync(file, 0o600); } catch { /* gone */ } });
  const denied = process.getuid && process.getuid() === 0 ? null : await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: kernelPath } });
  if (denied) {
    assert.equal(denied.status, 500);
    assert.equal(denied.body.code, 'seeds_unreadable');
    assert.equal(denied.body.cause, 'EACCES');
  } else t.diagnostic('running as root: mode 000 does not deny a read — the folder case below still holds');
  fs.chmodSync(file, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ 'bk-old': 1234567 }), 'never overwritten');
  fs.rmSync(file);
  fs.mkdirSync(file);
  const dir = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: kernelPath } });
  assert.equal(dir.status, 500);
  assert.equal(dir.body.code, 'seeds_unreadable');
  assert.equal(dir.body.cause, 'EISDIR');
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => /\.tmp$/.test(f)), []);
});

test('a query or body that is not an object, a binaryPath that is not a string: 400 by name, never read as «nothing asked»', async (t) => {
  const { p, kernelPath } = await up(t);
  placeKernel(kernelPath);
  for (const query of ['binaryPath=/x', ['/x'], 42]) {
    const r = await p.ask('GET', '/probe', { query });
    assert.equal(r.status, 400, JSON.stringify(query));
    assert.equal(r.body.code, 'bad_query');
  }
  for (const body of ['{"profileId":"bk-1"}', ['bk-1'], 7]) {
    const r = await p.ask('POST', '/resolve-launch', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'bad_body');
  }
  const pq = await p.ask('GET', '/probe', { query: { binaryPath: [kernelPath, '/x'] } });
  assert.equal(pq.status, 400);
  assert.equal(pq.body.code, 'bad_binary_path');
  const pb = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: { path: kernelPath } } });
  assert.equal(pb.status, 400);
  assert.equal(pb.body.code, 'bad_binary_path');
  assert.equal((await p.ask('GET', '/probe', { query: null })).status, 200, 'no query at all is «nothing asked»');
  assert.equal((await p.ask('POST', '/resolve-launch', { query: {}, body: { profileId: 'bk-1', binaryPath: kernelPath } })).status, 200);
});

test('anything else: 404 by code (a wrong method included)', async (t) => {
  const { p } = await up(t);
  for (const [m, r] of [['GET', '/nope'], ['GET', '/resolve-launch'], ['POST', '/probe'], ['DELETE', '/health'], ['GET', '/']]) {
    const a = await p.ask(m, r);
    assert.equal(a.status, 404, `${m} ${r}`);
    assert.equal(a.body.code, 'not_found');
  }
});

test('shutdown: the process exits 0', async (t) => {
  const { p } = await up(t);
  const r = await p.stop();
  assert.equal(r.code, 0);
});
