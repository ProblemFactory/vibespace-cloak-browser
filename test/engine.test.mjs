// THE PURE HALF (lib/engine.js) — the answers' shapes, the seed rule, the receipt reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../lib/engine.js');
const kernel = require('../kernel.json');

test('the probe answer: protocol 1, features exactly [egress-allowlist] (no surfaces), no kinds, version null (VibeSpace measures)', () => {
  const a = E.probeAnswer({ binaryPath: '/s/kernel/linux-x64/chrome', installed: false, kernel });
  assert.deepEqual(a.features, ['egress-allowlist']);
  assert.ok(!a.features.includes('surfaces'));
  assert.deepEqual(a.kinds, []);
  assert.equal(a.protocol, 1);
  assert.equal(a.version, null);
  assert.equal(a.declaredVersion, '146.0.7680.177.5');
  assert.equal(a.id, 'vibespace.cloak-browser');
  assert.equal(a.installed, false);
  assert.equal(a.executable, false);
  assert.equal(a.integrity, null);
  assert.equal(a.binaryPath, '/s/kernel/linux-x64/chrome');
});

test('executable is never claimed for a kernel that is not installed', () => {
  assert.equal(E.probeAnswer({ installed: false, executable: true, kernel }).executable, false);
});

test('the receipt: verified = the program\'s size is the receipt\'s (VibeSpace\'s own reading); pinned = the archive this version pins', () => {
  const pin = E.pinOf(kernel);
  assert.equal(pin, '4a12bcde95fa1bb1beef2b41ab5e5c27c36be78e3be3d0dac8c64d705216670e');
  const r = { sha256: pin, bytes: 465371408, verifiedAt: 1793600000000, version: '146.0.7680.177' };
  assert.deepEqual(E.integrityOf(r, { size: 465371408, pin }), { verified: true, sha256: pin, verifiedAt: 1793600000000, pinned: true });
  assert.equal(E.integrityOf(r, { size: 465371407, pin }).verified, false, 'a program that changed since it was verified');
  assert.equal(E.integrityOf({ ...r, sha256: 'f'.repeat(64) }, { size: 465371408, pin }).pinned, false, 'a receipt for another archive');
  assert.equal(E.integrityOf({ ...r, sha256: 'nope' }, { size: 465371408, pin }).verified, false);
  assert.equal(E.integrityOf(null, { size: 1, pin }), null);
});

test('the seed rule is VibeSpace\'s mintSeed: a positive 31-bit integer from 8 hex characters', () => {
  assert.equal(E.seedOf('00000001'), 1);
  assert.equal(E.seedOf('7fffffff'), 1, '0x7fffffff % 0x7fffffff = 0 ⇒ 1');
  assert.equal(E.seedOf('ffffffff'), 0xffffffff % 0x7fffffff);
  assert.equal(E.seedOf('0000abcd'), 0xabcd);
  for (const h of ['00000000', 'deadbeef', '12345678', 'zz']) { const s = E.seedOf(h); assert.ok(Number.isInteger(s) && s >= 1 && s <= E.SEED_MAX, h); }
});

test('seedFor: a profile keeps its seed; a new profile gets one no other profile holds; a collision is re-rolled', () => {
  const t0 = E.seedTableOf(null).table;
  const a = E.seedFor(t0, 'bk-aaaa', () => '00001111');
  assert.ok(a.ok && a.minted && a.seed === 0x1111);
  const a2 = E.seedFor(a.table, 'bk-aaaa', () => '00002222');
  assert.ok(a2.ok && !a2.minted && a2.seed === 0x1111, 'asked again: the same seed, nothing minted');
  const draws = ['00001111', '00001111', '00003333'];
  const b = E.seedFor(a.table, 'bk-bbbb', () => draws.shift());
  assert.ok(b.ok && b.minted && b.seed === 0x3333, 'the draw another profile holds is never handed out');
  assert.equal(E.seedFor(a.table, 'bk-cccc', () => '00001111').code, 'seed_exhausted');
});

test('seedFor refuses a missing / path-like profile id, and never reads the object prototype', () => {
  for (const bad of ['', '../x', 'a/b', ' x', null, undefined, 'x'.repeat(200)]) assert.equal(E.seedFor(E.seedTableOf(null).table, bad, () => '00000005').code, 'bad_profile', String(bad));
  const t = E.seedTableOf('{}').table;
  const c = E.seedFor(t, 'constructor', () => '00000007');
  assert.ok(c.ok && c.minted && c.seed === 7, 'a profile named like a prototype key is a profile like any other');
  const p = E.seedTableOf('{"__proto__": 5}');
  assert.ok(p.ok && Object.getPrototypeOf(p.table) === null && Object.prototype.hasOwnProperty.call(p.table, '__proto__'));
});

test('seeds.json: absent = empty; not JSON / not an object ⇒ refused by name (never overwritten); a migrated table is read as is', () => {
  assert.ok(E.seedTableOf(null).ok);
  assert.equal(E.seedTableOf('{oops').code, 'seeds_unreadable');
  assert.equal(E.seedTableOf('[1,2]').code, 'seeds_unreadable');
  const m = E.seedTableOf('{"bk-0000e0e1": 1234567, "bk-0000e0e2": "89"}');
  assert.equal(E.seedFor(m.table, 'bk-0000e0e1', () => '00000001').seed, 1234567);
  assert.equal(E.seedFor(m.table, 'bk-0000e0e2', () => '00000001').seed, 89);
  assert.equal(E.seedFor(E.seedTableOf('{"bk-x": -3}').table, 'bk-x', () => '00000001').code, 'seed_malformed');
});

test('the launch answer: --no-sandbox + the seed, an empty env, never an argument that is VibeSpace\'s (a proxy, the debugging endpoint, the profile dir)', () => {
  const a = E.launchAnswer({ binaryPath: '/s/kernel/linux-x64/chrome', seed: 4242 });
  assert.deepEqual(a, { executablePath: '/s/kernel/linux-x64/chrome', args: ['--no-sandbox', '--fingerprint=4242'], env: {} });
  assert.ok(!a.args.some((x) => E.NOT_OURS_RE.test(x)));
  assert.ok(!a.args.some((x) => /proxy/i.test(x)));
  for (const own of ['--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=<-loopback>', '--proxy-pac-url=x', '--winhttp-proxy-resolver', '--remote-debugging-port=0', '--user-data-dir=/x']) assert.ok(E.NOT_OURS_RE.test(own), own);
});

test('insideDir: only a path under the state folder is this plugin\'s to read', () => {
  assert.ok(E.insideDir('/d/state/id', '/d/state/id/kernel/linux-x64/chrome'));
  assert.ok(!E.insideDir('/d/state/id', '/d/state/id'));
  assert.ok(!E.insideDir('/d/state/id', '/d/state/id-other/chrome'));
  assert.ok(!E.insideDir('/d/state/id', '/d/state/id/../other/chrome'));
  assert.ok(!E.insideDir('/d/state/id', 'kernel/chrome'));
  assert.ok(!E.insideDir('', '/x'));
  assert.equal(E.defaultBinaryPath('/d/state/id'), '/d/state/id/kernel/linux-x64/chrome');
});
