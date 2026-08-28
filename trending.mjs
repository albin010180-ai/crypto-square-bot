import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/env.mjs";
import { ensureDirs, appendPublished, saveRunLog } from "./src/store.mjs";
import { generateArticles } from "./src/write.mjs";
import { publishArticle, publishShortPostSafe } from "./src/publish.mjs";
import { tweet } from "./src/x.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEEN_FILE = path.join(__dirname, "data", "trending-seen.json");
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 dakika

function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); } catch { return { topics: [], lastCheck: null }; }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    once: process.argv.includes("--once"),
  };
}

function buildCfg() {
  return {
    openrouterKey: process.env.OPENROUTER_API_KEY?.trim() || "",
    binanceKey: process.env.BINANCE_SQUARE_OPENAPI_KEY?.trim() || "",
    model: process.env.OPENROUTER_MODEL?.trim() || "google/gemma-4-31b-it:free",
    minWords: 350,
    maxWords: 600,
    referralCode: process.env.X_REFERRAL_CODE?.trim() || "CPA_001D41FKZ1",
    x: {
      apiKey: process.env.X_API_KEY?.trim() || "",
      apiSecret: process.env.X_API_SECRET?.trim() || "",
      accessToken: process.env.X_ACCESS_TOKEN?.trim() || "",
      accessSecret: process.env.X_ACCESS_SECRET?.trim() || "",
    },
  };
}

async function fetchTrendingTopics() {
  const topics = [];

  // Kaynak 1: Cryptocurrency.cv trending
  try {
    const res = await fetch("https://cryptocurrency.cv/api/trending", {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.trending) {
      for (const t of data.trending) {
        topics.push({
          name: t.topic,
          source: "cryptocurrency.cv",
          sentiment: t.sentiment,
          headlines: t.recentHeadlines || [],
          count: t.count || 0,
        });
      }
    }
  } catch (e) {
    console.warn("  cryptocurrency.cv hatasi:", e.message);
  }

  // Kaynak 2: CoinGecko trending coins
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.coins) {
      for (const c of data.coins.slice(0, 10)) {
        topics.push({
          name: `${c.item.name} (${c.item.symbol})`,
          source: "coingecko",
          priceBtc: c.item.price_btc,
          marketCapRank: c.item.market_cap_rank,
          score: c.item.score || 0,
        });
      }
    }
  } catch (e) {
    console.warn("  coingecko hatasi:", e.message);
  }

  return topics;
}

function isNewTopic(topic, seen) {
  const key = topic.name.toLowerCase().trim();
  return !seen.topics.some((t) => t.toLowerCase().trim() === key);
}

async function generateAndPublishTopic(topic, cfg, dryRun) {
  console.log(`\n=== Yeni trend konu: ${topic.name} ===`);
  console.log(`  Kaynak: ${topic.source}`);

  // Haber basligi olarak kullan
  const headlines = topic.headlines || [];
  const candidate = {
    title: topic.name,
    source: topic.source,
    link: "",
    publishedAt: new Date().toISOString(),
    summary: headlines.length > 0 ? headlines.join(". ") : `${topic.name} is trending in crypto market.`,
  };

  try {
    const article = await generateArticles([candidate], cfg);
    if (!article) {
      console.warn("  Makale uretilemedi");
      return false;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] TR: ${article.tr.title}`);
      console.log(`  [DRY-RUN] EN: ${article.en.title}`);
      return true;
    }

    // Yayinla
    const langs = ["tr", "en"];
    for (const lang of langs) {
      const art = article[lang];
      if (!art) continue;

      try {
        console.log(`  ${lang.toUpperCase()} makalesi yayinlaniyor...`);
        const okResult = await publishArticle(cfg.binanceKey, {
          title: art.title,
          body: art.body,
        });
        console.log(`    OK: ${okResult.url ?? "(id alinamadi)"}`);

        if (okResult && okResult.url) {
          const xEnabled = Object.values(cfg.x).every(Boolean);
          const xText = `${art.tweet}\n\nReferral kod: ${cfg.referralCode}`;
          
          if (xEnabled) {
            try {
              const x = await tweet({ ...cfg.x, text: xText });
              console.log(`    X: ${x.url}`);
            } catch (err) {
              console.warn(`    X hatasi: ${err.message}`);
            }
          }

          console.log(`  ${lang.toUpperCase()} kisa post yayinlaniyor...`);
          try {
            await publishShortPostSafe(cfg.binanceKey, { text: art.tweet });
            console.log(`    Kisa post OK`);
          } catch (err) {
            console.warn(`    Kisa post hatasi: ${err.message}`);
          }
        }

        if (okResult) {
          appendPublished({ lang, ...okResult, title: art.title, topic: topic.name });
        }
      } catch (err) {
        console.error(`  HATA (${lang}): ${err.message}`);
      }
    }

    return true;
  } catch (err) {
    console.error(`  Makale uretim hatasi: ${err.message}`);
    return false;
  }
}

async function checkAndPublish(cfg, dryRun) {
  const seen = loadSeen();
  console.log(`\n[${new Date().toISOString()}] Trending konular kontrol ediliyor...`);
  console.log(`  Daha once yapilan: ${seen.topics.length} konu`);

  const topics = await fetchTrendingTopics();
  console.log(`  Bulunan trend konu: ${topics.length}`);

  const newTopics = topics.filter((t) => isNewTopic(t, seen));
  console.log(`  Yeni konu: ${newTopics.length}`);

  if (newTopics.length === 0) {
    console.log("  Yeni konu yok, bekleniyor...");
    return;
  }

  // Her yeni konu icin makale uret ve yayinla
  for (const topic of newTopics.slice(0, 2)) { // Max 2 konu per check
    const success = await generateAndPublishTopic(topic, cfg, dryRun);
    if (success) {
      seen.topics.push(topic.name);
    }
  }

  seen.lastCheck = new Date().toISOString();
  saveSeen(seen);
}

async function main() {
  const { dryRun, once } = parseArgs();
  loadEnv();
  ensureDirs();
  const cfg = buildCfg();

  console.log("=== Trending Topics Monitor ===");
  console.log(`Mod: ${dryRun ? "DRY-RUN" : "CANLI"}`);
  console.log(`Kontrol araligi: ${CHECK_INTERVAL_MS / 1000}sn`);

  if (once) {
    await checkAndPublish(cfg, dryRun);
    return;
  }

  // Surekli dongu
  while (true) {
    try {
      await checkAndPublish(cfg, dryRun);
    } catch (err) {
      console.error("Dongu hatasi:", err.message);
    }
    console.log(`\nSonraki kontrol: ${new Date(Date.now() + CHECK_INTERVAL_MS).toISOString()}`);
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

main().catch(console.error);
