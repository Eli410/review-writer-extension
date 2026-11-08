/**
 * Live smoke test for the rewritten extension. Mirrors background.js's exact
 * request path (endpoint, headers, body shape, system prompt from prompt.txt)
 * and validates output with the same shared parsing helpers storage-keys.js
 * ships. Run: node test/llm-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

// ---- load shared helpers exactly as the extension ships them
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(ROOT, 'storage-keys.js'), 'utf8'), ctx);
const { parseJsonFromLLM, normalizePersona } = { ...ctx.window, normalizePersona: undefined };

// ---- build prompts exactly as prompts.js does
const pctx = { window: {} };
vm.createContext(pctx);
vm.runInContext(readFileSync(path.join(ROOT, 'prompts.js'), 'utf8'), pctx);

const systemPrompt = readFileSync(path.join(ROOT, 'prompt.txt'), 'utf8').trim();

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const eq = l.indexOf('=');
    return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
  }),
);
const apiKey = env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('No OPENROUTER_API_KEY in .env'); process.exit(1); }

const MODEL = 'anthropic/claude-haiku-5.5';

const productInfo = {
  title: 'Stanley Classic Trigger-Action Travel Mug 20oz, Matte Black',
  description: 'Keeps drinks hot for 5 hours or iced for 30 hours. Leak-resistant trigger-action lid, fits most cupholders, dishwasher safe.',
  category: 'Kitchen & Dining',
  features: 'Trigger-action push-button lid; Double-wall vacuum insulation; BPA-free; Fits car cupholders; Dishwasher safe',
  price: '$32.00',
  rating: '4.7 out of 5 stars',
  reviewsCount: '28,431 ratings',
};

async function chat(task, userPrompt) {
  const messages = [];
  if (task === 'review' || task === 'full') {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'chrome-extension://smoke-test/',
      'X-Title': 'Amazon Review Writer',
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, top_p: 0.95, max_tokens: 2048 }),
  });
  const body = await res.json();
  if (!res.ok) { throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); }
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`No content. Raw: ${JSON.stringify(body).slice(0, 400)}`);
  return { text, usage: body.usage };
}

function check(cond, label, extra = '') {
  if (cond) { console.log(`ok   ${label}`); return true; }
  console.error(`FAIL ${label} ${extra}`); process.exitCode = 1; return false;
}

// ---- 1. combined single call (fresh product path)
console.log('== full (persona + aspects + review in one call) ==');
const full = await chat('full', pctx.window.buildFullPrompt(productInfo));
const fparsed = parseJsonFromLLM(full.text);
console.log(JSON.stringify(fparsed, null, 2));
check(fparsed && typeof fparsed === 'object', 'full: JSON parsed');
check(fparsed?.persona && Number.isFinite(Number(fparsed.persona.age)), 'full: persona.age');
check(Array.isArray(fparsed?.aspects) && fparsed.aspects.length >= 2, 'full: aspects array', JSON.stringify(fparsed?.aspects));
check(typeof fparsed?.review?.title === 'string' && fparsed.review.title.length > 0, 'full: review.title');
const frText = fparsed?.review?.review || '';
const frWords = frText.split(/\s+/).filter(Boolean).length;
check(frWords >= 40 && frWords <= 350, 'full: review length sane', `${frWords} words`);
check(!frText.includes('—') && !/game-changer|lifesaver/i.test(frText), 'full: no em dash / hype words');
check(Number.isFinite(Number(full.usage?.cost)), 'usage cost field present', JSON.stringify(full.usage || {}));

// ---- 2. standalone review call (regen path)
console.log('\n== standalone review (regenerate path) ==');
const persona = {
  age: fparsed?.persona?.age || 41,
  gender: fparsed?.persona?.gender || 'male',
  occupation: fparsed?.persona?.occupation || 'home cook',
  description: fparsed?.persona?.description || 'busy parent, occasional coffee drinker',
};
const aspects = fparsed?.aspects || ['Quality', 'Leak resistance'];
const review = await chat('review', pctx.window.buildReviewPrompt(productInfo, persona, aspects));
const rparsed = parseJsonFromLLM(review.text);
check(typeof rparsed?.title === 'string' && typeof rparsed?.review === 'string', 'review: JSON {title, review}');
console.log(`title: ${rparsed?.title}`);
const rText = rparsed?.review || '';
const rWords = rText.split(/\s+/).filter(Boolean).length;
check(rWords >= 40 && rWords <= 350, 'review: length sane', `${rWords} words`);
check(!/bed Bath|Brandname/.test(rText), 'review: sanity');
console.log('\n--- sample review body ---\n' + rText);

console.log('\nusage full:', JSON.stringify(full.usage || {}));
console.log('usage review:', JSON.stringify(review.usage || {}));
