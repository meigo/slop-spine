import type { Trim } from "./trim";

export interface Region {
  name: string;
  trim: Trim;
  pageX: number;
  pageY: number;
}

const PAD = 2;

/** Shelf-pack trimmed regions into one page and write the Spine 4.2 .atlas text.
 *  scale:1, rotate:false — deliberately the simplest thing that works. */
export function packAtlas(
  items: { name: string; trim: Trim }[],
  canvasW: number,
  canvasH: number,
  pageWidth = 2048,
): { regions: Region[]; pageWidth: number; pageHeight: number; text: string } {
  const sorted = [...items].sort((a, b) => b.trim.height - a.trim.height);
  // Grow page width to fit the widest item with padding.
  const widest = items.length ? Math.max(...items.map((it) => it.trim.width)) : 0;
  const needed = widest + 2 * PAD;
  pageWidth = Math.max(pageWidth, needed > 0 ? 2 ** Math.ceil(Math.log2(needed)) : 0);
  const regions: Region[] = [];
  let x = PAD,
    y = PAD,
    rowHeight = 0;
  for (const it of sorted) {
    if (x + it.trim.width + PAD > pageWidth) {
      x = PAD;
      y += rowHeight + PAD;
      rowHeight = 0;
    }
    regions.push({ name: it.name, trim: it.trim, pageX: x, pageY: y });
    x += it.trim.width + PAD;
    rowHeight = Math.max(rowHeight, it.trim.height);
  }
  const used = y + rowHeight + PAD;
  const pageHeight = Math.max(16, 2 ** Math.ceil(Math.log2(used)));

  const lines = [
    "skeleton.png",
    `size:${pageWidth},${pageHeight}`,
    "filter:Linear,Linear",
    "pma:false",
    "scale:1",
  ];
  for (const r of regions) {
    // offsetY is measured from the BOTTOM of the original canvas.
    const offsetY = canvasH - (r.trim.y + r.trim.height);
    lines.push(
      r.name,
      `bounds:${r.pageX},${r.pageY},${r.trim.width},${r.trim.height}`,
      `offsets:${r.trim.x},${offsetY},${canvasW},${canvasH}`,
      "rotate:false",
    );
  }
  return { regions, pageWidth, pageHeight, text: lines.join("\n") + "\n" };
}
