import fs from "node:fs";
import path from "node:path";
import { generateInvoicePdf } from "../tools/invoice-pdf";
import { DEMO_SAMPLES, HISTORY_SAMPLES } from "../tools/sample-specs";

async function main() {
  const pub = path.join(process.cwd(), "public", "samples");
  const hist = path.join(process.cwd(), "db", "seed-invoices");
  fs.mkdirSync(pub, { recursive: true });
  fs.mkdirSync(hist, { recursive: true });
  for (const s of DEMO_SAMPLES) {
    fs.writeFileSync(path.join(pub, s.file), await generateInvoicePdf(s.spec));
    console.log("wrote public/samples/" + s.file);
  }
  for (const s of HISTORY_SAMPLES) {
    fs.writeFileSync(path.join(hist, s.file), await generateInvoicePdf(s.spec));
    console.log("wrote db/seed-invoices/" + s.file);
  }
  const manifest = DEMO_SAMPLES.map(({ file, title, scenario, expected, spec }) => ({
    file, title, scenario, expected, scanned: !!spec.scanned,
  }));
  fs.writeFileSync(path.join(process.cwd(), "src", "lib", "samples-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("wrote src/lib/samples-manifest.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
