import { loadEnv } from "./src/env.mjs";
import { ensureDirs, loadHistory, saveHistory, appendPublished, saveRunLog, saveLatest } from "./src/store.mjs";
import { collectNews, normalizeTitle } from "./src/news.mjs";
import { generateArticles, generateInfoArticles } from "./src/write.mjs";
import { pickInfoTopic } from "./src/info-topics.mjs";
import { publishArticle, publishShortPost } from "./src/publish.mjs";
import { tweet } from "./src/x.mjs";

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
      "https://www.binance.com/activity/referral-entry/CPA?ref=CPA_001D41FKZ1",
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

function limitCashtags(text, max = 4) {
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
    body: limitHashtags(limitCashtags(body))
      .replace(/[ \t]+(\r?\n)/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
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

  for (const [lang, art] of [["tr", article.tr], ["en", article.en]]) {
    let body = art.body;
    let okResult = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`${lang.toUpperCase()} makalesi yayinlaniyor...`);
        okResult = await publishArticle(cfg.binanceKey, {
          title: art.title,
          body,
        });
        console.log(`  OK: ${okResult.url ?? okResult.note ?? "(id alinamadi)"}`);
        break;
      } catch (err) {
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
      if (okResult.url && xEnabled) {
        try {
          const joinLabel = lang === "tr" ? "Binance'e katilin:" : "Join Binance:";
          const xText = `${art.tweet}\n\n${okResult.url}\n${joinLabel} ${cfg.referralLink}`;
          const x = await tweet({ ...cfg.x, text: xText });
          console.log(`  X: ${x.url}`);
          okResult.xUrl = x.url;
        } catch (err) {
          console.warn(`  X hatasi: ${err.message}`);
          okResult.xError = err.message;
        }
      }

      console.log(`${lang.toUpperCase()} kisa post yayinlaniyor...`);
      try {
        okResult.shortPost = await publishShortPost(cfg.binanceKey, { text: art.tweet });
        console.log(`  Kisa post OK: ${okResult.shortPost.url ?? okResult.shortPost.note ?? "(id alinamadi)"}`);
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
