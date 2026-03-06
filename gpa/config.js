import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { CONFIG_DIR, CONFIG_FILE, CONFIG_SCOPE } from "./constants.js";

const configDir = path.join(os.homedir(), CONFIG_DIR);
const configFile = path.join(configDir, CONFIG_FILE);

const ensureConfigDir = async () => {
  await fs.mkdir(configDir, { recursive: true });
};

const createFileHandle = async (filePath, flags) => {
  const handle = await fs.open(filePath, flags);
  return {
    handle,
    async [Symbol.asyncDispose]() {
      await handle.close();
    },
  };
};

export const loadConfig = async () => {
  try {
    await using fileResource = await createFileHandle(configFile, "r");
    const raw = await fileResource.handle.readFile({ encoding: "utf-8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveConfig = async (config) => {
  await ensureConfigDir();
  await using fileResource = await createFileHandle(configFile, "w");
  await fileResource.handle.writeFile(JSON.stringify(config, null, 2), "utf-8");
};

const normalizeRoot = (config) =>
  config && typeof config === "object" ? config : {};

const isLegacyShape = (root) => {
  const hasScope = Object.prototype.hasOwnProperty.call(root, CONFIG_SCOPE);
  const otherKeys = Object.keys(root).filter(
    (key) => key !== "default" && key !== "repos" && key !== CONFIG_SCOPE
  );
  return !hasScope && otherKeys.length === 0;
};

const migrateLegacyScope = (root) => {
  if (!isLegacyShape(root)) {
    return root;
  }
  return { [CONFIG_SCOPE]: root };
};

const ensureScope = (root) => {
  if (Object.prototype.hasOwnProperty.call(root, CONFIG_SCOPE)) {
    return root;
  }
  return { ...root, [CONFIG_SCOPE]: { skipDirs: [] } };
};

const normalizeScope = (scoped) => ({
  skipDirs: Array.isArray(scoped.skipDirs) ? scoped.skipDirs : [],
  skipMode: typeof scoped.skipMode === "string" ? scoped.skipMode : null,
  commands: Array.isArray(scoped.commands) ? scoped.commands : [],
  timeoutMs: Number.isFinite(scoped.timeoutMs)
    ? scoped.timeoutMs
    : null,
});

export const normalizeConfigShape = (config) => {
  const root = normalizeRoot(config);
  const migrated = migrateLegacyScope(root);
  const scopedRoot = ensureScope(migrated);
  const normalizedScope = normalizeScope(scopedRoot[CONFIG_SCOPE]);

  if (!normalizedScope.skipMode) {
    if (normalizedScope.skipDirs.length > 0) {
      normalizedScope.skipMode = "custom";
    } else {
      normalizedScope.skipMode = "default";
    }
  }

  return {
    root: { ...scopedRoot, [CONFIG_SCOPE]: normalizedScope },
    scope: CONFIG_SCOPE,
  };
};
