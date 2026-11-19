// Images de l'icône système, générées à la volée (pas de fichiers à embarquer).
// - macOS : image « template » monochrome (la barre des menus l'adapte au mode
//   clair/sombre), yeux = trous ; le nombre d'agents en attente est affiché
//   à côté via tray.setTitle.
// - Windows : mascotte bleue (yeux ronds si quelqu'un attend) + pastille orange avec le nombre.
import { nativeImage, type NativeImage } from "electron";
import { drawMascot, toBgraPremultiplied, type Face } from "./raster";

const BLUE: [number, number, number, number] = [10, 132, 255, 255];
const ORANGE: [number, number, number, number] = [255, 159, 10, 255];
const EYES: [number, number, number, number] = [0, 0, 0, 205];

const cache = new Map<string, NativeImage>();

export function trayImage(face: Face, waiting: number, platform = process.platform): NativeImage {
  const key = `${platform}:${face}:${Math.min(waiting, 10)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = nativeImage.createEmpty();
  if (platform === "darwin") {
    // 16 pt de haut : 14×16 @1x, 28×32 @2x
    for (const scale of [1, 2]) {
      const w = 14 * scale;
      const h = 16 * scale;
      const px = drawMascot({ width: w, height: h, face, body: [0, 0, 0, 255], eyes: null });
      img.addRepresentation({ scaleFactor: scale, width: w, height: h, buffer: toBgraPremultiplied(px) });
    }
    img.setTemplateImage(true);
  } else {
    for (const scale of [1, 1.25, 1.5, 2]) {
      const s = Math.round(16 * scale);
      const px = drawMascot({
        width: s,
        height: s,
        face,
        body: BLUE,
        eyes: EYES,
        padding: 1,
        badge: waiting > 0 ? { count: waiting, color: ORANGE, text: [0, 0, 0, 230] } : undefined,
      });
      img.addRepresentation({ scaleFactor: scale, width: s, height: s, buffer: toBgraPremultiplied(px) });
    }
  }
  cache.set(key, img);
  return img;
}
