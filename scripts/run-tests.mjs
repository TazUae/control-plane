#!/usr/bin/env node
// Recursively discovers *.test.ts files under src/ using only core `fs`
// APIs and passes them to the test runner as explicit arguments.
//
// Why not a glob pattern: `node --test "src/**/*.test.ts"` behaves
// differently across Node versions -- it works on some (e.g. 24.x) but
// fails outright with "Could not find '<pattern>'" on the Node 20.x this
// project targets and CI pins, because the pattern is never expanded, only
// looked up as a literal path. This script sidesteps that version
// dependency entirely: no shell glob, no Node-internal glob-expansion
// feature, just a plain recursive directory walk.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function collectTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTestFiles(full));
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectTestFiles("src").sort();
if (files.length === 0) {
  console.error("No *.test.ts files found under src/");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" }
);
process.exit(result.status ?? 1);
