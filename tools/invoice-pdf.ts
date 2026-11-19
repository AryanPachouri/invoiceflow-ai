/**
 * Invoice PDF generator — produces realistic sample invoices in three vendor layouts,
 * either as machine-readable PDFs or as "scanned" image-only PDFs (for OCR testing).
 * Used by `npm run samples:generate` and by the automated tests.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

export interface InvoiceSpec {
  layout: "classic" | "modern" | "compact";
  vendor: { name: string; address: string; taxId?: string; email?: string };
  billTo?: string;
  invoiceNumber?: string;
  invoiceDate?: string; // ISO yyyy-mm-dd
  dueDate?: string;
  poNumber?: string;
  currency: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  taxRate?: number; // percent
  taxAmountOverride?: number;
  omitTotal?: boolean;
  notes?: string;
  scanned?: boolean;
}

type Align = "left" | "right";
interface Painter {
  text(x: number, y: number, s: string, o?: { size?: number; bold?: boolean; color?: [number, number, number]; align?: Align }): void;
  rect(x: number, y: number, w: number, h: number, color: [number, number, number]): void;
  line(x1: number, y1: number, x2: number, y2: number, color?: [number, number, number]): void;
}

const W = 612;
const H = 792;
const SYM: Record<string, string> = { USD: "$", EUR: "EUR ", GBP: "£", INR: "INR " };

function money(n: number, currency: string) {
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYM[currency] ?? currency + " "}${s}`;
}
function fmtDate(iso: string, style: "long" | "us" | "iso") {
  const [y, m, d] = iso.split("-").map(Number);
  if (style === "iso") return iso;
  if (style === "us") return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${d} ${mon} ${y}`;
}

export function computeTotals(spec: InvoiceSpec) {
  const lines = spec.items.map((i) => ({ ...i, amount: Math.round(i.quantity * i.unitPrice * 100) / 100 }));
  const subtotal = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const tax = spec.taxAmountOverride ?? Math.round(subtotal * (spec.taxRate ?? 0)) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { lines, subtotal, tax, total };
}

function draw(p: Painter, spec: InvoiceSpec) {
  const { lines, subtotal, tax, total } = computeTotals(spec);
  const c = spec.currency;
  const navy: [number, number, number] = [0.07, 0.13, 0.27];
  const grey: [number, number, number] = [0.4, 0.43, 0.5];
  const billTo = spec.billTo ?? "Contoso Manufacturing Corp.\nAccounts Payable\n500 Market Street, Denver, CO 80202, USA";

  if (spec.layout === "classic") {
    p.text(50, 740, spec.vendor.name, { size: 16, bold: true, color: navy });
    spec.vendor.address.split(", ").reduce((y, part, i, arr) => {
      if (i % 2 === 0) p.text(50, y, arr.slice(i, i + 2).join(", "), { size: 9, color: grey });
      return i % 2 === 0 ? y - 12 : y;
    }, 724);
    if (spec.vendor.taxId) p.text(50, 688, `Tax ID: ${spec.vendor.taxId}`, { size: 9, color: grey });
    p.text(562, 740, "INVOICE", { size: 24, bold: true, color: navy, align: "right" });
    let y = 640;
    const meta: [string, string | undefined][] = [
      ["Invoice Number:", spec.invoiceNumber],
      ["Invoice Date:", spec.invoiceDate && fmtDate(spec.invoiceDate, "long")],
      ["Due Date:", spec.dueDate && fmtDate(spec.dueDate, "long")],
      ["PO Number:", spec.poNumber],
      ["Currency:", c],
    ];
    for (const [k, v] of meta) {
      if (!v) continue;
      p.text(340, y, k, { size: 10, bold: true });
      p.text(562, y, v, { size: 10, align: "right" });
      y -= 16;
    }
    p.text(50, 640, "Bill To", { size: 10, bold: true });
    billTo.split("\n").forEach((l, i) => p.text(50, 624 - i * 13, l, { size: 10 }));
    y = 520;
    p.rect(50, y - 6, 512, 22, [0.92, 0.94, 0.98]);
    p.text(58, y, "Description", { size: 10, bold: true });
    p.text(350, y, "Qty", { size: 10, bold: true, align: "right" });
    p.text(450, y, "Unit Price", { size: 10, bold: true, align: "right" });
    p.text(554, y, "Amount", { size: 10, bold: true, align: "right" });
    y -= 26;
    for (const l of lines) {
      p.text(58, y, l.description, { size: 10 });
      p.text(350, y, String(l.quantity), { size: 10, align: "right" });
      p.text(450, y, money(l.unitPrice, c), { size: 10, align: "right" });
      p.text(554, y, money(l.amount, c), { size: 10, align: "right" });
      y -= 20;
    }
    p.line(340, y + 6, 562, y + 6);
    y -= 12;
    p.text(450, y, "Subtotal", { size: 10, align: "right" });
    p.text(554, y, money(subtotal, c), { size: 10, align: "right" });
    y -= 16;
    p.text(450, y, spec.taxRate !== undefined ? `Tax (${spec.taxRate}%)` : "Tax", { size: 10, align: "right" });
    p.text(554, y, money(tax, c), { size: 10, align: "right" });
    if (!spec.omitTotal) {
      y -= 20;
      p.text(450, y, "Total Due", { size: 12, bold: true, align: "right" });
      p.text(554, y, money(total, c), { size: 12, bold: true, align: "right" });
    }
    p.text(50, 90, spec.notes ?? "Payment terms: Net 30. Please reference the invoice number with your remittance.", { size: 8, color: grey });
    if (spec.vendor.email) p.text(50, 76, `Questions? ${spec.vendor.email}`, { size: 8, color: grey });
    return;
  }

  if (spec.layout === "modern") {
    p.rect(0, 712, W, 80, navy);
    p.text(40, 752, spec.vendor.name, { size: 18, bold: true, color: [1, 1, 1] });
    p.text(40, 732, spec.vendor.address, { size: 9, color: [0.85, 0.88, 0.95] });
    p.text(572, 752, "TAX INVOICE", { size: 14, bold: true, color: [1, 1, 1], align: "right" });
    if (spec.vendor.taxId) p.text(572, 732, `VAT No. ${spec.vendor.taxId}`, { size: 9, color: [0.85, 0.88, 0.95], align: "right" });
    const meta: [string, string | undefined][] = [
      ["Invoice #", spec.invoiceNumber],
      ["Issue date", spec.invoiceDate && fmtDate(spec.invoiceDate, "long")],
      ["Payment due", spec.dueDate && fmtDate(spec.dueDate, "long")],
      ["Purchase Order", spec.poNumber],
    ];
    let x = 40;
    for (const [k, v] of meta) {
      p.text(x, 680, k, { size: 8, color: grey });
      p.text(x, 666, v ?? "—", { size: 11, bold: true });
      x += 135;
    }
    p.text(40, 630, "Billed to", { size: 8, color: grey });
    billTo.split("\n").forEach((l, i) => p.text(40, 616 - i * 13, l, { size: 10 }));
    let y = 540;
    p.line(40, y + 14, 572, y + 14, navy);
    p.text(40, y, "Item", { size: 9, bold: true });
    p.text(370, y, "Quantity", { size: 9, bold: true, align: "right" });
    p.text(470, y, "Rate", { size: 9, bold: true, align: "right" });
    p.text(572, y, "Line Total", { size: 9, bold: true, align: "right" });
    p.line(40, y - 6, 572, y - 6, navy);
    y -= 24;
    for (const l of lines) {
      p.text(40, y, l.description, { size: 10 });
      p.text(370, y, String(l.quantity), { size: 10, align: "right" });
      p.text(470, y, money(l.unitPrice, c), { size: 10, align: "right" });
      p.text(572, y, money(l.amount, c), { size: 10, align: "right" });
      y -= 20;
    }
    y -= 10;
    p.text(470, y, "Net amount", { size: 10, align: "right" });
    p.text(572, y, money(subtotal, c), { size: 10, align: "right" });
    y -= 16;
    p.text(470, y, spec.taxRate !== undefined ? `VAT ${spec.taxRate}%` : "VAT", { size: 10, align: "right" });
    p.text(572, y, money(tax, c), { size: 10, align: "right" });
    if (!spec.omitTotal) {
      y -= 24;
      p.rect(330, y - 8, 242, 26, [0.92, 0.94, 0.98]);
      p.text(470, y, `Amount due (${c})`, { size: 11, bold: true, align: "right" });
      p.text(566, y, money(total, c), { size: 11, bold: true, align: "right" });
    }
    p.text(40, 80, spec.notes ?? "Bank transfer within 30 days. Thank you for your business.", { size: 8, color: grey });
    return;
  }

  // compact
  p.text(50, 745, spec.vendor.name.toUpperCase(), { size: 13, bold: true });
  p.text(50, 731, spec.vendor.address, { size: 8, color: grey });
  if (spec.vendor.taxId) p.text(50, 719, `EIN ${spec.vendor.taxId}`, { size: 8, color: grey });
  p.line(50, 708, 562, 708);
  p.text(50, 690, "Bill No.", { size: 9, bold: true });
  p.text(120, 690, spec.invoiceNumber ?? "", { size: 9 });
  p.text(50, 676, "Dated", { size: 9, bold: true });
  p.text(120, 676, spec.invoiceDate ? fmtDate(spec.invoiceDate, "us") : "", { size: 9 });
  p.text(330, 690, "Customer PO Ref", { size: 9, bold: true });
  p.text(450, 690, spec.poNumber ?? "", { size: 9 });
  p.text(330, 676, "Terms", { size: 9, bold: true });
  p.text(450, 676, spec.dueDate ? `Due ${fmtDate(spec.dueDate, "us")}` : "Due on receipt", { size: 9 });
  p.text(50, 650, "Sold To: " + billTo.split("\n")[0], { size: 9 });
  let y = 610;
  p.text(50, y, "Description", { size: 9, bold: true });
  p.text(360, y, "Qty", { size: 9, bold: true, align: "right" });
  p.text(460, y, "Unit Cost", { size: 9, bold: true, align: "right" });
  p.text(562, y, "Extended", { size: 9, bold: true, align: "right" });
  p.line(50, y - 5, 562, y - 5);
  y -= 20;
  for (const l of lines) {
    p.text(50, y, l.description, { size: 9 });
    p.text(360, y, String(l.quantity), { size: 9, align: "right" });
    p.text(460, y, money(l.unitPrice, c), { size: 9, align: "right" });
    p.text(562, y, money(l.amount, c), { size: 9, align: "right" });
    y -= 16;
  }
  y -= 10;
  p.text(460, y, "Sub Total", { size: 9, align: "right" });
  p.text(562, y, money(subtotal, c), { size: 9, align: "right" });
  y -= 14;
  p.text(460, y, spec.taxRate !== undefined ? `Sales Tax @ ${spec.taxRate}%` : "Sales Tax", { size: 9, align: "right" });
  p.text(562, y, money(tax, c), { size: 9, align: "right" });
  if (!spec.omitTotal) {
    y -= 16;
    p.text(460, y, "Grand Total", { size: 10, bold: true, align: "right" });
    p.text(562, y, money(total, c), { size: 10, bold: true, align: "right" });
  }
  p.text(50, 80, spec.notes ?? "All amounts in " + c + ".", { size: 8, color: grey });
}

async function textPdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${spec.invoiceNumber ?? ""}`.trim());
  doc.setProducer("InvoiceFlow sample generator");
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const painter: Painter = {
    text(x, y, s, o = {}) {
      const f = o.bold ? bold : font;
      const size = o.size ?? 10;
      const w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: o.align === "right" ? x - w : x, y, size, font: f, color: rgb(...(o.color ?? [0.1, 0.1, 0.15])) });
    },
    rect(x, y, w, h, color) { page.drawRectangle({ x, y, width: w, height: h, color: rgb(...color) }); },
    line(x1, y1, x2, y2, color = [0.75, 0.78, 0.82]) {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.8, color: rgb(...color) });
    },
  };
  draw(painter, spec);
  return doc.save({ useObjectStreams: false });
}

async function scannedPdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const scale = 200 / 72; // 200 DPI
  const canvas = createCanvas(Math.round(W * scale), Math.round(H * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  // slight skew like a real scan
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((0.35 * Math.PI) / 180);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  const toPx = (x: number, y: number) => [x * scale, (H - y) * scale] as const;
  const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
  const painter: Painter = {
    text(x, y, s, o = {}) {
      const size = (o.size ?? 10) * scale;
      ctx.font = `${o.bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = css(o.color ?? [0.1, 0.1, 0.15]);
      ctx.textAlign = o.align === "right" ? "right" : "left";
      const [px, py] = toPx(x, y);
      ctx.fillText(s, px, py);
    },
    rect(x, y, w, h, color) {
      ctx.fillStyle = css(color);
      const [px, py] = toPx(x, y + h);
      ctx.fillRect(px, py, w * scale, h * scale);
    },
    line(x1, y1, x2, y2, color = [0.6, 0.62, 0.66]) {
      ctx.strokeStyle = css(color);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...toPx(x1, y1));
      ctx.lineTo(...toPx(x2, y2));
      ctx.stroke();
    },
  };
  draw(painter, spec);
  ctx.restore();
  // light speckle noise
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = "rgba(60,60,60,0.25)";
  for (let i = 0; i < 2500; i++) ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 1.5, 1.5);
  const jpg = await canvas.encode("jpeg", 82);
  const doc = await PDFDocument.create();
  doc.setProducer("Scanner XR-200 (simulated)");
  const page = doc.addPage([W, H]);
  const img = await doc.embedJpg(jpg);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H, rotate: degrees(0) });
  return doc.save();
}

export async function generateInvoicePdf(spec: InvoiceSpec): Promise<Uint8Array> {
  return spec.scanned ? scannedPdf(spec) : textPdf(spec);
}
