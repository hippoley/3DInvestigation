# BP3D Window Tour Studio Audit

Date: 2026-06-28

Project page:

```text
http://127.0.0.1:8187/bp3d-pure.html
```

Audit baseline before this follow-up:

```text
86c3bba Add local tour JSON import
```

## 1. Executive Summary

This work turned `bp3d-pure.html` from a visual IFC renderer into a product-demo
workspace for the replaced window screen product.

The main deliverables are:

- semantic furniture replacement from `jiaju1.glb`
- semantic replacement of two IFC windows, W21 Tag `181930` and W22 Tag `182101`,
  using `chuangsha.glb`
- a Tour Studio for one-take camera-path editing
- persistent saved-tour recovery and binding to the main `Tour` button
- visual comfort improvements for white/bright interiors
- a product-focused window tour flow with playback diagnostics
- simple recovery tools so old tours do not disappear from the UI

The current direction is correct for product demonstration, but the long-term
solution should separate three concerns:

- scene/runtime renderer
- editable camera-path/timeline studio
- asset inventory and semantic replacement registry

## 2. Current User-Facing Features

### 2.1 Main Page Controls

`bp3d-pure.html` now exposes the main tour controls in a fixed top-right strip:

- `Tour`: plays the currently bound tour, or falls back to the default window
  product tour.
- `Edit`: opens Tour Studio.
- `Stop`: stops the running tour.

The previous problem was that the tour button could be hidden inside the general
controls panel. It is now visible independently.

### 2.2 Tour Studio

Tour Studio is an embedded path editor for camera and target rails.

It includes:

- shot cards
- camera rail nodes
- target rail nodes
- timeline slider
- per-shot purpose / focus / framing / movement fields
- FOV controls
- capture-current-view
- zoom in / zoom out
- preview-at-time
- saved tour recovery
- main-tour binding state
- playback diagnostics
- smooth timing cleanup

The mental model is:

```text
blue points = camera positions
yellow points = look-at targets
shot cards = one-take beats
main Tour = the version bound to the top-right Tour button
```

### 2.3 Main Tour Status

The "Main Tour Status" card explains what the top-right `Tour` button will play:

- `Default`: product default tour will play.
- `Recoverable`: an old saved tour exists and can be restored.
- `Bound`: the current editor tour is bound to the main button.

Buttons:

- `Play Main Tour`: same code path as top-right `Tour`.
- `Set Current Edit As Main Tour`: binds current editor state.
- `Smooth Timing`: retimes shots to reduce speed jumps.
- `Preflight Check`: reports score, duration, lock count, warnings.

### 2.4 Saved Tours

Saved tours are stored in `localStorage` under keys starting with:

```text
bp3d-pure:tour-editor:
```

The current key is:

```text
bp3d-pure:tour-editor:v8:one-take-window-product
```

Legacy keys are scanned and listed in the `Saved Tours` card.

Recovery actions:

- `Recover Old Tour`: chooses the best legacy/current saved tour and binds it.
- `Save Current Snapshot`: saves the current editor tour into a timestamped
  browser snapshot key so a good version is not overwritten by later edits.
- Auto snapshot before overwrite: if the current tour has unsaved edits, Tour
  Studio automatically creates a browser snapshot before loading a project tour,
  importing JSON, restoring history, loading a preset, or clearing the editor.
- `Delete Selected Snapshot`: removes only user-created snapshot keys; it refuses
  to delete the current autosave key or legacy keys.
- `Prune Old Snapshots`: keeps the newest 12 snapshots and removes older ones so
  browser localStorage does not grow forever.
- `Restore To Editor`: restores the selected tour without forcing main binding.
- `Restore And Bind Main Tour`: restores and binds to the main `Tour` button.
- `Download Selected JSON`: exports any selected current, snapshot, or legacy tour
  as a portable `bp3d-tour/v1` JSON file.
- `Refresh`: reloads the saved-tour list from localStorage.

This addresses the issue where previously saved tours appeared to be lost after
the editor schema/key changed.

### 2.5 Smooth Timing

The smooth timing tool retimes a tour using the spatial distance between camera
nodes. It tries to reduce speed jumps by:

- computing distance between adjacent camera positions
- estimating a global target motion speed
- assigning duration per segment
- limiting large speed jumps from segment to segment
- placing detail emphasis into `hold`, not only into slow travel

In validation, a rough 3-shot test path improved from:

```text
speed jump 0.18x
```

to:

```text
score 100
locked 3/3
0 warnings
```

### 2.6 Preflight Check

The preflight check calls renderer diagnostics and reports:

- shot count
- duration
- average score
- subject-lock count
- warning count
- top issues

It prevents only hard error playback for bound custom tours. Warnings remain
playable so the user can still preview imperfect motion.

### 2.7 Project Tour File

Tour Studio now has a project-file path for tours in addition to browser
localStorage.

Default project tour:

```text
assets/tours/one_take_window_product_60s.json
```

UI actions:

- `Load Project Default Tour`: loads the JSON file, writes it into the editor,
  and binds it to the main `Tour` button.
- `Import Local Tour JSON`: opens a local file picker and imports any compatible
  tour JSON file into the editor.
- `Download Current Tour JSON`: exports the current editor tour as a JSON file
  so it can be committed into `assets/tours/`.

This is the first step toward making tours portable across browser profiles,
machines, and meetings.

### 2.8 Tour Source Status

The `Project Tour File` card now also shows where the current editor tour came
from, whether it has been edited, and whether the top-right `Tour` button is
bound to it.

Status badges:

- `PROJECT FILE`: loaded from `assets/tours/one_take_window_product_60s.json`.
- `LOCAL FILE`: imported through the local JSON file picker.
- `JSON TEXT`: imported from the advanced JSON text area.
- `BROWSER SAVE`: restored from the current browser localStorage key.
- `OLD SAVE`: restored from a legacy browser localStorage key.
- `SNAPSHOT`: restored from a user-created browser snapshot.
- `GENERATED`: regenerated from the renderer's built-in product-tour builder.
- `PRESET`: loaded from the built-in interior preset.
- `EMPTY`: the editor has no waypoints.

Extra state labels:

- `EDITED`: the user has moved nodes, changed shot cards, retimed, zoomed, or
  otherwise modified the loaded tour after import.
- `BOUND TO TOUR BUTTON`: the top-right `Tour` button will play the current
  editor version.
- `NOT BOUND`: the editor version exists, but the main `Tour` button may still
  play another source or the default product tour.

The card also gives a plain-language next step. For example, after importing or
editing a tour it tells the user to save the current edit to the top-right
`Tour` button; after a bound edit it reminds the user to download the JSON if
the version should be kept as a project artifact.

The browser console helper also exposes:

```js
window.__bp3dPureTourEditor.source()
```

This returns the current tour metadata for debugging provenance during meetings.

## 3. Asset Replacement Work

### 3.1 Furniture Replacement

Local asset:

```text
jiaju1.glb
```

Recognized semantic nodes:

| Category | Nodes |
|---|---|
| sofa | `shafa1`, `shafa2`, `shafa3` |
| bed | `chuang1`, `chuang2` |
| chair | `yizi1` |
| table | `zhuo1` |

Runtime function:

```js
replaceSemanticFurnitureFromGlb("./jiaju1.glb")
```

Behavior:

- finds IFC furniture semantics for sofa / bed / chair / table
- groups multi-mesh semantic furniture parts
- hides original IFC furniture
- clones the matching GLB asset
- positions it by original world bounding box
- centers and grounds the replacement
- scales to fit original footprint
- follows level/system filtering

Important user-driven refinements:

- beds should orient with pillow/head side toward the wall
- small-room bed can be slightly larger
- bed head transparent rack/accessory should be removed/hidden
- sofas should use softer plush/fabric material feel
- bright white furniture needs visible surface separation without outline strokes

### 3.2 Window Screen Replacement

Local asset:

```text
chuangsha.glb
```

Target IFC windows:

| Window | Tag | Level | Size |
|---|---:|---|---|
| W21 | `181930` | Level 2 | 750mm x 2200mm |
| W22 | `182101` | Level 2 | 750mm x 2200mm |

Runtime function:

```js
replaceWindowsByTagsFromGlb("./chuangsha.glb", ["181930", "182101"])
```

Intent:

- perfect original-position replacement
- keep IFC room context
- product-demo tour focuses on the new screen window
- window mesh should sit inside the metal rails/bars
- bottom display and button area must be visible and treated as important product
  detail

Important user-driven refinements:

- titanium/metal material must remain visible
- the bottom screen should stay black, not magenta/purple
- screen mesh should be embedded in the metal bar frame
- tour must not accidentally focus on the door or random walls
- tour must include top, bottom, left, right, close, far, overhead, and low-up
  views

## 4. File Purpose Map

### 4.1 Root HTML Pages

| File | Purpose |
|---|---|
| `bp3d-pure.html` | Primary current workspace. Real Three.js/BP3D renderer test page, style controls, furniture/window replacement controls, Tour Studio UI. |
| `blueprint3d-duplex.html` | Earlier advanced renderer / XKT + PBR workflow page. Keep as reference, not the active product-tour page. |
| `duplex-simulation.html` | BIM-style simulation viewer documented in `docs/duplex-simulation-viewer.md`. |
| `index.html` | General project entry/demo page. |
| `style-demo.html` | Visual/material style demo page. |

### 4.2 Main Runtime Scripts

| File | Purpose |
|---|---|
| `scripts/bp3d-real-renderer.js` | Core Three.js renderer and scene runtime. Loads IFC, manages materials, semantic windows/furniture, product tours, Tour Studio overlay, diagnostics, camera playback. |
| `scripts/bp3d-camera-tour.js` | Camera tour definitions and helper route logic. Useful for predefined paths and historical tour logic. |
| `scripts/bp3d-materials.js` | Material presets and style mappings. Includes tone, PBR-like material decisions, and visual separation strategy. |
| `scripts/bp3d-material-factory.js` | Material creation utilities and generated material variants. |
| `scripts/bp3d-light-factory.js` | Lighting presets and light setup utilities. |
| `scripts/bp3d-color-grading.js` | Exposure, bloom, tone/color controls for the renderer. |
| `scripts/bp3d-ifc-worker.js` | IFC parsing worker support. Keeps heavy IFC work away from the UI thread where possible. |

### 4.3 Local Product/Scene Assets

| File | Purpose | Git status |
|---|---|---|
| `chuangsha.glb` | New window screen product asset used by W21/W22 replacement. | committed in `f543742` |
| `jiaju1.glb` | Furniture asset library for sofa/bed/chair/table semantic replacement. | committed in `f543742` |
| `zigbee.glb` | Currently unreferenced in active code. Possible future smart-home/IoT product asset. | untracked |
| `ChuangshaAutoScreenAsset_20260623-202958.zip` | Source/archive for screen asset. Not needed by runtime. | untracked |
| `宏宇景裕豪园1120260622145142.dxf` | Local CAD/DXF reference file. Not used by current BP3D runtime. | untracked |

Recommendation:

- Keep runtime-required GLB files committed or move to Git LFS later.
- Keep source zips / DXF out of normal commits unless there is a documented data
  requirement.

### 4.4 Documentation

| File | Purpose |
|---|---|
| `docs/BP3D_REAL_RENDERER_SOP.md` | Historical implementation plan and renderer architecture notes. |
| `docs/BP3D-RENDERING-SOP.md` | Current/older BP3D rendering SOP. |
| `docs/duplex-restoration-audit.md` | Audit of the duplex sample as a restoration data source. |
| `docs/duplex-simulation-viewer.md` | Simulation viewer operating notes. |
| `docs/bp3d-window-tour-audit-2026-06-28.md` | This document; meeting audit for the window-product Tour Studio work. |

### 4.5 Tour Files

| File | Purpose |
|---|---|
| `assets/tours/one_take_window_product_60s.json` | Version-controlled default product-tour path for the replaced window screen. Can be loaded from Tour Studio. |

## 5. Tour Design Lessons Learned

The user repeatedly rejected tours that:

- pointed at the door instead of the product
- looked at random wall boundaries
- flew outside the room
- cut too sharply
- lacked close/detail views
- ignored the bottom display/button
- lacked top/bottom/left/right movement
- felt like a simple front-on camera push

The desired tour style is closer to a product commercial:

- one continuous take
- product locked as the subject
- elegant arc/orbit, not a straight-on stare
- close and far views
- top and bottom structural views
- low-up view from the bottom controls
- overhead/God-view transition used sparingly
- window opening/closing motion demo around the middle
- no wall clipping
- no exterior drift unless intentionally passing through an open window gap

## 6. Current Technical Risks

### 6.1 Tour Studio State Is Still localStorage-Based

Saved tours are stored in browser localStorage. This is convenient, but fragile:

- browser profile changes can hide old tours
- schema/version key changes require migration
- saved tours are not shared across machines
- Git commit does not include user-edited tours

Recommended next step:

```text
Export selected Tour Studio state to docs/tours/*.json or assets/tours/*.json
```

### 6.2 Large Binary Assets

`jiaju1.glb` is about 44.9MB.

GitHub accepted the push, but future assets should probably use Git LFS.

GitHub also warned about an existing large file:

```text
assets/hdri/glasshouse_interior_4k.exr
```

### 6.3 Renderer File Is Too Large

`scripts/bp3d-real-renderer.js` now contains many responsibilities:

- renderer
- IFC processing
- semantic extraction
- materials
- replacements
- tours
- Tour Studio overlay
- diagnostics

This is workable for iteration, but risky for long-term maintenance.

Recommended split:

| Proposed file | Responsibility |
|---|---|
| `scripts/bp3d-real-renderer.js` | renderer orchestration only |
| `scripts/bp3d-window-replacement.js` | window inventory and replacement |
| `scripts/bp3d-furniture-replacement.js` | furniture semantic replacement |
| `scripts/bp3d-tour-studio.js` | overlay, drag nodes, diagnostics bridge |
| `scripts/bp3d-product-tour-presets.js` | predefined commercial tours |

## 7. Validation Record

Validated during recent work:

- ESM/module parse of `bp3d-pure.html` script content
- `scripts/bp3d-real-renderer.js` syntax check
- local HTTP page availability at `127.0.0.1:8187`
- Tour Studio saved-tour restore with simulated legacy key
- main `Tour` button binding to `tour-editor-bound`
- main Tour Status card default state
- main Tour Status card bound state
- smooth timing improvement on a rough 3-shot test path
- preflight check returning score / lock / warning summary

Known limitation:

- full visual headless walkthrough can time out because the IFC scene and product
  replacements are heavy.

## 8. Meeting Talking Points

### What We Have Now

- A browser-based 3D product demo environment using a real BIM apartment context.
- Two selected BIM windows replaced by a custom screen-window GLB.
- Furniture replacement from a semantic asset library.
- A built-in Tour Studio for designing and saving product-camera movement.
- A recovery mechanism for old saved tours.
- A preflight scoring mechanism to detect weak camera paths.

### Why It Matters

This is no longer just "show a 3D model." It is moving toward:

```text
BIM context + semantic product placement + editable commercial camera language
```

That is useful for:

- cross-border product demos
- interior product installation previews
- client review meetings
- interactive showroom prototypes
- product-tour generation workflows

### What Still Needs Investment

- formal tour export/import files
- better asset registry
- Git LFS for larger GLB/HDR/DXF assets
- renderer modularization
- higher quality material authoring
- product animation controls for opening/closing
- non-technical Tour Studio UX polish

## 9. Recommended Next Steps

### Short Term

1. Add a window product part inventory panel: frame, mesh, display, button, handle.
2. Add a one-click "Product Commercial Preset" that can regenerate a strong
   default path from the current product placement.
3. Add a lightweight tour version label in the UI.
4. Add project-level named takes, e.g. `hero`, `technical`, `short-demo`.

### Medium Term

1. Split `bp3d-real-renderer.js` into smaller modules.
2. Move GLB metadata into `assets/product-registry.json`.
3. Put large binaries under Git LFS.
4. Add Playwright visual regression snapshots for:
   - replaced window visible
   - black display stays black
   - Tour Studio opens
   - main tour bound playback starts

### Long Term

1. Build a dedicated camera path editor mode with:
   - bezier/dual-rail editing
   - timeline keyframes
   - curve tension controls
   - saved named takes
2. Add product animation tracks:
   - screen open
   - close
   - button press
   - display light
3. Add meeting/export deliverables:
   - MP4 recording
   - storyboard PDF
   - tour JSON
   - product part map

## 10. Hybrid Window Placement Update

User request:

```text
Use the window from WebViewer/hybrid-window.html in the current BP3D scene and
replace suitable old windows, for example the first-floor single windows.
```

Findings:

- `hybrid-window.html` uses the same primary runtime asset family as the current
  BP3D replacement pipeline: `chuangsha.glb`.
- The hybrid page also contains extra generated/product hardware logic, including
  screen/detail overlays and external control assets. Those should be ported as a
  second pass if the exact hybrid-page model needs to be reproduced 1:1.
- The current stable replacement route is to reuse the BP3D semantic window tag
  replacement pipeline and fit the Chuangsha window into the IFC window bounding
  box.

Implemented:

- Added `Find L1 Single Windows` / `Replace L1 Single Windows` UI buttons in
  `bp3d-pure.html`.
- Added first-floor single-window candidate detection using:
  - `levelHint === "L1"`
  - tagged IFC windows only
  - narrow single-window width
  - normal door-height window height
- Updated the renderer so window replacement can run in append mode. This lets
  the first-floor single windows be replaced without clearing the existing W21/W22
  product-tour replacements.
- Wired the page boot flow so W21/W22 product windows replace first, then L1
  single-window replacement runs in append mode immediately after that task.

Verified first-floor single-window targets:

```text
W04 / Tag 146885 / ExpressID 6921 / Level L1 / 750mm x 2200mm
W01 / Tag 147051 / ExpressID 7025 / Level L1 / 750mm x 2200mm
```

Replacement verification:

```text
source: ./chuangsha.glb
append: true
requestedTags: 146885, 147051
replaced: 2 / 2
skipped: 0
```

Important note:

- The IFC metadata stores `overallWidth` and `overallHeight` in meters in this
  project (`0.75 x 2.2`), despite the object name reading `750mm x 2200mm`.
  The candidate filter now accepts this meter-based data and still supports
  millimeter-like values if they appear later.
- Manual UI verification succeeded through the real page buttons:
  `Find L1 Single Windows` returned the two tags above, and
  `Replace L1 Single Windows` returned `replaced: 2 / 2`.
- Full automatic boot verification in headless mode remained unstable because
  the local IFC/page load repeatedly exceeded the validation timeout. The
  automatic hook is implemented in code, but this audit should keep the timeout
  caveat visible rather than treating the headless run as completed.

Follow-up issue:

```text
The first-floor product should be an integrated push-out window with a screen,
but the previous BP3D replacement looked like screen-only.
```

Cause:

- The BP3D replacement pipeline was using `chuangsha.glb`, which represents the
  indoor screen-machine body.
- `hybrid-window.html` adds the push-out glass sash, hinges, handle, weather
  lips, and bottom chain-opener as generated Three.js geometry around that GLB.
- Those generated hybrid parts had not yet been ported into the BP3D replacement
  group, so the placed product read visually as "screen only."

Fix:

- `scripts/bp3d-real-renderer.js` now generates an integrated hybrid assembly
  inside every Chuangsha window replacement:
  - fixed titanium reveal frame
  - outward push-out glass sash
  - recessed glass panel
  - left hinge leaves/barrels
  - right free-edge raised push handle
  - bottom chain-opener housing and linkage
- Replacement result samples now include `hybridPushWindow` metadata with
  `hasPushSash`, `hasScreen`, `hasHandle`, and `hasBottomChainOpener`.
- `bp3d-pure.html` renderer cache-bust was updated so the browser does not keep
  the older screen-only renderer module.

Follow-up fix on 2026-06-29:

- Fixed a stacked-window bug where level filtering could revive old IFC window
  meshes hidden by replacement. The no-bounding-box branch now still respects
  `_windowReplacementHidden`.
- Window replacement target collection now includes all meshes sharing the same
  IFC `expressID`, not only tagged fragments found in the first pass.
- Added `debugWindowReplacementState(tags)` and page dataset
  `l1SingleWindowDebugState` to verify replacement count and old IFC visibility.
  For the L1 single windows, verification returned:

```text
Tag 146885: replacementGroups 1, originalMeshes 4, visibleOriginalMeshes 0
Tag 147051: replacementGroups 1, originalMeshes 4, visibleOriginalMeshes 0
```

- Added hybrid-only visual mode. It hides the original GLB backing/frame part
  that made the product read like two windows stacked together, while preserving
  the screen, pull bar, display, button, and black label product parts.

Second follow-up on 2026-06-29:

- Tightened hybrid-only mode so the replacement now displays only one generated
  hybrid single-window assembly. The original `chuangsha.glb` visual parts are
  hidden completely, rather than partially preserved.
- The generated hybrid assembly now creates its own integrated screen mesh,
  screen retainers, black bottom display, satin control button, push sash, handle,
  hinges, and bottom chain-opener. It no longer needs a second visible GLB window
  underneath it.
- Verification for L1 targets:

```text
Tag 146885: replacementGroups 1, visibleOriginalMeshes 0, hiddenOriginalParts 6
Tag 147051: replacementGroups 1, visibleOriginalMeshes 0, hiddenOriginalParts 6
hybridPushWindow.hybridOnly: true
```

Third follow-up on 2026-06-29:

- Corrected installation orientation using explicit window-normal modeling.
  The thin axis of the window target is treated as the normal axis; the side
  pointing toward the scene center is the interior side, and the opposite side is
  exterior.
- The hybrid-only assembly now places:
  - integrated screen mesh on the interior side
  - black display and satin control button on the interior side
  - push-out sash, exterior glass face, and hinges on the exterior side
- Verified metadata for both L1 single windows:

```text
Tag 146885: normalAxis x, interiorSign -1, exteriorSign 1
Tag 147051: normalAxis x, interiorSign 1, exteriorSign -1
screenSide interior, controlsSide interior, pushSashSide exterior
```

Fourth follow-up on 2026-06-29:

- Root cause of the "hybrid window fell apart" look: BP3D treated
  `hybrid-window.html` as a set of generated pieces instead of a single product
  assembly. The earlier hybrid-only mode hid the original `chuangsha.glb` body,
  so only procedural frame/sash parts remained visible.
- Corrected policy: old IFC windows are still hidden, but the source product
  body from `chuangsha.glb` is preserved. BP3D no longer generates a second
  interior screen, display, or button on top of it.
- The generated outward sash/frame is now aligned from the preserved product
  body's local bounding box, not directly from the old IFC opening. This keeps
  the indoor screen-machine body and outdoor push sash in one shared product
  coordinate system.
- Fit behavior now keeps the product as one root assembly while matching the
  original window opening width, height, and depth by default. A separate
  `preserveProductAspect: true` option remains available for product-preview
  shots, but architectural replacement uses opening-size fidelity.
- Kept `zigbee0625.fbx` as a local source/reference file for the bottom chain
  mechanism; it is not directly loaded by the current BP3D runtime.
- Exported `hybrid-window.html` as `hybrid-window-assembly.glb` and switched
  BP3D window replacement to prefer this complete assembly by default. This
  makes the L1 single-window replacement an exported product-root fit instead
  of a BP3D-side approximation.
- The exported source page's own geometry audit passed before export.

## 11. Untracked Local Files

As of this audit, the following files remain local and uncommitted:

```text
ChuangshaAutoScreenAsset_20260623-202958.zip
zigbee.glb
zigbee0625.fbx
宏宇景裕豪园1120260622145142.dxf
```

Suggested decision:

- If they are source references only, keep them out of Git.
- If they become runtime assets, move them into a documented `assets/` path and
  use Git LFS.
