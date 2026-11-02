// THE PLUGIN UNDER VIBESPACE'S REAL LOADER — a VibeSpace checkout (VIBESPACE_DIR) loads this package the way an install
// does (data/plugins/<id>/, its node --permission child over IPC), its engine registry asks the two verbs, and its
// settings schema derives the plugin's row. The same harness shape as VibeSpace's scripts/test-browser-builds.mjs ⑦.
// Skipped without VIBESPACE_DIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REPO, ID, placeKernel, vibespaceDir, hostRefuses, hostRuns, assertConsent } from './harness.mjs';
const require = createRequire(import.meta.url);
const VS = vibespaceDir();
const opts = VS ? {} : { skip: 'VIBESPACE_DIR is not set to a VibeSpace checkout' };
const manifest = require('../vibespace-plugin.json');

const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); return fn(); };

test('HOST: the real loader + engine registry run the plugin — consent, the engine row, both verbs, the seed per profile', opts, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-plugin-vs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // the package as a git install lands it: the repository's tree (no .git) in data/plugins/<id>
  fs.cpSync(REPO, path.join(root, 'data', 'plugins', ID), { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(path.relative(REPO, src)) });
  const express = require(path.join(VS, 'node_modules', 'express'));
  const warns = [];
  const LDR = require(path.join(VS, 'src/server/plugin-loader.js')).create({ rootDir: root, app: express(), hostVersion: manifest.engines.vibespace, log: { log() { }, warn(...a) { warns.push(a.join(' ')); } }, agentEnv: () => ({ PATH: process.env.PATH }) });
  t.after(() => LDR.shutdown());
  const ENGR = require(path.join(VS, 'src/server/browser-engines.js')).create({ loader: LDR, dataDir: path.join(root, 'data'), timeoutMs: 4000 });

  const rec = LDR.list().find((p) => p.id === ID);
  assert.ok(rec && rec.valid, `the loader reads the manifest: ${rec && rec.errors.join('; ')}`);
  assert.deepEqual(rec.warnings, []);
  assertConsent(rec.capabilitySummary.map((i) => i.id));
  assert.equal(ENGR.rows().length, 0, 'installed, not enabled: no engine');

  assert.throws(() => LDR.setEnabled(ID, true), /needs your consent/, 'an engine plugin is never enabled without consent');
  LDR.setEnabled(ID, true, { trusted: true });
  assert.ok(await waitFor(() => ENGR.rows().length === 1), `enabled + trusted ⇒ running (${JSON.stringify(LDR.list().find((p) => p.id === ID))})`);
  assert.deepEqual(ENGR.rows()[0], { id: ID, label: 'CloakBrowser', family: 'manifest', version: '0.1.0' });

  const KP = ENGR.kernelPath(ID);
  assert.equal(KP, path.join(root, 'data', 'plugins-state', ID, 'kernel', 'linux-x64', 'chrome'), 'VibeSpace\'s kernel place = the plugin\'s default (its state folder)');

  // the raw answer over the real IPC road
  const raw0 = await LDR.askRoute(ID, { method: 'GET', path: '/probe', query: { binaryPath: KP, platform: 'linux' } });
  assert.equal(raw0.status, 200);
  assert.deepEqual(raw0.body.features, ['egress-allowlist']);
  assert.equal(raw0.body.installed, false);
  assert.equal(raw0.body.binaryPath, KP);

  // the registry's verdict: after the engine SPI ok; before it, refused by the ONE surfaces rule
  const BE = require(path.join(VS, 'src/browser-engines.js'));
  const pr0 = await ENGR.probe(ID);
  if (pr0.ok) { hostRuns('its engine registry accepts the probe'); assert.ok(pr0.fact.installed === false && pr0.fact.binaryPath === KP && pr0.fact.label === 'CloakBrowser', JSON.stringify(pr0)); }
  else assert.ok(pr0.code === 'browser_engine_protocol' && /surfaces/.test(pr0.error), JSON.stringify(pr0)); // the ONE missing rule — the host mode judges it at the end

  placeKernel(KP);
  const raw1 = await LDR.askRoute(ID, { method: 'GET', path: '/probe', query: { binaryPath: KP } });
  assert.ok(raw1.body.installed && raw1.body.executable && raw1.body.integrity.verified && raw1.body.integrity.pinned, JSON.stringify(raw1.body));
  const pr1 = await ENGR.probe(ID);
  if (pr1.ok) assert.ok(pr1.fact.installed && pr1.fact.executable && pr1.fact.declaredVersion === '146.0.7680.177.5', JSON.stringify(pr1));

  // the keeper's launch ask: {platform, profileId, binaryPath, userDataDir}
  const la = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: KP, userDataDir: path.join(root, 'profiles', 'bk-0000e0e1') });
  assert.ok(la.ok, la.error);
  assert.equal(la.launch.executablePath, KP);
  assert.equal(la.launch.args[0], '--no-sandbox');
  assert.match(la.launch.args[1], /^--fingerprint=\d+$/);
  assert.deepEqual(la.launch.env, {});
  assert.ok(!la.launch.args.some((a) => BE.OWN_ARG_RE.test(a) || /proxy/i.test(a)));
  const lb = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: KP });
  const lc = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e2', binaryPath: KP });
  assert.deepEqual(lb.launch.args, la.launch.args, 'the same profile: the same seed');
  assert.notEqual(lc.launch.args[1], la.launch.args[1], 'another profile: another seed');
  const seeds = JSON.parse(fs.readFileSync(path.join(root, 'data', 'plugins-state', ID, 'seeds.json'), 'utf8'));
  assert.deepEqual(Object.keys(seeds).sort(), ['bk-0000e0e1', 'bk-0000e0e2']);
  const env = BE.engineLaunchEnv(la.launch, { base: [] });
  assert.equal(env.AGENT_BROWSER_ARGS, la.launch.args.join(','), 'the args ride AGENT_BROWSER_ARGS as one comma list (no comma inside an arg)');

  fs.rmSync(path.dirname(KP), { recursive: true });
  const gone = await ENGR.launchOptions(ID, { profileId: 'bk-0000e0e1', binaryPath: KP });
  assert.equal(gone.code, 'browser_engine_kernel_missing', 'the kernel gone ⇒ refused by name');
  assert.ok(!warns.some((w) => /ERR_ACCESS_DENIED/.test(w)), warns.join('\n'));

  LDR.setEnabled(ID, false);
  assert.ok(await waitFor(() => ENGR.rows().length === 0), 'disabled ⇒ the engine leaves the table at once');
  if (!pr0.ok) hostRefuses(t, 'the engine registry\'s probe', `${pr0.error} (engine SPI ①)`);
});

test('the settings row: plugin.vibespace.cloak-browser.egressAllowlist, a string defaulting to empty, under «Plugin: CloakBrowser»', opts, async (t) => {
  let S;
  try { S = await import(pathToFileURL(path.join(VS, 'src/lib/settings-schema.js')).href); }
  catch (e) { t.skip(`this VibeSpace's settings schema does not import under plain node (${e && e.message})`); return; }
  const PM = require(path.join(VS, 'src/plugin-manifest.js'));
  const v = PM.validateManifest(manifest, { folderName: ID, hostVersion: manifest.engines.vibespace });
  S.registerPluginSettings(ID, v.manifest.label, v.manifest.contributes.settings);
  t.after(() => S.unregisterPluginSettings(ID));
  const key = S.pluginSettingPath(ID, 'egressAllowlist');
  assert.equal(key, 'plugin.vibespace.cloak-browser.egressAllowlist');
  const row = S.SETTINGS_SCHEMA[key];
  assert.ok(row, `the schema has ${key}`);
  assert.equal(row.type, 'string');
  assert.equal(row.default, '');
  assert.equal(row.plugin, ID);
  assert.equal(S.pluginCategoryOf(ID), row.category);
  assert.match(String(row.category), /CloakBrowser/);
});
