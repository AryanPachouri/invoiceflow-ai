/**
 * Machine-readable PDF text extraction with layout reconstruction.
 * pdf.js returns positioned text fragments; we group them into visual lines by their
 * y-coordinate and join fragments with wide horizontal gaps using " | " so that table
 * columns survive (important for line-item parsing).
 */
export interface ExtractedPage {
  lines: string[];
  charCount: number;
}

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}

async function loadPdf(data: Uint8Array) {
  const { getDocumentProxy } = await import("unpdf");
  try {
    return await getDocumentProxy(new Uint8Array(data));
  } catch (e) {
    throw new PdfParseError(`The file could not be parsed as a PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface Frag { x: number; y: number; w: number; h: number; s: string }

export async function extractPdfText(data: Uint8Array): Promise<{ pages: ExtractedPage[]; pageCount: number; text: string }> {
  const pdf = await loadPdf(data);
  const pages: ExtractedPage[] = [];
  const maxPages = Math.min(pdf.numPages, 10);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const frags: Frag[] = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!item.str || !item.transform || !item.str.trim()) continue;
      frags.push({ x: item.transform[4], y: item.transform[5], w: item.width ?? 0, h: item.height || Math.abs(item.transform[3]) || 10, s: item.str });
    }
    // group into lines (top to bottom)
    frags.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Frag[][] = [];
    for (const f of frags) {
      const row = rows.find((r) => Math.abs(r[0].y - f.y) <= Math.max(2, f.h * 0.35));
      if (row) row.push(f);
      else rows.push([f]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    const lines = rows.map((r) => {
      r.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd = -Infinity;
      for (const f of r) {
        const gap = f.x - prevEnd;
        if (out) out += gap > Math.max(12, f.h * 1.2) ? " | " : gap > 1 ? " " : "";
        out += f.s.trim();
        prevEnd = f.x + f.w;
      }
      return out.replace(/\s+/g, " ").trim();
    });
    pages.push({ lines, charCount: lines.join("").replace(/\s/g, "").length });
  }
  return { pages, pageCount: pdf.numPages, text: pages.map((p) => p.lines.join("\n")).join("\n\f\n") };
}

/**
 * Render PDF pages to PNG for OCR.
 * Pages are scaled to a target pixel width (~2000px) rather than a fixed multiplier, so
 * unusually small page sizes (e.g. exported web templates) still give Tesseract enough
 * resolution. An explicit `scale` overrides this.
 */
export async function renderPdfPages(data: Uint8Array, scale?: number, maxPages = 3, targetWidthPx = 2000): Promise<Buffer[]> {
  const { renderPageAsImage } = await import("unpdf");
  const pdf = await loadPdf(data);
  const out: Buffer[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const page = await pdf.getPage(p);
    const width = page.getViewport({ scale: 1 }).width || 612;
    const s = scale ?? Math.min(Math.max(targetWidthPx / width, 1.5), 8);
    const img = await renderPageAsImage(new Uint8Array(data), p, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: s,
    });
    out.push(Buffer.from(img));
  }
  return out;
}
