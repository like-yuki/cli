import os from "os";
import {
  CLI_NAME,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_DEPTH,
  DEFAULT_SKIP_DIRS,
  MAX_CONCURRENCY,
  MAX_DEPTH_LIMIT,
  MIN_DEPTH,
  MESSAGES,
  usageLines,
} from "./constants.js";

const getCpuLimit = () => {
  const cores = os.cpus()?.length || 1;
  return Math.max(1, cores);
};

export const normalizeList = (items) =>
  [...new Set(items)].filter(Boolean).sort();

const isFlag = (value) => value?.startsWith("-");

const takeListValue = (value, label, logger) => {
  if (!value || isFlag(value)) {
    logger.warn(`${label} 参数无效，已忽略`);
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const parseArgs = (args, logger, config) => {
  let depth = DEFAULT_MAX_DEPTH;
  let verbose = false;
  let concurrency = DEFAULT_CONCURRENCY;
  let concurrencyProvided = false;
  const baseSkipDirs = Array.isArray(config.skipDirs) && config.skipDirs.length > 0
    ? config.skipDirs
    : DEFAULT_SKIP_DIRS;
  const skipOverrides = [];
  const cpuLimit = getCpuLimit();
  let showConfig = false;
  let editConfig = false;
  let resume = false;
  let resumeForce = false;
  let timeoutMs = null;
  let configAdd = [];
  let configRemove = [];
  let skipOverrideMode = null;
  let configModeOverride = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      for (const line of usageLines(CLI_NAME)) {
        logger.info(line);
      }
      return { depth: null, verbose: false, showHelp: true };
    }
    if (arg === "-d" || arg === "--detail") {
      verbose = true;
      continue;
    }
    if (arg === "-c" || arg === "--concurrency") {
      const value = args[i + 1];
      concurrencyProvided = true;
      if (value && !isFlag(value) && !Number.isNaN(parseInt(value, 10))) {
        concurrency = parseInt(value, 10);
        i += 1;
      } else {
        logger.warn("并发数无效，使用默认值 1");
      }
      continue;
    }
    if (arg === "--skip") {
      const value = args[i + 1];
      const next = takeListValue(value, "--skip", logger);
      if (next.length > 0) {
        skipOverrides.push(...next);
        i += 1;
      }
      continue;
    }
    if (arg === "--skip-only") {
      const value = args[i + 1];
      const next = takeListValue(value, "--skip-only", logger);
      if (next.length > 0) {
        skipOverrides.push(...next);
        skipOverrideMode = "only";
        i += 1;
      }
      continue;
    }
    if (arg === "--skip-none") {
      skipOverrideMode = "none";
      continue;
    }
    if (arg === "--timeout") {
      const value = args[i + 1];
      if (value && !isFlag(value) && !Number.isNaN(parseInt(value, 10))) {
        timeoutMs = parseInt(value, 10);
        i += 1;
      } else {
        logger.warn("超时时间无效，已忽略");
      }
      continue;
    }
    if (arg === "--show-config") {
      showConfig = true;
      continue;
    }
    if (arg === "--resume") {
      resume = true;
      continue;
    }
    if (arg === "--force") {
      resumeForce = true;
      continue;
    }
    if (arg === "--config") {
      editConfig = true;
      continue;
    }
    if (arg === "--default") {
      configModeOverride = "default";
      continue;
    }
    if (arg === "--none") {
      configModeOverride = "none";
      continue;
    }
    if (arg === "--add") {
      const value = args[i + 1];
      const next = takeListValue(value, "--add", logger);
      if (next.length > 0) {
        configAdd = [...configAdd, ...next];
        i += 1;
      }
      continue;
    }
    if (arg === "--remove") {
      const value = args[i + 1];
      const next = takeListValue(value, "--remove", logger);
      if (next.length > 0) {
        configRemove = [...configRemove, ...next];
        i += 1;
      }
      continue;
    }
    if (!Number.isNaN(parseInt(arg, 10))) {
      depth = parseInt(arg, 10);
    }
  }

  if (depth < MIN_DEPTH) {
    throw new Error(MESSAGES.invalidDepth);
  }

  const clampedConcurrency = Math.max(
    DEFAULT_CONCURRENCY,
    Math.min(MAX_CONCURRENCY, concurrency)
  );
  const finalConcurrency = Math.min(clampedConcurrency, cpuLimit);

  if (concurrencyProvided) {
    if (concurrency !== clampedConcurrency) {
      logger.warn(`并发数已限制到 ${clampedConcurrency}`);
    }
    if (clampedConcurrency !== finalConcurrency) {
      logger.warn(`并发数已限制到 CPU 核心数 ${finalConcurrency}`);
    }
  }

  const mergedSkipDirs = normalizeList([...baseSkipDirs, ...skipOverrides]);

  return {
    depth: Math.max(MIN_DEPTH, Math.min(MAX_DEPTH_LIMIT, depth)),
    concurrency: finalConcurrency,
    concurrencyProvided,
    skipDirs: mergedSkipDirs,
    skipOverrides: normalizeList(skipOverrides),
    skipOverrideMode,
    verbose,
    showConfig,
    editConfig,
    resume,
    resumeForce,
    configAdd: normalizeList(configAdd),
    configRemove: normalizeList(configRemove),
    configModeOverride,
    timeoutMs,
    showHelp: false,
  };
};
