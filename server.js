'use strict';
/**
 * THE CLOAKBROWSER ENGINE PLUGIN — its server process (VibeSpace plugin IPC v1). VibeSpace forks this file under
 *   node --permission --allow-fs-read=<plugin dir> --allow-fs-read=<state dir> --allow-fs-write=<state dir>
 * with no child-process grant (capabilities.server = {}), so this process reads only its own package and its state folder
 * (VIBESPACE_PLUGIN_DIR / VIBESPACE_PLUGIN_DATA), writes only the latter, and starts nothing. Nothing touches the disk at
 * import: every read happens inside a request, and every failure is answered by code instead of crashing.
 *
 *   hello              {t:'hello', api:1} once, at start
 *   GET  /health       200 {ok, id, version, protocol}
 *   GET  /probe        200 the probe answer (lib/engine.js probeAnswer) about the binaryPath VibeSpace hands in — echoed
 *   POST /resolve-launch, POST /launch-options
 *                      200 {executablePath: <the handed path>, args: ['--no-sandbox', '--fingerprint=<seed>'], env: {}}
 *                      400 {code:'bad_profile'}; 400 {code:'bad_binary_path'} when no program (one absolute path) is handed
 *                      500 {code:'seeds_unreadable', cause: <errno>} when seeds.json cannot be read (never overwritten)
 *   a query / body that is not an object, a binaryPath that is not a string
 *                      400 {code:'bad_query' | 'bad_body' | 'bad_binary_path'}
 *   anything else      404 {code:'not_found'}
 *   a failure          500 {error, code} (the error's own code, e.g. ERR_ACCESS_DENIED from the sandbox)
 *
 * The browser is the CloakBrowser build YOU installed from its maker; its program file is the plugin's `executablePath`
 * setting, which VibeSpace reads, judges and hands in. This process never opens, stats or lists that path (it could not: it
 * lies outside the two folders above) — it reads only its own manifest and seeds.json, and writes only seeds.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let E = null, loadError = null;
try { E = require('./lib/engine.js'); } catch (e) { loadError = e; }

const DIR = process.env.VIBESPACE_PLUGIN_DIR || __dirname;
const DATA = process.env.VIBESPACE_PLUGIN_DATA || '';

let manifestVersion;
function version() {
  if (manifestVersion === undefined) { try { manifestVersion = String(JSON.parse(fs.readFileSync(path.join(DIR, 'vibespace-plugin.json'), 'utf8')).version || '') || null; } catch { manifestVersion = null; } }
  return manifestVersion;
}
const readOrNull = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; } };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const badPath = (why) => [400, { error: why, code: 'bad_binary_path' }];

function probe(input) {
  const prog = E.programOf(input.binaryPath);
  if (prog.code === 'bad_binary_path') return badPath(prog.error);
  return [200, E.probeAnswer(prog)];
}

function launch(input) {
  const profileId = typeof input.profileId === 'string' ? input.profileId : '';
  if (!E.PROFILE_RE.test(profileId)) return [400, { error: 'the launch named no profile (a short id)', code: 'bad_profile' }];
  const prog = E.programOf(input.binaryPath);
  if (!prog.ok) return badPath(prog.error);
  const file = path.join(DATA, E.SEEDS_FILE);
  // every read failure but «absent» (EACCES, EISDIR, …) is the table being unreadable — answered by name, the file untouched
  let text;
  try { text = readOrNull(file); } catch (e) { return [500, { error: `${E.SEEDS_FILE} in the plugin's state folder cannot be read (${(e && e.code) || 'error'}) — it was left as it is`, code: 'seeds_unreadable', cause: String((e && e.code) || 'unknown') }]; }
  const t = E.seedTableOf(text);
  if (!t.ok) return [500, { error: t.error, code: t.code }];
  const s = E.seedFor(t.table, profileId, () => crypto.randomBytes(4).toString('hex'));
  if (!s.ok) return [s.code === 'bad_profile' ? 400 : 500, { error: s.error, code: s.code }];
  if (s.minted) {
    // written BEFORE it is answered: a seed nobody recorded would give the profile another fingerprint next time
    const tmp = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(s.table, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* the write already failed */ } return [500, { error: `the profile's fingerprint seed could not be recorded (${e && e.message})`, code: 'seeds_unwritable' }]; }
  }
  return [200, E.launchAnswer({ binaryPath: prog.path, seed: s.seed })];
}

function health() { return [200, { ok: true, id: E.ID, version: version(), protocol: E.PROTOCOL }]; }

function route(msg) {
  if (loadError) throw loadError;
  const method = String(msg.method || 'GET').toUpperCase(), p = String(msg.path || '');
  const verb = method === 'GET' && p === '/health' ? health : method === 'GET' && p === '/probe' ? probe : method === 'POST' && (p === '/resolve-launch' || p === '/launch-options') ? launch : null;
  if (!verb) return [404, { error: 'route not found', code: 'not_found' }];
  // a query / body of another shape is refused by name, never read as «nothing asked»
  if (msg.query != null && !isObj(msg.query)) return [400, { error: 'the query is not an object of names and values', code: 'bad_query' }];
  if (msg.body != null && !isObj(msg.body)) return [400, { error: 'the body is not a JSON object', code: 'bad_body' }];
  return verb({ ...(msg.query || {}), ...(msg.body || {}) });
}

if (typeof process.send !== 'function') {
  process.stderr.write('server.js is the CloakBrowser engine plugin\'s IPC server — VibeSpace starts it; it has nothing to do on its own\n');
  process.exit(2);
}
process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'shutdown') process.exit(0);
  if (msg.t !== 'route') return;
  let status, body;
  try { [status, body] = route(msg); }
  catch (e) { status = 500; body = { error: String((e && e.message) || e).slice(0, 300), code: String((e && e.code) || 'internal') }; }
  try { process.send({ t: 'route-reply', id: msg.id, status, body }); } catch { /* the channel closed: VibeSpace stopped us */ }
});
process.send({ t: 'hello', api: 1 });
