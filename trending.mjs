import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/env.mjs";
import { ensureDirs, appendPublished, saveRunLog } from "./src/store.mjs";
import { generateArticles } from "./src/write.mjs";
import { publishArticle, publishShortPostSafe } from "./src/publish.mjs";
import { uploadImageAsset } from "./src/video-publish.mjs";
import { getRemainingQuota } from "./src/llm.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEEN_FILE = path.join(__dirname, "data", "trending-seen.json");
const PUBLISHED_FILE = path.join(__dirname, "data", "published.json");
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakika
const MAX_TOPICS_PER_DAY = 6; // Gunluk max 6 konu (trending icin daha yuksek limit)
const LLM_CALLS_PER_RUN = 2; // Her run'da max 2 LLM cagrisi (1 makale = 2 dil)

function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); } catch { return { topics: [], lastCheck: null }; }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
}

function loadPublished() {
  try { return JSON.parse(fs.readFileSync(PUBLISHED_FILE, "utf8")); } catch { return []; }
}

function isAlreadyPublished(topicName) {
  const published = loadPublished();
  const nameLower = topicName.toLowerCase();
  return published.some(p => 
    p.title && p.title.toLowerCase().includes(nameLower)
  );
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
  };
}

async function fetchCoinData(symbol) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${symbol.toLowerCase()}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    return {
      name: data.name,
      symbol: (data.symbol ?? symbol).toUpperCase(),
      price: data.market_data?.current_price?.usd,
      change24h: data.market_data?.price_change_percentage_24h,
      marketCap: data.market_data?.market_cap?.usd,
      volume: data.market_data?.total_volume?.usd,
      sparkline: `https://www.coingecko.com/coins/${data.id}/sparkline.svg`,
    };
  } catch (e) {
    console.warn(`  Coin verisi alinamadi (${symbol}):`, e.message);
    return null;
  }
}

async function downloadImage(url, filePath) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (e) {
    console.warn(`  Image indirilemedi:`, e.message);
    return false;
  }
}

async function fetchTrendingTopics() {
  const topics = [];

  // Kaynak 0: Binance Square trending page (Playwright scrape)
  try {
    const { stdout } = await execFileAsync("node", ["tools/scrape-trends.mjs"], {
      timeout: 50000,
      cwd: __dirname,
    });
    const binanceTopics = JSON.parse(stdout.trim() || "[]");
    console.log("  Binance Square trending:", binanceTopics.length, "topic");
    for (const name of binanceTopics) {
      topics.push({ name, source: "binance-square", type: "topic" });
    }
  } catch (e) {
    console.warn("  binance-square scrape hatasi:", e.message);
  }

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
          type: "topic",
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
          name: c.item.name,
          symbol: c.item.symbol,
          coinId: c.item.id,
          source: "coingecko",
          marketCapRank: c.item.market_cap_rank,
          score: c.item.score || 0,
          type: "coin",
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
  if (seen.topics.some((t) => t.toLowerCase().trim() === key)) return false;
  if (isAlreadyPublished(topic.name)) return false;
  return true;
}

async function generateAndPublishTopic(topic, cfg, dryRun) {
  console.log(`\n=== Yeni trend konu: ${topic.name} ===`);
  console.log(`  Kaynak: ${topic.source}, Tip: ${topic.type}`);

  // Coin verisi al
  let coinData = null;
  if (topic.type === "coin" && topic.symbol) {
    coinData = await fetchCoinData(topic.symbol);
    if (coinData) {
      console.log(`  Fiyat: $${coinData.price} | 24s: %${coinData.change24h?.toFixed(2)}`);
    }
  }

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
      console.log(`  [DRY-RUN] EN: ${article.en.title}`);
      if (coinData) console.log(`  [DRY-RUN] Chart: ${coinData.sparkline}`);
      return true;
    }

    // Chart image indir
    let imageUrl = null;
    if (coinData && coinData.sparkline) {
      const tmpDir = path.join(__dirname, "tmp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const imagePath = path.join(tmpDir, `${topic.symbol || topic.name}_chart.png`);
      
      if (await downloadImage(coinData.sparkline, imagePath)) {
        try {
          imageUrl = await uploadImageAsset(cfg.binanceKey, imagePath);
          console.log(`  Chart yuklendi: ${imageUrl}`);
        } catch (e) {
          console.warn(`  Chart yukleme hatasi:`, e.message);
        }
        // Temp dosyayi temizle
        try { fs.unlinkSync(imagePath); } catch {}
      }
    }

    // Yayinla - EN only
    {
      const lang = "en";
      const art = article.en;
      if (art) {
        try {
          console.log(`  EN makalesi yayinlaniyor...`);
          
          // Makale icerigine coin bilgisi ekle
          let body = art.body;
          if (coinData) {
            body = `${coinData.name} (${coinData.symbol}) Current Price: $${coinData.price?.toFixed(2)} | 24h Change: ${coinData.change24h?.toFixed(2)}%\n\n${body}`;
          }

          const okResult = await publishArticle(cfg.binanceKey, {
            title: art.title,
            body,
          });
          console.log(`    OK: ${okResult.url ?? "(id alinamadi)"}`);

          if (okResult && okResult.url) {
            // Kisa post
            console.log(`  EN kisa post yayinlaniyor...`);
            try {
              await publishShortPostSafe(cfg.binanceKey, { text: art.tweet });
              console.log(`    Kisa post OK`);
            } catch (err) {
              console.warn(`    Kisa post hatasi: ${err.message}`);
            }
          }

          if (okResult) {
            appendPublished([{ lang, ...okResult, title: art.title, topic: topic.name }]);
          }
        } catch (err) {
          console.error(`  HATA (en): ${err.message}`);
        }
      }
    }

    return true;
  } catch (err) {
    console.error(`  Makale uretim hatasi: ${err.message}`);
    return false;
  }
}

async function checkAndPublish(cfg, dryRun) {
  const quota = getRemainingQuota();
  console.log(`\n[${new Date().toISOString()}] Trending konular kontrol ediliyor...`);
  console.log(`  OpenRouter quota: ${quota}/45 kalan`);
  
  if (quota < 5) {
    console.log(`  Quota cok dusuk (${quota}). Trending atlandi.`);
    return;
  }

  const seen = loadSeen();
  console.log(`  Daha once yapilan: ${seen.topics.length} konu`);

  const topics = await fetchTrendingTopics();
  console.log(`  Bulunan trend konu: ${topics.length}`);

  const newTopics = topics.filter((t) => isNewTopic(t, seen));
  console.log(`  Yeni konu: ${newTopics.length}`);

  if (newTopics.length === 0) {
    console.log("  Yeni konu yok, bekleniyor...");
    return;
  }

  // Gunluk limit kontrolu - published.json'dan bugunku konulari say
  const today = new Date().toISOString().split("T")[0];
  const published = loadPublished();
  const todayPublished = published.filter(p => p.at && p.at.startsWith(today));
  const todayCount = todayPublished.length;
  if (todayCount >= MAX_TOPICS_PER_DAY) {
    console.log(`  Gunluk limit asildi (${todayCount}/${MAX_TOPICS_PER_DAY}), atlanıyor.`);
    return;
  }

  // Her yeni konu icin makale uret ve yayinla
  const remaining = MAX_TOPICS_PER_DAY - todayCount;
  for (const topic of newTopics.slice(0, Math.min(2, remaining))) {
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
