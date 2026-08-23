import { loadEnv } from "./src/env.mjs";
import { ensureDirs, loadHistory, saveHistory, appendPublished, saveRunLog, saveLatest } from "./src/store.mjs";
import { collectNews, normalizeTitle } from "./src/news.mjs";
import { generateArticles, generateInfoArticles } from "./src/write.mjs";
import { pickInfoTopic } from "./src/info-topics.mjs";
import { publishArticle, publishShortPostSafe, stripRiskyPunct, aggressiveStrip } from "./src/publish.mjs";
import { tweet } from "./src/x.mjs";
import fs from "node:fs";

const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force") || process.env.FORCE_PUBLISH === "true",
    info: process.argv.includes("--info") || process.env.CONTENT_MODE === "info",
  };
}

function buildCfg() {
  const num = (name, fallback) => {
    const v = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    openrouterKey: process.env.OPENROUTER_API_KEY?.trim() || "",
    binanceKey: process.env.BINANCE_SQUARE_OPENAPI_KEY?.trim() || "",
    model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
    maxCandidates: num("MAX_CANDIDATES", 14),
    minWords: num("ARTICLE_MIN_WORDS", 350),
    maxWords: num("ARTICLE_MAX_WORDS", 600),
    referralLink:
      process.env.X_REFERRAL_LINK?.trim() ||
      "https://me-l.co/b6iygwwa",
    x: {
      apiKey: process.env.X_API_KEY?.trim() || "",
      apiSecret: process.env.X_API_SECRET?.trim() || "",
      accessToken: process.env.X_ACCESS_TOKEN?.trim() || "",
      accessSecret: process.env.X_ACCESS_SECRET?.trim() || "",
    },
  };
}

function limitHashtags(text, max = 4) {
  let count = 0;
  return text.replace(/#[A-Za-z0-9_]+/g, (tag) => {
    count += 1;
    return count <= max ? tag : "";
  });
}

function limitCashtags(text, max = 3) {
  const seen = new Set();
  return text.replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, (match, sym) => {
    if (seen.size < max || seen.has(sym)) {
      seen.add(sym);
      return match;
    }
    return sym;
  });
}

function sanitizeAll(title, body) {
  return {
    title: limitHashtags(limitCashtags(title)).trim(),
    body,
  };
}

function hardTitle(s) {
  return s.replace(/[^\p{L}\p{N}\s#@]/gu, " ").replace(/\s+/g, " ").trim();
}

function ensureCashtagsInShortPost(shortText, body) {
  const bodyCashtags = [...body.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)].map(m => m[0]);
  const textCashtags = [...shortText.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)].map(m => m[0]);
  if (textCashtags.length >= 2 || bodyCashtags.length === 0) return shortText;
  const needed = bodyCashtags.filter(ct => !textCashtags.includes(ct)).slice(0, 2);
  if (needed.length === 0) return shortText;
  const hashtags = shortText.match(/#[A-Za-z0-9_]+/g) || [];
  const tagLine = hashtags.join(" ");
  const textWithoutTags = shortText.replace(/#[A-Za-z0-9_]+/g, "").trim();
  return `${textWithoutTags} ${needed.join(" ")} ${tagLine}`.trim();
}

function enforceCashtagLimit(text, max = 3) {
  const seen = new Set();
  return text.replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, (match, sym) => {
    if (seen.has(sym)) return match;
    if (seen.size >= max) return sym;
    seen.add(sym);
    return match;
  });
}

function savePendingTweet(text, lang, postUrl) {
  const file = new URL("../data/pending-tweets.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  let tweets = [];
  try { tweets = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  tweets.push({ text, lang, postUrl, createdAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(tweets, null, 2));
  console.log(`  Tweet kaydedildi (pending-tweets.json) - manuel paylasim icin`);
}

async function main() {
  const startedAt = new Date().toISOString();
  const { dryRun, force, info } = parseArgs();
  loadEnv();
  const cfg = buildCfg();
  ensureDirs();

  if (!cfg.openrouterKey) {
    console.error("HATA: OPENROUTER_API_KEY tanimli degil.");
    console.error("GitHub: Repo > Settings > Secrets and variables > Actions altina ekleyin.");
    process.exit(1);
  }
  if (!cfg.binanceKey && !dryRun) {
    console.error("HATA: BINANCE_SQUARE_OPENAPI_KEY tanimli degil.");
    console.error("Anahtar olusturma: https://www.binance.com/square/creator-center/home");
    process.exit(1);
  }

  console.log(`[${startedAt}] Calistirma basladi${dryRun ? " (DRY-RUN)" : ""}${info ? " (BILGILENDIRME MODU)" : ""}`);
  console.log(`Model: ${cfg.model}`);

  if (!dryRun && (process.env.PUBLISH_ENABLED ?? "true") === "false") {
    console.log("Yayinler duraklatilmis (PUBLISH_ENABLED=false). Bu tur atlandi.");
    return;
  }

  let article;
  let contentType = info ? "info" : "news";
  let usedCandidates = [];
  let useInfo = info;
  let sourceErrors = [];
  let record_topic = null;
  const history = loadHistory();

  if (!useInfo) {
    const seenLinks = new Set(history.links);
    const seenTitles = new Set(history.titles);

    console.log("Haber kaynaklari taraniyor...");
    const { candidates, totalFetched, errors } = await collectNews({
      maxCandidates: cfg.maxCandidates,
    });
    sourceErrors = errors;
    for (const e of errors) console.warn(`  kaynak hatasi: ${e}`);
    console.log(`${totalFetched} haber okundu, ${candidates.length} aday secildi.`);

    const fresh = force
      ? candidates
      : candidates.filter(
          (c) => !seenLinks.has(c.link) && !seenTitles.has(normalizeTitle(c.title))
        );
    console.log(`Daha once kullanilmamis: ${fresh.length} aday.${force ? " (FORCE: gecmis yoksayildi)" : ""}`);

    if (fresh.length === 0) {
      console.log("Yeni haber yok -> bilgilendirme makalesi uretilecek.");
      useInfo = true;
      contentType = "info";
    } else {
      usedCandidates = fresh;
      article = await generateArticles(fresh, cfg);
    }
  }

  if (useInfo && !article) {
    contentType = "info";
    const topic = pickInfoTopic(new Date(), 1);
    console.log(`Bilgilendirme konusu: ${topic.id} - ${topic.tr}`);
    article = await generateInfoArticles(topic, cfg);
    record_topic = topic.id;
  }

  console.log(`\n=== TR: ${article.tr.title}`);
  console.log(`=== EN: ${article.en.title}\n`);

  const record = {
    startedAt,
    finishedAt: null,
    dryRun,
    model: cfg.model,
    contentType,
    contentTopic: record_topic ?? null,
    sourceErrors,
    candidates: usedCandidates.map((c) => ({ title: c.title, source: c.source, link: c.link })),
    selected: article.selected,
    articles: { tr: article.tr, en: article.en },
    published: [],
  };

  if (dryRun) {
    console.log("--- DRY-RUN: yayin yapilmadi ---");
    console.log(`\n[TURKCE]\nBaslik: ${article.tr.title}\n\n${article.tr.body}`);
    console.log(`\n[ENGLISH]\nTitle: ${article.en.title}\n\n${article.en.body}`);
    record.finishedAt = new Date().toISOString();
    saveLatest(record);
    console.log(`\nLog: ${saveRunLog(record)}`);
    return;
  }

  const xEnabled = Object.values(cfg.x).every(Boolean);
  if (!xEnabled) console.log("X entegrasyonu kapali (API anahtarlari tanimli degil).");

  const staggerMs = Number.parseInt(process.env.POST_STAGGER_MS ?? "90000", 10) || 90000;
  let firstLang = true;

  for (const [lang, art] of [["tr", article.tr], ["en", article.en]]) {
    if (!firstLang && !dryRun) {
      console.log(`spam-onleme: sonraki dil icin ${staggerMs / 1000}sn bekleniyor...`);
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    firstLang = false;
    art.body = enforceCashtagLimit(art.body);
    art.title = enforceCashtagLimit(art.title);
    let body = art.body;
    let okResult = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        console.log(`${lang.toUpperCase()} makalesi yayinlaniyor...`);
        okResult = await publishArticle(cfg.binanceKey, {
          title: art.title,
          body,
        });
        console.log(`  OK: ${okResult.url ?? okResult.note ?? "(id alinamadi)"}`);
        break;
      } catch (err) {
        if (/20030|punctuation/i.test(err.message) && attempt <= 3) {
          const before = art.title;
          art.title = attempt === 1 ? stripRiskyPunct(before) : attempt === 2 ? aggressiveStrip(before) : hardTitle(art.title);
          console.warn(`  [20030] baslik temizlendi (${attempt}/3), tekrar denenecek`);
          continue;
        }
        if (/220094|Hashtag count|220095|Coin pair/i.test(err.message) && attempt === 1) {
          console.warn(`  etiket limiti asildi, govde temizlenip tekrar denenecek`);
          const clean = sanitizeAll(art.title, body);
          art.title = clean.title;
          body = clean.body;
          continue;
        }
        console.error(`  HATA (${lang}): ${err.message}`);
        break;
      }
    }

    if (okResult) {
      if (okResult.url) {
        const joinLabel = lang === "tr" ? "Binance'e katilin:" : "Join Binance:";
        const xText = `${art.tweet}\n\n${okResult.url}\n${joinLabel} ${cfg.referralLink}`;
        
        if (xEnabled) {
          try {
            const x = await tweet({ ...cfg.x, text: xText });
            console.log(`  X: ${x.url}`);
            okResult.xUrl = x.url;
          } catch (err) {
            console.warn(`  X hatasi: ${err.message}`);
            okResult.xError = err.message;
            savePendingTweet(xText, lang, okResult.url);
          }
        } else {
          savePendingTweet(xText, lang, okResult.url);
        }
      }

      console.log(`${lang.toUpperCase()} kisa post yayinlaniyor...`);
      try {
        const shortText = ensureCashtagsInShortPost(art.tweet, body);
        const sp = await publishShortPostSafe(cfg.binanceKey, { text: shortText });
        okResult.shortPost = sp.result;
        console.log(`  Kisa post OK: ${sp.result.url ?? sp.result.note ?? "(id alinamadi)"}`);
      } catch (err) {
        console.warn(`  Kisa post atlandi: ${err.message}`);
        okResult.shortPostError = err.message;
      }

      record.published.push({ lang, ...okResult, title: art.title });
    }
  }

  if (usedCandidates.length > 0) {
    history.links.push(...usedCandidates.map((c) => c.link));
    history.titles.push(...usedCandidates.map((c) => normalizeTitle(c.title)));
    saveHistory(history);
  }

  const successCount = record.published.filter((p) => !p.error).length;
  appendPublished(
    record.published
      .filter((p) => !p.error)
      .map((p) => ({
        lang: p.lang,
        id: p.id,
        url: p.url,
        title: p.title,
        at: new Date().toISOString(),
      }))
  );

  record.finishedAt = new Date().toISOString();
  saveLatest(record);
  console.log(`\nLog: ${saveRunLog(record)}`);
  console.log(`Ozet: ${successCount}/${record.published.length} makale yayinlandi.`);
  if (successCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error(`OLUSMAYAN HATA: ${err.stack || err.message}`);
  process.exit(1);
});
