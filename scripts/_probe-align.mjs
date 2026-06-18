// Diagnose per-group (per IFC file) bounding boxes to find misalignment.
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto("http://127.0.0.1:4173/bp3d-pure.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const t = document.querySelector("#status")?.textContent || "";
  return /drag to orbit|Failed/.test(t);
}, null, { timeout: 120_000 }).catch(() => {});
await page.waitForTimeout(1000);

const result = await page.evaluate(async () => {
  const api = window.__bp3dApi;
  if (!api) return { error: "no api" };
  return api.debugGroupBboxes();
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
