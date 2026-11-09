/**
 * Persistent CDP bridge for testing: connects once to the browser's remote
 * debugging endpoint and keeps the session open, then serves a tiny local HTTP
 * API so test scripts don't need a new (re-approved) WS connection each time.
 *
 * Endpoints (on 127.0.0.1:9777):
 *   GET  /targets                     → JSON list of targets
 *   POST /eval   {targetId, expression, awaitPromise?} → evaluate in a target
 *   POST /tab    {url}                → open a new tab, returns its targetId
 *   POST /close  {targetId}           → close a tab
 *   POST /activate {targetId}         → bring a tab to front
 */
import http from 'node:http';
import * as cdp from './cdp.mjs';

const PORT = Number(process.env.RW_BRIDGE_PORT || 9777);

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/targets') {
      const targets = await cdp.listTargets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(targets, null, 1));
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const { send } = await cdp.connect();
      const respond = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload, null, 1));
      };
      if (req.url === '/eval') {
        const expression = String(body.expression || '');
        const value = await cdp.evalInTarget(body.targetId, expression, Boolean(body.awaitPromise));
        return respond(200, { value });
      }
      if (req.url === '/tab') {
        const result = await send('Target.createTarget', { url: body.url || 'about:blank' });
        return respond(200, { targetId: result.targetId });
      }
      if (req.url === '/close') {
        await send('Target.closeTarget', { targetId: body.targetId });
        return respond(200, { closed: true });
      }
      if (req.url === '/activate') {
        await send('Target.activateTarget', { targetId: body.targetId });
        return respond(200, { activated: true });
      }
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error?.message || String(error) }));
  }
});

server.listen(PORT, '127.0.0.1');
console.log(`cdp bridge listening on 127.0.0.1:${PORT} — connecting to the browser (retry until approved)…`);
(async () => {
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      await cdp.connect();
      console.log(`connected to browser remote debugging (attempt ${attempt})`);
      return; // process stays alive; HTTP handlers reuse the connection
    } catch (error) {
      if (attempt === 1) console.error('connect attempt failed:', error.message);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error('giving up after 60 attempts');
  process.exit(1);
})();
