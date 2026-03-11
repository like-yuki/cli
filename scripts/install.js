#!/usr/bin/env node

/**
 * postinstall: download platform binaries from GitHub Releases.
 */

import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const BINARIES = ["lk", "lk-gpa", "lk-pp"];

const PLATFORMS = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "win32-x64",
};

const platformKey = `${process.platform}-${process.arch}`;
const platform = PLATFORMS[platformKey];

if (!platform) {
  console.warn(`[postinstall] Unsupported platform: ${platformKey}, skipping binary download.`);
  process.exit(0);
}

const isWindows = process.platform === "win32";
const fileExt = isWindows ? ".exe" : "";

function parseRepoSlug(repoUrl) {
  if (!repoUrl || typeof repoUrl !== "string") return null;
  const cleaned = repoUrl
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  const match = cleaned.match(/github\.com\/([^/]+\/[^/]+)$/);
  return match ? match[1] : null;
}

function isBinaryReady() {
  for (const bin of BINARIES) {
    const binName = `${bin}${fileExt}`;
    try {
      const filepath = join(rootDir, binName);
      accessSync(filepath, constants.X_OK);
    } catch {
      return false;
    }
  }
  return true;
}

if (isBinaryReady()) {
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const version = pkg.version;
const repoSlug = parseRepoSlug(pkg.repository?.url);

if (!repoSlug) {
  console.warn("[postinstall] Invalid repository url in package.json, skip binary download.");
  process.exit(0);
}

console.log(
  `[postinstall] Downloading binaries from GitHub Releases (${repoSlug}, ${platformKey}, v${version})...`
);

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

async function downloadWithTagFallback(assetName) {
  const tags = [`v${version}`, version];
  let lastError = null;
  for (const tag of tags) {
    const url = `https://github.com/${repoSlug}/releases/download/${tag}/${assetName}`;
    try {
      return await fetch(url);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`Asset not found: ${assetName}`);
}

try {
  for (const bin of BINARIES) {
    const binName = `${bin}${fileExt}`;
    const assetName = `${bin}-${platform}${fileExt}`;
    const data = await downloadWithTagFallback(assetName);
    const outPath = join(rootDir, binName);
    writeFileSync(outPath, data, { mode: 0o755 });
    console.log(`[postinstall] Downloaded ${binName}`);
  }

  console.log("[postinstall] Done.");
} catch (e) {
  console.warn(
    `[postinstall] Failed to download binaries: ${e.message}\n` +
      `Please make sure release assets are published for version ${version}.`
  );
}
