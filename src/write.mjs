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
  "tr": { "title": "...", "body": "...", "tweet": "..." },
  "en": { "title": "...", "body": "...", "tweet": "..." }
}

ARTICLE RULES
- Title: max 90 characters, catchy but accurate.
- Body: ${minWords}-${maxWords} words, plain text only (no markdown headings or asterisks). Short paragraphs separated by blank lines. Start with a strong hook summarizing the key development.
- Cover each selected story with its key facts (numbers, names, dates). Connect stories into one readable market update, not a bare list.
- Do not invent facts that are not supported by the provided news items.
- Write flawless, natural language in BOTH languages; proofread grammar carefully.

COMPLIANCE RULES (critical - non-compliant posts get delisted by Binance Square moderation)
- ABSOLUTELY NO URLs anywhere in the body. Cite sources by OUTLET NAME ONLY in the sources section, e.g. "Kaynaklar: CoinDesk, The Block" / "Sources: CoinDesk, The Block".
- ABSOLUTELY NO mentions (@...) of any account - not @Binance, not @Binance_Square, nothing.
- STRICTLY NEUTRAL JOURNALISTIC TONE: report verified facts only. FORBIDDEN: price predictions or targets, buy/sell/hold suggestions, hype words (to the moon, massive pump, guaranteed, don't miss), emotional exaggeration, speculation presented as fact. Use sober verbs: rose, fell, announced, reported, according to.
- You are a NEWS REPORTER, never an advisor. Do not instruct readers what to do with their money.
- TRANSPARENCY LINE (very last line of body): TR -> "Bu haber yapay zeka destekli olarak derlenmistir; yatirim tavsiyesi degildir. Kendi arastirmanizi yapiniz (DYOR)." / EN -> "This news digest was compiled with AI assistance; it is not financial advice. Always do your own research (DYOR)."

REACH RULES (discovery without spam signals)
- Cashtags: use AT MOST 3 DIFFERENT cashtags in the entire body, inline where natural ($BTC $ETH $SOL). Uppercase standard symbols.
- Hashtags: EXACTLY 3, placed on one line right before the sources section. Choose them FRESH from today's actual story topics (e.g. #ETF #Solana #Regulation or #Bitcoin #DeFi #Hack) - never reuse the exact same combination as previous runs, and never include #BinanceSquare or generic filler every time.

STRUCTURE ORDER (both languages)
1. Article paragraphs (with up to 3 inline cashtags), varying your opening style between runs
2. MANDATORY hashtag line: EXACTLY 3 hashtags alone on one line, immediately before the sources section. Never skip this line.
3. Sources section: "Kaynaklar:" (TR) / "Sources:" (EN) followed by outlet names only, comma-separated, NO URLs
4. Transparency + disclaimer line

TWEET RULES (for each language's "tweet" field)
- A short X/Twitter post in the same language: 1-2 factual sentences teasing the most striking story, ending with exactly 3 hashtags related to the stories.
- MAXIMUM 180 characters. No URLs (added automatically later), no mentions, plain text.
- TR example: "Bitcoin 80K seviyesini test ediyor; CFTC kripto regülasyonu icin takvim acikladi #Bitcoin #Regulation #CryptoNews"`;
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
  for (const [label, part] of [["tr", tr], ["en", en]]) {
    let tweet = typeof part.tweet === "string" ? part.tweet.trim() : "";
    if (tweet.length < 20) {
      tweet = `${part.title} #Bitcoin #CryptoNews #BinanceSquare`;
    }
    if (tweet.length > 190) {
      tweet = tweet.slice(0, 187).trimEnd() + "...";
    }
    part.tweet = tweet;
  }
  for (const [label, part] of [["tr", tr], ["en", en]]) {
    const tagCount = (part.body.match(/#[A-Za-z0-9_]+/g) || []).length;
    if (tagCount < 3 || tagCount > 4) {
      throw new Error(`${label} govdesinde hashtag sayisi hatali (${tagCount}), 3-4 olmali`);
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
