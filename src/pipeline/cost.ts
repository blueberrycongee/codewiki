import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../config.js";
import type { CostRecord } from "../types.js";

const COST_LOG_PATH = path.join(CACHE_DIR, "cost-log.json");

// Pricing per 1M tokens (USD) as of 2026-04
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model] || { input: 3.0, output: 15.0 };
  return (
    (pricing.input / 1_000_000) * inputTokens +
    (pricing.output / 1_000_000) * outputTokens
  );
}

export function logCost(record: CostRecord) {
  let records: CostRecord[] = [];
  if (fs.existsSync(COST_LOG_PATH)) {
    records = JSON.parse(fs.readFileSync(COST_LOG_PATH, "utf-8"));
  }
  records.push(record);
  fs.mkdirSync(path.dirname(COST_LOG_PATH), { recursive: true });
  fs.writeFileSync(COST_LOG_PATH, JSON.stringify(records, null, 2));
}

export function printCostSummary() {
  if (!fs.existsSync(COST_LOG_PATH)) {
    console.log("No cost records found.");
    return;
  }
  const records: CostRecord[] = JSON.parse(
    fs.readFileSync(COST_LOG_PATH, "utf-8"),
  );

  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;

  const byStage: Record<string, { cost: number; calls: number }> = {};

  for (const r of records) {
    totalCost += r.estimatedCost;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    if (!byStage[r.stage]) byStage[r.stage] = { cost: 0, calls: 0 };
    byStage[r.stage].cost += r.estimatedCost;
    byStage[r.stage].calls += 1;
  }

  console.log("\n=== Cost Summary ===");
  console.log(`Total API calls: ${records.length}`);
  console.log(
    `Total tokens: ${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output`,
  );
  console.log(`Total estimated cost: $${totalCost.toFixed(4)}`);
  console.log("\nBy stage:");
  for (const [stage, data] of Object.entries(byStage)) {
    console.log(
      `  ${stage}: ${data.calls} calls, $${data.cost.toFixed(4)}`,
    );
  }
}
