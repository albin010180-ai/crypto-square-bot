const FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { name: "NewsBTC", url: "https://www.newsbtc.com/feed/" },
  { name: "Bitcoinist", url: "https://bitcoinist.com/feed/" },
  { name: "U.Today", url: "https://u.today/rss" },
];

const KEYWORD_WEIGHTS = [
  [/\b(btc|bitcoin)\b/, 6],
  [/\b(eth|ethereum)\b/, 4],
  [/\betf\b/, 6],
  [/\b(sec|cftc|regulat|lawsuit|ban|sanction)/, 5],
  [/(hack|exploit|breach|stolen|drain|phishing)/, 7],
  [/\bwhale\b/, 5],
  [/\b(fed|fomc|interest rate|cpi|inflation|recession)\b/, 5],
  [/(stablecoin|tether|\busdt\b|\busdc\b|depeg)/, 4],
  [/\b(solana|\bsol\b)\b/, 3],
  [/\b(xrp|ripple)\b/, 3],
  [/\b(binance|\bbnb\b)\b/, 5],
  [/\b(dogecoin|\bdoge\b|shiba|meme coin)/, 2],
  [/\b(altcoin|altcoins|altseason)\b/, 2],
  [/(rally|surge|soar|plunge|crash|pump|dump|slump|spike|tumble)/, 4],
  [/(record|all-time high|\bath\b|milestone)/, 5],
  [/\bai\b|artificial intelligence/, 3],
  [/(listing|delisting)/, 3],
  [/(launch|mainnet|upgrade|fork)/, 3],
  [/\b(billion|million|trillion)\b/, 2],
  [/\b(halving|mining|miner)/, 3],
];

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function pickField(itemXml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = itemXml.match(re);
  if (!m) return "";
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) value = cdata[1].trim();
  return value;
}

function parseFeed(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const block of blocks) {
    const title = stripTags(pickField(block, "title"));
    let link = stripTags(pickField(block, "link"));
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) link = href[1];
    }
    const pubDateRaw =
      pickField(block, "pubDate") ||
      pickField(block, "published") ||
      pickField(block, "updated") ||
      pickField(block, "dc:date");
    const description = stripTags(
      pickField(block, "description") || pickField(block, "summary") || pickField(block, "content")
    );
    if (!title || !link) continue;
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;
    items.push({
      title,
      link,
      source: sourceName,
      summary: description.slice(0, 400),
      publishedAt:
        publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CryptoSquareBot/1.0",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml, feed.name);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreItem(item) {
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  let score = 0;
  for (const [re, weight] of KEYWORD_WEIGHTS) {
    if (re.test(haystack)) score += weight;
  }
  score = Math.min(score, 22);
  if (item.publishedAt) {
    const hoursOld = (Date.now() - new Date(item.publishedAt).getTime()) / 3600000;
    score += Math.max(0, 24 - hoursOld) / 2;
  }
  return Math.round(score * 10) / 10;
}

export async function collectNews({ maxCandidates = 14 } = {}) {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const errors = [];
  const allItems = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
    } else {
      errors.push(`${FEEDS[i].name}: ${result.reason?.message || result.reason}`);
    }
  });

  const cutoff = Date.now() - 24 * 3600000;
  const recent = allItems.filter((item) => {
    if (!item.publishedAt) return true;
    return new Date(item.publishedAt).getTime() >= cutoff;
  });

  const seenTitles = new Set();
  const unique = [];
  for (const item of recent) {
    const norm = normalizeTitle(item.title);
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    unique.push(item);
  }

  unique.forEach((item) => {
    item.score = scoreItem(item);
  });
  unique.sort((a, b) => b.score - a.score);

  return { candidates: unique.slice(0, maxCandidates), totalFetched: allItems.length, errors };
}
