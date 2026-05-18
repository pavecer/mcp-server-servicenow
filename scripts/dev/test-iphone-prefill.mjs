#!/usr/bin/env node
/**
 * Apple iPhone smart-prefill probe.
 *
 * 1. Fetches the real ServiceNow catalog item form (default sys_id is the
 *    "Apple iPhone 7" demo item on https://dev310193.service-now.com).
 * 2. Runs the prefill engine against a few representative user contexts
 *    (free-text only, structured hints only, both combined).
 * 3. Prints variable inventory, prefilled values, diagnostics, and the
 *    final Adaptive Card so you can see exactly what the agent would
 *    return to the end user.
 *
 * Usage:
 *   npm run build
 *   node scripts/dev/test-iphone-prefill.mjs                       # default sys_id
 *   node scripts/dev/test-iphone-prefill.mjs <itemSysId>
 *   node scripts/dev/test-iphone-prefill.mjs <itemSysId> --scenario=hints
 *
 * Scenarios:
 *   context   Free-text userContext only (no structured hints).
 *   hints     Structured prefillHints only (highest confidence path).
 *   both      Both userContext AND prefillHints (typical agent flow).
 *   all       Run every scenario back-to-back. [default]
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Load local.settings.json the way Functions Core Tools does (same logic as
// scripts/dev/test-servicenow-local.mjs).
// ---------------------------------------------------------------------------
const settingsPath = path.join(repoRoot, "local.settings.json");
if (fs.existsSync(settingsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const values = raw?.Values ?? {};
    for (const [k, v] of Object.entries(values)) {
      if (process.env[k] === undefined && typeof v === "string") {
        process.env[k] = v;
      }
    }
  } catch (err) {
    console.error(`[warn] Failed to parse ${settingsPath}: ${err.message}`);
  }
} else {
  console.error(
    `[error] ${settingsPath} not found. Copy local.settings.sample.json and ` +
      `fill in SERVICENOW_INSTANCE_URL and credentials before running.`
  );
  process.exit(2);
}

process.env.ENTRA_AUTH_DISABLED = process.env.ENTRA_AUTH_DISABLED ?? "true";

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (const arg of argv) {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    if (eq === -1) flags[arg.slice(2)] = true;
    else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
  } else {
    positional.push(arg);
  }
}

// Default = the Apple iPhone sys_id you shared from dev310193.
const DEFAULT_IPHONE_SYS_ID = "ec80c13297968d1021983d1e6253af32";
const itemSysId = positional[0] || DEFAULT_IPHONE_SYS_ID;
const scenarioName = (flags.scenario || "all").toLowerCase();

// ---------------------------------------------------------------------------
// Import compiled sources
// ---------------------------------------------------------------------------
const distRoot = path.join(repoRoot, "dist");
if (!fs.existsSync(distRoot)) {
  console.error("[error] dist/ not found. Run 'npm run build' first.");
  process.exit(2);
}

const { ServiceNowClient } = await import(
  url.pathToFileURL(path.join(distRoot, "services", "servicenowClient.js"))
);
const { TokenManager } = await import(
  url.pathToFileURL(path.join(distRoot, "services", "tokenManager.js"))
);
const { computePrefillValues } = await import(
  url.pathToFileURL(path.join(distRoot, "utils", "prefillCatalogForm.js"))
);
const { buildOrderFormAdaptiveCard } = await import(
  url.pathToFileURL(path.join(distRoot, "utils", "adaptiveCards.js"))
);

const tokenManager = new TokenManager();
const client = new ServiceNowClient(tokenManager);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = {
  context: {
    label: "userContext only (free-text fallback path)",
    input: {
      userContext:
        "Hi! Please order me a black iPhone with 256GB storage on Verizon. " +
        "My old phone is damaged and I need a replacement by 2026-07-01. Just 1 unit."
    }
  },
  hints: {
    label: "prefillHints only (structured agent-extracted path)",
    input: {
      prefillHints: {
        color: "black",
        storage: "256",
        carrier: "verizon",
        justification: "Replacement for damaged corporate phone"
      }
    }
  },
  both: {
    label: "userContext + prefillHints (typical agent flow)",
    input: {
      userContext:
        "Replacement iPhone needed urgently, old one was damaged on business trip.",
      prefillHints: {
        color: "black",
        storage: "256",
        carrier: "verizon"
      }
    }
  }
};

const order = scenarioName === "all"
  ? ["context", "hints", "both"]
  : [scenarioName];

for (const name of order) {
  if (!SCENARIOS[name]) {
    console.error(`[error] Unknown scenario '${name}'. Use one of: ${Object.keys(SCENARIOS).join(", ")}, all`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
function hr(char = "-") {
  return char.repeat(80);
}

function summarizeVariable(v) {
  const choicesRaw = v.choices ?? v.options ?? null;
  let choices;
  if (typeof choicesRaw === "string") {
    choices = choicesRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(choicesRaw)) {
    choices = choicesRaw.map(c =>
      typeof c === "string" || typeof c === "number"
        ? String(c)
        : (c?.label ?? c?.title ?? c?.value ?? "")
    ).filter(Boolean);
  }
  return {
    name: v.name,
    label: v.label,
    type: v.type ?? v.question_type ?? v.ui_type,
    mandatory: v.mandatory === true,
    visible: v.visible !== false,
    readonly: v.readonly === true,
    choices: choices && choices.length > 0 ? choices : undefined
  };
}

try {
  console.log(hr("="));
  console.log(`Fetching catalog item ${itemSysId} ...`);
  console.log(hr("="));

  const item = await client.getCatalogItem(itemSysId);

  console.log(`Item name:     ${item.name}`);
  console.log(`Item sys_id:   ${item.sys_id}`);
  console.log(`Short desc:    ${item.short_description ?? "(none)"}`);
  console.log(`Variables:     ${item.variables?.length ?? 0}`);
  console.log("");
  console.log("Variable inventory (what the prefill engine sees):");
  console.log(JSON.stringify((item.variables ?? []).map(summarizeVariable), null, 2));
  console.log("");

  for (const name of order) {
    const scenario = SCENARIOS[name];
    console.log(hr("="));
    console.log(`SCENARIO '${name}': ${scenario.label}`);
    console.log(hr("="));
    console.log("Input to computePrefillValues:");
    console.log(JSON.stringify(scenario.input, null, 2));
    console.log("");

    const { values, diagnostics } = computePrefillValues(item.variables, scenario.input);

    console.log("Prefilled values:");
    console.log(JSON.stringify(values, null, 2));
    console.log("");
    console.log("Diagnostics (why each value was chosen):");
    console.log(JSON.stringify(diagnostics, null, 2));
    console.log("");

    const card = buildOrderFormAdaptiveCard(item, values);
    const inputs = (card.body ?? [])
      .filter(b => typeof b.id === "string")
      .map(b => ({
        id: b.id,
        type: b.type,
        value: b.value,
        prefilled: Object.prototype.hasOwnProperty.call(values, b.id)
      }));
    console.log("Adaptive Card inputs after prefill:");
    console.log(JSON.stringify(inputs, null, 2));
    console.log("");

    if (flags["dump-card"]) {
      console.log("Full Adaptive Card JSON:");
      console.log(JSON.stringify(card, null, 2));
      console.log("");
    }
  }
} catch (err) {
  if (err?.response?.data) {
    console.error("[error] ServiceNow responded:", JSON.stringify({
      status: err.response.status,
      statusText: err.response.statusText,
      data: err.response.data
    }, null, 2));
  } else {
    console.error(`[error] ${err?.message || err}`);
    if (err?.stack) console.error(err.stack);
  }
  process.exit(1);
}
