import path from "node:path";
import { createRequire } from "node:module";
import { renderPdfPages } from "./pdf-text";

/**
 * OCR fallback for scanned (image-only) PDFs.
 * Pages are rasterised with pdf.js + @napi-rs/canvas, then recognised with Tesseract
 * (tesseract.js, WASM). English language data is bundled via @tesseract.js-data/eng,
 * so no network access is needed at runtime.
 */
export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export interface OcrResult {
  lines: string[];
  text: string;
  confidence: number; // 0..100 mean word confidence
  pages: number;
}

function langPath() {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require.resolve("@tesseract.js-data/eng/package.json");
    return path.join(path.dirname(pkg), "4.0.0_best_int");
  } catch {
    return path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
  }
}

export async function ocrPdf(data: Uint8Array, timeoutMs: number): Promise<OcrResult> {
  let timer: NodeJS.Timeout | undefined;
  let worker: import("tesseract.js").Worker | undefined;
  const work = (async () => {
    const images = await renderPdfPages(data).catch((e) => {
      throw new OcrError(`Could not rasterise PDF for OCR: ${e instanceof Error ? e.message : e}`);
    });
    if (!images.length) throw new OcrError("PDF has no pages to OCR");
    const { createWorker, PSM } = await import("tesseract.js");
    worker = await createWorker("eng", 1, { langPath: langPath(), gzip: true, cacheMethod: "none" });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    const lines: string[] = [];
    let confSum = 0;
    for (const img of images) {
      const { data: d } = await worker.recognize(img);
      confSum += d.confidence;
      lines.push(...d.text.split("\n").map((l) => l.replace(/\s{3,}/g, " | ").replace(/\s+/g, " ").trim()).filter(Boolean));
    }
    return { lines, text: lines.join("\n"), confidence: Math.round((confSum / images.length) * 10) / 10, pages: images.length };
  })();
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new OcrError(`OCR timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await worker?.terminate().catch(() => undefined);
  }
}
