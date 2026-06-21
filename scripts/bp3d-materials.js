// Hyatt-class hotel interior PBR materials
// Design language: dark Marquina marble floors, champagne-gold hardware,
// warm-walnut millwork, ivory plaster walls, smoked-glass partitions.
import * as THREE from "three";

const IFC = {
  WALL: 2391406946, WALL_STD: 3512223829, CURTAIN_WALL: 3495092785,
  SLAB: 1529196076, SLAB_STD: 3027962421, ROOF: 2016517767, COVERING: 1973544240,
  DOOR: 395920057, DOOR_STD: 3242481149,
  WINDOW: 3304561284, WINDOW_STD: 486154966, FURNISHING: 263784265,
  STAIR: 331165859, STAIR_FLIGHT: 4252922144, RAILING: 2262370178,
  COLUMN: 901063453, BEAM: 753842376,
  PIPE_SEGMENT: 3612865200, PIPE_FITTING: 310824031,
  DUCT_SEGMENT: 3518393246, DUCT_FITTING: 342316401,
  CABLE_SEGMENT: 3758799889, CABLE_CARRIER: 4288193352,
  FLOW_TERMINAL: 2223149337, SANITARY: 3053780830,
  AIR_TERMINAL: 1634111441, SPACE_HEATER: 1999602285,
  LIGHT_FIXTURE: 629592764, LAMP: 76236018, OUTLET: 3694346114,
  ELECTRIC_APPLIANCE: 1904799276, FIRE_TERMINAL: 1305183839,
  VALVE: 4207607924, FLOW_FITTING: 4278956645,
  SPACE: 3856911033, SPACE_TYPE: 652456506
};

/**
 * Load a PBR texture set (diff / nor_gl / rough) and apply to a material.
 * Single source of truth — used by both makeFurnitureMaterials() and
 * upgradeToRealTextures(). Fails silently per-channel so procedural
 * fallback textures remain intact.
 *
 * @param {THREE.TextureLoader} loader
 * @param {string}  base   — texture root, e.g. "assets/textures"
 * @param {string}  name   — texture set slug, e.g. "oak_veneer_01"
 * @param {THREE.Material} mat — target material to patch
 * @param {number[]} repeat — [u, v] repeat factors
 */
function loadPBR(loader, base, name, mat, repeat) {
  const CHANNELS = [
    { suffix: 'diff',   prop: 'map',          srgb: true },
    { suffix: 'nor_gl', prop: 'normalMap',     srgb: false },
    { suffix: 'rough',  prop: 'roughnessMap',  srgb: false },
  ];
  for (const { suffix, prop, srgb } of CHANNELS) {
    loader.load(
      `${base}/${name}/${name}_${suffix}_1k.jpg`,
      (tex) => {
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat[0], repeat[1]);
        tex.anisotropy = 8;
        mat[prop] = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {} // load failed — keep procedural texture
    );
  }
}

// (Simple PBR materials moved to the full implementation below)

export function makeFurnitureMaterials() {
  const fm = {
    sofa: new THREE.MeshPhysicalMaterial({ color: 0xC8C4BE, roughness: 0.8, sheen: 0.4, sheenColor: 0xB0ADA8, sheenRoughness: 0.6 }),
    sofaCushion: new THREE.MeshPhysicalMaterial({ color: 0xD4D0CA, roughness: 0.85, sheen: 0.5, sheenColor: 0xC0BCB6 }),
    coffeeTableTop: new THREE.MeshPhysicalMaterial({ color: 0xE8E5E0, roughness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.05, envMapIntensity: 1.0 }),
    metalLeg: new THREE.MeshPhysicalMaterial({ color: 0x2C2C2C, roughness: 0.25, metalness: 0.95, envMapIntensity: 1.2 }),
    tvCabinet: new THREE.MeshPhysicalMaterial({ color: 0x4A3228, roughness: 0.4, clearcoat: 0.15, envMapIntensity: 0.6 }),
    diningTable: new THREE.MeshPhysicalMaterial({ color: 0xF0EDE8, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 0.9 }),
    diningChair: new THREE.MeshPhysicalMaterial({ color: 0xD5C8B0, roughness: 0.7, sheen: 0.3, sheenColor: 0xC0B8A0 }),
    bedFrame: new THREE.MeshPhysicalMaterial({ color: 0xF2F0ED, roughness: 0.75, sheen: 0.35, sheenColor: 0xE8E4E0 }),
    mattress: new THREE.MeshPhysicalMaterial({ color: 0xFAF9F7, roughness: 0.9 }),
    wardrobe: new THREE.MeshPhysicalMaterial({ color: 0xFAFAFA, roughness: 0.32, clearcoat: 0.25, envMapIntensity: 0.5 }),
    shoeCabinet: new THREE.MeshPhysicalMaterial({ color: 0xF5F5F5, roughness: 0.35, clearcoat: 0.2 }),
    kitchenUpper: new THREE.MeshPhysicalMaterial({ color: 0xFAFAFA, roughness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.1, envMapIntensity: 0.8 }),
    kitchenLower: new THREE.MeshPhysicalMaterial({ color: 0xC8B090, roughness: 0.5 }),
    countertop: new THREE.MeshPhysicalMaterial({ color: 0xE2DED8, roughness: 0.08, clearcoat: 0.7, clearcoatRoughness: 0.04, envMapIntensity: 1.0 }),
    baseboard: new THREE.MeshPhysicalMaterial({ color: 0xF0F0F0, roughness: 0.4 }),
    ceilingTrim: new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, roughness: 0.5, emissive: 0xFFF5E0, emissiveIntensity: 0.3 }),
    mirror: new THREE.MeshPhysicalMaterial({ color: 0xEEEEEE, roughness: 0.02, metalness: 0.98, envMapIntensity: 2.0 }),
    lampShade: new THREE.MeshPhysicalMaterial({ color: 0xFFF8F0, roughness: 0.6, transmission: 0.3, thickness: 0.02 }),
    lampPole: new THREE.MeshPhysicalMaterial({ color: 0x2C2C2C, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.0 }),
  };
  const loader = new THREE.TextureLoader();
  const base = "assets/textures";
  loadPBR(loader, base, "dark_wood", fm.tvCabinet, [1, 1]);
  loadPBR(loader, base, "plywood", fm.kitchenLower, [2, 2]);
  return fm;
}

// (pickMaterial moved to the full implementation below)

// Simple hash-based noise functions for procedural texture generation
function smoothNoise(x, y, seed = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 113.5) * 43758.5453;
  return n - Math.floor(n);
}

function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = smoothNoise(ix, iy, seed);
  const b = smoothNoise(ix + 1, iy, seed);
  const c = smoothNoise(ix, iy + 1, seed);
  const d = smoothNoise(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves = 4, seed = 0) {
  let v = 0, a = 0.5, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    v += a * smoothNoise(fx, fy, seed + i);
    fx *= 2; fy *= 2; a *= 0.5;
  }
  return v;
}

function makeWoodFloorTexture(size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");

  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#eee5da");
  bg.addColorStop(1, "#dccfbe");
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // Low-frequency plank wash only: no grain/noise normals on broad IFC slabs.
  const plankH = size / 6;
  for (let row = 0; row < 6; row++) {
    const y = row * plankH;
    const tone = 1 + (smoothNoise(row * 2.1, 3.7) - 0.5) * 0.025;
    g.fillStyle = `rgba(${Math.round(232 * tone)},${Math.round(220 * tone)},${Math.round(205 * tone)},0.30)`;
    g.fillRect(0, y, size, plankH);
    g.strokeStyle = "rgba(120,96,70,0.055)";
    g.lineWidth = 0.75;
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(size, y + 0.5);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.45, 0.45);
  tex.anisotropy = 4;
  return tex;
}

function makeWoodNormalTexture(size = 512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = fbm(x / 4, y / 32, 4, 7) * 1.0 + fbm(x / 32, y / 4, 3, 17) * 0.3;
      const hx = fbm((x + 1) / 4, y / 32, 4, 7) - fbm((x - 1) / 4, y / 32, 4, 7);
      const hy = fbm(x / 4, (y + 1) / 32, 4, 7) - fbm(x / 4, (y - 1) / 32, 4, 7);
      const idx = (y * size + x) * 4;
      img.data[idx] = 128 + hx * 90;
      img.data[idx + 1] = 128 + hy * 90;
      img.data[idx + 2] = 230 + h * 8;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function makePlasterTexture(size = 512, baseColor = [240, 235, 226]) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 96, y / 96, 3, 3);
      const grain = (noise2(x / 4, y / 4, 11) - 0.5) * 0.008;
      const v = 0.985 + (n - 0.5) * 0.025 + grain;
      const idx = (y * size + x) * 4;
      img.data[idx] = baseColor[0] * v;
      img.data[idx + 1] = baseColor[1] * v;
      img.data[idx + 2] = baseColor[2] * v;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeMetalRoughnessTexture(size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const brushed = fbm(x / 1.4, y / 32, 3, 5);
      const v = 0.32 + brushed * 0.18;
      const idx = (y * size + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = v * 255;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makePbrMaterials({ loadTextures = false } = {}) {
  const woodMap    = makeWoodFloorTexture();
  const wallMap    = makePlasterTexture(512, [243, 238, 230]);
  const ceilingMap = makePlasterTexture(512, [248, 247, 244]);
  const metalRough = makeMetalRoughnessTexture();

  // ── Shared helpers ──────────────────────────────────────────────────────────
  // Inline glass material factory — keep the helper so window / smokedGlass
  // share one setup path. The previous onBeforeCompile distortion hook was
  // removed because it patched Three r165's transmission chunk at an invalid
  // location and caused fragment shader compilation failures.
  function makeGlassMat(params, ampX, ampY) {
    void ampX;
    void ampY;
    return new THREE.MeshPhysicalMaterial(params);
  }

  const materials = {

    // ── Structural surfaces ─────────────────────────────────────────────────

    // Smooth lime plaster: micro-texture from noise map, zero metalness, soft IBL pickup
    wall: new THREE.MeshPhysicalMaterial({
      map: wallMap, color: 0xffffff,
      roughness: 0.86, metalness: 0,
      envMapIntensity: 0.55
    }),

    // Quiet warm floor: broad colour wash only, no normal/roughness/AO maps.
    // IFC slabs often have generated UVs, so detailed PBR maps alias and look dirty.
    floor: new THREE.MeshPhysicalMaterial({
      map: woodMap,
      color: 0xf2eadf,
      roughness: 0.74, metalness: 0,
      clearcoat: 0.035, clearcoatRoughness: 0.92,
      anisotropy: 0.0, anisotropyRotation: 0,
      envMapIntensity: 0.42
    }),

    // Flat white emulsion ceiling — very high roughness, minimal specular
    ceiling: new THREE.MeshPhysicalMaterial({
      map: ceilingMap, color: 0xffffff,
      roughness: 0.92, metalness: 0,
      envMapIntensity: 0.5
    }),

    // Solid oak door: warm honey tone, light clearcoat for factory-lacquered feel
    door: new THREE.MeshPhysicalMaterial({
      map: woodMap.clone(), color: 0x8a6240,
      roughness: 0.45, metalness: 0.05,
      clearcoat: 0.18, clearcoatRoughness: 0.40,
      envMapIntensity: 0.6
    }),

    // Covering / skirting / facade cladding: matches ceiling plaster
    covering: new THREE.MeshPhysicalMaterial({
      map: ceilingMap, color: 0xffffff,
      roughness: 0.85, metalness: 0,
      envMapIntensity: 0.5
    }),

    // ── Glass ───────────────────────────────────────────────────────────────

    // Float window glass: IOR 1.52, slight aqueous attenuation tint,
    // dispersion 0.08 for visible prism edge on strong backlight,
    // micro-waviness GLSL injection simulates real float-glass surface imperfections
    window: makeGlassMat({
      color: 0xd8ecf2,
      roughness: 0.04, metalness: 0,
      transmission: 1.0, thickness: 0.22,
      ior: 1.52,
      attenuationColor: 0xc8e4ec, attenuationDistance: 5.0,
      dispersion: 0.08,
      specularIntensity: 1.0,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide
    }, 0.0006, 0.0005),

    // Dark smoked glass partition / door panel: lower transmission, grey attenuation
    smokedGlass: makeGlassMat({
      color: 0x4a5055,
      roughness: 0.06, metalness: 0,
      transmission: 0.62, thickness: 0.14,
      ior: 1.46,
      attenuationColor: 0x2a3035, attenuationDistance: 0.9,
      dispersion: 0.04,
      specularIntensity: 1.0,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide
    }, 0.0003, 0.0003),

    // Acid-etched / sand-blasted shower screen: frosted surface roughness 0.42
    // scatters transmission — no distortion injection needed, roughness handles it
    showerGlass: new THREE.MeshPhysicalMaterial({
      color: 0xe8f2f6,
      roughness: 0.42, metalness: 0,
      transmission: 0.55, thickness: 0.09,
      ior: 1.45,
      dispersion: 0.02,
      specularIntensity: 0.75,
      envMapIntensity: 0.85,
      side: THREE.DoubleSide
    }),

    // ── Furniture – 7 semantic sub-surfaces ─────────────────────────────────

    // Upholstery (sofa fabric, chair cushion, headboard): denser woven soft
    // pack with broad grazing highlights rather than silky sharp flash.
    furniture: new THREE.MeshPhysicalMaterial({
      color: 0xb4a594,
      roughness: 0.90, metalness: 0,
      sheen: 0.50, sheenColor: 0xd8cbbe, sheenRoughness: 0.92,
      specularIntensity: 0.20,
      envMapIntensity: 0.14
    }),

    // Bed / bedding (mattress, duvet, pillow, soft headboard): brighter and
    // more matte than sofa upholstery so beds read softer, loftier and calmer.
    furnitureBed: new THREE.MeshPhysicalMaterial({
      color: 0xf3eee7,
      roughness: 0.985, metalness: 0,
      sheen: 0.05, sheenColor: 0xfffcf7, sheenRoughness: 0.99,
      specularIntensity: 0.12,
      envMapIntensity: 0.05
    }),

    // Hard lacquered case goods (cabinets, bookshelves, TV unit):
    // satin sprayed finish with restrained reflections instead of mirror gloss.
    furnitureHard: new THREE.MeshPhysicalMaterial({
      color: 0xf4efe8,
      roughness: 0.30, metalness: 0,
      clearcoat: 0.66, clearcoatRoughness: 0.22,
      specularIntensity: 0.34,
      envMapIntensity: 0.74
    }),

    // Premium stone / sintered slab top (countertop, coffee-table top, island):
    // near-zero roughness + heavy clearcoat = polished Calacatta marble feel
    furnitureTop: new THREE.MeshPhysicalMaterial({
      color: 0xe2ddd6,
      roughness: 0.08, metalness: 0.01,
      clearcoat: 0.88, clearcoatRoughness: 0.04,
      envMapIntensity: 1.0
    }),

    // Dark walnut / smoked oak case goods (credenza, wardrobe, dining table):
    // rich grain with a hand-rubbed oil finish — warm dark tone, low clearcoat
    furnitureDarkWood: new THREE.MeshPhysicalMaterial({
      color: 0x3a2a1e,
      roughness: 0.48, metalness: 0.02,
      clearcoat: 0.10, clearcoatRoughness: 0.55,
      anisotropy: 0.40,
      envMapIntensity: 0.55
    }),

    // Light ash / maple veneer (dining chairs, bed frame rails, shelving):
    // blonde wood, open-grain, lightly oiled — slightly more matte than the floor
    furnitureLightWood: new THREE.MeshPhysicalMaterial({
      color: 0xc8a87a,
      roughness: 0.60, metalness: 0.02,
      clearcoat: 0.08, clearcoatRoughness: 0.60,
      anisotropy: 0.35,
      envMapIntensity: 0.45
    }),

    // Powder-coated or polished metal furniture legs / frames:
    // matte-black or brushed-steel look — strong anisotropy on vertical axis
    furnitureMetal: new THREE.MeshPhysicalMaterial({
      color: 0x2a2e32,
      roughness: 0.28, metalness: 0.92,
      roughnessMap: metalRough,
      anisotropy: 0.65, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.0
    }),

    // ── Stairs & structure ──────────────────────────────────────────────────

    // Tread surface: oiled oak with anisotropic grain along tread width
    stair: new THREE.MeshPhysicalMaterial({
      map: woodMap.clone(), color: 0x6e6457,
      roughness: 0.55, metalness: 0.05,
      clearcoat: 0.20, clearcoatRoughness: 0.50,
      anisotropy: 0.35,
      envMapIntensity: 0.6
    }),

    // Structural column / beam: painted concrete-look — high roughness, slight IBL
    column: new THREE.MeshPhysicalMaterial({
      color: 0x9c958a,
      roughness: 0.70, metalness: 0.05,
      envMapIntensity: 0.4
    }),

    // ── Metal & MEP ─────────────────────────────────────────────────────────

    // Brushed stainless railing: strong vertical anisotropy streak highlight,
    // roughnessMap gives per-pixel variation so it doesn't look like foil
    railing: new THREE.MeshPhysicalMaterial({
      color: 0x3a4148,
      roughness: 0.30, metalness: 0.92,
      roughnessMap: metalRough,
      anisotropy: 0.70, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.1
    }),

    // Copper / chrome plumbing pipe: warm silver with brushed axis anisotropy
    pipe: new THREE.MeshPhysicalMaterial({
      color: 0xc4c2bd,
      roughness: 0.26, metalness: 0.94,
      roughnessMap: metalRough,
      anisotropy: 0.60, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.0
    }),

    // Galvanised sheet-metal duct: slightly cooler grey, medium metalness
    duct: new THREE.MeshPhysicalMaterial({
      color: 0x8a9098,
      roughness: 0.40, metalness: 0.70,
      roughnessMap: metalRough,
      anisotropy: 0.45, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 0.9
    }),

    // PVC / rubber-sheathed cable: orange insulation with faint fabric sheen
    cable: new THREE.MeshPhysicalMaterial({
      color: 0xcf6a26,
      roughness: 0.62, metalness: 0.18,
      sheen: 0.20, sheenColor: 0x8b3818,
      envMapIntensity: 0.25
    }),

    // Generic flow terminal / outlet / small device: off-white ABS plastic
    flowTerm: new THREE.MeshPhysicalMaterial({
      color: 0xeef0f2,
      roughness: 0.26, metalness: 0.20,
      clearcoat: 0.40, clearcoatRoughness: 0.25
    }),

    // Air terminal / grille: brushed aluminium, anisotropy along slat direction
    airTerm: new THREE.MeshPhysicalMaterial({
      color: 0xc8ccd0,
      roughness: 0.36, metalness: 0.72,
      roughnessMap: metalRough,
      anisotropy: 0.40, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 0.85
    }),

    // ── Sanitary & fixtures ─────────────────────────────────────────────────

    // Vitreous china (toilet, basin): wet glaze clearcoat 0.85, near-zero roughness
    sanitary: new THREE.MeshPhysicalMaterial({
      color: 0xfafaf8,
      roughness: 0.10, metalness: 0.02,
      clearcoat: 0.85, clearcoatRoughness: 0.08,
      envMapIntensity: 1.0
    }),

    // Tap / valve body: lacquered red-brass / chrome — red tint distinguishes isolators
    valve: new THREE.MeshPhysicalMaterial({
      color: 0xb04434,
      roughness: 0.40, metalness: 0.60,
      clearcoat: 0.15,
      envMapIntensity: 0.6
    }),

    // ── Lighting ────────────────────────────────────────────────────────────

    // Recessed / pendant light body: warm-white glow above Bloom threshold (2.5).
    // Metalness 0.55 keeps the housing looking like brushed aluminium trim.
    light: new THREE.MeshPhysicalMaterial({
      color: 0xfff4d0,
      roughness: 0.28, metalness: 0.55,
      emissive: 0xffdd88, emissiveIntensity: 2.5,
      clearcoat: 0.20,
      envMapIntensity: 0.7
    }),

    // ── Room volumes & fallback ─────────────────────────────────────────────

    // IfcSpace ghost volume: nearly invisible, double-sided so you see it from inside
    space: new THREE.MeshPhysicalMaterial({
      color: 0x88bbdd,
      roughness: 0.90, metalness: 0,
      transparent: true, opacity: 0.08, depthWrite: false,
      side: THREE.DoubleSide
    }),

    // Catch-all: neutral grey for unrecognised IFC types
    fallback: new THREE.MeshStandardMaterial({ color: 0xc4c4c0, roughness: 0.70, metalness: 0.10 })
  };

  // Optional async PBR texture upgrade. Keep this off the critical startup path:
  // the renderer can show the IFC quickly with procedural maps, then callers can
  // opt into real texture loading when the user switches/refreshes a style.
  if (loadTextures) upgradeToRealTextures(materials);

  return materials;
}

/**
 * Asynchronously load real PBR textures and upgrade materials in-place.
 * Every surface gets the best available texture from the local assets folder.
 * Falls back silently — procedural maps stay active if a file is missing.
 * Uses the shared loadPBR() defined at module top.
 */
function upgradeToRealTextures(materials) {
  const loader = new THREE.TextureLoader();
  const base   = "assets/textures";

  // ── Structural ─────────────────────────────────────────────────────────────
  // Keep broad architectural surfaces procedural and low-frequency. Real PBR
  // texture sets on generated IFC UVs created noisy/dirty angled views.

  // ── Floors & stairs ────────────────────────────────────────────────────────
  // Floor intentionally stays clean/procedural; avoid high-frequency PBR maps.
  // Stair tread: oak veneer 01 — warm honey tone, open grain
  loadPBR(loader, base, "oak_veneer_01",       materials.stair,             [1, 1]);

  // ── Doors ──────────────────────────────────────────────────────────────────
  // Door: wood_021 — solid plank timber, visible grain direction
  loadPBR(loader, base, "wood_021",            materials.door,              [1, 1]);

  // ── Furniture sub-surfaces ─────────────────────────────────────────────────
  // Upholstered: real linen/cotton fabric — sheen plays well with this
  loadPBR(loader, base, "linen_fabric",        materials.furniture,         [2, 2]);
  // Bedding / mattress shares the same weave but stays brighter and more matte.
  loadPBR(loader, base, "linen_fabric",        materials.furnitureBed,      [2, 2]);
  // Hard case goods and stone tops stay clean colours; detailed maps looked noisy.
  // Dark walnut case goods: dark_wood_02 — stronger figure than dark_wood
  loadPBR(loader, base, "dark_wood_02",        materials.furnitureDarkWood, [1, 1]);
  // Light ash / maple: light_oak_wood — blonde tight grain
  loadPBR(loader, base, "light_oak_wood",      materials.furnitureLightWood,[1, 1]);
  // Metal legs / frames: metal_plate gives brushed-aluminium directionality
  loadPBR(loader, base, "metal_plate",         materials.furnitureMetal,    [2, 2]);

  // ── MEP metal surfaces ─────────────────────────────────────────────────────
  // Railing: metal_plate roughness map already set in material constructor;
  // load the full PBR set for colour + normal accuracy
  loadPBR(loader, base, "metal_plate",         materials.railing,           [3, 3]);
  loadPBR(loader, base, "metal_plate",         materials.pipe,              [2, 2]);
  loadPBR(loader, base, "metal_plate",         materials.duct,              [3, 3]);
  loadPBR(loader, base, "metal_plate",         materials.airTerm,           [2, 2]);
}

/**
 * Pick the right material for an IFC entity.
 *
 * @param {Object} m          — materials map from makePbrMaterials()
 * @param {number} t          — IFC type code (ExpressType numeric)
 * @param {Object|number|string} [furnitureMetaOrId=0]
 *                                  — furniture metadata from the worker, a cached
 *                                    furniture material key, or the legacy expressID fallback.
 */
function normaliseFurnitureText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[():/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, parts) {
  return parts.some((part) => text.includes(part));
}

export function classifyFurnitureMaterial(meta = {}) {
  const family = typeof meta.name === "string" ? meta.name.split(":")[0] : "";
  const text = normaliseFurnitureText([
    family,
    meta.name,
    meta.objectType
  ].filter(Boolean).join(" "));

  if (!text) return "furnitureHard";
  if (hasAny(text, ["counter top", "countertop", "table top", "tabletop", "worktop", "vanity top", "island top"])) {
    return "furnitureTop";
  }
  if (hasAny(text, ["bed frame", "footboard", "side rail", "slat", "bed rail"])) {
    return "furnitureLightWood";
  }
  if (hasAny(text, ["mattress", "bed", "headboard", "pillow", "duvet", "blanket"])) {
    return "furnitureBed";
  }
  if (hasAny(text, ["sofa", "couch", "loveseat", "ottoman", "upholster", "upholstered", "cushion", "chaise", "armchair", "lounge chair"])) {
    return "furniture";
  }
  if (hasAny(text, ["metal", "steel", "stainless", "aluminium", "aluminum", "chrome", "iron", "wire"])) {
    return "furnitureMetal";
  }
  if (hasAny(text, ["chair", "stool", "bench", "bed frame", "rail"])) {
    return "furnitureLightWood";
  }
  if (hasAny(text, ["wardrobe", "credenza", "sideboard", "buffet", "dresser", "console", "desk", "table", "nightstand"])) {
    return "furnitureDarkWood";
  }
  if (hasAny(text, ["cabinet", "vanity", "drawer", "shelf", "shelving", "bookcase", "bookshelf", "storage", "locker", "tv unit", "media unit"])) {
    return "furnitureHard";
  }
  return "furnitureHard";
}

export function pickMaterial(m, t, furnitureMetaOrId = 0) {
  switch (t) {
    case IFC.WALL: case IFC.WALL_STD: case IFC.CURTAIN_WALL: return m.wall;
    case IFC.SLAB: case IFC.SLAB_STD: return m.floor;
    case IFC.ROOF: case IFC.COVERING: return m.covering;
    case IFC.DOOR: case IFC.DOOR_STD: return m.door;
    case IFC.WINDOW: case IFC.WINDOW_STD: return m.window;
    case IFC.FURNISHING: {
      if (typeof furnitureMetaOrId === "string" && m[furnitureMetaOrId]) {
        return m[furnitureMetaOrId] || m.furnitureHard;
      }
      const furnitureMeta = typeof furnitureMetaOrId === "number"
        ? { expressID: furnitureMetaOrId }
        : (furnitureMetaOrId || {});
      const materialKey = typeof furnitureMeta.furnitureMaterialKey === "string" && m[furnitureMeta.furnitureMaterialKey]
        ? furnitureMeta.furnitureMaterialKey
        : classifyFurnitureMaterial(furnitureMeta);
      return m[materialKey] || m.furnitureHard;
    }
    case IFC.STAIR: case IFC.STAIR_FLIGHT: return m.stair;
    case IFC.RAILING: return m.railing;
    case IFC.COLUMN: case IFC.BEAM: return m.column;
    case IFC.PIPE_SEGMENT: case IFC.PIPE_FITTING: return m.pipe;
    case IFC.DUCT_SEGMENT: case IFC.DUCT_FITTING: return m.duct;
    case IFC.CABLE_SEGMENT: case IFC.CABLE_CARRIER: return m.cable;
    case IFC.SANITARY: return m.sanitary;
    case IFC.AIR_TERMINAL: return m.airTerm;
    case IFC.LIGHT_FIXTURE: case IFC.LAMP: return m.light;
    case IFC.VALVE: return m.valve;
    case IFC.SPACE: case IFC.SPACE_TYPE: return m.space;
    case IFC.SPACE_HEATER: case IFC.FLOW_TERMINAL: case IFC.OUTLET:
    case IFC.ELECTRIC_APPLIANCE: case IFC.FIRE_TERMINAL: case IFC.FLOW_FITTING:
      return m.flowTerm;
    default: return m.fallback;
  }
}
