// Probe: diagnose per-group alignment and material state
import { chromium } from "playwright";

const URL = "http://127.0.0.1:4173/bp3d-pure.html";
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext()).newPage();

p.on("console", (m) => {
  if (m.type() === "error") console.error("PAGE-ERR:", m.text());
});

await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
console.log("Waiting for all IFCs to load...");
await p.waitForFunction(
  () => /drag to orbit/.test(document.querySelector("#status")?.textContent || ""),
  null,
  { timeout: 120000 }
);
console.log("All loaded. Probing...");

// Inject a diagnostic function that inspects scene internals
const result = await p.evaluate(() => {
  const api = window.__bp3dApi;
  if (!api) return { error: "no api" };

  // Access the Three.js scene through the renderer's internal root group.
  // debugGroupBboxes already gives us bbox info. We need material info too.
  const bboxes = api.debugGroupBboxes();

  // We can't directly access scene internals, but we CAN look at
  // mesh userData through the raycaster. Instead, let's add a quick
  // analysis function by inspecting the groups through the existing debug API.
  // Actually - let's just analyze by sampling the first few meshes in each group
  // via the already-exposed debugVisibilityStats.
  const stats = api.debugVisibilityStats();

  return { bboxes, stats };
});

console.log("\n=== PER-GROUP BOUNDING BOXES ===");
if (result.bboxes) {
  for (const g of result.bboxes) {
    console.log(`\n[${g.name}] (${g.system}) — ${g.meshCount} meshes`);
    console.log(`  center: (${g.center.x}, ${g.center.y}, ${g.center.z})`);
    console.log(`  size:   (${g.size.x}, ${g.size.y}, ${g.size.z})`);
    console.log(`  min:    (${g.min.x}, ${g.min.y}, ${g.min.z})`);
    console.log(`  max:    (${g.max.x}, ${g.max.y}, ${g.max.z})`);
  }
}

console.log("\n=== VISIBILITY STATS ===");
if (result.stats) {
  console.log(`Total: ${result.stats.total}, Visible: ${result.stats.visible}, Hidden: ${result.stats.hidden}`);
  console.log(`Y range: [${result.stats.minY?.toFixed(3)}, ${result.stats.maxY?.toFixed(3)}]`);
  for (const [sys, info] of Object.entries(result.stats.perSystem || {})) {
    console.log(`  ${sys}: total=${info.total} visible=${info.visible} groupVisible=${info.groupVisible}`);
  }
}

// Now let's check overlap: does Architecture bbox contain MEP bboxes?
console.log("\n=== ALIGNMENT CHECK ===");
if (result.bboxes && result.bboxes.length >= 2) {
  const arch = result.bboxes.find(g => g.system === "architecture");
  if (arch) {
    for (const g of result.bboxes) {
      if (g === arch) continue;
      const xOverlap = Math.max(0, Math.min(arch.max.x, g.max.x) - Math.max(arch.min.x, g.min.x));
      const yOverlap = Math.max(0, Math.min(arch.max.y, g.max.y) - Math.max(arch.min.y, g.min.y));
      const zOverlap = Math.max(0, Math.min(arch.max.z, g.max.z) - Math.max(arch.min.z, g.min.z));
      const overlapVol = xOverlap * yOverlap * zOverlap;
      const gVol = g.size.x * g.size.y * g.size.z;
      const pct = gVol > 0 ? ((overlapVol / gVol) * 100).toFixed(1) : 0;
      console.log(`  ${g.name} vs Architecture: ${pct}% contained (overlap vol=${overlapVol.toFixed(2)})`);
    }
  }
}

await b.close();
console.log("\nDone.");
