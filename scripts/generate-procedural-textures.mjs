/**
 * generate-procedural-textures.mjs
 * 
 * Generates high-quality procedural PBR textures (diff / nor_gl / rough) for
 * the six missing texture sets needed by bp3d-material-factory.js.
 * Uses only Node.js built-ins — no npm dependencies required.
 *
 * Run: node scripts/generate-procedural-textures.mjs
 *
 * Output directory: assets/textures/<name>/
 */

import fs from 'fs';
import path from 'path';
import { deflateSync } from 'zlib';

// ---------------------------------------------------------------------------
// CRC-32 lookup table (precomputed once at module load — ~8× faster than
// the naive per-byte 8-bit-shift loop used inside writeChunk previously).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writePNG(filePath, width, height, getPixel) {
  // getPixel(x,y) -> { r,g,b } 0-255
  const stride = 1 + width * 3;
  const rawData = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    rawData[y * stride] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixel(x, y);
      const offset = y * stride + 1 + x * 3;
      rawData[offset]     = r & 0xff;
      rawData[offset + 1] = g & 0xff;
      rawData[offset + 2] = b & 0xff;
    }
  }
  const compressed = deflateSync(rawData);
  const chunks = [];

  function writeChunk(type, data) {
    const len    = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length, 0);
    const typeB  = Buffer.from(type);
    // Compute CRC over type bytes + data bytes without allocating a concat buffer.
    let crc = 0xffffffff;
    for (let i = 0; i < typeB.length; i++) crc = CRC_TABLE[(crc ^ typeB[i]) & 0xff] ^ (crc >>> 8);
    for (let i = 0; i < data.length;  i++) crc = CRC_TABLE[(crc ^ data[i])  & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcOut = Buffer.allocUnsafe(4);
    crcOut.writeUInt32BE(crc, 0);
    chunks.push(len, typeB, data, crcOut);
  }

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  writeChunk('IHDR', ihdr);
  writeChunk('IDAT', compressed);
  writeChunk('IEND', Buffer.alloc(0));

  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------
function hash(x, y, s = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 113.5) * 43758.5453;
  return n - Math.floor(n);
}
function smoothNoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix+1, iy, s);
  const c = hash(ix, iy+1, s), d = hash(ix+1, iy+1, s);
  return a + (b-a)*ux + (c-a)*uy + (a-b-c+d)*ux*uy;
}
function fbm(x, y, oct = 4, s = 0) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++, x *= 2, y *= 2, a *= 0.5) v += a * smoothNoise(x, y, s+i);
  return v;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Texture generators
// ---------------------------------------------------------------------------

const SIZE = 512;

const generators = {

  travertine_rock: {
    diff: (x, y) => {
      const n = fbm(x/40, y/40, 5, 1);
      const vein = Math.abs(Math.sin((x/8 + n*30) * 0.18));
      const base = lerp(0.88, 0.96, n);
      const v = base - vein * 0.14;
      const r = clamp(v * 240, 160, 235);
      const g = clamp(v * 225, 148, 218);
      const b = clamp(v * 210, 135, 200);
      return { r, g, b };
    },
    nor: (x, y) => {
      const h  = fbm(x/40, y/40, 5, 1) + fbm(x/6, y/6, 3, 11) * 0.2;
      const hx = fbm((x+1)/40, y/40, 5, 1) - fbm((x-1)/40, y/40, 5, 1);
      const hy = fbm(x/40, (y+1)/40, 5, 1) - fbm(x/40, (y-1)/40, 5, 1);
      return { r: clamp(128 + hx*80, 0, 255)|0, g: clamp(128 + hy*80, 0, 255)|0, b: 220 };
    },
    rough: (x, y) => {
      const v = 0.50 + fbm(x/30, y/30, 3, 3) * 0.22;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },

  volcanic_rock: {
    diff: (x, y) => {
      const n = fbm(x/18, y/18, 6, 7);
      const pore = 1 - Math.exp(-Math.pow(fbm(x/8, y/8, 4, 21) * 3, 2));
      const v = n * 0.35 + pore * 0.12;
      const r = clamp(30 + v * 55, 20, 80)|0;
      const g = clamp(26 + v * 45, 18, 68)|0;
      const b = clamp(22 + v * 38, 15, 58)|0;
      return { r, g, b };
    },
    nor: (x, y) => {
      const hx = fbm((x+1)/14, y/14, 5, 7) - fbm((x-1)/14, y/14, 5, 7);
      const hy = fbm(x/14, (y+1)/14, 5, 7) - fbm(x/14, (y-1)/14, 5, 7);
      return { r: clamp(128 + hx*110, 0, 255)|0, g: clamp(128 + hy*110, 0, 255)|0, b: 210 };
    },
    rough: (x, y) => {
      const v = 0.72 + fbm(x/16, y/16, 4, 9) * 0.20;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },

  metal_plate: {
    diff: (x, y) => {
      const brushed = fbm(x/1.2, y/48, 2, 5);
      const scratch = smoothNoise(x/3, y/0.6, 13) > 0.88 ? 0.06 : 0;
      const v = 0.62 + brushed * 0.22 - scratch;
      const r = clamp(v * 200, 120, 200)|0;
      const g = clamp(v * 205, 125, 205)|0;
      const b = clamp(v * 210, 130, 210)|0;
      return { r, g, b };
    },
    nor: (x, y) => {
      const hx = fbm((x+1)/1.2, y/48, 2, 5) - fbm((x-1)/1.2, y/48, 2, 5);
      const hy = fbm(x/1.2, (y+1)/48, 2, 5) - fbm(x/1.2, (y-1)/48, 2, 5);
      return { r: clamp(128 + hx*60, 0, 255)|0, g: clamp(128 + hy*18, 0, 255)|0, b: 240 };
    },
    rough: (x, y) => {
      const v = 0.28 + fbm(x/1.2, y/48, 2, 5) * 0.14;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },

  black_slate: {
    diff: (x, y) => {
      const n = fbm(x/22, y/8, 5, 17);
      const cleavage = Math.abs(Math.sin((y/3 + n * 12) * 0.9)) * 0.12;
      const v = 0.14 + n * 0.12 + cleavage;
      const r = clamp(v * 100, 18, 90)|0;
      const g = clamp(v * 95,  16, 85)|0;
      const b = clamp(v * 100, 18, 90)|0;
      return { r, g, b };
    },
    nor: (x, y) => {
      const hx = fbm((x+1)/22, y/8, 5, 17) - fbm((x-1)/22, y/8, 5, 17);
      const hy = fbm(x/22, (y+1)/8, 5, 17) - fbm(x/22, (y-1)/8, 5, 17);
      return { r: clamp(128 + hx*95, 0, 255)|0, g: clamp(128 + hy*95, 0, 255)|0, b: 215 };
    },
    rough: (x, y) => {
      const v = 0.68 + fbm(x/20, y/8, 4, 19) * 0.18;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },

  linen_fabric: {
    diff: (x, y) => {
      const warpU = Math.abs(Math.sin(x * 3.14159)) * 0.06;
      const weftV = Math.abs(Math.sin(y * 3.14159)) * 0.06;
      const weave = ((Math.floor(x) + Math.floor(y)) % 2 === 0) ? warpU : weftV;
      const n = fbm(x/6, y/6, 3, 23) * 0.08;
      const v = 0.82 + weave + n;
      const r = clamp(v * 228, 170, 228)|0;
      const g = clamp(v * 215, 160, 215)|0;
      const b = clamp(v * 200, 148, 200)|0;
      return { r, g, b };
    },
    nor: (x, y) => {
      const hx = (Math.abs(Math.sin(x * 3.14159)) - Math.abs(Math.sin((x-1) * 3.14159))) * 0.4;
      const hy = (Math.abs(Math.sin(y * 3.14159)) - Math.abs(Math.sin((y-1) * 3.14159))) * 0.4;
      return { r: clamp(128 + hx*50, 0, 255)|0, g: clamp(128 + hy*50, 0, 255)|0, b: 235 };
    },
    rough: (x, y) => {
      const weave = ((Math.floor(x) + Math.floor(y)) % 2 === 0) ? 0.78 : 0.84;
      const v = weave + fbm(x/4, y/4, 2, 27) * 0.08;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },

  light_oak_wood: {
    diff: (x, y) => {
      const grain = fbm(x/3.5, y/55, 4, 31);
      const ringN = (Math.sin((x/14 + grain * 8) * 0.45) + 1) * 0.5;
      const knot  = Math.exp(-((x-SIZE*0.38)**2 + (y-SIZE*0.22)**2) / (SIZE*8)**2) * 0.08;
      const v = 0.72 + ringN * 0.18 - knot;
      const r = clamp(v * 215, 148, 215)|0;
      const g = clamp(v * 175, 118, 175)|0;
      const b = clamp(v * 128, 80, 128)|0;
      return { r, g, b };
    },
    nor: (x, y) => {
      const hx = fbm((x+1)/3.5, y/55, 4, 31) - fbm((x-1)/3.5, y/55, 4, 31);
      const hy = fbm(x/3.5, (y+1)/55, 4, 31) - fbm(x/3.5, (y-1)/55, 4, 31);
      return { r: clamp(128 + hx*70, 0, 255)|0, g: clamp(128 + hy*22, 0, 255)|0, b: 228 };
    },
    rough: (x, y) => {
      const v = 0.45 + fbm(x/3.5, y/55, 3, 31) * 0.18;
      const c = clamp(v * 255, 0, 255)|0;
      return { r: c, g: c, b: c };
    },
  },
};

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------
const outBase = path.join('assets', 'textures');
let written = 0;

for (const [name, gen] of Object.entries(generators)) {
  const dir = path.join(outBase, name);
  fs.mkdirSync(dir, { recursive: true });

  for (const [type, fn] of Object.entries(gen)) {
    const suffix = type === 'nor' ? 'nor_gl' : type;
    const filePath = path.join(dir, `${name}_${suffix}_1k.jpg`);

    // Skip if already exists and non-empty (from a previous real download)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024) {
      console.log(`  skip  ${filePath}`);
      continue;
    }

    // Write PNG bytes with .jpg extension. Three.js TextureLoader uses the
    // image's magic bytes (not the extension) to decode format, so this works
    // correctly in all browsers. The .jpg extension matches the naming convention
    // used by all real PBR textures in assets/textures/ for drop-in compatibility.
    writePNG(filePath, SIZE, SIZE, (x, y) => fn(x / SIZE * SIZE, y / SIZE * SIZE));
    console.log(`  wrote ${filePath}`);
    written++;
  }
}

console.log(`\nDone. ${written} files written.`);
