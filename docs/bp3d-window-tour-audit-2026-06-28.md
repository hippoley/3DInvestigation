# BP3D Window Tour Studio Audit

Date: 2026-06-28

Project page:

```text
http://127.0.0.1:8187/bp3d-pure.html
```

Latest pushed commit:

```text
f543742 Enhance BP3D tour studio and asset replacement
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
- `Restore To Editor`: restores the selected tour without forcing main binding.
- `Restore And Bind Main Tour`: restores and binds to the main `Tour` button.
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

1. Add `assets/tours/one_take_window_product_60s.json`.
2. Add explicit `Save Tour To File` / `Load Tour From File`.
3. Add a window product part inventory panel: frame, mesh, display, button, handle.
4. Add a one-click "Product Commercial Preset" that loads a strong default path.

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

## 10. Untracked Local Files

As of this audit, the following files remain local and uncommitted:

```text
ChuangshaAutoScreenAsset_20260623-202958.zip
zigbee.glb
宏宇景裕豪园1120260622145142.dxf
```

Suggested decision:

- If they are source references only, keep them out of Git.
- If they become runtime assets, move them into a documented `assets/` path and
  use Git LFS.

