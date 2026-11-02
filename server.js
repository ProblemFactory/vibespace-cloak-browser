'use strict';
/**
 * THE CLOAKBROWSER ENGINE PLUGIN — its server process (VibeSpace plugin IPC v1). VibeSpace forks this file under
 *   node --permission --allow-fs-read=<plugin dir> --allow-fs-read=<state dir> --allow-fs-write=<state dir>
 * with no child-process grant (capabilities.server = {}), so this process reads only its own package and its state folder
 * (VIBESPACE_PLUGIN_DIR / VIBESPACE_PLUGIN_DATA), writes only the latter, and starts nothing. Nothing touches the disk at
 * import: every read happens inside a request, and every failure is answered by code instead of crashing.
 *
 *   hello              {t:'hello', api:1} once, at start
 *   GET  /health       200 {ok, id, version, kernel}
 *   GET  /probe        200 the probe answer (lib/engine.js probeAnswer) about the binaryPath VibeSpace hands in
 *   POST /resolve-launch, POST /launch-options
 *                      200 {executablePath, args: ['--no-sandbox', '--fingerprint=<seed>'], env: {}}
 *                      409 {code:'no_binary'} when the kernel is not in its place; 400 {code:'bad_profile'}
 *   anything else      404 {code:'not_found'}
 *   a failure          500 {error, code} (the error's own code, e.g. ERR_ACCESS_DENIED from the sandbox)
 *
 * The kernel itself is downloaded by VibeSpace from kernel.json (the vendor's archive, pinned by its sha256) into
 * <state>/kernel/linux-x64/ with an install-receipt.json beside `chrome`; this process only reads what is there.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let E = null, loadError = null;
try { E = require('./lib/engine.js'); } catch (e) { loadError = e; }

const DIR = process.env.VIBESPACE_PLUGIN_DIR || __dirname;
const DATA = process.env.VIBESPACE_PLUGIN_DATA || '';

let kernelDoc;
function kernel() {
  if (kernelDoc === undefined) { try { kernelDoc = JSON.parse(fs.readFileSync(path.join(DIR, 'kernel.json'), 'utf8')); } catch { kernelDoc = null; } }
  return kernelDoc;
}
let manifestVersion;
function version() {
  if (manifestVersion === undefined) { try { manifestVersion = String(JSON.parse(fs.readFileSync(path.join(DIR, 'vibespace-plugin.json'), 'utf8')).version || '') || null; } catch { manifestVersion = null; } }
  return manifestVersion;
}
const readOrNull = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; } };

/** The program VibeSpace asks about: the path it hands in, else the kernel's own place in the state folder. */
const binaryOf = (input) => (typeof input.binaryPath === 'string' && input.binaryPath ? input.binaryPath : E.defaultBinaryPath(DATA));

/** What is at `p` — judged only inside the state folder (anything else is not this plugin's kernel, and never touched). */
function kernelFacts(p) {
  const out = { installed: false, executable: false, size: null, receipt: null };
  if (!E.insideDir(DATA, p)) return out;
  let st;
  try { st = fs.statSync(p); } catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return out; throw e; }
  if (!st.isFile()) return out;
  out.installed = true; out.size = st.size;
  try { fs.accessSync(p, fs.constants.X_OK); out.executable = true; } catch { out.executable = false; }
  try { const t = readOrNull(path.join(path.dirname(p), E.RECEIPT_FILE)); out.receipt = t == null ? null : JSON.parse(t); } catch { out.receipt = null; }
  return out;
}

function probe(input) {
  const p = binaryOf(input);
  const f = kernelFacts(p);
  return [200, E.probeAnswer({ binaryPath: p, installed: f.installed, executable: f.executable, receipt: f.receipt, size: f.size, kernel: kernel() })];
}

function launch(input) {
  const profileId = typeof input.profileId === 'string' ? input.profileId : '';
  if (!E.PROFILE_RE.test(profileId)) return [400, { error: 'the launch named no profile (a short id)', code: 'bad_profile' }];
  const p = binaryOf(input);
  const f = kernelFacts(p);
  if (!f.installed) return [409, { error: `no CloakBrowser kernel at ${p} — VibeSpace downloads it from this plugin's kernel.json`, code: 'no_binary' }];
  const file = path.join(DATA, E.SEEDS_FILE);
  const t = E.seedTableOf(readOrNull(file));
  if (!t.ok) return [500, { error: t.error, code: t.code }];
  const s = E.seedFor(t.table, profileId, () => crypto.randomBytes(4).toString('hex'));
  if (!s.ok) return [s.code === 'bad_profile' ? 400 : 500, { error: s.error, code: s.code }];
  if (s.minted) {
    // written BEFORE it is answered: a seed nobody recorded would give the profile another fingerprint next time
    const tmp = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(s.table, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* the write already failed */ } return [500, { error: `the profile's fingerprint seed could not be recorded (${e && e.message})`, code: 'seeds_unwritable' }]; }
  }
  return [200, E.launchAnswer({ binaryPath: p, seed: s.seed })];
}

function health() { return [200, { ok: true, id: E.ID, version: version(), protocol: E.PROTOCOL, kernel: E.declaredVersionOf(kernel()) }]; }

function route(msg) {
  if (loadError) throw loadError;
  const input = { ...(msg.query && typeof msg.query === 'object' ? msg.query : {}), ...(msg.body && typeof msg.body === 'object' && !Array.isArray(msg.body) ? msg.body : {}) };
  const method = String(msg.method || 'GET').toUpperCase(), p = String(msg.path || '');
  if (method === 'GET' && p === '/health') return health();
  if (method === 'GET' && p === '/probe') return probe(input);
  if (method === 'POST' && (p === '/resolve-launch' || p === '/launch-options')) return launch(input);
  return [404, { error: 'route not found', code: 'not_found' }];
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
