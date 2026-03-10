#!/usr/bin/env node

/**
 * postinstall fallback: when optionalDependencies are skipped (e.g. --ignore-optional),
 * download the platform-specific package from npm and extract the binaries.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { get } from "node:https";
import { gunzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const require = createRequire(import.meta.url);

const PLATFORMS = {
  "linux-x64": "@like-yuki/cli-linux-x64",
  "linux-arm64": "@like-yuki/cli-linux-arm64",
  "darwin-arm64": "@like-yuki/cli-darwin-arm64",
  "win32-x64": "@like-yuki/cli-win32-x64",
};

const BINARIES = ["lk", "lk-gpa", "lk-pp"];

const platformKey = `${process.platform}-${process.arch}`;
const pkgName = PLATFORMS[platformKey];

if (!pkgName) {
  console.warn(`[postinstall] Unsupported platform: ${platformKey}, skipping binary download.`);
  process.exit(0);
}

const isWindows = process.platform === "win32";

function isPlatformPackageInstalled() {
  for (const bin of BINARIES) {
    const binName = isWindows ? `${bin}.exe` : bin;
    try {
      require.resolve(`${pkgName}/bin/${binName}`);
    } catch {
      return false;
    }
  }
  return true;
}

if (isPlatformPackageInstalled()) {
  process.exit(0);
}

console.log(`[postinstall] Platform package not found, downloading ${pkgName}...`);

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const version = pkg.version;
const shortName = pkgName.replace("@like-yuki/", "");

function fetch(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function extractFromTarball(tarBuffer, filepath) {
  let offset = 0;
  while (offset < tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;

    const name = header.toString("utf-8", 0, 100).replace(/\0.*/g, "");
    const size = parseInt(header.toString("utf-8", 124, 136).replace(/\0.*/g, ""), 8);

    if (isNaN(size)) break;

    if (name === filepath || name === `./${filepath}`) {
      return tarBuffer.subarray(offset, offset + size);
    }

    offset = (offset + size + 511) & ~511;
  }
  return null;
}

try {
  const tgzUrl = `https://registry.npmjs.org/${pkgName}/-/${shortName}-${version}.tgz`;
  const tgzBuffer = await fetch(tgzUrl);

  const tarBuffer = gunzipSync(tgzBuffer);

  for (const bin of BINARIES) {
    const binName = isWindows ? `${bin}.exe` : bin;
    const data = extractFromTarball(tarBuffer, `package/bin/${binName}`);

    if (!data) {
      console.warn(`[postinstall] Binary "${binName}" not found in tarball, skipping.`);
      continue;
    }

    const outPath = join(rootDir, binName);
    writeFileSync(outPath, data, { mode: 0o755 });
    console.log(`[postinstall] Extracted ${binName}`);
  }

  console.log("[postinstall] Done.");
} catch (e) {
  console.warn(
    `[postinstall] Failed to download binary: ${e.message}\n` +
    `You may need to install the platform package manually:\n` +
    `  npm install ${pkgName}`
  );
}
