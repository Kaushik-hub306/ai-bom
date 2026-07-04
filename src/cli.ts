#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { scanContent, summarize, type CallSite } from "./scan";

const SCANNABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor"]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, acc);
    else if (SCANNABLE.has(extname(entry))) acc.push(full);
  }
  return acc;
}

function main(): void {
  const root = process.argv[2] ?? ".";
  const files = walk(root);

  const sites: CallSite[] = [];
  for (const file of files) {
    try {
      sites.push(...scanContent(file, readFileSync(file, "utf8")));
    } catch {
      // One unreadable/broken file must never kill the whole scan.
    }
  }

  const summary = summarize(files.length, sites);
  const bom = {
    aibom_version: "0.1",
    generated_at: new Date().toISOString(),
    root,
    summary,
    call_sites: sites,
  };
  writeFileSync("aibom.json", JSON.stringify(bom, null, 2));

  const providers =
    Object.entries(summary.providers)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "none";

  console.log(`ai-bom — scanned ${summary.files} files under "${root}"`);
  console.log(`  call sites:      ${summary.callSites}`);
  console.log(`  providers:       ${providers}`);
  console.log(`  unpinned models: ${summary.unpinnedModels}`);
  console.log(`  hardcoded keys:  ${summary.hardcodedKeys}`);
  console.log(`\n→ wrote aibom.json`);

  // Exit non-zero if a hardcoded key was found — a useful default CI signal.
  if (summary.hardcodedKeys > 0) process.exitCode = 1;
}

main();
