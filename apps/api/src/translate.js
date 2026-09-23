// translate.js — Text translation for the CMS.
//
// Default provider: MyMemory — free, no account, no API key. Roughly 1,000
// words/day anonymous; set MYMEMORY_EMAIL to a real address to raise that to
// ~10,000 words/day. Good enough for news summaries and impact stories where
// a human reviews the output.
//
// Optional provider: Google Cloud Translation. Better Swahili quality. Set
// TRANSLATE_PROVIDER=google and GOOGLE_TRANSLATE_KEY=... to switch. The rest
// of the app doesn't care which is used — the interface is identical.
//
// Env vars:
//   TRANSLATE_PROVIDER    'mymemory' (default) | 'google'
//   MYMEMORY_EMAIL        Optional. Raises the daily word limit.
//   GOOGLE_TRANSLATE_KEY  Required only when provider is 'google'.

const PROVIDER       = (process.env.TRANSLATE_PROVIDER || 'mymemory').toLowerCase();
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL || '';
const GOOGLE_KEY     = process.env.GOOGLE_TRANSLATE_KEY || '';

export function isConfigured() {
  if (PROVIDER === 'google') return !!GOOGLE_KEY;
  return true;   // MyMemory needs no key
}

export function providerName() { return PROVIDER; }

async function translateWithMyMemory(text, from, to) {
  const emailParam = MYMEMORY_EMAIL ? `&de=${encodeURIComponent(MYMEMORY_EMAIL)}` : '';
  const url =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}` +
    emailParam;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory request failed (${res.status})`);

  const data = await res.json();
  if (data.responseStatus && data.responseStatus !== 200) {
    throw new Error(`MyMemory: ${data.responseDetails || 'translation failed'}`);
  }
  const translated = data.responseData?.translatedText || '';

  // MyMemory sometimes returns an error string in the translated field.
  if (/^please select two distinct languages$/i.test(translated) ||
      /^invalid/i.test(translated)) {
    throw new Error(`MyMemory rejected the request: ${translated}`);
  }
  return translated;
}

async function translateWithGoogle(texts, from, to) {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(GOOGLE_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: from, target: to, format: 'text' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Translate failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data?.translations || []).map(t => t.translatedText || '');
}

/**
 * Translate an array of strings. Empty strings in the input are preserved as
 * empty strings in the output — we don't waste API calls on fields the editor
 * left blank.
 *
 * Returns an array with the same length as the input. Failed individual
 * translations become empty strings in the output; the caller decides what to
 * do (usually: show a toast and let the user type manually).
 */
export async function translateTexts(texts, from = 'en', to = 'sw') {
  if (!Array.isArray(texts) || !texts.length) return [];
  if (!isConfigured()) throw new Error('Translation provider not configured');

  // Keep track of which inputs were non-empty so we can rebuild the array
  // with empty slots preserved.
  const indices = [];
  const toTranslate = [];
  texts.forEach((t, i) => {
    const s = String(t ?? '').trim();
    if (s) { indices.push(i); toTranslate.push(s); }
  });
  if (!toTranslate.length) return texts.map(() => '');

  // Google supports batching in one call; MyMemory is one-at-a-time. We run
  // MyMemory calls in parallel with allSettled so one slow/failing field
  // doesn't block the others.
  let translated;
  if (PROVIDER === 'google') {
    translated = await translateWithGoogle(toTranslate, from, to);
  } else {
    const settled = await Promise.allSettled(
      toTranslate.map(text => translateWithMyMemory(text, from, to))
    );
    translated = settled.map(r => r.status === 'fulfilled' ? r.value : '');
  }

  const out = texts.map(() => '');
  indices.forEach((origIdx, k) => { out[origIdx] = translated[k] || ''; });
  return out;
}