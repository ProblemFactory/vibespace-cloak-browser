// THE SERVER over IPC, under the same `node --permission` flags VibeSpace's loader uses (test/harness.mjs). The program it
// is handed lives OUTSIDE the plugin's two folders (where you installed CloakBrowser): the server echoes it, never reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, start } from './harness.mjs';

const OWN_OR_PROXY = /^--(?:proxy-server|proxy-bypass-list|proxy-pac-url|winhttp-proxy-resolver|remote-debugging-(?:port|pipe|address)|user-data-dir|headless|ozone-platform)(?:=|$)|proxy/i;

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
  assert.deepEqual(r.body, { ok: true, id: 'vibespace.cloak-browser', version: '0.2.0', protocol: 1 });
});

test('GET /probe ECHOES the program it is handed (outside its folders) and claims nothing about it, the features word, no surfaces, no version of its own', async (t) => {
  const { p, program } = await up(t);
  const r = await p.ask('GET', '/probe', { query: { binaryPath: program, platform: 'linux' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: 'vibespace.cloak-browser', installed: false, executable: false, binaryPath: program, version: null, declaredVersion: null, protocol: 1, kinds: [], features: ['egress-allowlist'] });
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('GET /probe judges nothing about the file: a missing program, a folder, a file without the x-bit are all answered the same — VibeSpace judges the file', async (t) => {
  const { p, root, program } = await up(t);
  const folder = path.join(root, 'elsewhere');
  const plain = path.join(root, 'elsewhere', 'not-a-program');
  fs.writeFileSync(plain, 'text\n', { mode: 0o644 });
  const missing = path.join(root, 'nowhere', 'chrome');
  const want = (await p.ask('GET', '/probe', { query: { binaryPath: program } })).body;
  for (const handed of [missing, folder, plain, '/usr/bin/env']) {
    const r = await p.ask('GET', '/probe', { query: { binaryPath: handed } });
    assert.equal(r.status, 200, handed);
    assert.deepEqual(r.body, { ...want, binaryPath: handed }, `${handed}: the same answer — the plugin never looked`);
  }
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('GET /probe with nothing handed: 200, no program claimed, no path invented (the plugin has no program place of its own)', async (t) => {
  const { p } = await up(t);
  for (const query of [{}, { binaryPath: '' }, null]) {
    const r = await p.ask('GET', '/probe', { query });
    assert.equal(r.status, 200, JSON.stringify(query));
    assert.equal(r.body.installed, false);
    assert.equal(r.body.executable, false);
    assert.ok(!('binaryPath' in r.body));
  }
});

test('GET /probe about a path of another shape (relative, a line break): echoed with nothing claimed — VibeSpace says why it cannot run', async (t) => {
  const { p } = await up(t);
  for (const handed of ['chrome', 'bin/chrome', '/a\nb']) {
    const r = await p.ask('GET', '/probe', { query: { binaryPath: handed } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.installed, r.body.executable, r.body.binaryPath], [false, false, handed]);
  }
});

test('POST /resolve-launch answers THE handed program (outside its folders) + the seed; 400 without a profile; 400 bad_binary_path without one absolute program', async (t) => {
  const { p, program, root, dataDir } = await up(t);
  const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-0000e0e1', binaryPath: program, platform: 'linux' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.executablePath, program, 'the program VibeSpace resolved is the one it starts');
  const missing = path.join(root, 'nowhere', 'chrome');
  const m = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-0000e0e1', binaryPath: missing } });
  assert.equal(m.status, 200, 'a missing file is VibeSpace\'s to refuse (it judged it before asking) — the plugin never looked');
  assert.equal(m.body.executablePath, missing);
  for (const body of [{ binaryPath: program }, { profileId: '../x', binaryPath: program }, { profileId: 42, binaryPath: program }]) {
    const b = await p.ask('POST', '/resolve-launch', { body });
    assert.equal(b.status, 400, JSON.stringify(body));
    assert.equal(b.body.code, 'bad_profile');
  }
  for (const binaryPath of [undefined, '', 'chrome', '/a\nb', '/' + 'x'.repeat(4096)]) {
    const b = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath } });
    assert.equal(b.status, 400, JSON.stringify(binaryPath));
    assert.equal(b.body.code, 'bad_binary_path');
  }
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, 'seeds.json'), 'utf8'))), ['bk-0000e0e1'], 'a refused launch mints no seed');
  assert.doesNotMatch(p.stderr(), /ERR_ACCESS_DENIED/);
});

test('POST /resolve-launch: the seed is stable per profile, distinct across profiles, recorded in seeds.json, kept across a restart', async (t) => {
  const s = scratch(t);
  let p = await start(s);
  t.after(() => p.stop());
  const ask = (profileId) => p.ask('POST', '/resolve-launch', { body: { profileId, binaryPath: s.program, userDataDir: '/somewhere/profile', platform: 'linux' } });
  const a1 = await ask('bk-0000e0e1');
  assert.equal(a1.status, 200);
  assert.equal(a1.body.executablePath, s.program);
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
  const other = path.join(s.root, 'elsewhere', 'chrome-new');
  const a4 = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-0000e0e1', binaryPath: other } });
  assert.deepEqual(a4.body, { ...a1.body, executablePath: other }, 'another program set (a new build): the same seed, the new program');
});

test('POST /launch-options is the same verb as /resolve-launch', async (t) => {
  const { p, program } = await up(t);
  const a = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-2', binaryPath: program } });
  const b = await p.ask('POST', '/launch-options', { body: { profileId: 'bk-2', binaryPath: program } });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body);
});

test('never a proxy argument, never the debugging endpoint, the profile dir or a display flag — whatever the request carries', async (t) => {
  const { p, program } = await up(t);
  for (const extra of [{}, { proxy: 'http://127.0.0.1:9' }, { egressAllowlist: 'example.com' }, { userDataDir: '/x' }, { args: ['--proxy-server=x'] }, { headed: false }, { executablePath: '/usr/bin/env' }]) {
    const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-3', binaryPath: program, ...extra } });
    assert.equal(r.status, 200);
    assert.equal(r.body.executablePath, program, 'only binaryPath names the program');
    assert.ok(!r.body.args.some((a) => OWN_OR_PROXY.test(a)), JSON.stringify(r.body.args));
    assert.deepEqual(r.body.env, {});
  }
});

test('a migrated seeds.json is honoured; an unreadable one is refused by name and left as it is', async (t) => {
  const { p, program, dataDir } = await up(t);
  const file = path.join(dataDir, 'seeds.json');
  fs.writeFileSync(file, JSON.stringify({ 'bk-old': 1234567 }));
  const r = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-old', binaryPath: program } });
  assert.deepEqual(r.body.args, ['--no-sandbox', '--fingerprint=1234567']);
  fs.writeFileSync(file, '{ not json');
  const u = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: program } });
  assert.equal(u.status, 500);
  assert.equal(u.body.code, 'seeds_unreadable');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'never overwritten');
});

test('seeds.json present but unreadable (mode 000, a folder): 500 seeds_unreadable with the errno as cause, nothing written', async (t) => {
  const { p, program, dataDir } = await up(t);
  const file = path.join(dataDir, 'seeds.json');
  fs.writeFileSync(file, JSON.stringify({ 'bk-old': 1234567 }), { mode: 0o600 });
  fs.chmodSync(file, 0o000);
  t.after(() => { try { fs.chmodSync(file, 0o600); } catch { /* gone */ } });
  const denied = process.getuid && process.getuid() === 0 ? null : await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: program } });
  if (denied) {
    assert.equal(denied.status, 500);
    assert.equal(denied.body.code, 'seeds_unreadable');
    assert.equal(denied.body.cause, 'EACCES');
  } else t.diagnostic('running as root: mode 000 does not deny a read — the folder case below still holds');
  fs.chmodSync(file, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ 'bk-old': 1234567 }), 'never overwritten');
  fs.rmSync(file);
  fs.mkdirSync(file);
  const dir = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-new', binaryPath: program } });
  assert.equal(dir.status, 500);
  assert.equal(dir.body.code, 'seeds_unreadable');
  assert.equal(dir.body.cause, 'EISDIR');
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => /\.tmp$/.test(f)), []);
});

test('a query or body that is not an object, a binaryPath that is not a string: 400 by name, never read as «nothing asked»', async (t) => {
  const { p, program } = await up(t);
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
  const pq = await p.ask('GET', '/probe', { query: { binaryPath: [program, '/x'] } });
  assert.equal(pq.status, 400);
  assert.equal(pq.body.code, 'bad_binary_path');
  const pb = await p.ask('POST', '/resolve-launch', { body: { profileId: 'bk-1', binaryPath: { path: program } } });
  assert.equal(pb.status, 400);
  assert.equal(pb.body.code, 'bad_binary_path');
  assert.equal((await p.ask('GET', '/probe', { query: null })).status, 200, 'no query at all is «nothing asked»');
  assert.equal((await p.ask('POST', '/resolve-launch', { query: {}, body: { profileId: 'bk-1', binaryPath: program } })).status, 200);
});

test('anything else: 404 by code (a wrong method included)', async (t) => {
  const { p } = await up(t);
  for (const [m, r] of [['GET', '/nope'], ['GET', '/resolve-launch'], ['POST', '/probe'], ['DELETE', '/health'], ['GET', '/'], ['POST', '/kernel'], ['GET', '/install']]) {
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
