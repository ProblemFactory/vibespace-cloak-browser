'use strict';
/**
 * THE PURE HALF of the CloakBrowser engine plugin — requires only node:path, touches no file, starts no program. server.js
 * (the IPC loop) reads the files and hands the facts in; this file shapes the answers VibeSpace's engine registry judges
 * (VibeSpace src/browser-engines.js engineAnswerVerdict):
 *
 *   probe   GET /probe {binaryPath, platform} → {id, installed, executable, binaryPath, version: null, declaredVersion,
 *           integrity, protocol: 1, kinds: [], features: ['egress-allowlist']}. `version` is null: VibeSpace measures the
 *           kernel's `--version` itself (this plugin has no childProcess). `egress-allowlist` asks VibeSpace to wrap the
 *           browser in ITS allowlisting proxy and read the site list from this plugin's `egressAllowlist` setting; there is
 *           no `surfaces` word (CloakBrowser is a stock Chromium for dialogs — VibeSpace takes Chrome's road for it).
 *   launch  POST /resolve-launch {profileId, binaryPath} → {executablePath, args: ['--no-sandbox', '--fingerprint=<seed>'],
 *           env: {}}. The seed is the profile's own (seeds.json in the plugin's state folder), minted once, never shared
 *           by two profiles. NEVER a proxy argument: the proxy is VibeSpace's to set.
 */
const path = require('path');

const ID = 'vibespace.cloak-browser';
const PROTOCOL = 1;
const FEATURES = Object.freeze(['egress-allowlist']);
const KINDS = Object.freeze([]);
const TAG = 'linux-x64';
const BINARY = 'chrome';
const RECEIPT_FILE = 'install-receipt.json';
const SEEDS_FILE = 'seeds.json';
/** A profile id VibeSpace hands in (`bk-0000e0e1`, …) — one short token, never a path. */
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEED_MAX = 0x7fffffff;
const SHA_RE = /^[0-9a-f]{64}$/;
/** Arguments that are VibeSpace's alone — this plugin never answers one (the tests pin it). */
const NOT_OURS_RE = /^--(?:proxy-server|proxy-bypass-list|proxy-pac-url|winhttp-proxy-resolver|remote-debugging-(?:port|pipe|address)|user-data-dir)(?:=|$)/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Where VibeSpace places this plugin's kernel: `<state folder>/kernel/linux-x64/chrome` (its registry's kernelPath). */
function defaultBinaryPath(dataDir) { return dataDir ? path.join(dataDir, 'kernel', TAG, BINARY) : ''; }
/** Is `p` an absolute path INSIDE `dir` (the only folder this plugin may read besides its own package)? */
function insideDir(dir, p) {
  if (!dir || typeof p !== 'string' || !p.startsWith('/') || /[\0\n\r]/.test(p)) return false;
  const d = path.resolve(dir), r = path.resolve(p);
  return r.startsWith(d + path.sep);
}

/** The kernel version kernel.json DECLARES for this machine (not measured) | null. */
function declaredVersionOf(doc) {
  if (!isObj(doc)) return null;
  const p = isObj(doc.platforms) ? doc.platforms[TAG] : null;
  const v = (isObj(p) && p.version) || doc.version;
  return typeof v === 'string' && v ? v : null;
}
/** The archive sha256 kernel.json pins for this machine | null. */
function pinOf(doc) {
  const p = isObj(doc) && isObj(doc.platforms) ? doc.platforms[TAG] : null;
  const s = isObj(p) ? String(p.sha256 || '').toLowerCase() : '';
  return SHA_RE.test(s) ? s : null;
}

/** The receipt VibeSpace wrote beside `chrome` read against the program's size now (the same reading as VibeSpace's own
 *  receiptVerdict — `stat.size === bytes`, never a rehash) + `pinned`: the receipt names the archive THIS plugin version
 *  pins. null when there is no readable receipt. */
function integrityOf(receipt, { size = null, pin = null } = {}) {
  if (!isObj(receipt)) return null;
  const sha = SHA_RE.test(String(receipt.sha256 || '')) ? String(receipt.sha256) : null;
  const at = Number(receipt.verifiedAt);
  return {
    verified: !!sha && Number.isInteger(receipt.bytes) && receipt.bytes > 0 && size != null && Number(size) === receipt.bytes,
    sha256: sha,
    verifiedAt: receipt.verifiedAt != null && Number.isFinite(at) ? at : null,
    pinned: !!sha && !!pin && sha === pin,
  };
}

/** THE PROBE ANSWER from the facts server.js read. `binaryPath` = the path VibeSpace handed (it refuses an answer about
 *  any other program). */
function probeAnswer({ binaryPath = '', installed = false, executable = false, receipt = null, size = null, kernel = null } = {}) {
  return {
    id: ID,
    installed: !!installed,
    executable: !!installed && !!executable,
    ...(binaryPath ? { binaryPath } : {}),
    version: null,
    declaredVersion: declaredVersionOf(kernel),
    integrity: installed ? integrityOf(receipt, { size, pin: pinOf(kernel) }) : null,
    protocol: PROTOCOL,
    kinds: KINDS.slice(),
    features: FEATURES.slice(),
  };
}

/** A seed from 8 hex characters: a positive 31-bit integer — the shape `--fingerprint=<seed>` takes, and the SAME rule
 *  VibeSpace used when it minted seeds on the profile record (so a migrated seed and a new one look alike). */
function seedOf(hex8) {
  const n = parseInt(String(hex8 || '').slice(0, 8), 16);
  return Number.isFinite(n) ? (n % SEED_MAX) || 1 : 1;
}
/** A stored seed → the integer | null (malformed). */
function storedSeed(v) {
  const n = typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= SEED_MAX ? n : null;
}
/** seeds.json's text → `{ok, table}` | `{ok:false, code, error}`. Absent (null) = an empty table; anything else that is not
 *  a JSON object of profile → seed is refused by name — never overwritten (every profile's fingerprint lives in it). */
function seedTableOf(text) {
  if (text == null) return { ok: true, table: Object.create(null) };
  let doc;
  try { doc = JSON.parse(String(text)); } catch { return { ok: false, code: 'seeds_unreadable', error: `${SEEDS_FILE} in the plugin's state folder is not JSON — it was left as it is; repair or remove it` }; }
  if (!isObj(doc)) return { ok: false, code: 'seeds_unreadable', error: `${SEEDS_FILE} in the plugin's state folder is not an object of profile → seed — it was left as it is` };
  const table = Object.create(null);
  for (const [k, v] of Object.entries(doc)) table[k] = v;
  return { ok: true, table };
}
/** THE SEED of one profile: its own when the table has one; else a fresh one from `mint()` (hex) that no other profile
 *  holds. → `{ok, seed, minted, table}` (the table to WRITE when minted) | `{ok:false, code, error}`. */
function seedFor(table, profileId, mint) {
  if (!PROFILE_RE.test(String(profileId || ''))) return { ok: false, code: 'bad_profile', error: 'the launch named no profile (a short id)' };
  if (Object.prototype.hasOwnProperty.call(table, profileId)) {
    const s = storedSeed(table[profileId]);
    if (s == null) return { ok: false, code: 'seed_malformed', error: `${SEEDS_FILE} holds a seed of another shape for this profile — it was left as it is (a new one would change the profile's fingerprint)` };
    return { ok: true, seed: s, minted: false, table };
  }
  const taken = new Set(Object.values(table).map(storedSeed).filter((s) => s != null));
  for (let i = 0; i < 64; i++) {
    const s = seedOf(mint());
    if (taken.has(s)) continue;
    const next = Object.create(null);
    Object.assign(next, table);
    next[profileId] = s;
    return { ok: true, seed: s, minted: true, table: next };
  }
  return { ok: false, code: 'seed_exhausted', error: 'no unused fingerprint seed could be minted' };
}
/** The launch arguments of one profile. */
function launchArgs(seed) { return ['--no-sandbox', `--fingerprint=${seed}`]; }
/** THE LAUNCH ANSWER. */
function launchAnswer({ binaryPath, seed }) { return { executablePath: binaryPath, args: launchArgs(seed), env: {} }; }

module.exports = { ID, PROTOCOL, FEATURES, KINDS, TAG, BINARY, RECEIPT_FILE, SEEDS_FILE, PROFILE_RE, SEED_MAX, NOT_OURS_RE,
  defaultBinaryPath, insideDir, declaredVersionOf, pinOf, integrityOf, probeAnswer, seedOf, storedSeed, seedTableOf, seedFor, launchArgs, launchAnswer };
