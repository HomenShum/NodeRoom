import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFinanceDomainReceipt,
  buildFreshRoomProofRegistry,
} from "../src/eval/freshRoomProofReceipts";

function writeJson(relPath: string, value: unknown) {
  mkdirSync(path.dirname(relPath), { recursive: true });
  writeFileSync(relPath, `${JSON.stringify(value, null, 2)}\n`);
}

const generatedAt = new Date().toISOString();
const financeReceipt = buildFinanceDomainReceipt({ generatedAt });
const registry = buildFreshRoomProofRegistry({ generatedAt });

writeJson("docs/eval/fresh-room/FR-020/finance-domain-receipt.json", financeReceipt);
writeJson("docs/eval/fresh-room/proof-registry.json", registry);

console.log(JSON.stringify(registry.summary, null, 2));
