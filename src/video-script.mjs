import { generateWithRetry } from "./llm.mjs";

function buildPrompt(candidate) {
  const story = {
    title: candidate.title,
    source: candidate.source,
    publishedAt: candidate.publishedAt,
    summary: candidate.summary,
  };

  return `You are a crypto news video producer creating a short FACELESS news video for Binance Square.

Today's story to cover:

${JSON.stringify(story, null, 2)}

TASK
Create the video content in TURKISH and ENGLISH (same content, two languages).

OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{
  "tr": { "title": "...", "slides": ["...","...","...","..."], "caption": "..." },
  "en": { "title": "...", "slides": ["...","...","...","..."], "caption": "..." }
}

SLIDES RULES (each slide is shown fullscreen while narrated)
- EXACTLY 4 slides. Each slide: max 110 characters, plain text, ONE clear sentence or statement.
- Slide 1 = strong hook about the key development. Slides 2-4 = the essential facts (numbers, names, dates).
- No URLs, no mentions (@), no hashtags, no emojis on slides.

CAPTION RULES (posted as the video's text on Binance Square)
- 2-4 short factual sentences summarizing the story.
- Then a NEW LINE with EXACTLY 3 topical hashtags (e.g. "#Bitcoin #ETF #Regulation").
- Then a NEW LINE: "Kaynaklar: <outlet name>" (TR) / "Sources: <outlet name>" (EN) - outlet name only, NO URLs.
- Very last line - TR: "Bu video yapay zeka destekli olarak hazirlanmistir; yatirim tavsiyesi degildir. Kendi arastirmanizi yapiniz (DYOR)." / EN: "This video was produced with AI assistance; it is not financial advice. Always do your own research (DYOR)."
- ABSOLUTELY NO URLs and NO @mentions anywhere.

TITLE RULES
- Max 80 characters, factual but attention-grabbing, no cashtags/hashtags/URLs in title.

TONE (critical for Binance Square moderation)
- Strictly neutral journalistic reporting of verified facts only.
- FORBIDDEN: price predictions/targets, buy/sell suggestions, hype words (moon, massive pump, guaranteed), speculation presented as fact.
- You are a NEWS REPORTER, never an advisor.
- Write flawless natural Turkish and English.`;
}

function validateLang(lang, part) {
  if (!part || typeof part.title !== "string" || typeof part.caption !== "string") {
    throw new Error(`${lang} video icerigi eksik`);
  }
  if (!Array.isArray(part.slides) || part.slides.length < 3 || part.slides.length > 5) {
    throw new Error(`${lang} slayt sayisi hatali`);
  }
  part.slides = part.slides.map((s) => String(s).trim()).filter(Boolean);
  if (part.slides.length < 3) throw new Error(`${lang} gecerli slayt kalmadi`);
  for (const s of part.slides) {
    if (s.length > 160) throw new Error(`${lang} slayt cok uzun`);
    if (/https?:\/\/|@[A-Za-z0-9_]/.test(s)) throw new Error(`${lang} slaytta URL/mention var`);
  }
  const tags = part.caption.match(/#[A-Za-z0-9_]+/g) || [];
  if (tags.length < 3 || tags.length > 4) {
    throw new Error(`${lang} caption hashtag sayisi hatali (${tags.length})`);
  }
  if (/https?:\/\//.test(part.caption)) throw new Error(`${lang} caption icinde URL var`);
  if (/@[A-Za-z0-9_]/.test(part.caption)) throw new Error(`${lang} caption icinde mention var`);
  part.title = part.title.trim().slice(0, 90);
  part.caption = part.caption.trim();
  return part;
}

function validate(result) {
  validateLang("tr", result?.tr);
  validateLang("en", result?.en);
  return result;
}

export async function generateVideoScript(candidate, cfg) {
  return generateWithRetry({
    apiKey: cfg.openrouterKey,
    model: cfg.model,
    prompt: buildPrompt(candidate),
    validate,
    label: "video senaryosu",
    systemPrompt:
      "You are an expert crypto video producer. Always respond with valid JSON only.",
  });
}
