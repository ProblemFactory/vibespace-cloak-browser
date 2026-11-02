// THE IPC HARNESS — starts server.js the way VibeSpace's plugin loader does (src/server/plugin-loader.js startChild):
// fork with `node --permission --allow-fs-read=<plugin dir> --allow-fs-read=<state dir> --allow-fs-write=<state dir>`
// (capabilities.server = {} adds nothing: no extra path, no --allow-child-process), the four VIBESPACE_PLUGIN_* names,
// `serialization: 'advanced'`, stdio ignore/pipe/pipe/ipc; waits for {t:'hello'}; asks routes with {t:'route', id, …}.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ID = 'vibespace.cloak-browser';
/** The files of the plugin as it installs (the repository's own package). */
export const PACKAGE_FILES = ['vibespace-plugin.json', 'server.js', 'lib/engine.js', 'kernel.json'];

export function permissionArgs(pluginDir, dataDir) {
  return ['--permission', `--allow-fs-read=${pluginDir}`, `--allow-fs-read=${dataDir}`, `--allow-fs-write=${dataDir}`];
}

/** A scratch root: `<root>/plugins/<id>/` (a copy of the package, so a test may plant a change) + `<root>/state/<id>/`. */
export function scratch(t, { plant = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-plugin-test-'));
  const pluginDir = path.join(root, 'plugins', ID), dataDir = path.join(root, 'state', ID);
  for (const f of PACKAGE_FILES) { fs.mkdirSync(path.dirname(path.join(pluginDir, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(pluginDir, f)); }
  fs.mkdirSync(dataDir, { recursive: true });
  if (plant) plant(pluginDir);
  if (t && typeof t.after === 'function') t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, pluginDir, dataDir, kernelPath: path.join(dataDir, 'kernel', 'linux-x64', 'chrome') };
}

/** Start the plugin's server. `sandbox: false` = the same fork WITHOUT the permission flags (a control). */
export async function start({ pluginDir, dataDir, sandbox = true, helloMs = 5000 } = {}) {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', VIBESPACE_PLUGIN_ID: ID, VIBESPACE_PLUGIN_DIR: pluginDir, VIBESPACE_PLUGIN_DATA: dataDir, VIBESPACE_PLUGIN_API_VERSION: '1' };
  const child = fork(path.join(pluginDir, 'server.js'), [], { cwd: pluginDir, env, execArgv: sandbox ? permissionArgs(pluginDir, dataDir) : [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
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

/** A stand-in kernel: a tiny program at the kernel's place + the receipt VibeSpace writes beside it at install. */
export function placeKernel(kernelPath, { receipt = true, mode = 0o755, sha256 = null } = {}) {
  fs.mkdirSync(path.dirname(kernelPath), { recursive: true });
  fs.writeFileSync(kernelPath, '#!/bin/sh\necho "Chromium 146.0.7680.177"\n', { mode });
  fs.chmodSync(kernelPath, mode);
  const size = fs.statSync(kernelPath).size;
  if (receipt) {
    const pin = JSON.parse(fs.readFileSync(path.join(REPO, 'kernel.json'), 'utf8')).platforms['linux-x64'].sha256;
    fs.writeFileSync(path.join(path.dirname(kernelPath), 'install-receipt.json'), JSON.stringify({ sha256: sha256 || pin, bytes: size, verifiedAt: 1793600000000, version: '146.0.7680.177' }));
  }
  return size;
}

/** The VibeSpace checkout the VibeSpace-side legs import its PURE contract (and its real loader) from — VIBESPACE_DIR. */
export function vibespaceDir() {
  const d = process.env.VIBESPACE_DIR;
  return d && fs.existsSync(path.join(d, 'src', 'browser-engines.js')) ? path.resolve(d) : null;
}
