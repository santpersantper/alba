// src/utils/translate.js
// Translation utility — uses Lingva Translate (Google-quality, free, no API key, no daily limit)
// with MyMemory as fallback.
// Source language is auto-detected so both IT→EN and EN→IT work regardless of app language.

const LINGVA_BASE = "https://lingva.ml/api/v1";

/**
 * Translate text into the app's display language.
 * Source language is auto-detected by the API, so any language can be translated.
 * @param {string} text          - Source text
 * @param {"en"|"it"} appLanguage - Current app language (determines target)
 * @returns {Promise<string>}     Translated text, or original on failure
 */
export async function translateText(text, appLanguage) {
  if (!text || !text.trim()) return text;

  const target = appLanguage === "it" ? "it" : "en";

  // — Primary: Lingva Translate — auto-detects source language
  try {
    const url = `${LINGVA_BASE}/auto/${target}/${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const json = await res.json();
      if (json?.translation && typeof json.translation === "string") {
        return json.translation;
      }
    }
  } catch {
    // fall through to backup
  }

  // — Fallback: MyMemory — fixed langpair based on target
  try {
    const langpair = target === "en" ? "it|en" : "en|it";
    const params = new URLSearchParams({ q: text, langpair });
    const res = await fetch(`https://api.mymemory.translated.net/get?${params}`);
    if (res.ok) {
      const json = await res.json();
      const result = json?.responseData?.translatedText;
      if (result && typeof result === "string") {
        try { return decodeURIComponent(result.replace(/\+/g, " ")); } catch { return result; }
      }
    }
  } catch {}

  return text;
}
