import { generateWithRetry } from "./llm.mjs";
import { SAFETY_RULES, assertSafe } from "./safety.mjs";

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
1. Select the 3-6 most newsworthy and complementary stories (diverse topics, not variations of the same story). Prefer high-impact items: regulation, hacks/exploits, ETFs, major price moves, whale activity, macro events. ALSO consider: new project launches and fundraising rounds, white paper releases (with a credibility angle: team, tokenomics, audit status), exchange listings/delistings, airdrop campaigns, crypto-reward gaming developments.
2. Write ONE cohesive market-roundup article in ENGLISH. Fresh original wording - never copy sentences verbatim from sources.
3. When a new project or white paper appears among candidates, include a short credibility analysis paragraph: what is verifiable (team background, investors, audited contracts, token distribution) versus what remains unverified. Neutral assessment only - no endorsement.

OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{
  "selected": ["<url1>", "<url2>", ...],
  "en": { "title": "...", "body": "...", "tweet": "..." }
}

ARTICLE RULES
- Title: max 90 characters, catchy but accurate.
- Body: ${minWords}-${maxWords} words, plain text only (no markdown headings or asterisks). Short paragraphs separated by blank lines. Start with a strong hook summarizing the key development.
- Cover each selected story with its key facts (numbers, names, dates). Connect stories into one readable market update, not a bare list.
- Do not invent facts that are not supported by the provided news items.
- Write flawless, natural English; proofread grammar carefully.

COMPLIANCE RULES (critical - non-compliant posts get delisted by Binance Square moderation)
- ABSOLUTELY NO URLs anywhere in the body. Cite sources by OUTLET NAME ONLY in the sources section, e.g. "Sources: CoinDesk, The Block".
- ABSOLUTELY NO mentions (@...) of any account - not @Binance, not @Binance_Square, nothing.
- STRICTLY NEUTRAL JOURNALISTIC TONE: report verified facts only. FORBIDDEN: price predictions or targets, buy/sell/hold suggestions, hype words (to the moon, massive pump, guaranteed, don't miss), emotional exaggeration, speculation presented as fact. Use sober verbs: rose, fell, announced, reported, according to.
- You are a NEWS REPORTER, never an advisor. Do not instruct readers what to do with their money.
- TRANSPARENCY LINE (very last line of body): "This news digest was compiled with AI assistance; it is not financial advice. Always do your own research (DYOR)."

${SAFETY_RULES}

REACH RULES (discovery without spam signals)
- Cashtags: use EXACTLY 2-3 DIFFERENT cashtags in the entire body, inline where natural ($BTC $ETH $SOL). Focus on the most important coins mentioned in the stories. Uppercase standard symbols. NEVER exceed 3 cashtags - the API enforces a strict limit.
- Hashtags: EXACTLY 3, placed on one line right before the sources section. Choose them FRESH from today's actual story topics - always include #Binance as one of the 3 hashtags (e.g. #Bitcoin #Regulation #Binance or #ETF #DeFi #Binance). Never reuse the exact same combination as previous runs.

MARKET ANALYSIS ANGLE (Write to Earn optimization)
- Include at least one sentence analyzing trading volume, price action, or on-chain metrics for the main coins discussed.
- Mention support/resistance levels or key technical indicators when relevant to the story.
- Connect market data to the narrative to provide actionable insights for readers.

STRUCTURE ORDER
1. Article paragraphs (with EXACTLY 2-3 inline cashtags), varying your opening style between runs
2. MANDATORY hashtag line: EXACTLY 3 hashtags alone on one line, immediately before the sources section. Never skip this line.
3. Sources section: "Sources:" followed by outlet names only, comma-separated, NO URLs
4. Transparency + disclaimer line

TWEET RULES (for the "tweet" field)
- ALL tweets MUST BE IN ENGLISH ONLY.
- A short X/Twitter post: 1-2 factual sentences teasing the most striking story, ending with exactly 3 hashtags related to the stories.
- Include EXACTLY 1 cashtag ($BTC or $ETH, etc.) for Write to Earn tracking. X limits tweets to maximum 1 cashtag.
- Always include #Binance as one of the 3 hashtags.
- MAXIMUM 180 characters. No URLs, no mentions, plain text only.
- Example: "Bitcoin tests 80K level; CFTC announces crypto regulation timeline #Bitcoin #Regulation #Binance"`;
}

const FALLBACK_TAG_SETS = [
  ["#Bitcoin", "#CryptoNews", "#MarketUpdate"],
  ["#Ethereum", "#Altcoins", "#Blockchain"],
  ["#Crypto", "#DeFi", "#Web3"],
  ["#Bitcoin", "#ETF", "#Markets"],
];

function ensureHashtags(body) {
  const tags = body.match(/#[A-Za-z0-9_]+/g) || [];
  if (tags.length >= 3) return body;

  const cycle = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
  const pool = FALLBACK_TAG_SETS[cycle % FALLBACK_TAG_SETS.length].filter(
    (t) => !tags.includes(t)
  );
  const add = pool.slice(0, 3 - tags.length);
  if (add.length === 0) return body;
  console.log(`  hashtag tamiri: ${add.join(" ")} eklendi`);

  const lines = body.split("\n");
  const disclaimerIdx = lines.findLastIndex((l) =>
    /^This (news|article|video)/i.test(l.trim())
  );
  const tagLine = add.join(" ");
  if (disclaimerIdx > 0) {
    lines.splice(disclaimerIdx, 0, tagLine);
  } else {
    lines.push(tagLine);
  }
  return lines.join("\n");
}

function validate(result) {
  const en = result?.en;
  if (!en || typeof en.title !== "string" || typeof en.body !== "string") {
    throw new Error("EN article missing or invalid");
  }
  if (en.title.trim().length < 10 || en.body.trim().length < 200) {
    throw new Error("EN article too short");
  }
  assertSafe(`${en.title}\n${en.body}\n${en.tweet ?? ""}`, "EN article");

  let tweet = typeof en.tweet === "string" ? en.tweet.trim() : "";
  if (tweet.length < 20) {
    tweet = `${en.title} #Bitcoin #CryptoNews #BinanceSquare`;
  }
  if (tweet.length > 190) {
    tweet = tweet.slice(0, 187).trimEnd() + "...";
  }
  en.tweet = tweet;

  en.body = ensureHashtags(en.body.trim());
  const tagCount = (en.body.match(/#[A-Za-z0-9_]+/g) || []).length;
  if (tagCount < 3 || tagCount > 5) {
    throw new Error(`Hashtag count wrong (${tagCount}), must be 3-5`);
  }

  if (!Array.isArray(result.selected)) result.selected = [];
  result.en.title = en.title.trim();
  result.en.body = en.body.trim();
  result.tr = undefined;
  return result;
}

export async function generateArticles(candidates, cfg) {
  const prompt = buildPrompt(candidates, {
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
  });

  return generateWithRetry({
    apiKey: cfg.openrouterKey,
    model: cfg.model,
    prompt,
    validate,
    label: "makale",
  });
}

function buildInfoPrompt(topic, { minWords, maxWords }) {
  return `You are a senior crypto educator writing an INFORMATIONAL article for Binance Square. This is NOT a news roundup - no breaking stories, no invented dates or numbers.

TOPIC:
${topic.en}
Suggested hashtag themes: ${topic.tags.join(" ")}

TASK
Write ONE educational article in ENGLISH.

OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{
  "selected": [],
  "en": { "title": "...", "body": "...", "tweet": "..." }
}

ARTICLE RULES
- Title: max 90 characters.
- Body: ${minWords - 50}-${maxWords - 100} words, plain text only. Structure: what the topic is -> how it works -> practical checklist / warning signs -> balanced risks.
- Explain with everyday examples; keep it useful for beginners and intermediates.
- Do NOT cite news outlets (no sources section). Do NOT invent specific project names, dates, prices or statistics you cannot verify.
- Write flawless, natural English; proofread grammar carefully.

COMPLIANCE RULES (critical - non-compliant posts get delisted by Binance Square moderation)
- ABSOLUTELY NO URLs anywhere in the body.
- ABSOLUTELY NO mentions (@...) of any account.
- STRICTLY NEUTRAL EDUCATIONAL TONE: FORBIDDEN: price predictions or targets, buy/sell/hold suggestions, hype words, emotional exaggeration, speculation presented as fact.
- You are an EDUCATOR, never an advisor. Do not instruct readers what to do with their money.
- Cashtags: EXACTLY 2-3 DIFFERENT, inline where natural ($BTC $ETH $SOL). Focus on coins relevant to the topic. NEVER exceed 3 - API enforces strict limit.
- Hashtags: EXACTLY 3 on one line near the end: use "${topic.tags.slice(0, 2).join(" ")}" plus ONE more fitting tag such as #CryptoEducation #Binance #DYOR.
- TRANSPARENCY LINE (very last line of body): "This article was produced with AI assistance; it is not financial advice. Always do your own research (DYOR)."

STRUCTURE ORDER
1. Article paragraphs (up to 3 inline cashtags), vary your opening style
2. MANDATORY hashtag line: EXACTLY 3 hashtags alone on one line
3. Transparency + disclaimer line

TWEET RULES (for the "tweet" field)
- ALL tweets MUST BE IN ENGLISH ONLY.
- A short X/Twitter post: 1-2 factual sentences teasing the topic, ending with exactly 3 hashtags.
- Include EXACTLY 1 cashtag ($BTC or $ETH, etc.) for Write to Earn tracking. X limits tweets to maximum 1 cashtag.
- Always include #Binance as one of the 3 hashtags.
- MAXIMUM 180 characters. No URLs, no mentions, plain text only.

${SAFETY_RULES}`;
}

export async function generateInfoArticles(topic, cfg) {
  return generateWithRetry({
    apiKey: cfg.openrouterKey,
    model: cfg.model,
    prompt: buildInfoPrompt(topic, {
      minWords: cfg.minWords,
      maxWords: cfg.maxWords,
    }),
    validate,
    label: "bilgilendirme makalesi",
    systemPrompt: "You are an expert crypto educator. Always respond with valid JSON only.",
  });
}
