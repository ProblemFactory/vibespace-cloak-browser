// THE PLUGIN UNDER VIBESPACE'S REAL LOADER — a VibeSpace checkout (VIBESPACE_DIR) loads this package the way an install
// does (data/plugins/<id>/, its node --permission child over IPC), its engine registry reads the program you set in the
// plugin's `executablePath` setting, judges that file itself and asks the two verbs, and its settings schema derives both
// rows. The same harness shape as VibeSpace's scripts/test-browser-builds.mjs ⑦. Skipped without VIBESPACE_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REPO, ID, vibespaceDir, hostRefuses, hostRuns, assertConsent } from './harness.mjs';
const require = createRequire(import.meta.url);
const VS = vibespaceDir();
const opts = VS ? {} : { skip: 'VIBESPACE_DIR is not set to a VibeSpace checkout' };
const manifest = require('../vibespace-plugin.json');
const PROGRAM_KEY = `plugin.${ID}.executablePath`;

const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return fn(); };
/** A real program for this machine (a small one from the system, copied where an installer would put CloakBrowser) | null. */
function realProgram(dest) {
  for (const src of ['/bin/true', '/usr/bin/true']) {
    try { const b = Buffer.alloc(4); const fd = fs.openSync(src, 'r'); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); if (b.toString('hex') !== '7f454c46') continue; fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); fs.chmodSync(dest, 0o755); return dest; } catch { /* the next one */ }
  }
  return null;
}

/** A VibeSpace host in a scratch root: the package installed as a git install lands it (data/plugins/<id>, no .git), THE REAL
 *  loader, engine registry (reading the owner's settings from `values` — plugin.<id>.<key> — live) and kernel distribution. */
function host(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-plugin-vs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(REPO, path.join(root, 'data', 'plugins', ID), { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(path.relative(REPO, src)) });
  const express = require(path.join(VS, 'node_modules', 'express'));
  const warns = [], quiet = { log() { }, warn(...a) { warns.push(a.join(' ')); } };
  const values = Object.create(null);
  const LDR = require(path.join(VS, 'src/server/plugin-loader.js')).create({ rootDir: root, app: express(), hostVersion: manifest.engines.vibespace, log: quiet, agentEnv: () => ({ PATH: process.env.PATH }) });
  t.after(() => LDR.shutdown());
  const ENGR = require(path.join(VS, 'src/server/browser-engines.js')).create({ loader: LDR, dataDir: path.join(root, 'data'), timeoutMs: 4000, log: quiet, setting: (k) => values[k] });
  const EDS = require(path.join(VS, 'src/server/engine-distribution.js')).create({ dataDir: path.join(root, 'data'), engines: ENGR, loader: LDR, log: quiet });
  const BE = require(path.join(VS, 'src/browser-engines.js'));
  const userRoad = typeof ENGR.binaryPathOf === 'function' && typeof BE.engineSourceOf === 'function';
  return { root, warns, values, LDR, ENGR, EDS, BE, userRoad };
}

test('HOST: the real loader + engine registry run the plugin over the program you name — consent, the engine row, the core judges the file, both verbs, the seed per profile', opts, async (t) => {
  const { root, warns, values, LDR, ENGR, EDS, BE, userRoad } = host(t);
  const rec = LDR.list().find((p) => p.id === ID);
  assert.ok(rec && rec.valid, `the loader reads the manifest: ${rec && rec.errors.join('; ')}`);
  assert.deepEqual(rec.warnings, []);
  assertConsent(rec.capabilitySummary.map((i) => i.id));
  assert.equal(ENGR.rows().length, 0, 'installed, not enabled: no engine');
  assert.throws(() => LDR.setEnabled(ID, true), /needs your consent/, 'an engine plugin is never enabled without consent');
  LDR.setEnabled(ID, true, { trusted: true });
  assert.ok(await waitFor(() => ENGR.rows().length === 1), `enabled + trusted ⇒ running (${JSON.stringify(LDR.list().find((p) => p.id === ID))})`);
  assert.deepEqual(ENGR.rows()[0], { id: ID, label: 'CloakBrowser', family: 'manifest', version: manifest.version });

  // the program you installed — OUTSIDE the plugin's two folders, where its sandboxed process cannot look
  const program = realProgram(path.join(root, 'home', 'userW', '.cloakbrowser', 'chromium-146.0.7680.177.5', 'chrome'));
  const script = path.join(root, 'home', 'userW', 'bin', 'chrome-wrapper');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/bin/sh\nexec chrome "$@"\n', { mode: 0o755 });
  const missing = path.join(root, 'home', 'userW', 'nowhere', 'chrome');

  // the raw answers over the real IPC road: the handed path echoed, never looked at
  const raw = await LDR.askRoute(ID, { method: 'GET', path: '/probe', query: { binaryPath: missing, platform: 'linux' } });
  assert.equal(raw.status, 200);
  assert.deepEqual([raw.body.binaryPath, raw.body.features], [missing, ['egress-allowlist']]);

  let launchPath = program || script, baseRefusal = null;
  if (userRoad) {
    hostRuns('its engine registry takes the program from the executablePath row and judges it');
    assert.deepEqual(await ENGR.sourceOf(ID).then((s) => [s.ok, s.source]), [true, 'user'], 'no kernel.json + the program row ⇒ the user source');
    // unset: VibeSpace says where to set it — the plugin's answer claims nothing
    assert.deepEqual(await ENGR.binaryPathOf(ID), { ok: true, source: 'user', path: '' });
    const p0 = await ENGR.probe(ID);
    assert.ok(p0.ok && p0.fact.installed === false && p0.fact.executable === false && p0.fact.userBinary && p0.fact.userBinary.code === 'browser_engine_kernel_missing', JSON.stringify(p0));
    // a missing file: the plugin's «installed» is NOT read — the core's fact wins
    values[PROGRAM_KEY] = missing;
    const p1 = await ENGR.probe(ID);
    assert.ok(p1.ok && p1.fact.binaryPath === missing && p1.fact.installed === false && p1.fact.executable === false && p1.fact.userBinary.why === 'missing', JSON.stringify(p1));
    // a script (a #! wrapper) is refused by name
    values[PROGRAM_KEY] = script;
    const p2 = await ENGR.probe(ID);
    assert.ok(p2.ok && p2.fact.executable === false && p2.fact.userBinary.why === 'script', JSON.stringify(p2));
    if (program) {
      values[PROGRAM_KEY] = program;
      assert.deepEqual(await ENGR.binaryPathOf(ID), { ok: true, source: 'user', path: program });
      const p3 = await ENGR.probe(ID);
      assert.ok(p3.ok && p3.fact.installed && p3.fact.executable && p3.fact.binaryPath === program && p3.fact.source === 'user' && !p3.fact.userBinary, JSON.stringify(p3));
      assert.deepEqual(p3.fact.features, ['egress-allowlist']);
      assert.deepEqual(p3.fact.egress, { setting: `plugin.${ID}.egressAllowlist`, default: '' }, 'it runs inside the keeper\'s allowlisting proxy');
      const ch = BE.engineChoiceVerdict({ choice: { kind: 'plugin', id: ID }, engine: p3.fact });
      assert.ok(ch.ok && ch.executablePath === program, JSON.stringify(ch));
    } else t.diagnostic('no ELF program on this machine to stand in for CloakBrowser — the «a real program» leg was not run');
    // the download road is closed for it: VibeSpace downloads nothing
    await assert.rejects(EDS.installKernel(ID, { by: 'user' }), (e) => e && e.code === 'engine_source_user', 'no kernel download for a program you name');
  } else {
    // a VibeSpace before the user-binary road: it hands the plugin ITS OWN download place, not the program you named, takes the
    // plugin's word on a file it never judged, and its download road refuses this package (no kernel.json) — by its own words
    values[PROGRAM_KEY] = program || script;
    const kp = ENGR.kernelPath(ID);
    const pr = await ENGR.probe(ID);
    assert.ok(pr.ok && pr.fact.binaryPath === kp, `the base hands its download place: ${JSON.stringify(pr)}`);
    assert.ok(!fs.existsSync(kp), 'and there is no program there');
    let refusal = null;
    try { await EDS.installKernel(ID, { by: 'user' }); } catch (e) { refusal = e; }
    assert.ok(refusal && /kernel\.json/.test(refusal.message), `the base's download road refuses this package by name: ${refusal && refusal.message}`);
    launchPath = kp;
    baseRefusal = `it hands the plugin its own download place (plugins-state/${ID}/kernel/${ENGR.tag}/chrome) instead of the program set in Program file, and its download road refuses: ${refusal.message}`; // the host mode judges it at the end
  }

  // the keeper's launch ask: {platform, profileId, binaryPath, userDataDir} — the plugin starts exactly the program handed
  const la = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: launchPath, userDataDir: path.join(root, 'profiles', 'bk-0000e0e1') });
  assert.ok(la.ok, la.error);
  assert.equal(la.launch.executablePath, launchPath);
  assert.equal(la.launch.args[0], '--no-sandbox');
  assert.match(la.launch.args[1], /^--fingerprint=\d+$/);
  assert.deepEqual(la.launch.env, {});
  assert.ok(!la.launch.args.some((a) => BE.OWN_ARG_RE.test(a) || /proxy|headless|ozone/i.test(a)));
  const lb = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: launchPath });
  const lc = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e2', binaryPath: launchPath });
  assert.deepEqual(lb.launch.args, la.launch.args, 'the same profile: the same seed');
  assert.notEqual(lc.launch.args[1], la.launch.args[1], 'another profile: another seed');
  const seeds = JSON.parse(fs.readFileSync(path.join(root, 'data', 'plugins-state', ID, 'seeds.json'), 'utf8'));
  assert.deepEqual(Object.keys(seeds).sort(), ['bk-0000e0e1', 'bk-0000e0e2']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'plugins-state', ID)), ['seeds.json'], 'the plugin\'s state is its seeds — no kernel, no receipt');
  assert.ok(!warns.some((w) => /ERR_ACCESS_DENIED/.test(w)), warns.join('\n'));

  LDR.setEnabled(ID, false);
  assert.ok(await waitFor(() => ENGR.rows().length === 0), 'disabled ⇒ the engine leaves the table at once');
  if (baseRefusal) hostRefuses(t, 'the engine registry', baseRefusal);
});

// THE CLOAKBROWSER YOU INSTALLED (opt-in: CLOAK_PROGRAM=<its chrome file>, never fetched by the suite) — VibeSpace judges the
// real program at your path, measures its `--version` (one short run, no window) and the plugin starts exactly it.
const CLOAK_PROGRAM = process.env.CLOAK_PROGRAM && path.isAbsolute(process.env.CLOAK_PROGRAM) && fs.existsSync(process.env.CLOAK_PROGRAM) ? process.env.CLOAK_PROGRAM : null;
test('HOST: the CloakBrowser you installed (CLOAK_PROGRAM) — VibeSpace judges it a program for this machine, measures its version, and the launch names it', CLOAK_PROGRAM && VS ? {} : { skip: 'CLOAK_PROGRAM and VIBESPACE_DIR are not both set' }, async (t) => {
  const { values, LDR, ENGR, EDS, BE, userRoad } = host(t);
  LDR.setEnabled(ID, true, { trusted: true });
  assert.ok(await waitFor(() => ENGR.rows().length === 1));
  values[PROGRAM_KEY] = CLOAK_PROGRAM;
  if (!userRoad) { hostRefuses(t, 'the program you installed', `this VibeSpace cannot run it: it asks for ${ENGR.kernelPath(ID)} instead`); return; }
  hostRuns('it judges and measures the program you installed');
  const pr = await ENGR.probe(ID);
  assert.ok(pr.ok && pr.fact.installed && pr.fact.executable && pr.fact.binaryPath === CLOAK_PROGRAM && !pr.fact.userBinary, JSON.stringify(pr));
  const m = await EDS.measure(ID, { path: pr.fact.binaryPath, stamp: pr.fact.binaryStamp }); // the keeper's own ask (the stamp: the file as the registry judged it)
  assert.ok(m.ok && /^\d+\.\d+\.\d+/.test(String(m.version)), `measured: ${JSON.stringify(m)}`);
  t.diagnostic(`measured «${m.says}» → ${m.version}`);
  const la = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: CLOAK_PROGRAM });
  assert.ok(la.ok && la.launch.executablePath === CLOAK_PROGRAM, JSON.stringify(la));
  assert.ok(BE.engineChoiceVerdict({ choice: { kind: 'plugin', id: ID }, engine: { ...pr.fact, measuredVersion: m.version } }).ok);
});

test('the settings rows: plugin.vibespace.cloak-browser.executablePath and .egressAllowlist, strings defaulting to empty, under «Plugin: CloakBrowser»', opts, async (t) => {
  let S;
  try { S = await import(pathToFileURL(path.join(VS, 'src/lib/settings-schema.js')).href); }
  catch (e) { t.skip(`this VibeSpace's settings schema does not import under plain node (${e && e.message})`); return; }
  const PM = require(path.join(VS, 'src/plugin-manifest.js'));
  const v = PM.validateManifest(manifest, { folderName: ID, hostVersion: manifest.engines.vibespace });
  S.registerPluginSettings(ID, v.manifest.label, v.manifest.contributes.settings);
  t.after(() => S.unregisterPluginSettings(ID));
  for (const [k, label] of [['executablePath', 'Program file'], ['egressAllowlist', 'Sites it may open (host names, comma-separated)']]) {
    const key = S.pluginSettingPath(ID, k);
    assert.equal(key, `plugin.vibespace.cloak-browser.${k}`);
    const row = S.SETTINGS_SCHEMA[key];
    assert.ok(row, `the schema has ${key}`);
    assert.equal(row.type, 'string');
    assert.equal(row.default, '');
    assert.equal(row.plugin, ID);
    assert.equal(row.label, label);
    assert.equal(S.pluginCategoryOf(ID), row.category);
    assert.match(String(row.category), /CloakBrowser/);
  }
});
