import { promises as fs } from "fs";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  CONFIG_SCOPE,
} from "./constants.js";

export const getTargetsSignature = (targets) => JSON.stringify(targets || []);

const ensureConfigDir = async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
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
    await using fileResource = await createFileHandle(CONFIG_FILE, "r");
    const raw = await fileResource.handle.readFile({ encoding: "utf-8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveConfig = async (config, logger) => {
  await ensureConfigDir();
  try {
    const stat = await fs.stat(CONFIG_FILE);
    if (stat.isFile()) {
      const backupPath = `${CONFIG_FILE}.bak`;
      await fs.copyFile(CONFIG_FILE, backupPath);
      logger?.info?.(`配置已备份: ${backupPath}`);
    }
  } catch {}
  await using fileResource = await createFileHandle(CONFIG_FILE, "w");
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
  return { ...root, [CONFIG_SCOPE]: { default: null, repos: {} } };
};

const normalizeScope = (scoped) => ({
  default: scoped.default || null,
  repos: scoped.repos || {},
  state: scoped.state || {},
});

export const normalizeConfigShape = (config) => {
  const root = normalizeRoot(config);
  const migrated = migrateLegacyScope(root);
  const scopedRoot = ensureScope(migrated);
  const normalizedScope = normalizeScope(scopedRoot[CONFIG_SCOPE]);

  return {
    root: { ...scopedRoot, [CONFIG_SCOPE]: normalizedScope },
    scope: CONFIG_SCOPE,
  };
};

export const getScopedConfig = (rootConfig) => rootConfig[CONFIG_SCOPE];

export const saveResumeState = async (rootConfig, repoKey, state, logger) => {
  const scopedConfig = getScopedConfig(rootConfig);
  scopedConfig.state = scopedConfig.state || {};
  if (state) {
    scopedConfig.state[repoKey] = state;
  } else {
    delete scopedConfig.state[repoKey];
  }
  await saveConfig(rootConfig, logger);
};
