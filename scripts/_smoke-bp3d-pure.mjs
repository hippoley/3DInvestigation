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

// Wait until the renderer handle is ready. The status overlay is intentionally
// minimal now and may be hidden after loading, so don't assert on exact text.
await page.waitForFunction(() => !!window.__bp3dApi, null, { timeout: TIMEOUT_MS });
ok("initial scene ready");

await page.waitForFunction(() => {
  const look = window.__bp3dApi?.debugFurnitureMaterialLooks?.();
  return look?.style === "luxury"
    && !!look.surfaces?.furniture?.hasMap
    && !!look.surfaces?.furniture?.hasNormalMap
    && !!look.surfaces?.furnitureBed?.hasMap
    && !!look.surfaces?.furnitureBed?.hasNormalMap
    && !!look.surfaces?.furnitureHard?.hasMap;
}, null, { timeout: TIMEOUT_MS });
ok("deferred luxury furniture textures loaded");

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

const furnitureLookCheck = await page.evaluate(() => {
  const api = window.__bp3dApi;
  if (!api) return { ok: false, reason: "window.__bp3dApi missing" };
  if (typeof api.debugFurnitureMaterialLooks !== "function") {
    return { ok: false, reason: "debugFurnitureMaterialLooks missing" };
  }
  return { ok: true, look: api.debugFurnitureMaterialLooks() };
});
if (!furnitureLookCheck.ok) fail(furnitureLookCheck.reason);
else {
  const furniture = furnitureLookCheck.look?.surfaces?.furniture;
  const furnitureBed = furnitureLookCheck.look?.surfaces?.furnitureBed;
  const furnitureHard = furnitureLookCheck.look?.surfaces?.furnitureHard;
  if (!furniture || !furnitureBed || !furnitureHard) fail("missing furniture look snapshot");
  else {
    if (!furniture.hasMap || !furnitureBed.hasMap || !furnitureHard.hasMap) fail("upholstery/bed/casework texture hydration did not finish");
    else ok("upholstery, bed and casework textures hydrated on initial luxury style");
    if (furniture.color === furnitureHard.color) fail("upholstery and casework colors collapsed to the same value");
    else ok("upholstery and casework keep distinct base colors");
    if (furnitureBed.color === furniture.color) fail("bed and sofa colors collapsed to the same value");
    else ok("bed and sofa keep distinct base colors");
    if ((furniture.roughness ?? 0) <= (furnitureHard.roughness ?? 0) + 0.25) {
      fail(`upholstery roughness no longer meaningfully above casework (${furniture.roughness} vs ${furnitureHard.roughness})`);
    } else ok("upholstery stays materially rougher than casework");
    if ((furnitureBed.roughness ?? 0) < (furniture.roughness ?? 0) + 0.04) {
      fail(`bed roughness no longer meaningfully above sofa (${furnitureBed.roughness} vs ${furniture.roughness})`);
    } else ok("bed stays softer/more matte than sofa");
    if ((furniture.sheen ?? 0) < 0.45) fail(`upholstery sheen too low (${furniture.sheen})`);
    else ok("upholstery keeps a visible fabric sheen response");
    if ((furnitureBed.sheen ?? 1) >= (furniture.sheen ?? 0) - 0.20) {
      fail(`bed sheen drifted too close to sofa sheen (${furnitureBed.sheen} vs ${furniture.sheen})`);
    } else ok("bed keeps a calmer sheen than sofa upholstery");
    if ((furnitureHard.clearcoat ?? 0) <= (furniture.clearcoat ?? 0) + 0.30) {
      fail(`casework clearcoat no longer meaningfully above upholstery (${furnitureHard.clearcoat} vs ${furniture.clearcoat ?? 0})`);
    } else ok("casework keeps a stronger lacquer clearcoat than upholstery");
    if (!furniture.hasNormalMap || !furnitureBed.hasNormalMap || !furnitureHard.hasNormalMap) {
      fail("upholstery/bed/casework normal maps did not hydrate");
    } else ok("upholstery, bed and casework normal maps hydrated");
    if ((furniture.mapRepeat?.[0] ?? 0) >= (furnitureBed.mapRepeat?.[0] ?? 0) - 1.0) {
      fail(`bed fabric repeat is not meaningfully finer than sofa (${furniture.mapRepeat} vs ${furnitureBed.mapRepeat})`);
    } else ok("bed fabric repeat is finer than sofa upholstery");
    if ((furnitureBed.mapRepeat?.[0] ?? 0) >= (furnitureHard.mapRepeat?.[0] ?? 0) - 1.5) {
      fail(`casework repeat is not meaningfully tighter than bed (${furnitureBed.mapRepeat} vs ${furnitureHard.mapRepeat})`);
    } else ok("casework texture repeat stays tighter than bedding");
    if ((furniture.normalScale?.[0] ?? 0) <= (furnitureBed.normalScale?.[0] ?? 0) + 0.45) {
      fail(`sofa normal scale no longer clearly above bed (${furniture.normalScale} vs ${furnitureBed.normalScale})`);
    } else ok("sofa keeps a chunkier weave normal response than bed linen");
    if ((furnitureHard.normalScale?.[0] ?? 1) >= (furnitureBed.normalScale?.[0] ?? 0) - 0.08) {
      fail(`casework normal scale is too close to bed (${furnitureHard.normalScale} vs ${furnitureBed.normalScale})`);
    } else ok("casework keeps a much flatter surface normal than bedding");
  }
}

const furnitureGeometryCheck = await page.evaluate(() => {
  const api = window.__bp3dApi;
  if (!api) return { ok: false, reason: "window.__bp3dApi missing" };
  if (typeof api.debugFurnitureGeometryStats !== "function") {
    return { ok: false, reason: "debugFurnitureGeometryStats missing" };
  }
  return { ok: true, stats: api.debugFurnitureGeometryStats() };
});
if (!furnitureGeometryCheck.ok) fail(furnitureGeometryCheck.reason);
else {
  const stats = furnitureGeometryCheck.stats;
  if ((stats.total ?? 0) <= 0) fail("expected furnishing meshes for UV smoke");
  else ok(`furniture geometry stats captured: ${stats.total}`);
  if ((stats.withUv ?? 0) !== (stats.total ?? 0)) {
    fail(`furniture UVs missing on ${stats.total - stats.withUv}/${stats.total} meshes :: ${JSON.stringify(stats.missingUvSamples || [])}`);
  } else ok("all furniture meshes expose UVs");
}

const furnitureMaterialStateCheck = await page.evaluate(() => {
  const api = window.__bp3dApi;
  if (!api) return { ok: false, reason: "window.__bp3dApi missing" };
  if (typeof api.debugFurnitureMaterialStateStats !== "function") {
    return { ok: false, reason: "debugFurnitureMaterialStateStats missing" };
  }
  return { ok: true, stats: api.debugFurnitureMaterialStateStats() };
});
if (!furnitureMaterialStateCheck.ok) fail(furnitureMaterialStateCheck.reason);
else {
  const stats = furnitureMaterialStateCheck.stats;
  if ((stats.total ?? 0) <= 0) fail("expected furnishing meshes for transparency smoke");
  else ok(`furniture material state captured: ${stats.total}`);
  ok(`furniture side stats: front=${stats.bySide?.front ?? 0} back=${stats.bySide?.back ?? 0} double=${stats.bySide?.double ?? 0} mirrored=${stats.negativeDeterminant ?? 0}`);
  if ((stats.transparent ?? 0) !== 0 || (stats.lowOpacity ?? 0) !== 0) {
    fail(`furniture meshes became translucent (${stats.transparent} transparent / ${stats.lowOpacity} low-opacity) :: ${JSON.stringify(stats.failingSamples || [])}`);
  } else ok("all furniture meshes remain fully opaque");
}

const styleBucketCheck = await page.evaluate(() => {
  const api = window.__bp3dApi;
  if (!api) return { ok: false, reason: "window.__bp3dApi missing" };
  if (typeof api.debugFurnitureMaterialAssignments !== "function") {
    return { ok: false, reason: "debugFurnitureMaterialAssignments missing" };
  }
  const before = api.debugFurnitureMaterialAssignments();
  api.setStyle("volcanic", { loadTextures: false });
  const after = api.debugFurnitureMaterialAssignments();
  api.setStyle("luxury", { loadTextures: false });
  const restored = api.debugFurnitureMaterialAssignments();
  return { ok: true, before, after, restored };
});
if (!styleBucketCheck.ok) fail(styleBucketCheck.reason);
else {
  const { before, after, restored } = styleBucketCheck;
  if (before.totalFurniture <= 0) fail("expected furnishing meshes for style bucket smoke");
  else ok(`furniture meshes detected: ${before.totalFurniture}`);
  const sofaSamples = before.byExpected.furniture?.samples || [];
  const bedSamples = before.byExpected.furnitureBed?.samples || [];
  const hardSamples = [
    ...(before.byExpected.furnitureHard?.samples || []),
    ...(before.byExpected.furnitureDarkWood?.samples || [])
  ];
  const sofaText = sofaSamples.join(" ").toLowerCase();
  const bedText = bedSamples.join(" ").toLowerCase();
  const hardText = hardSamples.join(" ").toLowerCase();
  if (!sofaText.includes("sofa")) fail("expected sofa sample in upholstered furniture bucket");
  else ok("sofa samples classified into upholstered furniture bucket");
  if (!bedText.includes("bed")) fail("expected bed sample in bed/bedding bucket");
  else ok("bed samples classified into bed/bedding bucket");
  if (!hardText.includes("cabinet")) fail("expected cabinet sample in cabinet/casework bucket");
  else ok("cabinet samples classified into cabinet/casework bucket");
  if (sofaText.includes("cabinet")) fail("cabinet sample leaked into upholstered furniture bucket");
  else ok("cabinet samples stay out of upholstered furniture bucket");
  if (sofaText.includes("bed") || bedText.includes("sofa")) fail("bed/sofa samples crossed buckets");
  else ok("bed and sofa samples stay in separate buckets");
  if (before.mismatched !== 0) fail(`initial furniture material mismatch count = ${before.mismatched}`);
  else ok("initial furniture material buckets match expected classification");
  if (after.mismatched !== 0) fail(`style switch remapped ${after.mismatched} furniture meshes to wrong material buckets`);
  else ok("style switch preserved furniture material buckets");
  if (restored.mismatched !== 0) fail(`style round-trip left ${restored.mismatched} furniture meshes mismatched`);
  else ok("style round-trip preserved furniture material buckets");
}

const infoCardCheck = await page.evaluate(() => {
  if (typeof window.__bp3dRenderInfoCard !== "function") {
    return { ok: false, reason: "window.__bp3dRenderInfoCard missing" };
  }
  window.__bp3dRenderInfoCard({
    ifcType: 263784265,
    expressID: 168377,
    system: "architecture",
    furnitureMaterialKey: "furnitureDarkWood",
    furnitureName: "M_Dining Table:Walnut",
    furnitureObjectType: "Walnut",
    furnitureTag: "168377",
    position: { x: 1.23, y: 4.56, z: 7.89 }
  });
  const card = document.querySelector("#infocard");
  const text = card?.textContent || "";
  const display = card ? getComputedStyle(card).display : "none";
  window.__bp3dRenderInfoCard(null);
  const hiddenDisplay = card ? getComputedStyle(card).display : "none";
  return { ok: true, text, display, hiddenDisplay };
});
if (!infoCardCheck.ok) fail(infoCardCheck.reason);
else {
  if (infoCardCheck.display === "none") fail("info card stayed hidden after mock furniture selection");
  else ok("info card rendered for mock furniture selection");
  if (!infoCardCheck.text.includes("Dark Wood")) fail("info card missing furniture surface label");
  else ok("info card shows furniture surface label");
  if (!infoCardCheck.text.includes("M_Dining Table:Walnut")) fail("info card missing furniture name");
  else ok("info card shows furniture name");
  if (infoCardCheck.hiddenDisplay !== "none") fail("info card did not hide after clearing selection");
  else ok("info card clears on null selection");
}

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
