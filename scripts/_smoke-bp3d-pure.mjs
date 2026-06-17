// Smoke test for bp3d-pure.html: open the page, wait for Architecture +
// payload to land, exercise the new system/level chips and inspect mesh
// visibility through the renderer's debug surface. Runs against an http
// server on http://127.0.0.1:4173. Throws (non-zero exit) on any failure.
//
// Usage: node scripts/_smoke-bp3d-pure.mjs
// Not a unit test — kept under scripts/ as a manual verification aid.
import { chromium } from "playwright";

const URL = "http://127.0.0.1:4173/bp3d-pure.html";
const TIMEOUT_MS = 90_000; // initial IFC blocking phase can take ~15s on cold cache

const errors = [];
const fail = (m) => { errors.push(m); console.error("FAIL:", m); };
const ok = (m) => console.log("OK:", m);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") fail(`console.error: ${m.text()}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

// Hook the API on window for inspection without touching the page source.
await page.addInitScript(() => {
  const origImport = window.__bp3dImport;
  void origImport;
});
// Wait until the renderer module exposes systems through the chip count.
await page.waitForFunction(() => {
  const sys = document.querySelectorAll("#systemChips .chip");
  return sys.length >= 1;
}, null, { timeout: TIMEOUT_MS });
ok("system chips rendered");

await page.waitForFunction(() => {
  const lv = document.querySelectorAll("#levelChips .chip");
  return lv.length >= 2; // "All" + at least one level
}, null, { timeout: TIMEOUT_MS });
ok("level chips rendered");

// Wait for Architecture phase to complete: status text settles to either
// "Architecture ready ..." or final "<n> meshes ..." form.
await page.waitForFunction(() => {
  const t = document.querySelector("#status")?.textContent || "";
  return /Architecture ready|drag to orbit/.test(t);
}, null, { timeout: TIMEOUT_MS });
ok("architecture phase complete");

// Inspect mesh state via the global renderer handle. We re-expose it by
// patching the module-level variable through the page-level closure: the
// pure page doesn't keep a global, so reach in through the canvas.
const meshStats = await page.evaluate(async () => {
  // Walk the scene graph from the canvas's WebGLRenderer? Not directly
  // exposed. Instead, count visible meshes by sampling DOM-side state.
  // The chips encode the systems we have; we just verify visibility toggles
  // mutate something observable: trigger a system off, then back on, and
  // ensure the renderer doesn't throw.
  return {
    levelChipCount: document.querySelectorAll("#levelChips .chip").length,
    systemChipCount: document.querySelectorAll("#systemChips .chip").length,
    activeLevel: document.querySelector("#levelChips .chip.active")?.textContent || null,
    activeSystems: Array.from(document.querySelectorAll("#systemChips .chip.active")).map((b) => b.textContent),
    statusText: document.querySelector("#status")?.textContent || ""
  };
});
console.log("meshStats:", JSON.stringify(meshStats, null, 2));
if (meshStats.levelChipCount < 2) fail("expected at least 2 level chips (All + 1)");
if (meshStats.systemChipCount < 1) fail("expected at least 1 system chip");
if (!meshStats.activeLevel) fail("no active level chip after init");

// Toggle the first system chip off, then on, and ensure no console errors fire.
// We dispatch click events directly because #status text mutates every few ms
// during the streaming phase, which makes Playwright's "stable" check time out
// even though the chip itself never moves.
async function clickChip(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, selector);
}

await clickChip("#systemChips .chip:nth-child(1)");
await page.waitForTimeout(200);
const afterOff = await page.evaluate(() =>
  document.querySelector("#systemChips .chip:nth-child(1)").classList.contains("active")
);
if (afterOff) fail("system chip 1 still active after click");
else ok("system chip toggle off");

await clickChip("#systemChips .chip:nth-child(1)");
await page.waitForTimeout(200);
const afterOn = await page.evaluate(() =>
  document.querySelector("#systemChips .chip:nth-child(1)").classList.contains("active")
);
if (!afterOn) fail("system chip 1 not active after second click");
else ok("system chip toggle round-trip");

// Click a non-"All" level chip if present.
const levelChipCount = await page.evaluate(() =>
  document.querySelectorAll("#levelChips .chip").length
);
if (levelChipCount >= 2) {
  // Capture pre-toggle visibility stats for visual-level assertion.
  const pre = await page.evaluate(() => window.__bp3dApi?.debugVisibilityStats() || null);
  if (!pre) fail("renderer api not exposed on window");
  else ok(`pre-filter: total=${pre.total} visible=${pre.visible} y=[${pre.minY.toFixed(2)}, ${pre.maxY.toFixed(2)}]`);

  await clickChip("#levelChips .chip:nth-child(2)");
  await page.waitForTimeout(250);
  const newActive = await page.evaluate(() =>
    document.querySelector("#levelChips .chip.active")?.textContent || null
  );
  if (newActive === meshStats.activeLevel) fail(`level chip click didn't change active: still ${newActive}`);
  else ok(`level chip switched to ${newActive}`);

  // Verify setLevelFilter actually hid some meshes. If everything stays
  // visible it usually means the height axis (Y vs Z) assumption is wrong.
  const post = await page.evaluate(() => window.__bp3dApi?.debugVisibilityStats() || null);
  if (!post) fail("post-filter stats unavailable");
  else {
    ok(`post-filter: total=${post.total} visible=${post.visible}`);
    if (post.total > 0 && post.visible === post.total) {
      fail(`level filter applied but no meshes hidden — height axis likely wrong (visible=${post.visible}/${post.total})`);
    }
    if (post.total > 0 && post.visible === 0) {
      fail(`level filter hid ALL meshes — range likely outside model bbox (y=[${post.minY.toFixed(2)}, ${post.maxY.toFixed(2)}])`);
    }
    if (post.visible > 0 && post.visible < post.total) {
      ok(`level filter hid ${post.total - post.visible}/${post.total} meshes — height axis is Y as assumed`);
    }
  }
}

await browser.close();

if (errors.length) {
  console.error(`\n${errors.length} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
