// Procedural PBR materials and texture generators for the BP3D real renderer.
// Generates wood floor, plaster wall, brushed metal, ceramic etc on Canvas2D
// at module load — zero external assets.
import * as THREE from "three";

const IFC = {
  WALL: 2391406946, WALL_STD: 3512223829, CURTAIN_WALL: 3495092785,
  SLAB: 1529196076, SLAB_STD: 3027962421, ROOF: 2016517767,
  COVERING: 1973544240,
  DOOR: 395920057, DOOR_STD: 3242481149,
  WINDOW: 3304561284, WINDOW_STD: 486154966,
  FURNISHING: 263784265,
  STAIR: 331165859, STAIR_FLIGHT: 4252922144, RAILING: 2262370178,
  COLUMN: 901063453, BEAM: 753842376,
  PIPE_SEGMENT: 3612865200, PIPE_FITTING: 310824031,
  DUCT_SEGMENT: 3518393246, DUCT_FITTING: 342316401,
  CABLE_SEGMENT: 3758799889, CABLE_CARRIER: 4288193352,
  FLOW_TERMINAL: 2223149337, SANITARY: 3053780830,
  AIR_TERMINAL: 1634111441, SPACE_HEATER: 1999602285,
  LIGHT_FIXTURE: 629592764, LAMP: 76236018, OUTLET: 3694346114,
  ELECTRIC_APPLIANCE: 1904799276, FIRE_TERMINAL: 1305183839,
  VALVE: 4207607924, FLOW_FITTING: 4278956645
};

function noise2(x, y, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = noise2(xi, yi, seed);
  const b = noise2(xi + 1, yi, seed);
  const c = noise2(xi, yi + 1, seed);
  const d = noise2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x, y, octaves = 4, seed = 0) {
  let v = 0, a = 0.5, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    v += a * smoothNoise(fx, fy, seed + i);
    fx *= 2; fy *= 2; a *= 0.5;
  }
  return v;
}

function makeWoodFloorTexture(size = 512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const plankH = size / 8;
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * plankH * 0.6;
    for (let col = 0; col < 4; col++) {
      const x = col * (size / 4) - offset;
      const y = row * plankH;
      const w = size / 4;
      const baseR = 110 + smoothNoise(row * 3.1, col * 7.7) * 50;
      const baseG = 70 + smoothNoise(row * 5.2, col * 2.3) * 30;
      const baseB = 45 + smoothNoise(row * 1.7, col * 4.4) * 18;
      g.fillStyle = `rgb(${baseR|0},${baseG|0},${baseB|0})`;
      g.fillRect(x, y, w, plankH);
      // Wood grain
      const grainImage = g.getImageData(x, y, w, plankH);
      const data = grainImage.data;
      for (let py = 0; py < plankH; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;
          const grain = fbm(px / 6, py / 60, 3, row + col * 13) - 0.5;
          const knot = Math.exp(-Math.pow((px - w * 0.5) / (w * 0.4), 2)) * smoothNoise(px / 80, py / 80) * 0.15;
          const dim = grain * 60 - knot * 80;
          data[idx] = Math.max(40, Math.min(220, data[idx] + dim));
          data[idx + 1] = Math.max(25, Math.min(160, data[idx + 1] + dim * 0.6));
          data[idx + 2] = Math.max(15, Math.min(110, data[idx + 2] + dim * 0.3));
          data[idx + 3] = 255;
        }
      }
      g.putImageData(grainImage, x, y);
      g.strokeStyle = "rgba(20,12,8,0.5)";
      g.lineWidth = 1.4;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, plankH - 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 8;
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
      const n = fbm(x / 24, y / 24, 5, 3);
      const grain = (noise2(x, y, 11) - 0.5) * 0.05;
      const v = 0.93 + (n - 0.5) * 0.08 + grain;
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

export function makePbrMaterials() {
  const woodMap = makeWoodFloorTexture();
  const woodNormal = makeWoodNormalTexture();
  const wallMap = makePlasterTexture(512, [243, 238, 230]);
  const ceilingMap = makePlasterTexture(512, [248, 247, 244]);
  const metalRough = makeMetalRoughnessTexture();

  return {
    // Plaster wall: subtle micro-variation from the texture, no metallic, slight envMap pickup
    wall: new THREE.MeshPhysicalMaterial({
      map: wallMap, color: 0xffffff, roughness: 0.86, metalness: 0,
      envMapIntensity: 0.55
    }),
    // Wood floor: anisotropic specular along grain + soft clearcoat for that polished-wood look
    floor: new THREE.MeshPhysicalMaterial({
      map: woodMap, normalMap: woodNormal, normalScale: new THREE.Vector2(0.6, 0.6),
      color: 0xffffff, roughness: 0.5, metalness: 0.04,
      clearcoat: 0.28, clearcoatRoughness: 0.5,
      anisotropy: 0.55, anisotropyRotation: 0,
      envMapIntensity: 0.9
    }),
    ceiling: new THREE.MeshPhysicalMaterial({
      map: ceilingMap, color: 0xffffff, roughness: 0.92, metalness: 0,
      envMapIntensity: 0.5
    }),
    door: new THREE.MeshPhysicalMaterial({
      map: woodMap.clone(), color: 0x8a6240, roughness: 0.45, metalness: 0.05,
      clearcoat: 0.18, clearcoatRoughness: 0.4
    }),
    // Physically-correct glass: transmission handles transparency (no opacity/transparent flags),
    // realistic IOR 1.52, slight aqueous tint via attenuation, small dispersion for edge color split.
    window: new THREE.MeshPhysicalMaterial({
      color: 0xeef6f8,
      roughness: 0.05, metalness: 0,
      transmission: 1.0, thickness: 0.05,
      ior: 1.52,
      attenuationColor: 0xeaf3f7, attenuationDistance: 12,
      dispersion: 0.05,
      specularIntensity: 1.0,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide
    }),
    // Upholstery / generic furniture: matte with very faint sheen for fabric feel
    furniture: new THREE.MeshPhysicalMaterial({
      color: 0xa28b6e, roughness: 0.7, metalness: 0.02,
      clearcoat: 0.08, clearcoatRoughness: 0.6,
      sheen: 0.4, sheenColor: 0x705540, sheenRoughness: 0.7
    }),
    covering: new THREE.MeshPhysicalMaterial({
      map: ceilingMap, color: 0xffffff, roughness: 0.85, metalness: 0,
      envMapIntensity: 0.5
    }),
    stair: new THREE.MeshPhysicalMaterial({
      map: woodMap.clone(), color: 0x6e6457, roughness: 0.55, metalness: 0.05,
      clearcoat: 0.2, clearcoatRoughness: 0.5,
      anisotropy: 0.35
    }),
    // Brushed steel railing — strong anisotropy gives the streak highlight
    railing: new THREE.MeshPhysicalMaterial({
      color: 0x3a4148, roughness: 0.3, metalness: 0.92, roughnessMap: metalRough,
      anisotropy: 0.7, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.1
    }),
    column: new THREE.MeshPhysicalMaterial({
      color: 0x9c958a, roughness: 0.7, metalness: 0.05
    }),
    // Copper-ish plumbing: high metalness + brushed anisotropy along pipe length
    pipe: new THREE.MeshPhysicalMaterial({
      color: 0xc4c2bd, roughness: 0.26, metalness: 0.94, roughnessMap: metalRough,
      anisotropy: 0.6, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 1.15
    }),
    // Galvanised duct: medium metalness, brushed
    duct: new THREE.MeshPhysicalMaterial({
      color: 0x8a9098, roughness: 0.4, metalness: 0.7, roughnessMap: metalRough,
      anisotropy: 0.45, anisotropyRotation: Math.PI / 2,
      envMapIntensity: 0.9
    }),
    cable: new THREE.MeshPhysicalMaterial({
      color: 0xcf6a26, roughness: 0.62, metalness: 0.18,
      sheen: 0.2, sheenColor: 0x8b3818
    }),
    flowTerm: new THREE.MeshPhysicalMaterial({
      color: 0xeef0f2, roughness: 0.26, metalness: 0.2,
      clearcoat: 0.4, clearcoatRoughness: 0.25
    }),
    // Porcelain sanitary: strong clearcoat = wet glaze sheen
    sanitary: new THREE.MeshPhysicalMaterial({
      color: 0xfafaf8, roughness: 0.1, metalness: 0.02,
      clearcoat: 0.85, clearcoatRoughness: 0.08,
      envMapIntensity: 1.1
    }),
    airTerm: new THREE.MeshPhysicalMaterial({
      color: 0xc8ccd0, roughness: 0.36, metalness: 0.72, roughnessMap: metalRough,
      anisotropy: 0.4, anisotropyRotation: Math.PI / 2
    }),
    // Light fixture: glow + warm metal frame
    light: new THREE.MeshPhysicalMaterial({
      color: 0xfff4d0, roughness: 0.28, metalness: 0.55,
      emissive: 0xffd070, emissiveIntensity: 0.85,
      clearcoat: 0.2
    }),
    valve: new THREE.MeshPhysicalMaterial({
      color: 0xb04434, roughness: 0.4, metalness: 0.6,
      clearcoat: 0.15
    }),
    fallback: new THREE.MeshStandardMaterial({ color: 0xc4c4c0, roughness: 0.7, metalness: 0.1 })
  };
}

export function pickMaterial(m, t) {
  switch (t) {
    case IFC.WALL: case IFC.WALL_STD: case IFC.CURTAIN_WALL: return m.wall;
    case IFC.SLAB: case IFC.SLAB_STD: return m.floor;
    case IFC.ROOF: case IFC.COVERING: return m.covering;
    case IFC.DOOR: case IFC.DOOR_STD: return m.door;
    case IFC.WINDOW: case IFC.WINDOW_STD: return m.window;
    case IFC.FURNISHING: return m.furniture;
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
    case IFC.SPACE_HEATER: case IFC.FLOW_TERMINAL: case IFC.OUTLET:
    case IFC.ELECTRIC_APPLIANCE: case IFC.FIRE_TERMINAL: case IFC.FLOW_FITTING:
      return m.flowTerm;
    default: return m.fallback;
  }
}
