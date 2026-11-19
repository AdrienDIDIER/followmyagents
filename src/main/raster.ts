// Rasteriseur minimal de la mascotte (formes arrondies + anticrénelage par
// suréchantillonnage). Aucune dépendance : utilisé par l'app (icône système)
// et par scripts/make-icons.mts (icônes de build).
//
// Géométrie : viewBox 28×32 de docs/design (symbol "m" et "m-alert").

export type Rgba = [number, number, number, number]; // 0..255
type Shape = (x: number, y: number) => boolean;

const roundRect =
  (x: number, y: number, w: number, h: number, r: number): Shape =>
  (px, py) => {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const cx = Math.min(Math.max(px, x + r), x + w - r);
    const cy = Math.min(Math.max(py, y + r), y + h - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
const circle =
  (cx: number, cy: number, r: number): Shape =>
  (px, py) =>
    (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
const any =
  (...s: Shape[]): Shape =>
  (x, y) =>
    s.some((f) => f(x, y));

export type Face = "work" | "alert" | "idle";

const BODY = any(roundRect(2, 1, 24, 25, 8), roundRect(8, 25, 3, 6, 1.5), roundRect(17, 25, 3, 6, 1.5));
const FACES: Record<Face, Shape> = {
  work: any(roundRect(8.5, 10, 3, 4.5, 1.5), roundRect(16.5, 10, 3, 4.5, 1.5)),
  alert: any(circle(10, 12, 2.6), circle(18, 12, 2.6), roundRect(11.5, 18, 5, 2, 1)),
  idle: any(roundRect(8.5, 12, 3, 2, 1), roundRect(16.5, 12, 3, 2, 1)),
};

/** 3×5 chiffres pour la pastille (Windows). */
const DIGITS: Record<string, string[]> = {
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

export interface MascotOptions {
  /** taille du canevas en pixels */
  width: number;
  height: number;
  face: Face;
  /** couleur du corps ; yeux = trous transparents si eyes === null */
  body: Rgba;
  eyes: Rgba | null;
  /** pastille orange avec un nombre (coin bas droit) */
  badge?: { count: number; color: Rgba; text: Rgba };
  /** marge intérieure en unités du viewBox */
  padding?: number;
  supersample?: number;
}

/** Renvoie des pixels RGBA (non prémultipliés), ligne par ligne. */
export function drawMascot(o: MascotOptions): Uint8Array {
  const { width: W, height: H } = o;
  const ss = o.supersample ?? 4;
  const pad = o.padding ?? 0;
  // ajuste le viewBox 28×32 (+ marge) dans le canevas, centré
  const vbW = 28 + pad * 2;
  const vbH = 32 + pad * 2;
  const scale = Math.min(W / vbW, H / vbH);
  const offX = (W - vbW * scale) / 2;
  const offY = (H - vbH * scale) / 2;
  const face = FACES[o.face];
  const out = new Uint8Array(W * H * 4);

  const badge = o.badge && o.badge.count > 0 ? o.badge : undefined;
  const bR = W * 0.3;
  const bCx = W - bR;
  const bCy = H - bR;
  const label = badge ? (badge.count > 9 ? "+" : String(badge.count)) : "";

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          let c: Rgba | null = null;
          if (badge && (px - bCx) ** 2 + (py - bCy) ** 2 <= bR * bR) {
            // chiffre en pixels (grille 3×5 centrée dans la pastille)
            const cell = (bR * 1.2) / 5;
            const gx = Math.floor((px - (bCx - cell * 1.5)) / cell);
            const gy = Math.floor((py - (bCy - cell * 2.5)) / cell);
            const on = DIGITS[label]?.[gy]?.[gx] === "1";
            c = on ? badge.text : badge.color;
          } else {
            const vx = (px - offX) / scale - pad;
            const vy = (py - offY) / scale - pad;
            if (BODY(vx, vy)) {
              if (face(vx, vy)) c = o.eyes;
              else c = o.body;
            }
          }
          if (c) {
            const ca = c[3] / 255;
            r += c[0] * ca;
            g += c[1] * ca;
            b += c[2] * ca;
            a += ca;
          }
        }
      }
      const n = ss * ss;
      const i = (y * W + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** RGBA → BGRA prémultiplié (format attendu par nativeImage.createFromBitmap). */
export function toBgraPremultiplied(rgba: Uint8Array): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i + 2] * a);
    out[i + 1] = Math.round(rgba[i + 1] * a);
    out[i + 2] = Math.round(rgba[i] * a);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}
