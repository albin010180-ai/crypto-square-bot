import { chromium } from "playwright";

const TRENDS_URL = "https://www.binance.com/en/square/trends";

export async function scrapeBinanceTrends() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,  // non-headless may help with WAF
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();

    // Remove automation indicators
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    console.log("Navigating to trends page...");
    await page.goto(TRENDS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait longer for WAF challenge to resolve + SPA to render
    console.log("Waiting for page to render...");
    await page.waitForTimeout(15000);

    const title = await page.title();
    console.log("Page title:", title);

    // Take a screenshot for debugging
    await page.screenshot({ path: "tmp/trends-debug.png" }).catch(() => {});

    // Get full page HTML length
    const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
    console.log("HTML length:", htmlLen);

    // Get body text
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
    console.log("Body text preview:", bodyText.slice(0, 500));

    // Extract trending topics
    const topics = await page.evaluate(() => {
      const results = [];
      const selectors = [
        '[class*="trendItem"]',
        '[class*="trend-item"]',
        '[class*="topicItem"]',
        '[class*="topic-item"]',
        '[class*="hashtag"]',
        '[class*="hot"] a',
        '[class*="Hot"] a',
        'a[href*="/square/hashtag/"]',
        'a[href*="/square/trends/"]',
        '[data-testid*="trend"]',
        '[data-testid*="topic"]',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 100) {
            results.push(text.replace(/^#/, ""));
          }
        });
      }
      return [...new Set(results)];
    });

    // Fallback: parse body text for topic-like lines
    const allText =
      topics.length > 0
        ? topics
        : bodyText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 2 && l.length < 60 && /^[A-Z]/.test(l))
            .slice(0, 20);

    return { topics: allText, pageTitle: title, htmlLen };
  } catch (err) {
    console.error("Playwright scrape error:", err.message);
    return { topics: [], pageTitle: "", error: err.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
