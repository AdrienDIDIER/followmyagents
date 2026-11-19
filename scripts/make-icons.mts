// Génère les icônes de build : build/icon.png (1024) et build/icon.ico (16→256).
// Usage : node --experimental-strip-types scripts/make-icons.mts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Le dépôt est en CommonJS : on charge raster.ts comme module ESM temporaire.
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fma-icons-")), "raster.mjs");
fs.writeFileSync(tmp, stripTypeScriptTypes(fs.readFileSync(path.join(root, "src/main/raster.ts"), "utf8")));
const { drawMascot } = (await import(pathToFileURL(tmp).href)) as typeof import("../src/main/raster");

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(rgba: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Icône d'app : carré arrondi sombre + mascotte bleue. */
function appIcon(size: number): Uint8Array {
  const bg = new Uint8Array(size * size * 4);
  const r = size * 0.225;
  const m = size * 0.1; // marge façon icône macOS
  const ss = 3;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const cx = Math.min(Math.max(px, m + r), size - m - r);
          const cy = Math.min(Math.max(py, m + r), size - m - r);
          if (px >= m && py >= m && px <= size - m && py <= size - m && (px - cx) ** 2 + (py - cy) ** 2 <= r * r) cov++;
        }
      const i = (y * size + x) * 4;
      // léger dégradé vertical
      const t = y / size;
      bg[i] = Math.round(44 - 14 * t);
      bg[i + 1] = Math.round(44 - 14 * t);
      bg[i + 2] = Math.round(52 - 16 * t);
      bg[i + 3] = Math.round((cov / (ss * ss)) * 255);
    }
  const inner = Math.round(size * 0.56);
  const mascot = drawMascot({ width: inner, height: inner, face: "work", body: [10, 132, 255, 255], eyes: [0, 0, 0, 200], supersample: 3 });
  const ox = Math.round((size - inner) / 2);
  const oy = Math.round((size - inner) / 2 + size * 0.02);
  for (let y = 0; y < inner; y++)
    for (let x = 0; x < inner; x++) {
      const si = (y * inner + x) * 4;
      const di = ((y + oy) * size + (x + ox)) * 4;
      const a = mascot[si + 3] / 255;
      for (let c = 0; c < 3; c++) bg[di + c] = Math.round(mascot[si + c] * a + bg[di + c] * (1 - a));
    }
  return bg;
}

function ico(sizes: number[]): Buffer {
  const pngs = sizes.map((s) => encodePng(appIcon(s), s, s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + dir.length;
  sizes.forEach((s, i) => {
    const o = i * 16;
    dir[o] = s >= 256 ? 0 : s;
    dir[o + 1] = s >= 256 ? 0 : s;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(pngs[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build", "icon.png"), encodePng(appIcon(1024), 1024, 1024));
fs.writeFileSync(path.join(root, "build", "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("build/icon.png, build/icon.ico générés");
