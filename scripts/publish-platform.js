#!/usr/bin/env node

/**
 * Publish all platform-specific packages to npm.
 * Syncs version from root package.json, then runs npm publish in each platform dir.
 *
 * Usage:
 *   node scripts/publish-platform.js          # publish all platforms
 *   node scripts/publish-platform.js --dry-run # dry run
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const version = rootPkg.version;
const dryRun = process.argv.includes("--dry-run");

const PLATFORM_DIRS = [
  "cli-linux-x64",
  "cli-linux-arm64",
  "cli-darwin-arm64",
  "cli-win32-x64",
];

console.log(`Publishing platform packages v${version}${dryRun ? " (dry run)" : ""}...\n`);

for (const dir of PLATFORM_DIRS) {
  const pkgDir = join(rootDir, "npm", dir);
  const pkgPath = join(pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const cmd = `npm publish --access public${dryRun ? " --dry-run" : ""}`;
  console.log(`[publish] ${pkg.name}@${version}`);
  console.log(`  $ ${cmd}`);

  try {
    execSync(cmd, { stdio: "inherit", cwd: pkgDir });
  } catch (e) {
    console.error(`[publish] Failed: ${pkg.name}`);
    if (!dryRun) process.exit(1);
  }

  console.log();
}

console.log("All platform packages published.");
