const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
import fs from "node:fs";
import path from "node:path";

const QUOTA_FILE = path.join(process.cwd(), "data", "llm-quota.json");
const DAILY_LIMIT = 45;

export const FALLBACK_MODELS = [
  "openrouter/free",
  "z-ai/glm-5.2:free",
];

function loadQuota() {
  try {
    const data = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8"));
    const today = new Date().toISOString().split("T")[0];
    if (data.date !== today) {
      return { date: today, calls: 0 };
    }
    return data;
  } catch {
    return { date: new Date().toISOString().split("T")[0], calls: 0 };
  }
}

function saveQuota(quota) {
  try {
    const dir = path.dirname(QUOTA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(quota, null, 2));
  } catch {}
}

export function getRemainingQuota() {
  const q = loadQuota();
  return Math.max(0, DAILY_LIMIT - q.calls);
}

export function trackCall() {
  const q = loadQuota();
  q.calls++;
  saveQuota(q);
  return DAILY_LIMIT - q.calls;
}

export function hasQuota() {
  const remaining = getRemainingQuota();
  if (remaining <= 0) {
    console.warn(`[LLM] Quota bitti (${DAILY_LIMIT}/${DAILY_LIMIT}).`);
    return false;
  }
  return true;
}

export async function callModel(model, apiKey, prompt, systemPrompt) {
  if (!hasQuota()) throw new Error("OpenRouter quota bitti");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/crypto-square-bot",
        "X-Title": "Crypto Square Bot",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              systemPrompt ||
              "You are an expert crypto news editor. Always respond with valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = await res.text();

    // Rate limit — throw with retryable flag
    if (res.status === 429) {
      const err = new Error(`OpenRouter HTTP 429: ${raw.slice(0, 200)}`);
      err.retryable = true;
      throw err;
    }

    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 300)}`);

    const json = JSON.parse(raw);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter bos yanit dondu");
    trackCall();
    const remaining = getRemainingQuota();
    console.log(`[LLM] Quota: ${remaining}/${DAILY_LIMIT} kalan`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Yanitta JSON bulunamadi");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generateWithRetry({
  apiKey,
  model,
  prompt,
  validate,
  label = "icerik",
  systemPrompt,
}) {
  if (!hasQuota()) throw new Error(`[LLM] Quota bitti - ${label} atlandi`);

  const models = [...new Set([model, ...FALLBACK_MODELS])];
  const errors = [];
  const MAX_ATTEMPTS = 3;

  for (const m of models) {
    if (!hasQuota()) break;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`${label} uretiliyor (model: ${m}, deneme ${attempt}/${MAX_ATTEMPTS})...`);
        const content = await callModel(m, apiKey, prompt, systemPrompt);
        return validate(extractJson(content));
      } catch (err) {
        errors.push(`[${m} #${attempt}] ${err.message.slice(0, 150)}`);
        console.warn(`  basarisiz: ${err.message.slice(0, 150)}`);
        if (err.message.includes("quota bitti")) break;

        // Exponential backoff for rate limits
        if (err.retryable || err.message.includes("429")) {
          const backoff = Math.min(5000 * Math.pow(2, attempt - 1), 60000);
          console.log(`  rate limit, ${backoff / 1000}s bekleniyor...`);
          await sleep(backoff);
        } else {
          await sleep(attempt === 1 ? 10000 : 20000);
        }
      }
    }
  }
  throw new Error(
    `${label} uretilemedi. Denenen modeller: ${models.join(", ")}.\n${errors.join("\n")}`
  );
}
