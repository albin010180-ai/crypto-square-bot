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
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
    });
    const page = await ctx.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    await page.goto(TRENDS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for WAF challenge + SPA render
    await page.waitForTimeout(12000);

    const title = await page.title();
    if (title.includes("ERROR") || title.includes("challenge")) {
      process.stderr.write("WAF blocked: " + title + "\n");
      process.stdout.write("[]");
      return;
    }

    // Extract trending topics
    const topics = await page.evaluate(() => {
      const results = [];
      const selectors = [
        'a[href*="/square/hashtag/"]',
        'a[href*="/square/trends/"]',
        '[class*="trendItem"]',
        '[class*="trend-item"]',
        '[class*="topicItem"]',
        '[class*="topic-item"]',
        '[class*="hashtag"]',
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

    if (topics.length === 0) {
      // Fallback: parse body text
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      const fallback = bodyText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 2 && l.length < 60 && /^[A-Z]/.test(l))
        .slice(0, 20);
      process.stdout.write(JSON.stringify(fallback));
    } else {
      process.stdout.write(JSON.stringify(topics));
    }
  } catch (err) {
    process.stderr.write("Error: " + err.message + "\n");
    process.stdout.write("[]");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

scrape();
