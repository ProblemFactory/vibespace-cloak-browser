'use strict';
/**
 * THE PURE HALF of the CloakBrowser engine plugin — requires only node:path, touches no file, starts no program. server.js
 * (the IPC loop) hands the request in; this file shapes the answers VibeSpace's engine registry judges (VibeSpace
 * src/browser-engines.js engineAnswerVerdict):
 *
 *   probe   GET /probe {binaryPath, platform} → {id, installed, executable, binaryPath, version: null, declaredVersion: null,
 *           protocol: 1, kinds: [], features: ['egress-allowlist']}. `binaryPath` is the path VibeSpace HANDS in — the program
 *           file you set in the plugin's `executablePath` setting — echoed as it came. This plugin never reads that file:
 *           its process may read only its own package and its state folder, so VibeSpace judges the file itself (it exists,
 *           it is a program for this machine, it may run) and measures its `--version`. `installed` / `executable` are
 *           ALWAYS false: the plugin never vouches for a program it cannot see. VibeSpace puts its own facts in their place;
 *           a VibeSpace that cannot judge the file refuses the launch by name instead of starting a program nobody checked.
 *           `egress-allowlist` asks VibeSpace to wrap the browser in ITS allowlisting proxy and read the site list from this
 *           plugin's `egressAllowlist` setting; there is no `surfaces` word (CloakBrowser is a stock Chromium for dialogs).
 *   launch  POST /resolve-launch {profileId, binaryPath} → {executablePath: <the handed path>, args: ['--no-sandbox',
 *           '--fingerprint=<seed>'], env: {}}. The seed is the profile's own (seeds.json in the plugin's state folder),
 *           minted once, never shared by two profiles. NEVER a proxy argument, never a display flag: both are VibeSpace's.
 */
const path = require('path');

const ID = 'vibespace.cloak-browser';
const PROTOCOL = 1;
const FEATURES = Object.freeze(['egress-allowlist']);
const KINDS = Object.freeze([]);
const SEEDS_FILE = 'seeds.json';
/** The longest program path VibeSpace hands in (its launch verdict's own cap). */
const PATH_MAX = 4096;
/** A profile id VibeSpace hands in (`bk-0000e0e1`, …) — one short token, never a path. */
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEED_MAX = 0x7fffffff;
/** Arguments that are VibeSpace's alone — this plugin never answers one (the tests pin it). */
const NOT_OURS_RE = /^--(?:proxy-server|proxy-bypass-list|proxy-pac-url|winhttp-proxy-resolver|remote-debugging-(?:port|pipe|address)|user-data-dir|headless|ozone-platform)(?:=|$)/;

/**
 * THE PROGRAM VibeSpace names, read by its SHAPE only (the file is never touched): → `{ok:true, path}` | `{ok:false, code,
 * error, path?}`. Nothing handed (absent / '') ⇒ `none`; not a string ⇒ `bad_binary_path`; a string that is not one
 * absolute path (relative, NUL, a line break, > 4096) ⇒ `bad_shape` with the string kept (a probe echoes it as it came).
 */
function programOf(v) {
  if (v === undefined || v === null || v === '') return { ok: false, code: 'none', error: 'no program file was handed in — VibeSpace hands the one set in ⚙ → Plugins → CloakBrowser → Program file (the plugin\'s executablePath setting)' };
  if (typeof v !== 'string') return { ok: false, code: 'bad_binary_path', error: 'binaryPath is not a string (one absolute path)' };
  if (!path.isAbsolute(v) || v.length > PATH_MAX || /[\0\n\r]/.test(v)) return { ok: false, code: 'bad_shape', path: v, error: 'binaryPath is not one absolute path to a program file' };
  return { ok: true, path: v };
}

/** THE PROBE ANSWER about the program VibeSpace handed (`programOf`'s verdict): the path echoed, nothing claimed about it. */
function probeAnswer(program = programOf(undefined)) {
  const echo = program && typeof program.path === 'string' ? program.path : '';
  return {
    id: ID,
    installed: false,
    executable: false,
    ...(echo ? { binaryPath: echo } : {}),
    version: null,
    declaredVersion: null,
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
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, code: 'seeds_unreadable', error: `${SEEDS_FILE} in the plugin's state folder is not an object of profile → seed — it was left as it is` };
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
/** THE LAUNCH ANSWER: the program VibeSpace handed, never another. */
function launchAnswer({ binaryPath, seed }) { return { executablePath: binaryPath, args: launchArgs(seed), env: {} }; }

module.exports = { ID, PROTOCOL, FEATURES, KINDS, SEEDS_FILE, PATH_MAX, PROFILE_RE, SEED_MAX, NOT_OURS_RE,
  programOf, probeAnswer, seedOf, storedSeed, seedTableOf, seedFor, launchArgs, launchAnswer };
