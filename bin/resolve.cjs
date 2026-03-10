const path = require("path");

const PLATFORMS = {
  "linux-x64": "@like-yuki/cli-linux-x64",
  "linux-arm64": "@like-yuki/cli-linux-arm64",
  "darwin-arm64": "@like-yuki/cli-darwin-arm64",
  "win32-x64": "@like-yuki/cli-win32-x64",
};

function getBinaryPath(binaryName) {
  const platformKey = `${process.platform}-${process.arch}`;
  const pkg = PLATFORMS[platformKey];

  if (!pkg) {
    throw new Error(
      `Unsupported platform: ${platformKey}. ` +
      `Supported: ${Object.keys(PLATFORMS).join(", ")}`
    );
  }

  const isWindows = process.platform === "win32";
  const binName = isWindows ? `${binaryName}.exe` : binaryName;

  try {
    return require.resolve(`${pkg}/bin/${binName}`);
  } catch {
    const fallbackPath = path.join(__dirname, "..", binName);
    try {
      require("fs").accessSync(fallbackPath, require("fs").constants.X_OK);
      return fallbackPath;
    } catch {
      throw new Error(
        `Could not find binary "${binaryName}" for platform ${platformKey}.\n` +
        `The platform package "${pkg}" was not installed and no fallback binary was found.\n` +
        `Try reinstalling: npm install -g @like-yuki/cli`
      );
    }
  }
}

module.exports = { getBinaryPath, PLATFORMS };
