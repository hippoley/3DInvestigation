/**
 * bp3d-material-factory.js
 * Four interior style presets for the ArchViz renderer.
 *
 * Presets: japandi | luxury | volcanic | smart
 *
 * Each preset contains per-surface parameter overrides. The factory reads
 * the base materials from bp3d-materials.js and *clones* them before applying
 * the preset, so switching styles never permanently mutates the originals.
 *
 * Usage:
 *   import { MaterialFactory } from './bp3d-material-factory.js';
 *   const factory = new MaterialFactory(scene);
 *   const mats = factory.apply('japandi');   // returns the patched materials map
 *   factory.apply('luxury');                 // hot-swap to another style
 */

import * as THREE from 'three';
import { makePbrMaterials, pickMaterial } from './bp3d-materials.js';

// ---------------------------------------------------------------------------
// Preset definitions
// Each key maps to an object of { surfaceName: { ...Three.js material params } }
// Only the listed params are overwritten; everything else stays as defined in
// bp3d-materials.js so the PBR texture set is preserved.
// ---------------------------------------------------------------------------

const PRESETS = {

  /** Japandi — warm cream + pale ash wood + warm plaster, muted saturation */
  japandi: {
    wall:               { color: 0xf5f0e8, roughness: 0.90, envMapIntensity: 0.45 },
    floor:              { color: 0xe8dfc8, roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.55 },
    ceiling:            { color: 0xfaf8f4, roughness: 0.94 },
    door:               { color: 0xc8b898, roughness: 0.50, clearcoat: 0.10 },
    furniture:          { color: 0xc6b9a9, roughness: 0.90, sheen: 0.46, sheenColor: 0xe2d5c7, sheenRoughness: 0.90, specularIntensity: 0.18, envMapIntensity: 0.15 },
    furnitureBed:       { color: 0xf2ebdf, roughness: 0.985, sheen: 0.05, sheenColor: 0xfffcf7, sheenRoughness: 0.99, specularIntensity: 0.10, envMapIntensity: 0.05 },
    furnitureHard:      { color: 0xf3ede3, roughness: 0.34, clearcoat: 0.42, clearcoatRoughness: 0.28, specularIntensity: 0.28, envMapIntensity: 0.62 },
    furnitureTop:       { color: 0xe8e2d8, roughness: 0.12, clearcoat: 0.82 },
    furnitureDarkWood:  { color: 0x2e221a, roughness: 0.52, clearcoat: 0.08 },
    furnitureLightWood: { color: 0xd4b888, roughness: 0.62, clearcoat: 0.06 },
    furnitureMetal:     { color: 0x1e2018, roughness: 0.35, metalness: 0.90, envMapIntensity: 0.9 },
    stair:              { color: 0xc0b090, roughness: 0.58, clearcoat: 0.14 },
    railing:            { color: 0x2a2a22, roughness: 0.38, metalness: 0.88 },
    sanitary:           { color: 0xf8f8f4, clearcoat: 0.80, roughness: 0.08 },
    light:              { emissive: 0xffecb0, emissiveIntensity: 2.0 },
    smokedGlass:        { color: 0x6a7875, transmission: 0.65, roughness: 0.04 },
    showerGlass:        { color: 0xeef4f2, roughness: 0.44 },
  },

  /** Modern Luxury — off-white + champagne metal + dark walnut + high gloss */
  luxury: {
    wall:               { color: 0xf0ede8, roughness: 0.84, envMapIntensity: 0.65 },
    floor:              { color: 0xf2eadf, roughness: 0.74, clearcoat: 0.035, clearcoatRoughness: 0.92, envMapIntensity: 0.42 },
    ceiling:            { color: 0xfafaf8, roughness: 0.90 },
    door:               { color: 0x5a4535, roughness: 0.32, clearcoat: 0.38, envMapIntensity: 0.9 },
    furniture:          { color: 0xb5a694, roughness: 0.90, sheen: 0.56, sheenColor: 0xdccfc3, sheenRoughness: 0.88, specularIntensity: 0.20, envMapIntensity: 0.14 },
    furnitureBed:       { color: 0xf7f1e9, roughness: 0.985, sheen: 0.05, sheenColor: 0xffffff, sheenRoughness: 0.99, specularIntensity: 0.12, envMapIntensity: 0.05 },
    furnitureHard:      { color: 0xf7f1e8, roughness: 0.20, clearcoat: 0.78, clearcoatRoughness: 0.16, specularIntensity: 0.38, envMapIntensity: 0.92 },
    furnitureTop:       { color: 0xeae4dc, roughness: 0.05, clearcoat: 0.95, clearcoatRoughness: 0.02, envMapIntensity: 1.4 },
    furnitureDarkWood:  { color: 0x2a1e14, roughness: 0.38, clearcoat: 0.22, envMapIntensity: 0.7 },
    furnitureLightWood: { color: 0xc8a070, roughness: 0.52, clearcoat: 0.12, envMapIntensity: 0.6 },
    furnitureMetal:     { color: 0xc0a840, roughness: 0.18, metalness: 0.96, envMapIntensity: 1.6 }, // champagne gold
    stair:              { color: 0x4a3828, roughness: 0.38, clearcoat: 0.32, envMapIntensity: 0.8 },
    railing:            { color: 0xc8b888, roughness: 0.20, metalness: 0.96, envMapIntensity: 1.5 },
    sanitary:           { color: 0xffffff, clearcoat: 0.92, clearcoatRoughness: 0.04, roughness: 0.06 },
    light:              { emissive: 0xffe8a0, emissiveIntensity: 2.8 },
    smokedGlass:        { color: 0x303430, transmission: 0.50, roughness: 0.03 },
    showerGlass:        { color: 0xf0f6f8, roughness: 0.32 },
  },

  /** Volcanic Dark — dark volcanic stone + smoked wood + matte black metal */
  volcanic: {
    wall:               { color: 0x3a3530, roughness: 0.82, envMapIntensity: 0.50 },
    floor:              { color: 0x2a2420, roughness: 0.60, clearcoat: 0.22, clearcoatRoughness: 0.55, envMapIntensity: 0.8 },
    ceiling:            { color: 0x2e2a26, roughness: 0.90 },
    door:               { color: 0x1e1a16, roughness: 0.40, clearcoat: 0.15, envMapIntensity: 0.6 },
    furniture:          { color: 0x5c5349, roughness: 0.88, sheen: 0.18, sheenColor: 0x7a6f63, sheenRoughness: 0.92, specularIntensity: 0.14, envMapIntensity: 0.15 },
    furnitureBed:       { color: 0xccc2b6, roughness: 0.985, sheen: 0.03, sheenColor: 0xe7ddd1, sheenRoughness: 0.99, specularIntensity: 0.09, envMapIntensity: 0.04 },
    furnitureHard:      { color: 0x26201b, roughness: 0.22, clearcoat: 0.54, clearcoatRoughness: 0.18, specularIntensity: 0.30, envMapIntensity: 0.82 },
    furnitureTop:       { color: 0x3a3530, roughness: 0.10, clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 1.2 },
    furnitureDarkWood:  { color: 0x1a1410, roughness: 0.55, clearcoat: 0.05 },
    furnitureLightWood: { color: 0x6a5840, roughness: 0.68, clearcoat: 0.04 },
    furnitureMetal:     { color: 0x141412, roughness: 0.22, metalness: 0.90, envMapIntensity: 0.7 }, // matte black
    stair:              { color: 0x1e1a16, roughness: 0.50, clearcoat: 0.18, envMapIntensity: 0.6 },
    railing:            { color: 0x1a1a18, roughness: 0.30, metalness: 0.90, envMapIntensity: 0.9 },
    sanitary:           { color: 0xf0ece8, clearcoat: 0.86, roughness: 0.09 },
    light:              { emissive: 0xff9840, emissiveIntensity: 3.0 },
    smokedGlass:        { color: 0x1a1e1c, transmission: 0.38, roughness: 0.09 },
    showerGlass:        { color: 0xd4e2e8, roughness: 0.48 },
  },

  /** Smart Clean — matte white + light gray + brushed aluminum + cool tone */
  smart: {
    wall:               { color: 0xf8f8f8, roughness: 0.88, envMapIntensity: 0.50 },
    floor:              { color: 0xf0f0f0, roughness: 0.48, clearcoat: 0.30, clearcoatRoughness: 0.50 },
    ceiling:            { color: 0xffffff, roughness: 0.92 },
    door:               { color: 0xe8e8e8, roughness: 0.35, clearcoat: 0.20, envMapIntensity: 0.7 },
    furniture:          { color: 0xd3d0ca, roughness: 0.89, sheen: 0.16, sheenColor: 0xf0ece7, sheenRoughness: 0.94, specularIntensity: 0.16, envMapIntensity: 0.14 },
    furnitureBed:       { color: 0xf8f7f3, roughness: 0.985, sheen: 0.03, sheenColor: 0xffffff, sheenRoughness: 0.99, specularIntensity: 0.08, envMapIntensity: 0.04 },
    furnitureHard:      { color: 0xfcfcfa, roughness: 0.22, clearcoat: 0.70, clearcoatRoughness: 0.16, specularIntensity: 0.34, envMapIntensity: 0.90 },
    furnitureTop:       { color: 0xe8e8e8, roughness: 0.08, clearcoat: 0.90, clearcoatRoughness: 0.03, envMapIntensity: 1.3 },
    furnitureDarkWood:  { color: 0x585858, roughness: 0.45, clearcoat: 0.15 },  // treated grey ash
    furnitureLightWood: { color: 0xd8d0c0, roughness: 0.58, clearcoat: 0.08 },  // bleached birch
    furnitureMetal:     { color: 0xa8b0b8, roughness: 0.20, metalness: 0.95, envMapIntensity: 1.4 }, // brushed alu
    stair:              { color: 0xd0d0d0, roughness: 0.42, clearcoat: 0.22, envMapIntensity: 0.6 },
    railing:            { color: 0xa8b0b8, roughness: 0.22, metalness: 0.94, envMapIntensity: 1.4 },
    sanitary:           { color: 0xffffff, clearcoat: 0.90, roughness: 0.06 },
    light:              { emissive: 0xe8f0ff, emissiveIntensity: 2.2 },
    smokedGlass:        { color: 0x404850, transmission: 0.70, roughness: 0.03 },
    showerGlass:        { color: 0xf4f8fc, roughness: 0.28 },
  },
};

// ---------------------------------------------------------------------------
// Texture sets to load per style
// Each entry: {
//   name: poly-haven-slug,
//   repeat: [u,v],
//   surfaces: [...mat keys],
//   materialExtras?: { normalScale?: [x,y], ... }
// }
// Textures come from assets/textures/ (already downloaded or fetched by the
// companion PowerShell script download-style-textures.ps1).
// Entries may optionally include { ao: true } to also load an _ao_1k.jpg map
// into material.aoMap (requires uv2 on the geometry; fallback-safe if missing).
// ---------------------------------------------------------------------------

const STYLE_TEXTURES = {
  japandi: [
    { name: 'wood_floor_polish', repeat: [3, 3], surfaces: ['floor', 'stair'], ao: true },
    { name: 'wood_021',          repeat: [1, 1], surfaces: ['door'] },
    { name: 'white_plaster_02',  repeat: [2, 2], surfaces: ['wall', 'ceiling', 'covering'] },
    { name: 'linen_fabric',      repeat: [1.8, 1.8], surfaces: ['furniture'],    materialExtras: { normalScale: [0.95, 0.95] } },
    { name: 'linen_fabric',      repeat: [3.4, 3.4], surfaces: ['furnitureBed'], materialExtras: { normalScale: [0.30, 0.30] } },
    { name: 'white_plaster_02',  repeat: [6.0, 6.0], surfaces: ['furnitureHard'], materialExtras: { normalScale: [0.08, 0.08] } },
    { name: 'travertine_rock',   repeat: [1, 1], surfaces: ['furnitureTop'] },
    { name: 'light_oak_wood',    repeat: [1, 1], surfaces: ['furnitureLightWood'] },
    { name: 'dark_wood',         repeat: [1, 1], surfaces: ['furnitureDarkWood'] },
    { name: 'metal_plate',       repeat: [2, 2], surfaces: ['furnitureMetal', 'railing'] },
  ],
  luxury: [
    { name: 'oak_veneer_02',     repeat: [1, 1], surfaces: ['stair'] },
    { name: 'wood_095',          repeat: [1, 1], surfaces: ['door'] },
    { name: 'linen_fabric',      repeat: [1.6, 1.6], surfaces: ['furniture'],    materialExtras: { normalScale: [1.00, 1.00] } },
    { name: 'linen_fabric',      repeat: [3.6, 3.6], surfaces: ['furnitureBed'], materialExtras: { normalScale: [0.26, 0.26] } },
    { name: 'white_plaster_02',  repeat: [6.5, 6.5], surfaces: ['furnitureHard'], materialExtras: { normalScale: [0.07, 0.07] } },
    { name: 'dark_wood_02',      repeat: [1, 1], surfaces: ['furnitureDarkWood'] },
    { name: 'oak_veneer_02',     repeat: [1, 1], surfaces: ['furnitureLightWood'] },
    { name: 'metal_plate',       repeat: [2, 2], surfaces: ['furnitureMetal', 'railing'] },
  ],
  volcanic: [
    { name: 'volcanic_rock',     repeat: [2, 2], surfaces: ['wall', 'furnitureTop'] },
    { name: 'linen_fabric',      repeat: [1.8, 1.8], surfaces: ['furniture'],    materialExtras: { normalScale: [0.82, 0.82] } },
    { name: 'linen_fabric',      repeat: [3.2, 3.2], surfaces: ['furnitureBed'], materialExtras: { normalScale: [0.22, 0.22] } },
    { name: 'dark_wood',         repeat: [2, 2], surfaces: ['floor', 'door', 'stair', 'furnitureDarkWood'] },
    { name: 'metal_plate',       repeat: [3, 3], surfaces: ['railing', 'furnitureMetal'] },
    { name: 'black_slate',       repeat: [3.0, 3.0], surfaces: ['furnitureHard'], materialExtras: { normalScale: [0.12, 0.12] } },
    { name: 'plywood',           repeat: [1, 1], surfaces: ['furnitureLightWood'] },
  ],
  smart: [
    { name: 'white_plaster_02',  repeat: [2, 2], surfaces: ['wall', 'ceiling', 'covering', 'door', 'furnitureHard'] },
    { name: 'wood_floor_052',    repeat: [3, 3], surfaces: ['floor', 'stair'], ao: true },
    { name: 'linen_fabric',      repeat: [1.9, 1.9], surfaces: ['furniture'],    materialExtras: { normalScale: [0.78, 0.78] } },
    { name: 'linen_fabric',      repeat: [3.8, 3.8], surfaces: ['furnitureBed'], materialExtras: { normalScale: [0.20, 0.20] } },
    { name: 'metal_plate',       repeat: [3, 3], surfaces: ['railing', 'furnitureMetal'] },
    { name: 'tiled_floor_001',   repeat: [2, 2], surfaces: ['furnitureTop'] },
    { name: 'oak_veneer_01',     repeat: [1, 1], surfaces: ['furnitureLightWood'] },
    { name: 'dark_wood_02',      repeat: [1, 1], surfaces: ['furnitureDarkWood'] },
  ],
};

// ---------------------------------------------------------------------------
// MaterialFactory class
// ---------------------------------------------------------------------------

export class MaterialFactory {
  constructor(options = {}) {
    /** Base materials freshly created. Never mutated — always clone before use. */
    this._base = makePbrMaterials({ loadTextures: false });
    /** Currently active clones (live in the scene). */
    this._active = null;
    this._activeStyle = null;
    this._loader = new THREE.TextureLoader();
    this._textureCache = new Map();
    this._onMaterialUpdate = typeof options.onMaterialUpdate === "function"
      ? options.onMaterialUpdate
      : null;
  }

  /**
   * Apply a style preset.
   * @param {'japandi'|'luxury'|'volcanic'|'smart'} styleName
   * @returns {Object} The patched materials map (same reference as before if
   *                   already applied, new clones on first call or style change).
   */
  apply(styleName, { loadTextures = true } = {}) {
    if (!PRESETS[styleName]) {
      console.warn(`[MaterialFactory] Unknown style "${styleName}". Using "japandi".`);
      styleName = 'japandi';
    }

    // Dispose previous clones to avoid GPU memory leak when hot-swapping
    if (this._active && this._activeStyle !== styleName) {
      this._disposeActive();
    }

    if (!this._active || this._activeStyle !== styleName) {
      this._active = this._cloneBase();
      this._activeStyle = styleName;
    }

    const preset = PRESETS[styleName];
    for (const [surface, params] of Object.entries(preset)) {
      const mat = this._active[surface];
      if (!mat) continue;
      for (const [k, v] of Object.entries(params)) {
        this._assignMaterialParam(mat, k, v);
      }
      mat.needsUpdate = true;
    }

    this._applyStyleSurfaceTweaks(styleName);

    // Real 1K texture loads are optional so the first IFC frame is not competing
    // with image decode/GPU uploads. UI-triggered style changes keep them on.
    if (loadTextures) this._loadStyleTextures(styleName);

    this._notifyMaterialUpdate();

    return this._active;
  }

  /** Returns the currently active materials map (or base if none applied yet). */
  get materials() {
    return this._active || this._base;
  }

  /** Returns the currently active style name. */
  get activeStyle() {
    return this._activeStyle;
  }

  /** Expose pickMaterial so callers don't need to import it separately. */
  pick(ifcType, expressID = 0) {
    return pickMaterial(this.materials, ifcType, expressID);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  _cloneBase() {
    const cloned = {};
    for (const [k, mat] of Object.entries(this._base)) {
      cloned[k] = mat.clone();
    }
    return cloned;
  }

  _disposeActive() {
    if (!this._active) return;
    for (const mat of Object.values(this._active)) {
      try { mat.dispose(); } catch {}
    }
    this._active = null;
  }

  _notifyMaterialUpdate() {
    try { this._onMaterialUpdate?.(); } catch {}
  }

  _assignMaterialParam(mat, key, value) {
    if (Array.isArray(value) && mat[key]?.isVector2) {
      mat[key].set(value[0] ?? 0, value[1] ?? value[0] ?? 0);
      return;
    }
    if ((key === 'color' || key === 'emissive' || key === 'sheenColor' || key === 'specularColor' || key === 'attenuationColor') && mat[key]?.isColor) {
      mat[key].set(value);
      return;
    }
    mat[key] = value;
  }

  _applyMaterialExtras(surfaces, extras) {
    if (!extras) return;
    for (const s of surfaces) {
      const mat = this._active?.[s];
      if (!mat) continue;
      for (const [key, value] of Object.entries(extras)) {
        this._assignMaterialParam(mat, key, value);
      }
      mat.needsUpdate = true;
    }
  }

  _applyStyleSurfaceTweaks(styleName) {
    const sets = STYLE_TEXTURES[styleName] || [];
    for (const { surfaces, materialExtras } of sets) {
      this._applyMaterialExtras(surfaces, materialExtras);
    }
  }

  /**
   * Load a single texture channel and apply it to the listed surfaces.
   * Handles caching, async loading, and fallback (silent on 404).
   *
   * @param {string}   cacheKey   — unique key for _textureCache
   * @param {string}   url       — texture file URL
   * @param {number[]} repeat    — [u, v] repeat factors
   * @param {string[]} surfaces  — material keys to patch
   * @param {string}   matProp   — material property name (e.g. 'map', 'normalMap')
   * @param {Object}   [extra]   — additional properties set on each material (e.g. { aoMapIntensity: 0.65 })
   * @param {boolean}  [srgb]    — whether to tag the texture as sRGB (diffuse only)
   */
  _loadAndApply(cacheKey, url, repeat, surfaces, matProp, extra, srgb) {
    const applySurfaces = (tex) => {
      for (const s of surfaces) {
        if (!this._active?.[s]) continue;
        this._active[s][matProp] = tex;
        if (extra) Object.assign(this._active[s], extra);
        this._active[s].needsUpdate = true;
      }
      this._notifyMaterialUpdate();
    };

    if (this._textureCache.has(cacheKey)) {
      applySurfaces(this._textureCache.get(cacheKey));
      return;
    }

    this._loader.load(
      url,
      (tex) => {
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat[0], repeat[1]);
        tex.anisotropy = 8;
        this._textureCache.set(cacheKey, tex);
        applySurfaces(tex);
      },
      undefined,
      () => {} // silently skip — file may not exist (e.g. optional AO)
    );
  }

  _loadStyleTextures(styleName) {
    const sets = STYLE_TEXTURES[styleName] || [];
    const base = 'assets/textures';
    for (const { name, repeat, surfaces, ao } of sets) {
      const repeatKey = repeat.map((value) => String(value).replace('.', 'p')).join('x');
      this._loadAndApply(`${name}_${repeatKey}_diff`,  `${base}/${name}/${name}_diff_1k.jpg`,    repeat, surfaces, 'map',        undefined, true);
      this._loadAndApply(`${name}_${repeatKey}_nor`,   `${base}/${name}/${name}_nor_gl_1k.jpg`,  repeat, surfaces, 'normalMap');
      this._loadAndApply(`${name}_${repeatKey}_rough`, `${base}/${name}/${name}_rough_1k.jpg`,   repeat, surfaces, 'roughnessMap');
      if (ao) {
        this._loadAndApply(`${name}_${repeatKey}_ao`,  `${base}/${name}/${name}_ao_1k.jpg`,      repeat, surfaces, 'aoMap', { aoMapIntensity: 0.65 });
      }
    }
  }

  dispose() {
    this._disposeActive();
    for (const tex of this._textureCache.values()) {
      try { tex.dispose(); } catch {}
    }
    this._textureCache.clear();
    for (const mat of Object.values(this._base)) {
      try { mat.dispose(); } catch {}
    }
  }
}

export { PRESETS, STYLE_TEXTURES };
