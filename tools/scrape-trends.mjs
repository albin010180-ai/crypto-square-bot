#!/usr/bin/env node
// Scrape Binance Square trending topics page using Playwright
// Output: JSON array of topic strings to stdout
import { chromium } from "playwright";

const TRENDS_URL = "https://www.binance.com/en/square/trends";

async function scrape() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
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

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: {} };
    });

    // Navigate and wait for WAF challenge to resolve
    let loaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      process.stderr.write("Attempt " + attempt + "...\n");
      await page.goto(TRENDS_URL, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      // Wait for WAF JS challenge to complete and page to reload
      await page.waitForTimeout(10000);

      const title = await page.title();
      const url = page.url();
      process.stderr.write("Title: " + title + " URL: " + url + "\n");

      if (!title.includes("ERROR") && !title.includes("challenge") && !title.includes("Just a moment")) {
        loaded = true;
        break;
      }
      // WAF still blocking, retry
      await page.waitForTimeout(5000);
    }

    if (!loaded) {
      process.stderr.write("WAF blocked after retries\n");
      process.stdout.write("[]");
      return;
    }

    // Wait for SPA content to render
    await page.waitForTimeout(5000);

    // Try to find trending topic elements
    const topics = await page.evaluate(() => {
      const results = [];
      const selectors = [
        'a[href*="/square/hashtag/"]',
        'a[href*="/square/trends/"]',
        '[class*="trendItem"]',
        '[class*="trend-item"]',
        '[class*="topicItem"]',
        '[class*="topic-item"]',
        '[class*="hot"] a',
        '[class*="Hot"] a',
        '[data-testid*="trend"]',
        '[data-testid*="topic"]',
        // Binance Square specific patterns
        'a[href*="/en/feed/topic/"]',
        'a[href*="/en/feed/hashtag/"]',
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

    if (topics.length > 0) {
      process.stdout.write(JSON.stringify(topics));
      return;
    }

    // Fallback: get all links and text that look like trending topics
    const fallback = await page.evaluate(() => {
      const results = [];
      // Get all links on the page
      document.querySelectorAll("a").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const text = a.textContent?.trim();
        if (
          text &&
          text.length > 2 &&
          text.length < 80 &&
          (href.includes("hashtag") || href.includes("trend") || href.includes("topic"))
        ) {
          results.push(text.replace(/^#/, ""));
        }
      });
      // Also look for numbered list items (trending lists)
      document.querySelectorAll("li, [class*='item']").forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 60 && /^[A-Z]/.test(text)) {
          results.push(text);
        }
      });
      return [...new Set(results)].slice(0, 20);
    });

    process.stdout.write(JSON.stringify(fallback));
  } catch (err) {
    process.stderr.write("Error: " + err.message + "\n");
    process.stdout.write("[]");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

scrape();
