#!/usr/bin/env node
// RE-MEASURE what CloakBrowser's free build reaches (egress-proof.json). Ported from the measurement VibeSpace ran when
// CloakBrowser was built in (2026-09-28): every process under `strace -f`, every connect() with AF_INET/AF_INET6 counted
// (a DNS connect counts: resolving a vendor host is already the decision to talk to it), each address NAMED by the DNS
// answers in the trace's buffers, each connect attributed to the program that made it (chrome / the browser driver / the
// download). What changed with the plugin: the download is no longer the vendor's npm wrapper but VibeSpace's kernel road
// — an https fetch of kernel.json's URL, every redirect hop https, the length and sha256 checked — so the download phase
// here is the same kind of fetch, traced; the browser is launched the way VibeSpace launches an engine: its driver
// (agent-browser) with AGENT_BROWSER_EXECUTABLE_PATH=<chrome> and AGENT_BROWSER_ARGS = this plugin's launch answer.
//
// The runs (`--runs`, default all four): first (the binary's first start after unpacking) · second (from the same unpacked
// folder) · key (a dummy value in CLOAKBROWSER_LICENSE_KEY — the plugin never sets one; the run shows the build ignores
// it) · idle (`--idle-ms`, default 10 minutes on about:blank).
//
// The 217 MB download happens ONLY with `--download`; `--archive <file>` measures from an archive already fetched (its
// length and sha256 must be kernel.json's). Linux x64 only (the measured platform). Needs strace and the real
// agent-browser (`--agent-browser <path>`, else the first large `agent-browser` on PATH — never VibeSpace's small shim).
//
// Usage: node scripts/measure-egress.mjs --work <empty dir> (--download | --archive <file>) [--agent-browser <path>]
//          [--runs first,second,key,idle] [--hold-ms 30000] [--idle-ms 600000] [--seed 12345] [--headed]
// Output: the record (JSON) on stdout and in <work>/record.json; a refusal is a record with status 'refused'.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), '..');
const E = require(path.join(REPO, 'lib/engine.js'));
const KERNEL = JSON.parse(fs.readFileSync(path.join(REPO, 'kernel.json'), 'utf8'));
const ART = KERNEL.platforms[E.TAG];

const args = process.argv.slice(2);
const flag = (k, d = null) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const has = (k) => args.includes(k);

// ── the traced download child: `--fetch <url> <out>` (an https fetch hop by hop, like VibeSpace's kernel road) ──────────
if (has('--fetch')) {
  const [url, out] = [flag('--fetch'), args[args.indexOf('--fetch') + 2]];
  const hops = [];
  let u = url;
  for (let i = 0; i < 10; i++) {
    if (!/^https:\/\//.test(u)) { console.log(JSON.stringify({ ok: false, why: `a hop that is not https: ${u.slice(0, 120)}`, hops })); process.exit(1); }
    const res = await fetch(u, { redirect: 'manual' });
    hops.push({ host: new URL(u).host, status: res.status });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (loc) { try { await res.body?.cancel(); } catch { /* none */ } u = new URL(loc, u).href; continue; }
    if (res.status !== 200) { console.log(JSON.stringify({ ok: false, why: `HTTP ${res.status}`, hops })); process.exit(1); }
    const h = crypto.createHash('sha256'); let bytes = 0;
    const fd = fs.openSync(out, 'w');
    for await (const c of res.body) { h.update(c); bytes += c.length; fs.writeSync(fd, c); }
    fs.closeSync(fd);
    console.log(JSON.stringify({ ok: true, hops, bytes, sha256: h.digest('hex') }));
    process.exit(0);
  }
  console.log(JSON.stringify({ ok: false, why: 'more than 10 redirects', hops })); process.exit(1);
}

const WORK = flag('--work') ? path.resolve(flag('--work')) : null;
const HOLD_MS = Number(flag('--hold-ms', 30000)) || 30000;
const IDLE_MS = Number(flag('--idle-ms', 600000)) || 600000;
const SEED = Number(flag('--seed', 12345)) || 12345;
const RUNS = String(flag('--runs', 'first,second,key,idle')).split(',').filter(Boolean);
const HEADED = has('--headed');
const today = new Date().toISOString().slice(0, 10);
const TOOL = 'strace -f -qq -e trace=%network,execve,clone,clone3,fork,vfork -s 1024 -xx';
const RUN_WORDS = { first: 'first launch after unpacking', second: 'second launch from the same folder', key: 'launch with a license key present', idle: 'idle browser' };

function done(rec) {
  if (WORK) { try { fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(path.join(WORK, 'record.json'), JSON.stringify(rec, null, 2) + '\n'); } catch { /* stdout still carries it */ } }
  console.log(JSON.stringify(rec, null, 2));
  process.exit(rec.status === 'measured' ? 0 : 1);
}
const refusal = (why, detail) => ({ plugin: E.ID, tool: TOOL, date: today, status: 'refused', refusal: why, detail, runs: [] });
const which = (bin) => { const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

if (!WORK) done(refusal('no_work_dir', 'name an empty folder with --work'));
if (process.platform !== 'linux' || process.arch !== 'x64') done(refusal('platform', `kernel.json measures linux-x64; this is ${process.platform}-${process.arch}`));
if (fs.existsSync(WORK) && fs.readdirSync(WORK).length) done(refusal('work_not_empty', `${WORK} is not empty — a measurement starts from nothing`));
const STRACE = which('strace');
if (!STRACE) done(refusal('strace_absent', 'strace is not installed — the counts cannot be taken'));
const AB = flag('--agent-browser', null) || (() => {
  for (const d of String(process.env.PATH || '').split(':')) {
    const f = path.join(d, 'agent-browser');
    try { if (fs.statSync(f).size > 64 * 1024) return fs.realpathSync(f); } catch { /* next */ } // VibeSpace's shim is a tiny script
  }
  return null;
})();
if (!AB) done(refusal('agent_browser_absent', 'the real agent-browser is not on PATH — VibeSpace launches the engine through it, so the runs do too (--agent-browser <path>)'));
if (!has('--download') && !flag('--archive')) done(refusal('download_not_authorized', `the first phase downloads ${Math.round(ART.bytes / 1e6)} MB from the vendor — pass --download to authorize it, or --archive <file> for one already fetched`));
const PATH_RUN = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':');

// ── the trace reader (VibeSpace's, ported) ─────────────────────────────────────────────────────────────────────────────
const unesc = (s) => s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\([nrtvf"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', v: '\v', f: '\f', '"': '"', '\\': '\\' }[c]));
function readName(b, off, depth = 0) {
  const labels = []; let i = off; let jumped = false; let next = -1;
  for (let guard = 0; guard < 128 && i < b.length; guard++) {
    const n = b.charCodeAt(i);
    if (n === 0) { i++; break; }
    if ((n & 0xc0) === 0xc0) { if (depth > 8 || i + 1 >= b.length) return null; const p = ((n & 0x3f) << 8) | b.charCodeAt(i + 1); if (!jumped) next = i + 2; jumped = true; i = p; depth++; continue; }
    if (n > 63) return null;
    labels.push(b.slice(i + 1, i + 1 + n)); i += 1 + n;
  }
  return { name: labels.join('.'), end: jumped ? next : i };
}
function dnsParse(b) {
  if (b.length < 17) return null;
  const qd = (b.charCodeAt(4) << 8) | b.charCodeAt(5), an = (b.charCodeAt(6) << 8) | b.charCodeAt(7);
  if (qd !== 1 || an > 64) return null;
  const q = readName(b, 12);
  if (!q || !/^[a-zA-Z0-9._-]+$/.test(q.name) || !q.name.includes('.')) return null;
  let i = q.end + 4; const answers = [];
  for (let k = 0; k < an && i < b.length; k++) {
    const r = readName(b, i); if (!r) break; i = r.end;
    const type = (b.charCodeAt(i) << 8) | b.charCodeAt(i + 1); const len = (b.charCodeAt(i + 8) << 8) | b.charCodeAt(i + 9); const rd = b.slice(i + 10, i + 10 + len); i += 10 + len;
    if (type === 1 && len === 4) answers.push([...rd].map((c) => c.charCodeAt(0)).join('.'));
    if (type === 28 && len === 16) { const h = [...rd].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); answers.push(h.match(/.{4}/g).map((x) => x.replace(/^0+(?=.)/, '')).join(':').replace(/(^|:)0(:0)+(:|$)/, '::')); }
  }
  return { qname: q.name.toLowerCase(), answers };
}
function readTrace(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'latin1') : '';
  const exe = new Map(), parent = new Map(), ipName = new Map(), dnsNames = new Set();
  const connects = [];
  let inet = 0;
  for (const line of text.split('\n')) {
    const pm = /^(\d+) /.exec(line); if (!pm) continue;
    const pid = Number(pm[1]);
    const ex = /execve\("((?:[^"\\]|\\.)*)"/.exec(line); if (ex && !/= -1 /.test(line)) exe.set(pid, unesc(ex[1]));
    const cl = /(?:clone3?|vfork|fork)\b.*\)\s*=\s*(\d+)\s*$/.exec(line); if (cl && Number(cl[1]) > 0) parent.set(Number(cl[1]), pid);
    if (/\bconnect\(/.test(line) && /AF_INET6?\b/.test(line)) {
      inet++;
      const port = Number((/sin6?_port=htons\((\d+)\)/.exec(line) || [])[1]);
      const m = /inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6,\s*"([^"]+)"/.exec(line);
      connects.push({ pid, addr: m ? unesc(m[1] || m[2]).toLowerCase() : '?', port });
    }
    if (/(send|recv)(to|from|msg|mmsg)?\(|resumed>/.test(line)) {
      for (const q of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const d = dnsParse(unesc(q[1])); if (d) { dnsNames.add(d.qname); for (const a of d.answers) ipName.set(a, d.qname); } }
    }
  }
  const exeOf = (pid) => { for (let p = pid, g = 0; p && g < 64; p = parent.get(p), g++) if (exe.has(p)) return exe.get(p); return '?'; };
  const who = (pid) => { const e = exeOf(pid); return /\/chrome$/.test(e) ? 'chrome' : /agent-browser/.test(e) ? 'browser driver' : /\/node$/.test(e) ? 'download' : path.basename(e); };
  const probes = connects.filter((c) => c.port === 0);
  const tmap = new Map();
  for (const c of connects.filter((x) => x.port !== 0)) {
    const host = c.port === 53 ? 'dns resolver' : (/^127\./.test(c.addr) || c.addr === '::1') ? 'loopback' : (ipName.get(c.addr) || '?');
    const k = `${host}|${c.addr}|${c.port}|${who(c.pid)}`;
    tmap.set(k, (tmap.get(k) || 0) + 1);
  }
  const targets = [...tmap].map(([k, n]) => { const [host, addr, port, by] = k.split('|'); return { host, addr, port: Number(port), by, n }; }).sort((a, b) => b.n - a.n);
  return { inetConnects: inet, addrProbes: probes.length, targets, dnsNames: [...dnsNames].sort() };
}
function browserStarts(file, exe) {
  if (!fs.existsSync(file)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(file, 'latin1').split('\n')) { if (!/\bexecve\(/.test(line)) continue; const u = unesc(line); if (u.includes(`execve("${exe}"`) && !/"--type=/.test(u)) n++; }
  return n;
}
const tagged = (c, phase) => ({ ...c, targets: c.targets.map((t) => ({ ...t, phase })) });

// ── the phases ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function traced(file, env, argv) {
  const child = spawn('env', ['-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), STRACE, '-f', '-qq', '-e', 'trace=%network,execve,clone,clone3,fork,vfork', '-s', '1024', '-xx', '-o', file, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { if (err.length < 64000) err += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return { child, exited, out: () => out, err: () => err };
}
/** Our own leftovers only: a process whose command line or environment names this run's folder. */
function processesUnder(dir) {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    let s = ''; try { s = fs.readFileSync(`/proc/${d}/cmdline`, 'latin1') + '\0' + fs.readFileSync(`/proc/${d}/environ`, 'latin1'); } catch { continue; }
    if (s.includes(dir)) out.push(Number(d));
  }
  return out;
}
async function reapUnder(dir) {
  let pids = processesUnder(dir).filter((p) => { try { return !/strace/.test(fs.readFileSync(`/proc/${p}/comm`, 'utf8')); } catch { return false; } });
  for (const p of pids) { try { process.kill(p, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 20 && pids.length; i++) { await sleep(250); pids = pids.filter((p) => fs.existsSync(`/proc/${p}`)); }
  for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  return pids.length;
}
async function sha256File(f) { const h = crypto.createHash('sha256'); for await (const c of fs.createReadStream(f)) h.update(c); return h.digest('hex'); }
function treeBytes(d) { let n = 0; const st = [d]; while (st.length) { const x = st.pop(); for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) st.push(p); else if (e.isFile()) n += fs.statSync(p).size; } } return n; }

async function launch(runDir, holdMs, extraEnv = {}) {
  const file = path.join(runDir, 'launch.strace');
  const home = path.join(runDir, 'home'), profile = path.join(runDir, 'profile');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(profile, { recursive: true });
  const ns = 'cm' + path.basename(runDir).replace(/[^a-z0-9]/gi, '').slice(-8);
  const sock = fs.mkdtempSync('/tmp/cme-'); // the driver refuses a socket path over 103 bytes
  const answer = E.launchAnswer({ binaryPath: EXE, seed: SEED });
  const abEnv = { AGENT_BROWSER_SOCKET_DIR: sock, AGENT_BROWSER_SESSION: ns, AGENT_BROWSER_NAMESPACE: ns, AGENT_BROWSER_PROFILE: profile, AGENT_BROWSER_IDLE_TIMEOUT_MS: '0', AGENT_BROWSER_JSON: '1', AGENT_BROWSER_HEADED: HEADED ? '1' : '0', AGENT_BROWSER_EXECUTABLE_PATH: answer.executablePath, AGENT_BROWSER_ARGS: answer.args.join(',') };
  const env = { HOME: home, PATH: PATH_RUN, TERM: 'dumb', ...abEnv };
  const t = traced(file, { ...env, ...extraEnv }, [AB, 'open', 'about:blank']);
  const t0 = Date.now();
  while (!/"success"\s*:\s*(true|false)/.test(t.out()) && t.child.exitCode === null && Date.now() - t0 < 120000) await sleep(250);
  const opened = /"success"\s*:\s*true/.test(t.out());
  const openMs = Date.now() - t0;
  const ctl = (argv) => spawnSync('env', ['-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), AB, ...argv], { encoding: 'utf8', timeout: 30000 });
  let ua = null;
  if (opened) { const r = ctl(['eval', 'navigator.userAgent']); ua = (r.stdout || '').trim().slice(0, 300) || null; await sleep(holdMs); }
  ctl(['close', '--all']);
  let reaped = 0;
  if (!(await Promise.race([t.exited, sleep(20000).then(() => null)]))) { reaped = await reapUnder(runDir); await Promise.race([t.exited, sleep(10000)]); }
  try { fs.rmSync(sock, { recursive: true, force: true }); } catch { /* gone */ }
  const c = tagged(readTrace(file), 'launch');
  return { phase: 'launch: agent-browser open about:blank (AGENT_BROWSER_EXECUTABLE_PATH=<chrome>, AGENT_BROWSER_ARGS=the plugin\'s launch answer)', opened, openMs, headed: HEADED, userAgent: ua, chromeStarts: browserStarts(file, EXE), reaped, stderr: opened ? undefined : t.err().slice(-1500), ...c };
}

// ── the measurement ────────────────────────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(WORK, { recursive: true });
const archive = flag('--archive') ? path.resolve(flag('--archive')) : path.join(WORK, 'cloakbrowser-linux-x64.tar.gz');
let download;
if (has('--download')) {
  const file = path.join(WORK, 'download.strace');
  const t = traced(file, { HOME: WORK, PATH: PATH_RUN, TERM: 'dumb' }, [process.execPath, SELF, '--fetch', ART.url, archive]);
  await t.exited;
  let r = null; try { r = JSON.parse(t.out().trim().split('\n').pop()); } catch { r = null; }
  if (!r || !r.ok) done({ ...refusal('download_failed', (r && r.why) || t.err().slice(-400)), download: r });
  download = { url: ART.url, hops: r.hops, bytes: r.bytes, sha256: r.sha256, ...tagged(readTrace(file), 'download') };
} else download = { url: ART.url, given: archive, note: 'the archive was given (--archive) — the download phase was not traced this time' };
const bytes = fs.statSync(archive).size, sha = await sha256File(archive);
if (bytes !== ART.bytes || sha !== ART.sha256) done({ ...refusal('not_the_pinned_archive', `the archive is ${bytes} bytes, sha256 ${sha}; kernel.json pins ${ART.bytes} bytes, ${ART.sha256} — nothing was started`), download });
const KDIR = path.join(WORK, 'kernel', E.TAG);
fs.mkdirSync(KDIR, { recursive: true });
const strip = Number(KERNEL.layout.stripComponents) || 0;
const un = spawnSync('tar', ['-xzf', archive, '-C', KDIR, ...(strip ? [`--strip-components=${strip}`] : [])], { encoding: 'utf8' });
const EXE = path.join(KDIR, 'chrome');
if (un.status !== 0 || !fs.existsSync(EXE)) done({ ...refusal('unpack_failed', (un.stderr || '').slice(-400)), download });
const version = (spawnSync(EXE, ['--version'], { encoding: 'utf8', timeout: 20000 }).stdout || '').trim();
const runs = [];
for (const name of RUNS) {
  if (!RUN_WORDS[name]) done(refusal('unknown_run', `--runs names "${name}" (first, second, key, idle)`));
  const d = path.join(WORK, `run-${name}`); fs.mkdirSync(d, { recursive: true });
  const l = await launch(d, name === 'idle' ? IDLE_MS : HOLD_MS, name === 'key' ? { CLOAKBROWSER_LICENSE_KEY: 'cb_measurement_dummy_not_a_license' } : {});
  runs.push({ what: RUN_WORDS[name], inetConnects: l.inetConnects, addrProbes: l.addrProbes, browserStarts: l.chromeStarts, heldMs: name === 'idle' ? IDLE_MS : HOLD_MS, targets: l.targets, phases: [l] });
}
const reached = runs.flatMap((r) => r.targets).filter((t) => t.by === 'chrome' && t.host !== 'loopback');
const record = {
  plugin: E.ID, tool: TOOL, date: today, chromium: ART.version, platform: E.TAG, status: runs.every((r) => r.phases[0].opened) ? 'measured' : 'refused',
  ...(runs.every((r) => r.phases[0].opened) ? {} : { refusal: 'launch_failed', detail: 'a run did not open about:blank — see its phase' }),
  measuredWith: 'scripts/measure-egress.mjs',
  launchedVia: `agent-browser ${((spawnSync(AB, ['--version'], { encoding: 'utf8' }).stdout || '').trim().split(' ').pop()) || '?'} (${HEADED ? 'headed' : 'headless'}), AGENT_BROWSER_EXECUTABLE_PATH=<chrome>, AGENT_BROWSER_ARGS=${E.launchArgs('<seed>').join(',')}`,
  download, binary: { path: 'chrome', sha256: await sha256File(EXE), bytes: fs.statSync(EXE).size, dirBytes: treeBytes(KDIR), version },
  runs: runs.map((r) => ({ ...r, phases: r.phases.map((p) => ({ ...p, targets: undefined, dnsNames: p.dnsNames })) })),
  verdict: { browserReached: reached.map((t) => `${t.host} (${t.addr}:${t.port})`), onlyLoopback: reached.length === 0 },
};
done(record);
