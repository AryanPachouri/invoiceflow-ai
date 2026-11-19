import { createDb, setDbForTesting, type Db } from "@/server/db";
import { setStorageForTesting } from "@/server/storage";
import { seedHistory, seedMasterData } from "@/server/seed";
import { generateInvoicePdf, type InvoiceSpec } from "../tools/invoice-pdf";
import { SEED_VENDORS } from "@/server/seed/data";

export async function freshDb(opts: { history?: boolean } = {}): Promise<Db> {
  setStorageForTesting(undefined);
  const db = await createDb({ pgliteDir: "memory://" });
  setDbForTesting(db);
  await seedMasterData(db);
  if (opts.history !== false) await seedHistory(db);
  return db;
}

export function vendor(code: string) {
  const v = SEED_VENDORS.find((x) => x.code === code)!;
  return { name: v.name, address: v.address, taxId: v.taxId, email: v.email };
}

export async function pdf(spec: InvoiceSpec) {
  return Buffer.from(await generateInvoicePdf(spec));
}
