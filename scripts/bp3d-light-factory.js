/**
 * bp3d-light-factory.js
 * Three lighting presets for the ArchViz renderer.
 *
 * Presets: daylight | night | showroom
 *
 * The factory receives live references to the scene's light objects and
 * renderer on construction. Calling apply() patches them in-place — no
 * re-creation needed, transitions are instant (or can be animated via GSAP
 * once Step 4 is wired in).
 *
 * Usage:
 *   import { LightFactory } from './bp3d-light-factory.js';
 *   const lf = new LightFactory({ sunLight, fill, hemi, ambient, scene, renderer, colorGrading });
 *   lf.apply('night');
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const PRESETS = {

  /**
   * Daylight — clear mid-morning sun from the south-east.
   * Warm directional key + cool blue sky fill + bright hemisphere.
   */
  daylight: {
    envMap: 'assets/hdri/glasshouse_interior_4k.exr',
    sun: {
      color:     0xfff1d6,
      intensity: 2.34,
      elevation: 32,   // degrees above horizon
      azimuth:   155,  // compass degrees (N=0, E=90)
    },
    fill: {
      color:     0xb8d4ee,
      intensity: 0.84,
      position:  [20, 15, -25],
    },
    hemi: {
      skyColor:    0xeaf2ff,
      groundColor: 0x9e9688,
      intensity:   0.78,
    },
    ambient: {
      color:     0xffffff,
      intensity: 0.18,
    },
    fog: {
      color:   0xf7f5ef,
      density: 0.0035,
    },
    renderer: {
      exposure:    0.92,
      background:  0xf8f7f2,
    },
    postfx: {
      contrast:    1.04,
      saturation:  0.95,
      temperature: 0.024,
      shadowTint:  0.012,
      vignetteOffset:   0.78,
      vignetteDarkness: 0.18,
    },
  },

  /**
   * Night — dusk / evening interior ambiance.
   * Very low sun on the horizon, warm indoor fill, boosted ambient to simulate
   * ceiling downlights, dark foggy background, high bloom threshold drops to
   * let light fixtures glow prominently.
   */
  night: {
    envMap: 'assets/hdri/glasshouse_interior_4k.exr',
    sun: {
      color:     0xff8840,
      intensity: 0.3,
      elevation: 4,
      azimuth:   200,
    },
    fill: {
      color:     0xffe0b0,
      intensity: 0.5,
      position:  [10, 8, -15],
    },
    hemi: {
      skyColor:    0x2a1e0e,
      groundColor: 0x0e0a04,
      intensity:   0.25,
    },
    ambient: {
      color:     0xffeedd,
      intensity: 0.38,
    },
    fog: {
      color:   0x1a2030,
      density: 0.010,
    },
    renderer: {
      exposure:   1.42,
      background: 0x1a2030,
    },
    postfx: {
      contrast:    1.18,
      saturation:  1.10,
      temperature: 0.055,
      shadowTint:  0.008,
      vignetteOffset:   0.70,
      vignetteDarkness: 0.72,
    },
  },

  /**
   * Indoor — warm interior ambience using the glasshouse EXR.
   * Soft window-light key, warm fill, natural indoor reflections.
   * Best for furniture showcase and living-room interior shots.
   */
  indoor: {
    envMap: 'assets/hdri/glasshouse_interior_4k.exr',
    sun: {
      color:     0xffecd6,
      intensity: 1.72,
      elevation: 26,
      azimuth:   120,
    },
    fill: {
      color:     0xfff0e0,
      intensity: 0.92,
      position:  [-15, 10, 10],
    },
    hemi: {
      skyColor:    0xfff8f0,
      groundColor: 0xd0c3ad,
      intensity:   0.82,
    },
    ambient: {
      color:     0xfff4e8,
      intensity: 0.22,
    },
    fog: {
      color:   0xf7f1e8,
      density: 0.003,
    },
    renderer: {
      exposure:   0.88,
      background: 0xf8f5ee,
    },
    postfx: {
      contrast:    1.02,
      saturation:  0.94,
      temperature: 0.024,
      shadowTint:  0.014,
      vignetteOffset:   0.82,
      vignetteDarkness: 0.12,
    },
  },

  /**
   * Showroom — neutral softbox studio for material/product evaluation.
   * Even exposure, no strong directional shadow, high ambient, minimal fog.
   * Useful for inspecting material quality without atmospheric distractions.
   */
  showroom: {
    envMap: 'assets/hdri/studio_country_hall_4k.exr',
    sun: {
      color:     0xfff8f0,
      intensity: 1.8,
      elevation: 55,
      azimuth:   90,
    },
    fill: {
      color:     0xf0f4ff,
      intensity: 1.6,
      position:  [-20, 18, 20],
    },
    hemi: {
      skyColor:    0xffffff,
      groundColor: 0xd0d0d0,
      intensity:   1.4,
    },
    ambient: {
      color:     0xffffff,
      intensity: 0.50,
    },
    fog: {
      color:   0xf7f7f4,
      density: 0.0025,
    },
    renderer: {
      exposure:   1.08,
      background: 0xf9f9f6,
    },
    postfx: {
      contrast:    1.08,
      saturation:  1.04,
      temperature: 0.010,
      shadowTint:  0.025,
      vignetteOffset:   0.88,
      vignetteDarkness: 0.16,
    },
  },
};

// ---------------------------------------------------------------------------
// LightFactory class
// ---------------------------------------------------------------------------

export class LightFactory {
  /**
   * @param {Object} refs
   * @param {THREE.DirectionalLight} refs.sunLight
   * @param {THREE.DirectionalLight} refs.fill
   * @param {THREE.HemisphereLight}  refs.hemi
   * @param {THREE.AmbientLight}     refs.ambient
   * @param {THREE.Scene}            refs.scene
   * @param {THREE.WebGLRenderer}    refs.renderer
   * @param {ShaderPass}             refs.colorGrading  — EffectComposer ShaderPass
   */
  constructor(refs) {
    this._r = refs;
    this._activePreset = null;
    this._onEnvMapChangeCb = null;
  }

  /**
   * Register a callback to be invoked when the active preset's envMap changes.
   * @param {(url: string) => void} callback
   */
  onEnvMapChange(callback) {
    this._onEnvMapChangeCb = callback;
  }

  /**
   * Apply a preset.
   * @param {'daylight'|'night'|'showroom'} presetName
   */
  apply(presetName) {
    const p = PRESETS[presetName];
    if (!p) {
      console.warn(`[LightFactory] Unknown preset "${presetName}". Using "daylight".`);
      return this.apply('daylight');
    }

    const { sunLight, fill, hemi, ambient, scene, renderer, colorGrading } = this._r;

    // Sun / key light
    sunLight.color.set(p.sun.color);
    sunLight.intensity = p.sun.intensity;
    const phi   = THREE.MathUtils.degToRad(90 - p.sun.elevation);
    const theta = THREE.MathUtils.degToRad(p.sun.azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    const dist = sunLight.position.length() || 80;
    sunLight.position.copy(sunDir).multiplyScalar(dist);
    if (sunLight.target) {
      // Keep target at origin (scene center) — fitToScene overrides if needed
      sunLight.target.position.set(0, 0, 0);
      sunLight.target.updateMatrixWorld();
    }

    // Fill light
    fill.color.set(p.fill.color);
    fill.intensity = p.fill.intensity;
    fill.position.set(...p.fill.position);

    // Hemisphere
    hemi.color.set(p.hemi.skyColor);
    hemi.groundColor.set(p.hemi.groundColor);
    hemi.intensity = p.hemi.intensity;

    // Ambient
    ambient.color.set(p.ambient.color);
    ambient.intensity = p.ambient.intensity;

    // Scene fog + background
    if (scene.fog) {
      scene.fog.color.set(p.fog.color);
      scene.fog.density = p.fog.density;
    }
    scene.background = new THREE.Color(p.renderer.background);

    // Renderer exposure
    renderer.toneMappingExposure = p.renderer.exposure;

    // Color grading uniforms
    if (colorGrading?.uniforms) {
      const u = colorGrading.uniforms;
      if (u.contrast)         u.contrast.value         = p.postfx.contrast;
      if (u.saturation)       u.saturation.value       = p.postfx.saturation;
      if (u.temperature)      u.temperature.value      = p.postfx.temperature;
      if (u.shadowTint)       u.shadowTint.value       = p.postfx.shadowTint;
      if (u.vignetteOffset)   u.vignetteOffset.value   = p.postfx.vignetteOffset;
      if (u.vignetteDarkness) u.vignetteDarkness.value = p.postfx.vignetteDarkness;
    }

    // Notify env map change if the envMap differs from the previous preset
    const prevEnvMap = this._activePreset ? PRESETS[this._activePreset]?.envMap : null;
    const nextEnvMap = p.envMap || null;
    if (this._onEnvMapChangeCb && nextEnvMap !== prevEnvMap) {
      this._onEnvMapChangeCb(nextEnvMap);
    }

    this._activePreset = presetName;
  }

  get activePreset() { return this._activePreset; }

  /** Returns the envMap path of the currently active preset, or null. */
  get activeEnvMap() {
    return this._activePreset ? (PRESETS[this._activePreset]?.envMap ?? null) : null;
  }

  /** Returns a snapshot of the named preset (read-only copy). */
  static getPreset(name) { return PRESETS[name] ? JSON.parse(JSON.stringify(PRESETS[name])) : null; }

  /** Returns all preset names. */
  static presetNames() { return Object.keys(PRESETS); }
}

export { PRESETS };
