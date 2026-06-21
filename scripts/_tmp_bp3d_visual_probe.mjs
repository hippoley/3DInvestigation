import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";

function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("invalid PNG signature");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG format ${bitDepth}/${colorType}/${interlace}`);
  }
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * bytesPerPixel);
  let srcOffset = 0;
  let dstOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[srcOffset++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[srcOffset++];
      const left = x >= bytesPerPixel ? out[dstOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[dstOffset + x - stride] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[dstOffset + x - stride - bytesPerPixel] : 0;
      let value = rawByte;
      if (filter === 1) value = (rawByte + left) & 0xff;
      else if (filter === 2) value = (rawByte + up) & 0xff;
      else if (filter === 3) value = (rawByte + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft);
        value = (rawByte + pred) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      out[dstOffset + x] = value;
    }
    dstOffset += stride;
  }
  return { width, height, data: out };
}

function computeMetrics(image) {
  const sampleRect = {
    x: Math.round(image.width * 0.27),
    y: Math.round(image.height * 0.36),
    w: Math.round(image.width * 0.30),
    h: Math.round(image.height * 0.28),
  };
  let sum = 0;
  let bright = 0;
  let dark = 0;
  const buckets = new Array(16).fill(0);
  for (let y = sampleRect.y; y < sampleRect.y + sampleRect.h; y++) {
    for (let x = sampleRect.x; x < sampleRect.x + sampleRect.w; x++) {
      const i = (y * image.width + x) * 4;
      const lum = 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
      sum += lum;
      if (lum >= 185) bright++;
      if (lum <= 85) dark++;
      buckets[Math.min(15, Math.floor(lum / 16))]++;
    }
  }
  const pixels = sampleRect.w * sampleRect.h;
  return {
    image: { width: image.width, height: image.height },
    sampleRect,
    avgLuma: +(sum / pixels).toFixed(3),
    brightRatio: +(bright / pixels).toFixed(4),
    darkRatio: +(dark / pixels).toFixed(4),
    buckets: buckets.map((v) => +(v / pixels).toFixed(4)),
  };
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:4173/bp3d-pure.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => !!window.__bp3dApi?.debugFurnitureMaterialStateStats, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.__bp3dApi.debugFurnitureMaterialStateStats().total || 0) > 0, null, { timeout: 90_000 });
  await page.evaluate(() => { window.__bp3dApi.flyToInterior(0); });
  await page.waitForTimeout(1200);
  const canvasRect = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    if (!canvas) throw new Error("#canvas missing");
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  });
  const png = await page.screenshot({ clip: canvasRect, type: "png" });
  const metrics = computeMetrics(decodePng(png));
  writeFileSync("downloads/bp3d-visual-probe.json", JSON.stringify(metrics, null, 2) + "\n", "utf8");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
