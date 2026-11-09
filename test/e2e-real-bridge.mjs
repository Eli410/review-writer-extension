/**
 * End-to-end "From Reviews" test against the USER'S REAL BROWSER, driven
 * through the running cdp bridge (test/cdp-server.mjs, http://127.0.0.1:9777),
 * which already holds an approved debugging connection. Everything — finding
 * the extension, opening a fresh Amazon product, opening the popup page as a
 * window, activating the product tab inside it, clicking the button — runs via
 * SW/page eval so no extra debugging approvals are needed.
 *
 * Usage: node test/e2e-real-bridge.mjs [ASIN]
 */
import { writeFileSync } from 'node:fs';

const BRIDGE = 'http://127.0.0.1:9777';
const SEARCH_URL = 'https://www.amazon.com/s?k=ceramic+pour+over+coffee+dripper';
const FORCE_ASIN = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const out = await res.json();
  if (out.error) throw new Error(`${path}: ${out.error}`);
  return out;
}
async function get(path) { return (await fetch(`${BRIDGE}${path}`)).json(); }
const evalIn = (targetId, expression, awaitPromise = true) => post('/eval', { targetId, expression, awaitPromise }).then((r) => r.value);

// ---- 1. find the extension SW (wake it first via its id from chrome://extensions)
const wakeTab = await post('/tab', { url: 'chrome://extensions' });
await sleep(2000);
const extInfoRaw = await evalIn(wakeTab.targetId, '(async()=>JSON.stringify((await chrome.developerPrivate.getExtensionsInfo()).map(e=>({id:e.id,name:e.name,state:e.state}))))()');
const extList = JSON.parse(extInfoRaw);
const selfExt = extList.find((e) => e.name === 'Amazon Review Writer');
await post('/close', { targetId: wakeTab.targetId });
if (!selfExt) throw new Error('Amazon Review Writer not installed here: ' + JSON.stringify(extList));
let EXT_ID = selfExt.id;
console.log('extension found:', EXT_ID, selfExt.state);

const wakeWaitTab = await post('/tab', { url: `chrome-extension://${EXT_ID}/popup.html` });
await sleep(1500);
try { await evalIn(wakeWaitTab.targetId, 'chrome.runtime.getPlatformInfo().then(() => true)'); } catch (_) {}
await post('/close', { targetId: wakeWaitTab.targetId });
await sleep(500);

const targets = await get('/targets');
const swCandidates = targets.filter((t) => t.type === 'service_worker' && t.url.includes(EXT_ID));
let swTarget = null;
for (const t of swCandidates) {
  try {
    const name = await evalIn(t.targetId, 'chrome.runtime.getManifest().name', false);
    if (name === 'Amazon Review Writer') { swTarget = t; EXT_ID = t.url.match(/chrome-extension:\/\/([^/]+)\//)[1]; break; }
  } catch (_) {}
}
if (!swTarget) throw new Error('Amazon Review Writer service worker not found among: ' + swCandidates.map((t) => t.url).join(', '));
console.log('extension SW:', EXT_ID);

// ---- 2. pick a fresh ASIN (one not already in storage), or use the forced one
const pickScript = `(async ()=>{
  const all = await chrome.storage.local.get(null);
  const seenAsins = new Set(Object.keys(all).map(k => (k.match(/^review_[A-Z0-9]{10}$/) || [])[1]).filter(Boolean));
  const t = await chrome.tabs.create({ url: ${JSON.stringify(SEARCH_URL)}, active: false });
  try {
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const res = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () =>
        Array.from(document.querySelectorAll('[data-asin]')).map(n => n.getAttribute('data-asin')).filter((a) => a && a.length === 10).slice(0, 8) });
      const list = res && res[0] && res[0].result || [];
      const fresh = list.find((a) => !seenAsins.has(a));
      if (fresh) return fresh;
    }
    return null;
  } finally { chrome.tabs.remove(t.id); }
})()`;
const picked = FORCE_ASIN ? FORCE_ASIN : await evalIn(swTarget.targetId, pickScript);
const ASIN = picked || 'B09B8V1LZ3';
if (!FORCE_ASIN) console.log('fresh ASIN chosen from search:', ASIN);
const PRODUCT_URL = `https://www.amazon.com/dp/${ASIN}`;

// ---- 3. park any surplus data for a clean start (keep this ASIN only fresh)
await evalIn(swTarget.targetId, `(async()=>{const keys=['persona_${ASIN}','aspects_${ASIN}','review_${ASIN}','productInfo_${ASIN}']; await chrome.storage.local.remove(keys); return true;})()`);

// ---- 4. open the product tab and wait for content script + title
const productTabId = await evalIn(swTarget.targetId, `(async()=>{const t = await chrome.tabs.create({ url: ${JSON.stringify(PRODUCT_URL)}, active: false }); return t.id;})()`);
let productReady = false;
let productTitle = '';
for (let i = 0; i < 50; i++) {
  await sleep(1500);
  try {
    const probe = await evalIn(swTarget.targetId, `(async()=>{try { const r = await chrome.tabs.sendMessage(${productTabId}, {action:'getProductInfo'}); return JSON.stringify({title:(r.productInfo&&r.productInfo.title)||'', reviews:(r.productInfo&&r.productInfo.reviewsCount)||''}); } catch (e) { return JSON.stringify({title:''}); }})()`);
    const p = JSON.parse(probe);
    if (p.title) { productReady = true; productTitle = p.title; break; }
  } catch (_) {}
}
console.log('product tab ready:', productReady, '|', productTitle);
if (!productReady) throw new Error('Product page did not become readable (content script missed).');

// ---- 5. popup page as a real extension page window; product tab inside it, active
const winInfo = await evalIn(swTarget.targetId, `(async()=>{
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'), type: 'normal', width: 460, height: 940, left: 30, top: 30, focused: false,
  });
  await chrome.tabs.move(${productTabId}, { windowId: win.id, index: 0 });
  await chrome.tabs.update(${productTabId}, { active: true });
  return { windowId: win.id, popupTabId: win.tabs[0].id };
})()`);
console.log('popup window:', winInfo);
await evalIn(swTarget.targetId, `(async()=>{await chrome.tabs.reload(${winInfo.popupTabId}); return true;})()`);

// ---- 6. find the popup page CDP target for DOM access
let popupTarget = null;
for (let i = 0; i < 30; i++) {
  await sleep(700);
  const t2 = await get('/targets');
  popupTarget = t2.find((x) => x.type === 'page' && x.url === `chrome-extension://${EXT_ID}/popup.html`);
  if (popupTarget) break;
}
if (!popupTarget) throw new Error('popup.html target not found');
const popupEval = (expression, awaitPromise = true) => evalIn(popupTarget.targetId, expression, awaitPromise);

const readState = () => popupEval(`JSON.stringify({
  status: (document.getElementById('status')||{}).textContent || '',
  className: (document.getElementById('status')||{}).className || '',
  busy: Array.from(document.querySelectorAll('button')).some(b => b.disabled),
  title: (document.getElementById('reviewTitle')||{}).value || '',
  review: (document.getElementById('reviewOutput')||{}).value || '',
  fromReviewsBtn: document.getElementById('generateFromReviews') ? 'present' : 'MISSING',
})`).then((raw) => JSON.parse(raw));

// ---- 7. let popup init settle (fresh ASIN → auto combined generation)
let state = await readState();
console.log('button element:', state.fromReviewsBtn);
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  state = await readState();
  if (state.busy === false && ['success', 'error'].includes(state.className)) break;
}
console.log('popup after baseline generation:', state.className, '|', state.status);

// ---- 8. THE BUTTON: From Reviews
console.log('clicking #generateFromReviews …');
await popupEval(`document.getElementById('generateFromReviews').click(); true;`, false);
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  state = await readState();
  if (!state.busy && ['success', 'error'].includes(state.className)) break;
}
console.log('FINAL from-reviews state:', JSON.stringify(state, null, 1));

// ---- 9. storage check + cleanup
const stored = await evalIn(swTarget.targetId, `(async()=>{const all = await chrome.storage.local.get(null); const k='review_${ASIN}'; return JSON.stringify({reviewStored: Boolean(all[k]), head: String(all[k]||'').slice(0, 90)});})()`);
console.log('stored:', stored);

await evalIn(swTarget.targetId, `(async()=>{try { await chrome.windows.remove(${winInfo.windowId}); } catch (_) {} return true;})()`);
console.log('popup window closed (product tab went with it).');

const pass = state.className === 'success' && state.review.length > 40 && JSON.parse(stored).reviewStored;
console.log('=== RESULT:', pass ? 'PASS' : 'FAIL(behavior above shows why)');
if (pass) {
  writeFileSync('test/e2e-real-result.json', JSON.stringify({ asin: ASIN, productTitle, reviewTitle: state.title, review: state.review }, null, 2));
  console.log('Review title was:', state.title);
  console.log('Review body was:\n' + state.review);
}
process.exit(pass ? 0 : 1);
