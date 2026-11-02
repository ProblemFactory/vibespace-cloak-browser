// THE PURE HALF (lib/engine.js) — the answers' shapes, the program path read by its shape only, the seed rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../lib/engine.js');

const USER_PROGRAM = '/home/userW/.cloakbrowser/chromium-146.0.7680.177.5/chrome';

test('the probe answer about a handed program: the path echoed, NOTHING claimed about it (installed / executable false — VibeSpace judges the file), protocol 1, features exactly [egress-allowlist] (no surfaces), no kinds, no version of its own', () => {
  const a = E.probeAnswer(E.programOf(USER_PROGRAM));
  assert.deepEqual(a, { id: 'vibespace.cloak-browser', installed: false, executable: false, binaryPath: USER_PROGRAM, version: null, declaredVersion: null, protocol: 1, kinds: [], features: ['egress-allowlist'] });
  assert.ok(!a.features.includes('surfaces'));
  assert.ok(!('integrity' in a), 'no receipt, no pin: nothing is downloaded');
});

test('the probe answer with nothing handed: no program, nothing claimed, no path invented', () => {
  for (const v of [undefined, null, '']) {
    const a = E.probeAnswer(E.programOf(v));
    assert.equal(a.installed, false, String(v));
    assert.equal(a.executable, false);
    assert.ok(!('binaryPath' in a), 'the plugin has no program place of its own');
  }
});

test('programOf reads the handed path by its SHAPE only: one absolute path, ≤ 4096, no NUL / line break', () => {
  assert.deepEqual(E.programOf(USER_PROGRAM), { ok: true, path: USER_PROGRAM });
  assert.equal(E.programOf(undefined).code, 'none');
  assert.equal(E.programOf('').code, 'none');
  for (const v of [42, ['/x'], { path: '/x' }, true]) assert.equal(E.programOf(v).code, 'bad_binary_path', JSON.stringify(v));
  for (const v of ['chrome', './chrome', '~/chrome', '/a\nb', '/a\rb', '/a\0b', '/' + 'x'.repeat(4096)]) {
    const p = E.programOf(v);
    assert.equal(p.code, 'bad_shape', JSON.stringify(v));
    assert.equal(p.path, v, 'kept as it came: a probe echoes it, VibeSpace says why it cannot run');
  }
  assert.ok(E.programOf('/' + 'x'.repeat(4095)).ok, '4096 characters is the cap, not past it');
  const bad = E.probeAnswer(E.programOf('chrome'));
  assert.deepEqual([bad.installed, bad.executable, bad.binaryPath], [false, false, 'chrome']);
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

test('the launch answer: THE handed program, --no-sandbox + the seed, an empty env — never a proxy, the debugging endpoint, the profile dir or a display flag', () => {
  const a = E.launchAnswer({ binaryPath: USER_PROGRAM, seed: 4242 });
  assert.deepEqual(a, { executablePath: USER_PROGRAM, args: ['--no-sandbox', '--fingerprint=4242'], env: {} });
  assert.ok(!a.args.some((x) => E.NOT_OURS_RE.test(x)));
  assert.ok(!a.args.some((x) => /proxy|headless|ozone|display/i.test(x)));
  for (const own of ['--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=<-loopback>', '--proxy-pac-url=x', '--winhttp-proxy-resolver', '--remote-debugging-port=0', '--user-data-dir=/x', '--headless=new', '--ozone-platform=x11']) assert.ok(E.NOT_OURS_RE.test(own), own);
});
