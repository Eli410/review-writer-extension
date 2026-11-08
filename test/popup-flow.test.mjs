/**
 * Headless integration test for popup.js: runs the real popup + prompts +
 * storage-keys scripts in a VM with mocked chrome.* APIs and a stub DOM, and
 * drives the init / regenerate / settings flows. Run: node test/popup-flow.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function makeElement(tag) {
  const listeners = {};
  const children = [];
  const element = {
    _tag: tag,
    value: '',
    textContent: '',
    innerHTML: '',
    placeholder: '',
    disabled: false,
    className: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    appendChild(child) { children.push(child); },
    async click(type = 'click') {
      for (const fn of listeners[type] || []) await fn();
    },
    _listeners: listeners,
    _children: children,
  };
  return element;
}

/** Build a fresh popup environment. Returns helpers + mutable chrome mock. */
function buildPopupEnv({ tabUrl, llmHandler }) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement('div#' + id));
    return elements.get(id);
  };
  const localStore = new Map();
  const syncStore = new Map();
  const fakeTab = { id: 1, url: tabUrl };
  const calls = { llm: [], testKey: 0 };
  const env = { byId, elements, localStore, syncStore, calls, dclHandlers: [], fakeTab };

  const document = {
    getElementById: byId,
    createElement: (tag) => makeElement(tag),
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') env.dclHandlers.push(fn); },
  };

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const want = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : keys === null ? [...localStore.keys()] : Object.keys(keys);
          const out = {};
          for (const k of want) if (localStore.has(k)) out[k] = localStore.get(k);
          return out;
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) localStore.set(k, v); },
        async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) localStore.delete(k); },
      },
      sync: {
        async get(keys) {
          const want = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : [...syncStore.keys()];
          const out = {};
          for (const k of want) if (syncStore.has(k)) out[k] = syncStore.get(k);
          return out;
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) syncStore.set(k, v); },
      },
    },
    tabs: {
      query: async () => [fakeTab],
      create: async ({ url }) => ({ id: 99, url }),
      async sendMessage(tabId, msg) {
        if (msg.action === 'ping') return { status: 'ok' };
        if (msg.action === 'getProductInfo') return { productInfo: PRODUCT_INFO };
        if (msg.action === 'getProductTitle') return { title: PRODUCT_INFO.title };
        if (msg.action === 'getAsin') return { asin: 'B07QT8RTV2' };
        if (msg.action === 'fillReviewTextarea') return { success: true };
        return null;
      },
    },
    runtime: {
      async sendMessage(msg) {
        if (msg.action === 'llmComplete') {
          calls.llm.push(msg.task);
          return { text: llmHandler(msg.task) };
        }
        if (msg.action === 'testKey') {
          calls.testKey++;
          return { ok: true, summary: 'test-key-ok' };
        }
        return null;
      },
      getManifest: () => ({ name: 'Amazon Review Writer' }),
    },
    scripting: { executeScript: async () => {} },
  };

  const ctx = { document, chrome, setTimeout, window: {}, console, navigator: { clipboard: { writeText: async () => {} } } };
  env.ctx = ctx;
  vm.createContext(ctx);
  for (const file of ['config.js', 'storage-keys.js', 'prompts.js', 'popup.js']) {
    vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }

  return env;
}

async function run(env) {
  assert.ok(env.dclHandlers.length === 1, 'popup registered DOMContentLoaded once');
  await env.dclHandlers[0]();
}

const PRODUCT_INFO = {
  title: 'Stanley Classic Trigger-Action Travel Mug 20oz, Matte Black',
  description: 'Keeps drinks hot for 5 hours.',
  category: 'Kitchen & Dining',
  features: ['Trigger-action lid', 'Vacuum insulation'],
  price: '$32.00',
  rating: '4.7 out of 5 stars',
  reviewsCount: '28,431 ratings',
};

const CANNED = {
  full: () => 'met internal facts\n{"persona":{"age":34,"gender":"female","occupation":"office administrator","description":"commutes daily"},"aspects":["Heat retention","Lid design","Cupholder fit"],"review":{"title":"Works well for daily coffee","review":"Got this a few days ago. Coffee stays hot on my drive. The lid clicked shut and did not leak in my bag. Fits the cupholder fine."}}\n/me',
  review: () => '```json\n{"title":"Keeps coffee hot","review":"Used it for three days on my commute. Still hot at the office, lid does not leak, and it fits the cupholder with room to spare."}\n```',
  persona: () => '{"age":29,"gender":"male","occupation":"barista","description":"commuter, coffee drinker"}',
  aspects: () => '["Heat retention","Lid design"]',
};

let failures = 0;
const test = (label, fn) => {
  try { fn(); console.log(`ok   ${label}`); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
};
const testAsync = async (label, fn) => {
  try { await fn(); console.log(`ok   ${label}`); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
};

// ---- scenario 1: fresh product on a /dp/ URL — one combined call, everything saved & shown
{
  const env = buildPopupEnv({ tabUrl: 'https://www.amazon.com/dp/B07QT8RTV2', llmHandler: (t) => CANNED[t]() });
  await run(env);
  assert.ok(env.calls.llm.length === 1 && env.calls.llm[0] === 'full', `expected one full call, got ${JSON.stringify(env.calls.llm)}`);
  const review = env.localStore.get('review_B07QT8RTV2');
  assert.ok(/Title: Works well for daily coffee/.test(review), 'review stored');
  assert.ok(env.localStore.get('persona_B07QT8RTV2')?.age === 34, 'persona stored');
  assert.ok(env.localStore.get('aspects_B07QT8RTV2')?.length === 3, 'aspects stored');
  assert.ok(env.byId('reviewOutput').value.length > 20, 'review body displayed');
  assert.ok(env.byId('reviewTitle').value === 'Works well for daily coffee', 'title displayed');
  assert.ok(env.byId('currentModelLabel').textContent.includes('Haiku 5.5'), 'model label shows default');
}

// ---- scenario 2: reopen with everything stored — zero LLM calls.
// llmHandler guards against init-time calls while still serving the
// regenerate button when clicked.
{
  const env = buildPopupEnv({ tabUrl: 'https://www.amazon.com/dp/B07QT8RTV2', llmHandler: () => CANNED.review() });
  env.localStore.set('review_B07QT8RTV2', 'Title: From before\n\nReview: Body from before, kept for the reshape test.');
  env.localStore.set('persona_B07QT8RTV2', { age: 50, gender: 'male', occupation: 'teacher', description: 'loud rooms veteran' });
  env.localStore.set('aspects_B07QT8RTV2', ['Durability']);
  await run(env);
  assert.equal(env.calls.llm.length, 0, 'no LLM calls on warm open');
  assert.ok(env.byId('reviewOutput').value.includes('Body from before'), 'stored review shown');
  assert.equal(env.byId('status').className, 'success', 'status success');
  await testAsync('warm open: regenerate review round-trips', async () => {
    await env.byId('regenerateReview').click();
    assert.equal(env.calls.llm.length, 1, 'one review call after button');
    assert.equal(env.calls.llm[0], 'review', 'task is review');
    assert.ok(env.byId('status').className === 'success', 'status success after regen');
  });
}

// ---- scenario 3: non-Amazon tab → friendly message
{
  const env = buildPopupEnv({ tabUrl: 'https://example.com/other', llmHandler: CANNED.full });
  await run(env);
  assert.ok(/navigate to an Amazon/.test(env.byId('productTitle').textContent), 'not-amazon message');
  assert.equal(env.calls.llm.length, 0, 'no calls off Amazon');
}

// ---- scenario 4: partial state — persona stored but no review → review-only call
{
  const env = buildPopupEnv({ tabUrl: 'https://www.amazon.com/dp/B07QT8RTV2', llmHandler: (t) => CANNED[t]() });
  env.localStore.set('persona_B07QT8RTV2', { age: 33, gender: 'female', occupation: 'nurse', description: 'night shifts' });
  await run(env);
  assert.deepEqual(env.calls.llm, ['review'], 'only the review call runs');
  assert.ok(env.localStore.has('review_B07QT8RTV2'), 'review saved');
  assert.ok(env.byId('personaGender').value === 'female', 'stored persona loaded into fields');
}

// ---- scenario 5: settings — save + test key
{
  const env = buildPopupEnv({ tabUrl: 'https://www.amazon.com/dp/B07QT8RTV2', llmHandler: CANNED.full });
  env.byId('settingsApiKey').value = 'sk-or-v1-test';
  await run(env);
  await env.byId('settingsKeyTest').click();
  assert.equal(env.calls.testKey, 1, 'testKey invoked');
  assert.ok(/Key OK/.test(env.byId('settingsStatus').textContent), 'key OK status');
  assert.equal(env.localStore.get('openrouterApiKey'), 'sk-or-v1-test', 'key saved after successful test');
  // model switch persists
  env.byId('settingsModel').value = 'openai/gpt-6-luna';
  await env.byId('settingsModel').click('change'); // dispatches the change event
  const syncCfg = env.syncStore.get('settings');
  assert.equal(syncCfg?.model, 'openai/gpt-6-luna', 'model persisted');
}

process.exitCode = failures ? 1 : 0;
console.log(failures ? `\n${failures} failure(s)` : '\nall popup flow scenarios passed');
