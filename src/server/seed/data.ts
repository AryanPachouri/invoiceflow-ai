/**
 * Realistic fictional master data. Sample invoices in /public/samples reference these
 * vendors and purchase orders. All PO amounts are pre-tax (net) values.
 */
export interface SeedVendor {
  code: string;
  name: string;
  taxId: string;
  address: string;
  email: string;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface SeedPO {
  poNumber: string;
  vendorCode: string;
  description: string;
  currency: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

export const SEED_VENDORS: SeedVendor[] = [
  { code: "V-1001", name: "Apex Industrial Supplies Inc.", taxId: "84-3920175", address: "1450 Harbor Blvd, Oakland, CA 94607, USA", email: "billing@apexindustrial.example", currency: "USD", status: "ACTIVE" },
  { code: "V-1002", name: "Brightline Cloud Services LLC", taxId: "47-1182934", address: "88 Mission St, Suite 1200, San Francisco, CA 94105, USA", email: "ar@brightline.example", currency: "USD", status: "ACTIVE" },
  { code: "V-1003", name: "Nordic Freight Logistics GmbH", taxId: "DE298374615", address: "Speicherstadt 14, 20457 Hamburg, Germany", email: "rechnung@nordicfreight.example", currency: "EUR", status: "ACTIVE" },
  { code: "V-1004", name: "Meridian Print & Packaging Co.", taxId: "91-2203847", address: "620 Industrial Pkwy, Columbus, OH 43228, USA", email: "invoices@meridianprint.example", currency: "USD", status: "INACTIVE" },
  { code: "V-1005", name: "Summit Facilities Management", taxId: "36-5541290", address: "300 W Adams St, Chicago, IL 60606, USA", email: "accounts@summitfm.example", currency: "USD", status: "ACTIVE" },
  { code: "V-1006", name: "Orion Data Systems Ltd", taxId: "GB284771209", address: "21 Canal Reach, London N1C 4AB, United Kingdom", email: "finance@oriondata.example", currency: "GBP", status: "ACTIVE" },
];

export const SEED_POS: SeedPO[] = [
  {
    poNumber: "PO-2026-0141", vendorCode: "V-1001", currency: "USD", description: "Site safety equipment — Q4 restock",
    items: [
      { description: "Safety Helmet, Class E", quantity: 200, unitPrice: 45 },
      { description: "Hi-Vis Safety Vest", quantity: 400, unitPrice: 22.5 },
      { description: "Steel-Toe Work Boots", quantity: 50, unitPrice: 140 },
    ],
  },
  {
    poNumber: "PO-2026-0157", vendorCode: "V-1002", currency: "USD", description: "Cloud hosting subscription — FY2026 (monthly billing)",
    items: [{ description: "Managed Cloud Hosting - Monthly", quantity: 12, unitPrice: 3000 }],
  },
  {
    poNumber: "PO-2026-0166", vendorCode: "V-1002", currency: "USD", description: "Premium support retainer — FY2026",
    items: [{ description: "Premium Support Retainer - Monthly", quantity: 12, unitPrice: 800 }],
  },
  {
    poNumber: "PO-2026-0150", vendorCode: "V-1003", currency: "EUR", description: "Inbound freight — Hamburg to Rotterdam lane",
    items: [
      { description: "FTL Freight Hamburg-Rotterdam", quantity: 10, unitPrice: 1550 },
      { description: "Customs Documentation", quantity: 10, unitPrice: 300 },
    ],
  },
  {
    poNumber: "PO-2026-0133", vendorCode: "V-1004", currency: "USD", description: "Branded shipping cartons",
    items: [{ description: "Printed Shipping Carton 18x12x10", quantity: 5000, unitPrice: 1.84 }],
  },
  {
    poNumber: "PO-2026-0172", vendorCode: "V-1005", currency: "USD", description: "HQ facilities maintenance — H2 2026",
    items: [
      { description: "Monthly Janitorial Service", quantity: 6, unitPrice: 1500 },
      { description: "HVAC Preventive Maintenance", quantity: 2, unitPrice: 1500 },
    ],
  },
  {
    poNumber: "PO-2026-0188", vendorCode: "V-1006", currency: "GBP", description: "Data platform licences",
    items: [{ description: "Analytics Platform Licence - Annual", quantity: 5, unitPrice: 2400 }],
  },
];

/** Default business rules (also documented in docs/BUSINESS_RULES.md). */
export const DEFAULT_RULES = {
  version: 1,
  tolerancePercent: 2,
  toleranceAbsoluteMin: 1,
  allowedCurrencies: ["USD", "EUR", "GBP", "INR"],
  duplicateDetection: {
    byVendorAndInvoiceNumber: true,
    byFingerprint: true,
    action: "REJECT" as "REJECT" | "REVIEW",
  },
  autoApproval: {
    enabled: true,
    maxAmount: 50000,
    minExtractionConfidence: 70,
    requireExplicitPo: true,
  },
  hardFailures: {
    inactiveVendor: "REJECT" as "REJECT" | "REVIEW",
    poVendorMismatch: "REJECT" as "REJECT" | "REVIEW",
    unknownVendor: "REVIEW" as "REJECT" | "REVIEW",
  },
};

export type BusinessRules = typeof DEFAULT_RULES;
