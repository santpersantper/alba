// src/utils/translate.js
// Translation utility — uses MyMemory (free, no API key) with auto-detection.
// Source language is auto-detected so both IT→EN and EN→IT work regardless of app language.

/**
 * Translate text into the app's display language.
 * @param {string} text           - Source text
 * @param {"en"|"it"} appLanguage - Current app language (determines target)
 * @returns {Promise<string>}      Translated text, or original on failure
 */
export async function translateText(text, appLanguage) {
  if (!text || !text.trim()) return text;

  const target = appLanguage === "it" ? "it" : "en";

  // — Primary: MyMemory with auto-detection
  try {
    const params = new URLSearchParams({ q: text, langpair: `autodetect|${target}` });
    const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      const result = json?.responseData?.translatedText;
      if (result && typeof result === "string" && json?.responseStatus === 200) {
        try { return decodeURIComponent(result.replace(/\+/g, " ")); } catch { return result; }
      }
    }
  } catch {}

  // — Fallback: MyMemory with fixed langpair
  try {
    const langpair = target === "it" ? "en|it" : "it|en";
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
