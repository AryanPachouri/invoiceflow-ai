// The standalone server needs static assets, public files, migrations and seed invoices next to it.
import fs from "node:fs";
const out = ".next/standalone";
if (!fs.existsSync(out)) process.exit(0);
const copy = (src, dst) => fs.existsSync(src) && fs.cpSync(src, dst, { recursive: true });
copy(".next/static", `${out}/.next/static`);
copy("public", `${out}/public`);
copy("db", `${out}/db`);
fs.rmSync(`${out}/.data`, { recursive: true, force: true }); // never ship local runtime data
console.log("standalone assets copied");
