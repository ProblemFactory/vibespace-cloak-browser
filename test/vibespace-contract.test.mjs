// THE CONTRACT — this package judged by VibeSpace's OWN pure verdicts, imported from a VibeSpace checkout (VIBESPACE_DIR):
// src/plugin-manifest.js validateManifest / capabilitySummary / capabilitiesHash, src/browser-engines.js engineAnswerVerdict
// and the program-row rules. Without VIBESPACE_DIR only the self-contained checks run.
//
// The engine contract this plugin relies on:
//   ① the probe `features` word `egress-allowlist` (and `surfaces` optional) + the reserved settings row `egressAllowlist`
//   ② THE USER-BINARY ROAD: the reserved settings row `executablePath` — the program YOU name; VibeSpace reads it, judges the
//      file, measures its version, hands the path to the probe and the launch, and starts exactly that program
// A VibeSpace without ② does not read the row: its registry hands the plugin its own download place, finds no program there
// and refuses the start by name; its kernel road refuses a package with no kernel.json. The HOST leg first proves everything
// else of the plugin is accepted, then THE HOST MODE decides
// (test/harness.mjs): such a host is a FAILING leg named «THE HOST REFUSES THE PLUGIN», unless CLOAK_EXPECT_HOST_REFUSES=1
// declares it expected (then it passes by name). A host with ② is GREEN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, vibespaceDir, hostRefuses, hostRuns, assertConsent } from './harness.mjs';
const require = createRequire(import.meta.url);
const manifest = require('../vibespace-plugin.json');
const E = require('../lib/engine.js');
const VS = vibespaceDir();
const vs = (rel) => require(path.join(VS, rel));
const needVS = VS ? {} : { skip: 'VIBESPACE_DIR is not set to a VibeSpace checkout' };
const USER_PROGRAM = '/home/userW/.cloakbrowser/chromium-146.0.7680.177.5/chrome';
const LICENCE_URL = 'https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md';

test('the manifest, self-contained: the engine id, server + routes + browserEngine, TWO string settings — executablePath (the program) and egressAllowlist (the sites) — no capability', () => {
  assert.equal(manifest.id, E.ID);
  assert.equal(manifest.label, 'CloakBrowser');
  assert.equal(manifest.server, true);
  assert.equal(manifest.client, 'none');
  assert.deepEqual({ ...manifest.contributes, settings: undefined }, { routes: true, browserEngine: true, settings: undefined });
  assert.deepEqual(manifest.contributes.settings.map((s) => [s.key, s.type, s.default]), [['executablePath', 'string', ''], ['egressAllowlist', 'string', '']]);
  assert.deepEqual(manifest.capabilities, { server: {} });
  const [prog, sites] = manifest.contributes.settings;
  assert.equal(prog.label, 'Program file', 'the words VibeSpace prints when it is unset: «open ⚙ → Plugins → CloakBrowser → Program file»');
  assert.match(prog.description, /CloakBrowser program \(its chrome file\)/);
  assert.match(prog.description, /install CloakBrowser the way its maker says, then paste the path here/i);
  assert.match(manifest.description, new RegExp(`Not affiliated with CloakHQ.*${LICENCE_URL.replace(/[.\/]/g, '\\$&')}`));
  assert.doesNotMatch(manifest.description, /download/i, 'VibeSpace downloads nothing for this plugin');
  assert.ok(manifest.description.length <= 500, `description ${manifest.description.length} ≤ 500`);
  for (const s of [prog, sites]) assert.ok(s.description.length <= 300 && s.label.length <= 80, `${s.key}: within the manifest text caps`);
});

test('the package names no download: no kernel.json, no archive address, no sha256 pin — the only web addresses are the licence\'s and the repository\'s', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
  walk(REPO);
  const rel = files.map((f) => path.relative(REPO, f));
  for (const gone of ['kernel.json', 'egress-proof.json', 'scripts/measure-egress.mjs']) assert.ok(!rel.includes(gone), `${gone} is gone`);
  const allowed = new Set([LICENCE_URL, 'https://github.com/CloakHQ/CloakBrowser', 'https://github.com/ProblemFactory/vibespace-cloak-browser.git']);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const r = path.relative(REPO, f);
    assert.doesNotMatch(text, /cloakbrowser\.dev|releases\/download/i, `${r} names no download host`);
    assert.doesNotMatch(text, /\b[0-9a-f]{64}\b/, `${r} pins no sha256`);
    const urls = [...text.matchAll(/https?:\/\/[^\s)>"'`]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));
    assert.deepEqual(urls.filter((u) => !allowed.has(u) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(u)), [], `${r}: no other web address`);
  }
});

test('CHANGELOG.md has an entry for this version naming the same minimum VibeSpace as engines.vibespace', () => {
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const entry = log.split(/^## /m).find((s) => s.startsWith(manifest.version + '\n'));
  assert.ok(entry, `an entry «## ${manifest.version}»`);
  const m = /Requires VibeSpace ≥ (\d+\.\d+\.\d+)/.exec(entry);
  assert.ok(m, 'the entry names its minimum VibeSpace');
  assert.equal(m[1], manifest.engines.vibespace, 'the CHANGELOG and the manifest name the same release');
});

test('VibeSpace validateManifest: valid, no warning, nothing clipped; the consent names a server process + the browser engine (+ the proxy and the program lines) and nothing more', needVS, () => {
  const PM = vs('src/plugin-manifest.js');
  const v = PM.validateManifest(manifest, { folderName: manifest.id, hostVersion: manifest.engines.vibespace });
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.manifest.contributes.settings, manifest.contributes.settings.map((s) => ({ key: s.key, type: 'string', label: s.label, description: s.description, default: '' })), 'both rows arrive whole (≤ 80 / ≤ 300 characters)');
  assert.equal(v.manifest.description, manifest.description, 'the description arrives whole (≤ 500)');
  assert.equal(v.manifest.contributes.browserEngine, true);
  assert.ok(PM.needsConsent(v.manifest));
  assertConsent(PM.capabilitySummary(v.manifest).map((i) => i.id));
  assert.ok(PM.ID_RE.test(manifest.id) && vs('src/browser-engines.js').ID_RE.test(manifest.id));
});

test('VibeSpace engineAnswerVerdict accepts the probe answer about the handed program (features [egress-allowlist], no surfaces) and the launch answer naming it', needVS, () => {
  const BE = vs('src/browser-engines.js');
  const settings = vs('src/plugin-manifest.js').validateManifest(manifest, { folderName: manifest.id }).manifest.contributes.settings;
  const v = BE.engineAnswerVerdict('probe', { status: 200, body: E.probeAnswer(E.programOf(USER_PROGRAM)) }, { id: manifest.id, label: manifest.label, settings });
  assert.ok(v.ok, v.error);
  assert.deepEqual(v.fact.features, ['egress-allowlist']);
  assert.equal(v.fact.binaryPath, USER_PROGRAM, 'the path it was handed, echoed');
  assert.deepEqual(v.fact.egress, { setting: 'plugin.vibespace.cloak-browser.egressAllowlist', default: '' });
  const none = BE.engineAnswerVerdict('probe', { status: 200, body: E.probeAnswer(E.programOf('')) }, { id: manifest.id, settings });
  assert.ok(none.ok && none.fact.binaryPath === null && none.fact.installed === false, 'nothing handed: a valid answer that claims nothing');
  const launch = BE.engineAnswerVerdict('launchOptions', { status: 200, body: E.launchAnswer({ binaryPath: USER_PROGRAM, seed: 1234567 }) }, { id: manifest.id });
  assert.ok(launch.ok, launch.error);
  assert.deepEqual(launch.launch, { executablePath: USER_PROGRAM, args: ['--no-sandbox', '--fingerprint=1234567'], env: {} });
  assert.ok(!launch.launch.args.some((a) => BE.OWN_ARG_RE.test(a) || (BE.PROXY_ARG_RE && BE.PROXY_ARG_RE.test(a))));
});

test('HOST: VibeSpace reads executablePath as the engine\'s program — the user-binary road (engine contract ②)', needVS, (t) => {
  const BE = vs('src/browser-engines.js'), PM = vs('src/plugin-manifest.js');
  const m = PM.validateManifest(manifest, { folderName: manifest.id }).manifest;
  const withoutRow = { ...m, contributes: { ...m.contributes, settings: m.contributes.settings.filter((s) => s.key !== 'executablePath') } };
  if (typeof BE.engineSourceOf === 'function' && typeof BE.binaryRowOf === 'function') {
    hostRuns('it reads the executablePath row as the engine\'s program');
    const row = BE.binaryRowOf(m.contributes.settings);
    assert.deepEqual(row, { default: '' });
    assert.deepEqual(BE.engineSourceOf({ row, kernelJson: false, id: m.id, label: m.label }), { ok: true, source: 'user' });
    const both = BE.engineSourceOf({ row, kernelJson: true, id: m.id, label: m.label });
    assert.equal(both.code, 'browser_engine_protocol', 'an engine has one source — this package carries no kernel.json');
    assert.equal(BE.binaryRowPath(m.id), 'plugin.vibespace.cloak-browser.executablePath');
    if (BE.ENGINE_OWNER_ROW_RE) for (const k of ['executablePath', 'egressAllowlist']) assert.match(`plugin.${m.id}.${k}`, BE.ENGINE_OWNER_ROW_RE, `${k}: the owner's cookie only writes it`);
    const unset = BE.userBinaryVerdict({ path: '', fact: null, magic: null, platform: 'linux', id: m.id, label: m.label });
    assert.equal(unset.code, 'browser_engine_kernel_missing');
    assert.ok(unset.error.includes(`${m.label} → ${m.contributes.settings[0].label}`), `the unset words name this row as it reads on screen: ${unset.error}`);
    const ids = PM.capabilitySummary(m).map((i) => i.id);
    assert.ok(ids.includes('user-binary'), `the consent names the program you name: ${JSON.stringify(ids)}`);
    assert.notEqual(PM.capabilitiesHash(m), PM.capabilitiesHash(withoutRow), 'consent covers the row: a version without it drifts');
  } else {
    // a VibeSpace before the user-binary road: the rest of the plugin is accepted (the legs above) — but the row is an ordinary
    // setting there: nothing reads it as the program and consent does not cover it; the registry hands the plugin VibeSpace's own
    // download place (plugins-state/<id>/kernel/<platform>/chrome) instead, and the kernel road refuses a package with no kernel.json
    assert.equal(PM.capabilitiesHash(m), PM.capabilitiesHash(withoutRow), 'this host\'s consent does not cover the row');
    assert.ok(!PM.capabilitySummary(m).some((i) => i.id === 'user-binary'));
    hostRefuses(t, 'the executablePath row', 'this VibeSpace has no user-binary road (no engineSourceOf / binaryRowOf): it does not read the program you set in Program file — its registry hands the plugin its own download place instead, and its kernel road refuses: this package has no kernel.json');
  }
});
