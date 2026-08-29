import { generateWithRetry } from "./llm.mjs";
import { SAFETY_RULES, assertSafe } from "./safety.mjs";

function baseRules() {
  return `OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{
  "en": { "title": "...", "slides": ["...","...","...","..."], "caption": "..." }
}

SLIDES RULES (each slide is shown fullscreen while narrated)
- EXACTLY 4 slides. Each slide: max 110 characters, plain text, ONE clear sentence or statement.
- Slide 1 = strong hook. Slides 2-4 = the essential facts or teaching points.
- No URLs, no mentions (@), no hashtags, no emojis on slides.
- AVOID punctuation-heavy slides: no colons, semicolons, quotes, parentheses or percent signs on slide text.

CAPTION RULES (posted as the video's text on Binance Square)
- 2-4 short factual sentences.
- Include 2-3 cashtags ($BTC, $ETH, $SOL, etc.) for Write to Earn commission tracking.
- Then a NEW LINE with EXACTLY 3 topical hashtags.
- Then a NEW LINE: transparency/disclaimer line - "This video was produced with AI assistance; it is not financial advice. Always do your own research (DYOR)."
- ABSOLUTELY NO URLs and NO @mentions anywhere.

TITLE RULES
- Max 80 characters, factual but attention-grabbing, no cashtags/hashtags/URLs in title, minimal punctuation.

TONE
- Strictly neutral reporting/teaching of verified facts only.
- FORBIDDEN: price predictions/targets, buy/sell suggestions, hype words (moon, massive pump, guaranteed), speculation presented as fact.
- You are a NEWS REPORTER / EDUCATOR, never an advisor.
- Write flawless natural English.

${SAFETY_RULES}`;
}

function buildNewsPrompt(candidate) {
  const story = {
    title: candidate.title,
    source: candidate.source,
    publishedAt: candidate.publishedAt,
    summary: candidate.summary,
  };

  return `You are a crypto news video producer creating a short FACELESS news video for Binance Square.

Today's story to cover:

${JSON.stringify(story, null, 2)}

Create the video content in ENGLISH only.
Caption must include one line citing the source outlet by NAME ONLY (e.g. "Sources: NewsBTC") placed right before the final disclaimer line.

${baseRules()}`;
}

function buildInfoPrompt(topic) {
  return `You are a crypto educator producing a short FACELESS informational video for Binance Square.

INFORMATIONAL TOPIC (no breaking news involved):
${topic.en}
Suggested hashtag themes: ${topic.tags.join(" ")}

Create the educational video content in ENGLISH only.
Explain the topic clearly for everyday crypto users: what it is, how it works, and practical warning signs or best practices.
Do NOT cite news outlets (this is not news). Do NOT invent specific dates, numbers or project names that you cannot verify.
The caption's hashtag line should use exactly these 3 hashtags: ${topic.tags.slice(0, 2).join(" ")} plus ONE more fitting tag such as #Binance #CryptoTips or #LearnCrypto.

${baseRules()}`;
}

function repairHashtags(caption, fallbackTags = []) {
  const tags = caption.match(/#[A-Za-z0-9_]+/g) || [];
  if (tags.length >= 3) return caption;
  const pool = [
    ...fallbackTags,
    "#Crypto",
    "#CryptoNews",
    "#Binance",
    "#Blockchain",
    "#CryptoTips",
  ].filter((t) => !tags.includes(t));
  const add = pool.slice(0, 3 - tags.length);
  if (add.length === 0) return caption;
  console.log(`  caption hashtag tamiri: ${add.join(" ")} eklendi`);
  const lines = caption.split("\n");
  lines.splice(Math.max(1, lines.length - 2), 0, add.join(" "));
  return lines.join("\n");
}

function makeValidate(fallbackTags = []) {
  return function validate(result) {
    const part = result?.en;
    if (!part || typeof part.title !== "string" || typeof part.caption !== "string") {
      throw new Error("EN video content missing");
    }
    if (!Array.isArray(part.slides) || part.slides.length < 3 || part.slides.length > 5) {
      throw new Error("EN slide count wrong");
    }
    part.slides = part.slides.map((s) => String(s).trim()).filter(Boolean);
    if (part.slides.length < 3) throw new Error("EN valid slides too few");
    const joined = `${part.title}\n${part.slides.join("\n")}\n${part.caption}`;
    assertSafe(joined, "EN video");
    for (const s of part.slides) {
      if (s.length > 160) throw new Error("EN slide too long");
      if (/https?:\/\/|@[A-Za-z0-9_]/.test(s)) throw new Error("EN slide has URL/mention");
    }
    part.caption = repairHashtags(part.caption.trim(), fallbackTags);
    const tags = part.caption.match(/#[A-Za-z0-9_]+/g) || [];
    if (tags.length < 3 || tags.length > 5) {
      throw new Error(`EN caption hashtag count wrong (${tags.length})`);
    }
    if (/https?:\/\//.test(part.caption)) throw new Error("EN caption has URL");
    if (/@[A-Za-z0-9_]/.test(part.caption)) throw new Error("EN caption has mention");
    part.title = part.title.trim().slice(0, 90);
    part.caption = part.caption.trim();
    result.tr = undefined;
    return result;
  };
}

const validateNews = makeValidate();
const validateInfo = makeValidate(["#CryptoEducation", "#LearnCrypto"]);

export async function generateVideoScript(candidate, cfg) {
  return generateWithRetry({
    apiKey: cfg.openrouterKey,
    model: cfg.model,
    prompt: buildNewsPrompt(candidate),
    validate: validateNews,
    label: "video senaryosu",
    systemPrompt: "You are an expert crypto video producer. Always respond with valid JSON only.",
  });
}

export async function generateInfoVideoScript(topic, cfg) {
  return generateWithRetry({
    apiKey: cfg.openrouterKey,
    model: cfg.model,
    prompt: buildInfoPrompt(topic),
    validate: validateInfo,
    label: "bilgilendirme video senaryosu",
    systemPrompt: "You are an expert crypto educator. Always respond with valid JSON only.",
  });
}
