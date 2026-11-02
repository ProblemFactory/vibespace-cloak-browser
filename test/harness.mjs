// THE IPC HARNESS — starts server.js the way VibeSpace's plugin loader does (src/server/plugin-loader.js startChild):
// fork with `node --permission --allow-fs-read=<plugin dir> --allow-fs-read=<state dir> --allow-fs-write=<state dir>`
// (capabilities.server = {} adds nothing: no extra path, no --allow-child-process), the four VIBESPACE_PLUGIN_* names,
// `serialization: 'advanced'`, stdio ignore/pipe/pipe/ipc; waits for {t:'hello'}; asks routes with {t:'route', id, …}.
import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ID = 'vibespace.cloak-browser';
/** The files of the plugin as it installs (the repository's own package). */
export const PACKAGE_FILES = ['vibespace-plugin.json', 'server.js', 'lib/engine.js'];

export function permissionArgs(pluginDir, dataDir) {
  return ['--permission', `--allow-fs-read=${pluginDir}`, `--allow-fs-read=${dataDir}`, `--allow-fs-write=${dataDir}`];
}

/**
 * A scratch root: `<root>/plugins/<id>/` (a copy of the package, so a test may plant a change) + `<root>/state/<id>/` +
 * `<root>/elsewhere/chrome` — a stand-in for the program you installed yourself: a real executable file OUTSIDE both
 * folders (where the vendor's installer puts it), the path VibeSpace hands in.
 */
export function scratch(t, { plant = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-plugin-test-'));
  const pluginDir = path.join(root, 'plugins', ID), dataDir = path.join(root, 'state', ID);
  for (const f of PACKAGE_FILES) { fs.mkdirSync(path.dirname(path.join(pluginDir, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(pluginDir, f)); }
  fs.mkdirSync(dataDir, { recursive: true });
  const program = path.join(root, 'elsewhere', 'chrome');
  fs.mkdirSync(path.dirname(program), { recursive: true });
  fs.writeFileSync(program, '#!/bin/sh\necho "Chromium 146.0.7680.177"\n', { mode: 0o755 });
  if (plant) plant(pluginDir);
  if (t && typeof t.after === 'function') t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, pluginDir, dataDir, program };
}

/** strace on PATH (the tracing legs skip without it, saying so). */
export const STRACE = (() => { try { return spawnSync('strace', ['-V'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();

/**
 * Start the plugin's server. `sandbox: false` = the same process WITHOUT the permission flags (a control). `trace: <file>` =
 * the same process under `strace -f` (every syscall that names a path, written to <file>; the tracer kills its tracee if it
 * is itself stopped).
 */
export async function start({ pluginDir, dataDir, sandbox = true, trace = null, helloMs = 5000 } = {}) {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', VIBESPACE_PLUGIN_ID: ID, VIBESPACE_PLUGIN_DIR: pluginDir, VIBESPACE_PLUGIN_DATA: dataDir, VIBESPACE_PLUGIN_API_VERSION: '1' };
  const flags = sandbox ? permissionArgs(pluginDir, dataDir) : [];
  const server = path.join(pluginDir, 'server.js');
  const opts = { cwd: pluginDir, env, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] };
  const child = trace
    ? spawn('strace', ['-f', '-qq', '--kill-on-exit', '-s', '4096', '-e', 'trace=%file', '-o', trace, process.execPath, ...flags, server], opts)
    : fork(server, [], { ...opts, execArgv: flags });
  let stderr = '', nextId = 1, hello = null;
  const pending = new Map();
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', () => { /* nothing is printed */ });
  child.on('error', () => { /* an IPC send racing the exit — the exit below says it */ });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => { for (const p of pending.values()) p.reject(new Error('plugin process exited')); pending.clear(); resolve({ code, signal }); }));
  const helloSeen = new Promise((resolve) => {
    child.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') { hello = m; resolve(m); return; }
      if (m.t === 'route-reply' && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
    });
  });
  const first = await Promise.race([helloSeen, exited.then((x) => ({ exited: x })), new Promise((r) => setTimeout(() => r({ timeout: true }), helloMs))]);
  const api = {
    child, hello, first, exited,
    stderr: () => stderr,
    /** One route ask → {status, body}. */
    ask(method, routePath, { query = {}, body = null, ms = 5000 } = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`no answer to ${method} ${routePath} in ${ms} ms`)); }, ms);
        pending.set(id, { resolve, reject, timer });
        try { child.send({ t: 'route', id, method, path: routePath, query, headers: { 'content-type': 'application/json' }, body }); }
        catch (e) { pending.delete(id); clearTimeout(timer); reject(e); }
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      try { child.send({ t: 'shutdown' }); } catch { /* gone */ }
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
      const r = await exited; clearTimeout(t); return r;
    },
  };
  return api;
}

/** The VibeSpace checkout the VibeSpace-side legs import its PURE contract (and its real loader) from — VIBESPACE_DIR. */
export function vibespaceDir() {
  const d = process.env.VIBESPACE_DIR;
  return d && fs.existsSync(path.join(d, 'src', 'browser-engines.js')) ? path.resolve(d) : null;
}

/**
 * THE HOST MODE (VIBESPACE_DIR legs). A VibeSpace that cannot run this plugin — one that predates the user-binary road
 * (the reserved `executablePath` setting: VibeSpace judges and runs the program you name; without it, its registry hands the
 * plugin its own download place and its kernel road refuses a package with no kernel.json) — is a FAILING leg, by name: a
 * suite that cannot tell «the host runs it» from
 * «the host refuses it» proves nothing. CLOAK_EXPECT_HOST_REFUSES=1 declares such a host EXPECTED: then each refusal passes
 * by name (after the leg proved everything else of the plugin is accepted), and a host that RUNS the plugin under that flag
 * fails instead (the expectation is stale).
 */
export const EXPECT_HOST_REFUSES = process.env.CLOAK_EXPECT_HOST_REFUSES === '1';
export function hostRefuses(t, what, why) {
  if (!EXPECT_HOST_REFUSES) assert.fail(`THE HOST REFUSES THE PLUGIN — ${what}: ${why}. This VibeSpace predates the user-binary road the plugin needs (the reserved executablePath setting): run the suite against one that has it, or set CLOAK_EXPECT_HOST_REFUSES=1 to accept this host by name`);
  t.diagnostic(`expected host refusal (CLOAK_EXPECT_HOST_REFUSES=1) — ${what}: ${why}`);
}
export function hostRuns(what) {
  if (EXPECT_HOST_REFUSES) assert.fail(`CLOAK_EXPECT_HOST_REFUSES=1, but this VibeSpace RUNS the plugin (${what}) — the expectation is stale: unset it`);
}

/** The consent a VibeSpace shows for this plugin: a server process + the browser engine, and — from the releases with the
 *  engine features — the allowlisting-proxy line and the «runs the program you name» line. Never a filesystem,
 *  child-process, network or client-code item. */
export const CONSENT_ITEMS = Object.freeze(['server-process', 'browser-engine', 'egress-allowlist', 'user-binary']);
export function assertConsent(ids) {
  assert.ok(ids.includes('server-process') && ids.includes('browser-engine'), JSON.stringify(ids));
  assert.deepEqual(ids.filter((i) => !CONSENT_ITEMS.includes(i)), [], `no other power: ${JSON.stringify(ids)}`);
}
