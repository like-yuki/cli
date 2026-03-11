const path = require("path");
const fs = require("fs");

const PLATFORMS = {
  "linux-x64": true,
  "linux-arm64": true,
  "darwin-arm64": true,
  "win32-x64": true,
};

function getBinaryPath(binaryName) {
  const platformKey = `${process.platform}-${process.arch}`;
  const supported = PLATFORMS[platformKey];

  if (!supported) {
    throw new Error(
      `Unsupported platform: ${platformKey}. ` +
      `Supported: ${Object.keys(PLATFORMS).join(", ")}`
    );
  }

  const isWindows = process.platform === "win32";
  const binName = isWindows ? `${binaryName}.exe` : binaryName;
  const localPath = path.join(__dirname, "..", binName);

  // Preferred path: binaries downloaded by postinstall from GitHub Release assets.
  try {
    fs.accessSync(localPath, fs.constants.X_OK);
    return localPath;
  } catch {}

  throw new Error(
    `Could not find binary "${binaryName}" for platform ${platformKey}.\n` +
    `Expected local binary at: ${localPath}\n` +
    `Please reinstall to trigger postinstall download:\n` +
    `  npm install -g @like-yuki/cli`
  );
}

module.exports = { getBinaryPath, PLATFORMS };
