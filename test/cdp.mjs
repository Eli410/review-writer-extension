/**
 * Minimal Chrome DevTools Protocol client for testing this extension against a
 * real (Brave/Chrome) browser that exposes the consent-gated "incoming remote
 * debugging" endpoint (Chromium >= 144). Those builds disable the HTTP discovery
 * endpoints (/json/version → 404); the browser WS path lives in the profile's
 * DevToolsActivePort file instead.
 *
 * Usage from other test scripts:
 *   const { connect, evalInTab, listTabs, newTab, activateTab, reloadExtension } = await import('./cdp.mjs');
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEBUG_PORT = 9222;
// Throwaway test instances can override the profile dir / port via env.
const PROFILE_ROOT = process.env.RW_BROWSER_PROFILE_DIR
  || join(homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser');

export async function browserWsUrl() {
  // Consent-gated instances obscure every HTTP discovery endpoint but write
  // DevToolsActivePort into the profile. Flag-launched instances serve
  // /json/version normally and don't write the file; fall back to it when absent.
  const raw = await readFile(join(PROFILE_ROOT, 'DevToolsActivePort'), 'utf8')
    .catch(() => null);
  if (raw) {
    const [port, wsPath, ...extra] = raw.trim().split(/\r?\n/);
    if (extra.length) throw new Error(`Unexpected DevToolsActivePort contents: ${raw}`);
    return `ws://127.0.0.1:${port || DEBUG_PORT}${wsPath}`;
  }
  const port = process.env.RW_BROWSER_DEBUG_PORT || DEBUG_PORT;
  const version = JSON.parse(String(await (await fetch(`http://127.0.0.1:${port}/json/version`)).text()));
  return version.webSocketDebuggerUrl;
}

/**
 * One shared WS connection per process. Brave shows an "incoming debugging"
 * approval dialog on first connect; it must be accepted in the browser window.
 */
let ws = null;
let seq = 0;
const pending = new Map();

export async function connect() {
  if (ws && ws.readyState === 1) return { ws, send };
  const url = await browserWsUrl();
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}. Is remote debugging allowed in the browser?`)), 15000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`Connection to ${url} failed (error event). The browser may need to approve the incoming connection.`)); };
    ws.onclose = () => { clearTimeout(timer); reject(new Error(`Connection to ${url} closed during handshake.`)); };
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else resolve(msg.result);
    }
  };
  ws.onclose = () => { ws = null; pending.clear(); };

  function send(method, params = {}, sessionId) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }
      }, 90_000);
    });
  }
  return { ws, send };
}

export async function listTargets() {
  const { send } = await connect();
  const { targetInfos } = await send('Target.getTargets');
  return targetInfos;
}

export function printTargets(targets) {
  for (const t of targets) {
    console.log(`[${t.type}] ${t.url}`);
    if (t.type === 'page' || t.type === 'service_worker' || t.type === 'extension') {
      console.log(`   title: ${t.title} | id: ${t.targetId}`);
    }
  }
}

/** Attach to a target (returns CDP session id). */
export async function attach(targetId) {
  const { send } = await connect();
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

/** Evaluate an expression in a target's main world. Pass result to get the JS value. */
export async function evalInTarget(targetId, expression, awaitPromise = false) {
  const { send } = await connect();
  const sessionId = await attach(targetId);
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (exceptionDetails) {
    const detail = exceptionDetails?.exception?.description || exceptionDetails?.text || 'unknown error';
    throw new Error(`Evaluation failed in target ${targetId}: ${detail}`);
  }
  return result.value;
}
