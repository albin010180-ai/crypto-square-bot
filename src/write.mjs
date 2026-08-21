const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const FALLBACK_MODELS = [
  "openrouter/free",
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

function buildPrompt(candidates, { minWords, maxWords }) {
  const list = candidates.map((c, i) => ({
    no: i + 1,
    title: c.title,
    source: c.source,
    url: c.link,
    publishedAt: c.publishedAt,
    summary: c.summary,
  }));

  return `You are a senior crypto news editor writing engaging articles for Binance Square, Binance's social platform.

Below are ${list.length} recent crypto news items (last 24 hours) collected from major outlets:

${JSON.stringify(list, null, 2)}

TASK
1. Select the 3-6 most newsworthy and complementary stories (diverse topics, not variations of the same story). Prefer high-impact items: regulation, hacks/exploits, ETFs, major price moves, whale activity, macro events.
2. Write ONE cohesive market-roundup article in TURKISH and the SAME article in ENGLISH. Fresh original wording - never copy sentences verbatim from sources.

OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{
  "selected": ["<url1>", "<url2>", ...],
  "tr": { "title": "...", "body": "..." },
  "en": { "title": "...", "body": "..." }
}

ARTICLE RULES
- Title: max 90 characters, catchy but accurate.
- Body: ${minWords}-${maxWords} words, plain text only (no markdown headings or asterisks). Short paragraphs separated by blank lines. Start with a strong hook summarizing the key development.
- Cover each selected story with its key facts (numbers, names, dates). Connect stories into one readable market update, not a bare list.
- Do not invent facts that are not supported by the provided news items.

REACH RULES (critical - maximize discovery on Binance Square)
- Cashtags: inside the body, every coin you discuss MUST appear with its cashtag at least once, e.g. $BTC $ETH $SOL $LINK $XRP. Use the standard symbol, uppercase.
- After the sources section, add ONE engagement line containing:
  * 6-8 hashtags: mix high-traffic evergreen tags (#Bitcoin #Crypto #CryptoNews #BinanceSquare #Web3 #Altcoins) with story-specific ones (e.g. #ETF #Solana #XRP #AI #Halving). Only include tags actually related to the stories.
  * 1-3 mentions with @ : always include @Binance and @Binance_Square; additionally mention an official project account ONLY if a major project is central to a story and its handle is the obvious lowercase/standard form (e.g. @solana @ethereum @ripple @chainlink). Never invent obscure handles.
- Example engagement line: "#Bitcoin #Crypto #CryptoNews #ETF #BinanceSquare #Web3 @Binance @Binance_Square"
- Very last line must be the disclaimer: TR body -> "Bu icerik yatirim tavsiyesi degildir." / EN body -> "This content is not financial advice."

STRUCTURE ORDER (both languages)
1. Article paragraphs (with inline cashtags)
2. Sources section: "Kaynaklar:" (TR) / "Sources:" (EN) followed by one line per used source: outlet name - URL
3. Engagement line (hashtags + mentions)
4. Disclaimer line`;
}

function extractJson(text) {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Yanitta JSON bulunamadi");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validate(result) {
  const tr = result?.tr;
  const en = result?.en;
  for (const [label, part] of [["tr", tr], ["en", en]]) {
    if (!part || typeof part.title !== "string" || typeof part.body !== "string") {
      throw new Error(`${label} makalesi eksik veya gecersiz`);
    }
    if (part.title.trim().length < 10 || part.body.trim().length < 200) {
      throw new Error(`${label} makalesi cok kisa`);
    }
  }
  if (!Array.isArray(result.selected)) result.selected = [];
  result.tr.title = tr.title.trim();
  result.tr.body = tr.body.trim();
  result.en.title = en.title.trim();
  result.en.body = en.body.trim();
  return result;
}

async function callModel(model, apiKey, prompt) {
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
          { role: "system", content: "You are an expert crypto news editor. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 300)}`);
    }
    const json = JSON.parse(raw);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter bos yanit dondu");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateArticles(candidates, cfg) {
  const prompt = buildPrompt(candidates, {
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
  });

  const models = [...new Set([cfg.model, ...FALLBACK_MODELS])];
  const errors = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Makale uretiliyor (model: ${model}, deneme ${attempt}/2)...`);
        const content = await callModel(model, cfg.openrouterKey, prompt);
        return validate(extractJson(content));
      } catch (err) {
        errors.push(`[${model} #${attempt}] ${err.message}`);
        console.warn(`  basarisiz: ${err.message}`);
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw new Error(`Makale uretilemedi. Denenen modeller: ${models.join(", ")}. Hatalar:\n${errors.join("\n")}`);
}
