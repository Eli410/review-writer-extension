/**
 * End-to-end "From Reviews" test against a real browser + real Amazon page.
 *
 * Requires a Brave/Chrome instance running with this directory loaded as an
 * extension. Default target: the throwaway instance (--user-data-dir=/tmp/brave-rw-test
 * --remote-debugging-port=9223 --load-extension=...); override with
 * RW_BROWSER_PROFILE_DIR / RW_BROWSER_DEBUG_PORT.
 *
 * The popup (popup.html) is opened as a real extension page window; the Amazon
 * product tab is moved into it and activated, so the popup's tabs.query picks
 * the product page up exactly like when opened from the toolbar. Then the
 * #generateFromReviews button is clicked for the real flow: scrape existing
 * reviews → prompt → LLM → display.
 */
import { listTargets, attach, connect } from './cdp.mjs';

const ASIN_ARG = process.argv[2] || '';     // force one via argv; otherwise discover
const ASIN_DEFAULT = 'B08N5WRWNW';
const PRODUCT_URL_DEFAULT = `https://www.amazon.com/dp/${ASIN_DEFAULT}`;
const SEARCH_URL = 'https://www.amazon.com/s?k=water+filter+undercounter';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = await connect();

// Discover the unpacked extension id via chrome://extensions (browser-level
// navigation always works, even with the service worker asleep).
const { targetId: extListTabId } = await conn.send('Target.createTarget', { url: 'chrome://extensions' });
await sleep(1200);
const extListSession = await attach(extListTabId);
const extInfoRaw = await conn.send('Runtime.evaluate', {
  expression: '(async()=>JSON.stringify((await chrome.developerPrivate.getExtensionsInfo()).map(e=>({id:e.id,name:e.name,state:e.state}))))()',
  awaitPromise: true,
  returnByValue: true,
}, extListSession);
if (extInfoRaw.exceptionDetails) throw new Error(`getExtensionsInfo failed: ${extInfoRaw.exceptionDetails?.text || 'unknown'}`);
const exts = JSON.parse(extInfoRaw.result.value);
const self = exts.find((e) => e.name === 'Amazon Review Writer');
if (!self) throw new Error(`Amazon Review Writer not installed in this instance: ${JSON.stringify(exts)}`);
const EXT_ID = self.id;
console.log('extension id:', EXT_ID, '(' + self.state + ')');
await conn.send('Target.closeTarget', { targetId: extListTabId });

// Wake the MV3 service worker by loading a tiny extension page.
const { targetId: wakeTabId } = await conn.send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/popup.html` });
await sleep(1200);
const wakeSession = await attach(wakeTabId);
await conn.send('Runtime.evaluate', {
  expression: 'chrome.runtime.getPlatformInfo().then(() => true)',
  awaitPromise: true,
  returnByValue: true,
}, wakeSession);
await conn.send('Target.closeTarget', { targetId: wakeTabId });
await sleep(500);

const sw = (await listTargets()).find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
if (!sw) throw new Error('Extension service worker did not wake up.');
console.log('extension SW awake:', sw.targetId);

const sessionId = await attach(sw.targetId);
const evalInSw = async (expression, awaitPromise = true) => {
  const { result, exceptionDetails } = await conn.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (exceptionDetails) {
    throw new Error(`SW eval failed: ${exceptionDetails?.exception?.description || exceptionDetails?.text || 'unknown'}`);
  }
  return result.value;
};

// ---- 1. find a live product: search, take the first listing with an ASIN
let ASIN = ASIN_ARG;
let PRODUCT_URL = ASIN ? `https://www.amazon.com/dp/${ASIN}` : PRODUCT_URL_DEFAULT;
if (!ASIN) {
  const { targetId: searchTabId } = await conn.send('Target.createTarget', { url: SEARCH_URL });
  await sleep(4000);
  const searchSession = await attach(searchTabId);
  const searchEval = async (expression) => {
    const { result, exceptionDetails } = await conn.send('Runtime.evaluate', { expression, returnByValue: true }, searchSession);
    if (exceptionDetails) throw new Error(`search page eval failed: ${exceptionDetails?.exception?.description?.slice(0, 200) || 'unknown'}`);
    return result.value;
  };
  for (let i = 0; i < 30; i++) {
    const asins = await searchEval(`JSON.stringify(Array.from(document.querySelectorAll('[data-asin]')).map(n => n.getAttribute('data-asin')).filter(a => a && a.length === 10).slice(0, 5))`);
    const list = JSON.parse(asins);
    if (list.length) { ASIN = list[0]; console.log('search found live ASINs:', list, '→ using', ASIN); break; }
    await sleep(1500);
  }
  await conn.send('Target.closeTarget', { targetId: searchTabId });
  PRODUCT_URL = `https://www.amazon.com/dp/${ASIN}`;
  if (!ASIN) throw new Error('No product found in search results.');
}

// ---- 1b. product tab + wait for it to render
const productTab = await evalInSw(`(async()=>{const t = await chrome.tabs.create({ url: '${PRODUCT_URL}', active: true }); return t.id;})()`);
console.log('product tab id:', productTab);

const findPageTarget = async (urlFragment, { waitMs = 20000 } = {}) => {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await conn.send('Target.getTargets', {});
    const match = targetInfos.find((t) => t.type === 'page' && t.url.includes(urlFragment));
    if (match) return match;
    await sleep(500);
  }
  return null;
};
const productTarget = await findPageTarget(ASIN);
if (!productTarget) throw new Error('Could not find the product page among CDP targets.');
const pageSession = await attach(productTarget.targetId);
const evalInPage = async (expression) => {
  const { result, exceptionDetails } = await conn.send('Runtime.evaluate', { expression, returnByValue: true }, pageSession);
  if (exceptionDetails) throw new Error(`product page eval failed: ${exceptionDetails?.exception?.description?.slice(0, 200) || 'unknown'}`);
  return result.value;
};

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try {
    const state = await evalInPage(`JSON.stringify({ready: document.readyState, title: !!document.getElementById('productTitle'), titleText: (document.getElementById('productTitle')?.textContent||'').trim().slice(0,60), captcha: document.title.includes('CAPTCHA') || !!document.querySelector('form[action*="validateCaptcha"]'), reviews: document.querySelectorAll('div[data-hook="review"]').length})`);
    const s = JSON.parse(state);
    if (s.captcha) throw new Error('Amazon served a CAPTCHA to this profile. Open the URL once manually and retry later.');
    if (s.ready === 'complete' && s.title) {
      ready = true;
      console.log('product page ready:', s);
      break;
    }
  } catch (e) {
    if (String(e.message).includes('CAPTCHA')) throw e;
  }
}
if (!ready) throw new Error('Product page never finished loading.');

// ---- 2. popup as a real extension page window; move product tab in, activate it
const popupInfo = await evalInSw(`(async()=>{
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'normal', width: 460, height: 940, left: 40, top: 40, focused: false,
  });
  await chrome.tabs.move(${productTab}, { windowId: win.id, index: 0 });
  await chrome.tabs.update(${productTab}, { active: true });
  return { windowId: win.id, popupTabId: win.tabs[0].id };
})()`);
console.log('popup window:', popupInfo);
const popupTabId = popupInfo.popupTabId;

// Popup already ran init() against its own (wrong) tab — reload it so init
// re-resolves the active tab, which is now the Amazon product page.
await evalInSw(`(async()=>{await chrome.tabs.reload(${popupTabId}); return true;})()`);

const popupTarget = await findPageTarget('/popup.html', { waitMs: 10000 });
if (!popupTarget) throw new Error('popup page target not found');
const popupSession = await attach(popupTarget.targetId);
const evalInPopup = async (expression, awaitPromise = true) => {
  const { result, exceptionDetails } = await conn.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, popupSession);
  if (exceptionDetails) throw new Error(`popup eval failed: ${exceptionDetails?.exception?.description?.slice(0, 300) || 'unknown'}`);
  return result.value;
};

// ---- 3. wait for popup init to settle
let popupState = '';
for (let i = 0; i < 40; i++) {
  await sleep(1500);
  const state = await evalInPopup(`JSON.stringify({status: document.getElementById('status')?.textContent||'', className: document.getElementById('status')?.className||'', busy: Array.from(document.querySelectorAll('button')).some(b=>b.disabled), review: document.getElementById('reviewOutput')?.value?.slice(0, 80)||''})`);
  popupState = JSON.parse(state);
  if (popupState.review && !popupState.busy) break;
  if (['success', 'error'].includes(popupState.className) && !popupState.busy) break;
}
console.log('popup after init:', popupState);

// ---- 4. sanity: the scraper sees existing reviews (direct content-script hop)
const reviewsProbe = await evalInSw(`(async()=>{const r = await chrome.tabs.sendMessage(${productTab}, {action:'getExistingReviews'}); return JSON.stringify({count: (r.reviews||[]).length, error: r.error||null, first: (r.reviews||[])[0]||null});})()`);
console.log('scraper probe:', reviewsProbe);

// ---- 5. click the real button
console.log('clicking #generateFromReviews …');
await evalInPopup(`document.getElementById('generateFromReviews').click(); true;`, false);

let finalState = null;
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  const state = await evalInPopup(`JSON.stringify({status: document.getElementById('status')?.textContent||'', className: document.getElementById('status')?.className||'', busy: Array.from(document.querySelectorAll('button')).some(b=>b.disabled), title: document.getElementById('reviewTitle')?.value||'', review: document.getElementById('reviewOutput')?.value||''})`);
  const s = JSON.parse(state);
  finalState = s;
  if (!s.busy && ['success', 'error'].includes(s.className)) break;
}
console.log('FINAL popup state:', JSON.stringify(finalState));

// ---- 6. check storage shows the review saved under the ASIN key
const stored = await evalInSw(`(async()=>{const all = await chrome.storage.local.get(null); const review = all['review_' + '${ASIN}'] || null; const persona = all['persona_' + '${ASIN}'] || null; return JSON.stringify({reviewType: typeof review, reviewHead: review ? review.slice(0, 120) : null, persona: persona ? (persona.age + '/' + persona.gender + '/' + persona.occupation) : null});})()`);
console.log('stored after button:', stored);

if (finalState && finalState.className === 'success' && finalState.review) {
  // screenshot the popup for visual proof
  const shot = await conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, popupSession);
  const { writeFileSync } = await import('node:fs');
  writeFileSync('test/e2e-popup-result.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved: test/e2e-popup-result.png');
  console.log('REVIEW TITLE:', finalState.title);
  console.log('REVIEW BODY:', finalState.review);
} else {
  console.log('NOTE: flow did not reach success state — see FINAL popup state above.');
}

// cleanup: close the popup window (product tab too), keep nothing open
await evalInSw(`(async()=>{try { await chrome.windows.remove(${popupInfo.windowId}); } catch (_) {} return true;})()`);
console.log('popup window closed');
process.exit(0);
