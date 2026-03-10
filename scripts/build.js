#!/usr/bin/env node

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const TARGETS = [
  { bunTarget: "bun-linux-x64", npmDir: "cli-linux-x64" },
  { bunTarget: "bun-linux-arm64", npmDir: "cli-linux-arm64" },
  { bunTarget: "bun-darwin-arm64", npmDir: "cli-darwin-arm64" },
  { bunTarget: "bun-windows-x64", npmDir: "cli-win32-x64" },
];

const ENTRIES = [
  { entry: "index.js", name: "lk" },
  { entry: "gpa.js", name: "lk-gpa" },
  { entry: "pp.js", name: "lk-pp" },
];

const selectedTarget = process.argv[2];

for (const { bunTarget, npmDir } of TARGETS) {
  if (selectedTarget && bunTarget !== selectedTarget) continue;

  const binDir = join(rootDir, "npm", npmDir, "bin");
  mkdirSync(binDir, { recursive: true });

  for (const { entry, name } of ENTRIES) {
    const isWindows = bunTarget.includes("windows");
    const outName = isWindows ? `${name}.exe` : name;
    const outfile = join(binDir, outName);
    const entryPath = join(rootDir, entry);

    const cmd = `bun build --compile --target=${bunTarget} --minify --outfile "${outfile}" "${entryPath}"`;

    console.log(`\n[build] ${bunTarget} -> ${name}`);
    console.log(`  $ ${cmd}`);

    try {
      execSync(cmd, { stdio: "inherit", cwd: rootDir });
    } catch (e) {
      console.error(`[build] Failed: ${bunTarget}/${name}`);
      process.exit(1);
    }
  }

  console.log(`\n[build] ${bunTarget} done.`);
}

console.log("\n[build] All targets built successfully.");
