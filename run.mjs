import { loadEnv } from "./src/env.mjs";
import { ensureDirs, loadHistory, saveHistory, appendPublished, saveRunLog } from "./src/store.mjs";
import { collectNews, normalizeTitle } from "./src/news.mjs";
import { generateArticles } from "./src/write.mjs";
import { publishArticle } from "./src/publish.mjs";

const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force") || process.env.FORCE_PUBLISH === "true",
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
  };
}

function limitHashtags(body, max = 4) {
  let count = 0;
  return body.replace(/#[A-Za-z0-9_]+/g, (tag) => {
    count += 1;
    return count <= max ? tag : "";
  }).replace(/[ \t]+(\r?\n)/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const startedAt = new Date().toISOString();
  const { dryRun, force } = parseArgs();
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

  console.log(`[${startedAt}] Calistirma basladi${dryRun ? " (DRY-RUN)" : ""}`);
  console.log(`Model: ${cfg.model}`);

  const history = loadHistory();
  const seenLinks = new Set(history.links);
  const seenTitles = new Set(history.titles);

  console.log("Haber kaynaklari taraniyor...");
  const { candidates, totalFetched, errors } = await collectNews({
    maxCandidates: cfg.maxCandidates,
  });
  for (const e of errors) console.warn(`  kaynak hatasi: ${e}`);
  console.log(`${totalFetched} haber okundu, ${candidates.length} aday secildi.`);

  const fresh = force
    ? candidates
    : candidates.filter(
        (c) => !seenLinks.has(c.link) && !seenTitles.has(normalizeTitle(c.title))
      );
  console.log(`Daha once kullanilmamis: ${fresh.length} aday.${force ? " (FORCE: gecmis yoksayildi)" : ""}`);
  if (fresh.length === 0) {
    console.log("Yeni kullanilabilir haber yok, bu tur atlandi.");
    return;
  }

  const article = await generateArticles(fresh, cfg);
  console.log(`\n=== TR: ${article.tr.title}`);
  console.log(`=== EN: ${article.en.title}\n`);

  const record = {
    startedAt,
    finishedAt: null,
    dryRun,
    model: cfg.model,
    sourceErrors: errors,
    candidates: fresh.map((c) => ({ title: c.title, source: c.source, link: c.link })),
    selected: article.selected,
    articles: { tr: article.tr, en: article.en },
    published: [],
  };

  if (dryRun) {
    console.log("--- DRY-RUN: yayin yapilmadi ---");
    console.log(`\n[TURKCE]\nBaslik: ${article.tr.title}\n\n${article.tr.body}`);
    console.log(`\n[ENGLISH]\nTitle: ${article.en.title}\n\n${article.en.body}`);
    record.finishedAt = new Date().toISOString();
    console.log(`\nLog: ${saveRunLog(record)}`);
    return;
  }

  for (const [lang, art] of [["tr", article.tr], ["en", article.en]]) {
    let body = art.body;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`${lang.toUpperCase()} makalesi yayinlaniyor...`);
        const result = await publishArticle(cfg.binanceKey, {
          title: art.title,
          body,
        });
        console.log(`  OK: ${result.url ?? result.note ?? "(id alinamadi)"}`);
        record.published.push({ lang, ...result, title: art.title });
        break;
      } catch (err) {
        if (/220094|Hashtag count/i.test(err.message) && attempt === 1) {
          console.warn(`  hashtag limiti asildi, govde temizlenip tekrar denenecek`);
          body = limitHashtags(body);
          continue;
        }
        console.error(`  HATA (${lang}): ${err.message}`);
        record.published.push({ lang, error: err.message });
        break;
      }
    }
  }

  history.links.push(...fresh.map((c) => c.link));
  history.titles.push(...fresh.map((c) => normalizeTitle(c.title)));
  saveHistory(history);

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
  console.log(`\nLog: ${saveRunLog(record)}`);
  console.log(`Ozet: ${successCount}/${record.published.length} makale yayinlandi.`);
  if (successCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error(`OLUSMAYAN HATA: ${err.stack || err.message}`);
  process.exit(1);
});
