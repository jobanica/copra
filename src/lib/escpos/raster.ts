"use client";

// Convert an image data URL (e.g. a signature PNG) into an ESC/POS raster
// bit-image block (GS v 0) for 58mm thermal printers (max ~384 dots wide).

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function rasterFromDataUrl(
  dataUrl: string,
  targetWidth = 360,
  maxHeight = 180,
): Promise<Uint8Array> {
  const img = await loadImage(dataUrl);
  const scale = targetWidth / img.width;
  const w = targetWidth;
  const h = Math.max(1, Math.min(maxHeight, Math.round(img.height * scale)));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const widthBytes = Math.ceil(w / 8);
  const out = new Uint8Array(8 + widthBytes * h);
  out[0] = 0x1d; // GS
  out[1] = 0x76; // v
  out[2] = 0x30; // 0
  out[3] = 0x00; // mode: normal
  out[4] = widthBytes & 0xff;
  out[5] = (widthBytes >> 8) & 0xff;
  out[6] = h & 0xff;
  out[7] = (h >> 8) & 0xff;

  let p = 8;
  for (let y = 0; y < h; y++) {
    for (let xb = 0; xb < widthBytes; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        if (x < w) {
          const i = (y * w + x) * 4;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          const alpha = px[i + 3];
          if (alpha > 32 && lum < 128) byte |= 0x80 >> bit;
        }
      }
      out[p++] = byte;
    }
  }
  return out;
}
