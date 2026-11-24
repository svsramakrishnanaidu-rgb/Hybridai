"use client";

/**
 * HYDRO AI — freezing and cropping one frame.
 *
 * A page being photographed moves; a frozen frame is what the user actually
 * saw when they asked. Cropping happens here, in the tab, before anything is
 * uploaded: only the selected region leaves the device, and only for the one
 * question it was captured for.
 */

import { cropBox, isUsableRect, type SelectionRect } from "@/lib/vision/selection";

async function loadBitmap(dataUrl: string): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Crop a frozen JPEG/data URL to the selected region. */
export async function cropDataUrl(
  dataUrl: string,
  rect: SelectionRect,
  maxWidth = 900,
): Promise<{ dataUrl: string; mime: string } | null> {
  if (!isUsableRect(rect)) return null;
  const source = await loadBitmap(dataUrl);
  if (!source) return null;
  const width = "width" in source ? source.width : 0;
  const height = "height" in source ? source.height : 0;
  const box = cropBox(rect, width, height, maxWidth);
  if (!box) return null;
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, box.width, box.height);
  if ("close" in source) source.close();
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.8), mime: "image/jpeg" };
}
