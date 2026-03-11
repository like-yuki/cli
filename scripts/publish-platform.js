#!/usr/bin/env node

/**
 * Deprecated script.
 * Platform binaries are now published as GitHub Release assets by workflow:
 *   .github/workflows/npm-publish.yml
 * and downloaded by scripts/install.js during postinstall.
 */

console.error(
  [
    "[publish-platform] This script is deprecated.",
    "Platform binaries are no longer published to npm platform packages.",
    "Use the GitHub Actions workflow to build binaries and upload release assets.",
  ].join("\n")
);
process.exit(1);
