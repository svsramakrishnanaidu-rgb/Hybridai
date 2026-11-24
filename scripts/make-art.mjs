/**
 * Prepares the layered artwork from the supplied reference screenshot.
 *
 * The reference exists only as a flattened image, so every layer is derived
 * from it rather than invented. The avatar mask is a feathered ellipse around
 * the bust only — so breathing and parallax never move the tattooed hands or
 * the flames — and the heart layer is a separate alpha cut-out that stays
 * registered because it shares the artwork's exact canvas and crop.
 *
 * Run: node scripts/make-art.mjs
 */

import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const SRC =
  ".cloud-attachments/b1613d0380cba4d8ad447991ecaddb132454ae1a64da607bab2cbbac519b66ef.webp";

// Interface chrome removed: the rail and its gold edge end at x=90, the top
// bar at y=61, and the separator line is excluded from the bottom.
const ART = { left: 90, top: 61, width: 1456, height: 650 };
const MOBILE = { left: 330, top: 0, width: 900, height: ART.height };

const smoothstep = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

await mkdir("public/art", { recursive: true });

// ── erase the baked "Assistant | Standby" label ──────────────────────────
// A hard patch left a rectangle; this blurs and darkens the corner in place
// and composites it back through a feathered alpha mask, so the label becomes
// an illegible violet softness instead of a seam.
const raw = await sharp(SRC).extract(ART).toBuffer();
const REGION = { left: 0, top: 0, width: 380, height: 70 };
const softened = await sharp(raw)
  .extract(REGION)
  .blur(30)
  .modulate({ brightness: 0.2 })
  .toBuffer();
const maskSvg = `<svg width="${REGION.width}" height="${REGION.height}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="f"><feGaussianBlur stdDeviation="18"/></filter></defs><rect x="20" y="8" width="340" height="50" rx="18" fill="white" filter="url(#f)"/></svg>`;
const feathered = await sharp(softened)
  .ensureAlpha()
  .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
  .png()
  .toBuffer();
// A soft radial vignette finishes the job and gives the live status label a
// readable backing, exactly where the reference has its own status text.
const vignette = `<svg width="${ART.width}" height="${ART.height}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="18%" cy="3%" r="26%"><stop offset="0" stop-color="#0a0810" stop-opacity="1"/><stop offset=".55" stop-color="#0a0810" stop-opacity=".96"/><stop offset="1" stop-color="#0a0810" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
const clean = await sharp(raw)
  .composite([
    { input: feathered, left: REGION.left, top: REGION.top },
    { input: Buffer.from(vignette), left: 0, top: 0 },
  ])
  .toBuffer();

await sharp(clean).webp({ quality: 90 }).toFile("public/art/hydro-scene.webp");
await sharp(clean)
  .extract(MOBILE)
  .webp({ quality: 88 })
  .toFile("public/art/hydro-scene-mobile.webp");

// The eye inside the Start vision control, inside its gold border.
await sharp(SRC)
  .extract({ left: 1220, top: 758, width: 80, height: 52 })
  .webp({ quality: 92 })
  .toFile("public/art/vision-eye.webp");

/**
 * Build the avatar and heart cut-outs for one crop.
 * `heart` is given in that crop's normalised coordinates.
 */
async function buildLayers(buffer, { bust, heart }, suffix) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = info;
  const avatar = Buffer.alloc(width * height * 4);
  const heartLayer = Buffer.alloc(width * height * 4);
  const flames = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const nx = x / width;
      const ny = y / height;

      // A feathered ellipse around the bust: excludes the hands and flames.
      const distance = Math.sqrt(
        ((nx - bust.cx) / bust.rx) ** 2 + ((ny - bust.cy) / bust.ry) ** 2,
      );
      const bodyAlpha = 1 - smoothstep(0.72, 1, distance);
      avatar[i] = r;
      avatar[i + 1] = g;
      avatar[i + 2] = b;
      avatar[i + 3] = Math.round(bodyAlpha * 255);

      const heartDistance = Math.sqrt(
        ((nx - heart.cx) / heart.rx) ** 2 + ((ny - heart.cy) / heart.ry) ** 2,
      );
      const heartAlpha = 1 - smoothstep(0.4, 1, heartDistance);
      heartLayer[i] = Math.min(255, Math.round(r * 0.72 + 45));
      heartLayer[i + 1] = Math.min(255, Math.round(g * 1.05 + 35));
      heartLayer[i + 2] = Math.min(255, Math.round(b * 1.12 + 35));
      heartLayer[i + 3] = Math.round(heartAlpha * 240);

      // Violet light pass: only flame-coloured pixels, weighted by brightness.
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const violet = b > g + 8 && b >= r * 0.92 && saturation > 0.2 && max > 28;
      const weight = violet ? smoothstep(0, 150, b - g) * smoothstep(20, 150, b) : 0;
      flames[i] = Math.min(255, Math.round(r * 1.1 + 20));
      flames[i + 1] = Math.min(255, Math.round(g * 0.7));
      flames[i + 2] = Math.min(255, Math.round(b * 1.15 + 20));
      flames[i + 3] = Math.round(weight * 205);
    }
  }

  const encode = (buf, file, quality) =>
    sharp(buf, { raw: { width, height, channels: 4 } }).webp({ quality }).toFile(file);

  await encode(avatar, `public/art/hydro-avatar${suffix}.webp`, 86);
  await encode(heartLayer, `public/art/hydro-heart${suffix}.webp`, 88);
  await encode(flames, `public/art/hydro-flames${suffix}.webp`, 78);
  return { width, height };
}

// ── desktop: measure the heart from the brightest cyan mass ───────────────
{
  const { data, info } = await sharp(clean).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height } = info;
  let hx = 0;
  let hy = 0;
  let hw = 0;
  for (let y = Math.floor(height * 0.35); y < Math.floor(height * 0.9); y += 1) {
    for (let x = Math.floor(width * 0.45); x < Math.floor(width * 0.78); x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > 180 && g > 170 && g + b - 2 * r > 120) {
        const weight = (b - 150) / 100;
        hx += x * weight;
        hy += y * weight;
        hw += weight;
      }
    }
  }
  const heart = { cx: hx / hw / width, cy: hy / hw / height, rx: 0.075, ry: 0.1 };
  console.log(
    `heart at ${(heart.cx * 100).toFixed(1)}%, ${(heart.cy * 100).toFixed(1)}%`,
  );

  await buildLayers(
    clean,
    { bust: { cx: 0.59, cy: 0.56, rx: 0.16, ry: 0.53 }, heart },
    "",
  );

  // ── mobile: same geometry mapped into the art-directed crop ─────────────
  const mobileBuffer = await sharp(clean).extract(MOBILE).toBuffer();
  const mapX = (value) => (value * width - MOBILE.left) / MOBILE.width;
  await buildLayers(
    mobileBuffer,
    {
      bust: { cx: mapX(0.59), cy: 0.56, rx: 0.205, ry: 0.53 },
      heart: { cx: mapX(heart.cx), cy: heart.cy, rx: 0.105, ry: 0.1 },
    },
    "-mobile",
  );
  console.log(`mobile crop ${MOBILE.width}x${MOBILE.height}`);
}
