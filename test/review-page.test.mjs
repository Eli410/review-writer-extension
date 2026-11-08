/**
 * Headless test for review-page.js: mocks the review form DOM and storage,
 * verifies the 5-star click, field filling via TypingSimulator, and the
 * fillReviewTextarea message contract (async, correct shape, no re-typing).
 * Run: node test/review-page.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const ASIN = 'ASIATEST00';
const STORED_REVIEW = 'Title: Keeps coffee hot\n\nReview: Body one. Body two after the blank line.';

class FakeEvent {
  constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
}

function makeInput(id) {
  return {
    id,
    value: '',
    focus() { document.activeElement = this; },
    setSelectionRange() {},
    dispatchEvent(ev) { (this.events ||= []).push(ev); return true; },
    clicked: 0,
    events: [],
  };
}

const star = { clicked: 0, click() { this.clicked++; } };
const titleInput = makeInput('reviewTitle');
const bodyInput = makeInput('reviewText');

const document = {
  activeElement: null,
  hidden: false,
  addEventListener() {},
  querySelector(selector) {
    if (selector === 'span[aria-label="select to rate item five star."]' || selector.includes('starRating-single:nth-child(5)')) {
      return star;
    }
    if (selector === '#reviewTitle') return titleInput;
    if (selector === '#reviewText') return bodyInput;
    return null;
  },
};

const localStore = new Map([[`review_${ASIN}`, STORED_REVIEW]]);
const env = { messageListeners: [] };
const chrome = {
  storage: {
    local: {
      async get(keys) {
        const want = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of want) if (localStore.has(k)) out[k] = localStore.get(k);
        return out;
      },
    },
  },
  runtime: { onMessage: { addListener(fn) { env.messageListeners.push(fn); } } },
};

const ctx = {
  document,
  chrome,
  setTimeout,
  console,
  window: { location: { href: `https://www.amazon.com/review/review-your-purchases/?asin=${ASIN}` } },
  MouseEvent: FakeEvent,
  KeyboardEvent: FakeEvent,
  Event: FakeEvent,
  URLSearchParams,
};
env.ctx = ctx;
vm.createContext(ctx);
for (const file of ['storage-keys.js', 'typing-simulator.js', 'review-page.js']) {
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

// Review-page auto-fills on load; let the IIFE finish (typing takes real time).
// Poll until the COMPLETE body text exists, not a partial match.
for (let i = 0; i < 600 && !(bodyInput.value || '').includes('Body two after the blank line.'); i++) {
  await new Promise((r) => setTimeout(r, 100));
}

assert.equal(star.clicked, 1, '5-star rating clicked once');
assert.equal(titleInput.value, 'Keeps coffee hot', 'title typed');
assert.ok(bodyInput.value.includes('Body two after the blank line.'), 'body typed');

// Message contract: async response, skips re-typing over existing content.
assert.equal(env.messageListeners.length, 1, 'message listener registered');
let responded = null;
const ready = env.messageListeners[0]({ action: 'fillReviewTextarea', reviewText: 'Title: Fresh\n\nReview: Fresh body.' }, {}, (resp) => { responded = resp; });
assert.equal(ready, true, 'listener returns true for async work');
await new Promise((r) => setTimeout(r, 50));
assert.equal(responded?.success, true, 'message response is async + successful');
assert.ok(bodyInput.value.includes('Body two'), 'did not re-type over filled body (skips)');
assert.equal(titleInput.value, 'Keeps coffee hot', 'did not re-type over filled title (skips)');

console.log('all review-page scenarios passed');
