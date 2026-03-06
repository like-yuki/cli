import {
  DEFAULT_SKIP_DIRS,
  MESSAGES,
} from "./constants.js";
import {
  loadConfig,
  normalizeConfigShape,
  saveConfig,
} from "./config.js";
import { promptText } from "./prompts.js";
import { createLogger } from "./logger.js";
import { scanDirectories } from "./repo.js";
import { pullRepo } from "./puller.js";
import { parseArgs, normalizeList } from "./arg-parser.js";
import { loadState, saveState, clearState } from "./state.js";

const mergeSkipDirs = (current, add, remove) => {
  const next = new Set(current);
  for (const item of add) {
    next.add(item);
  }
  for (const item of remove) {
    next.delete(item);
  }
  return normalizeList([...next]);
};

const printRepoSummary = (repos, logger, verbose) => {
  logger.info(MESSAGES.foundRepos);
  for (const repo of repos) {
    logger.info(`\n- ${repo.name}`);
    if (verbose) {
      logger.info(`  路径: ${repo.path}`);
      logger.info(`  远程仓库: ${repo.remoteUrl}`);
      logger.info(`  当前分支: ${repo.currentBranch}`);
      logger.info(`  最后提交: ${repo.lastCommit}`);
    }
  }
};

const generateReport = (startTime, repos, results) => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const successRepos = results.filter((item) => item.status === "success");
  const failedRepos = results.filter((item) => item.status === "failed");
  const skippedRepos = results.filter((item) => item.status === "skipped");

  return {
    duration: `${duration}秒`,
    totalRepos: repos.length,
    successCount: successRepos.length,
    failureCount: failedRepos.length,
    skippedCount: skippedRepos.length,
    successRepos,
    failedRepos,
    skippedRepos,
  };
};

const printReport = (report, logger) => {
  logger.info(MESSAGES.summaryTitle);
  logger.info(`执行时间: ${report.duration}`);
  logger.info(`仓库总数: ${report.totalRepos}`);
  logger.success(`更新成功: ${report.successCount}`);
  logger.error(`更新失败: ${report.failureCount}`);
  logger.warn(`已跳过: ${report.skippedCount}`);

  if (report.successCount > 0) {
    logger.success(MESSAGES.successTitle);
    for (const item of report.successRepos) {
      logger.success(`- ${item.repo.name}`);
    }
  }

  if (report.failureCount > 0) {
    logger.error(MESSAGES.failedTitle);
    for (const item of report.failedRepos) {
      logger.error(`- ${item.repo.name}\n 原因: ${item.error}\n\n`);
    }
  }

  if (report.skippedCount > 0) {
    logger.warn(MESSAGES.skippedTitle);
    for (const item of report.skippedRepos) {
      logger.warn(`- ${item.repo.name}\n 原因: ${item.reason}\n\n`);
    }
  }
};

export const run = async (baseLogger, argv) => {
  const logger = createLogger(baseLogger);
  const args = argv ?? process.argv.slice(2);
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const {
    depth,
    concurrency,
    concurrencyProvided,
    skipDirs,
    skipOverrides,
    skipOverrideMode,
    verbose,
    showHelp,
    showConfig,
    editConfig,
    configAdd,
    configRemove,
    configModeOverride,
    resume,
    resumeForce,
    timeoutMs,
  } = parseArgs(args, logger, scopedConfig);
  if (showHelp) {
    return;
  }

  const resolveEffectiveSkipDirs = () => {
    if (skipOverrideMode === "none") {
      return [];
    }
    if (skipOverrideMode === "only") {
      return skipOverrides;
    }
    if (skipOverrides.length > 0) {
      return skipDirs;
    }
    if (scopedConfig.skipMode === "none") {
      return [];
    }
    if (scopedConfig.skipMode === "custom") {
      return Array.isArray(scopedConfig.skipDirs) ? scopedConfig.skipDirs : [];
    }
    return DEFAULT_SKIP_DIRS;
  };

  if (showConfig) {
    const effectiveSkipDirs = resolveEffectiveSkipDirs();
    const effective = {
      skipDirs: effectiveSkipDirs,
      commands: scopedConfig.commands || [],
      timeoutMs: timeoutMs ?? scopedConfig.timeoutMs ?? null,
    };
    logger.info(
      JSON.stringify(
        {
          default: scopedConfig,
          overrides: skipOverrides.length > 0 || skipOverrideMode
            ? { skipDirs: skipOverrides, mode: skipOverrideMode }
            : null,
          effective,
        },
        null,
        2
      )
    );
    return;
  }

  if (editConfig) {
    if (configModeOverride === "default") {
      scopedConfig.skipMode = "default";
      scopedConfig.skipDirs = [];
    } else if (configModeOverride === "none") {
      scopedConfig.skipMode = "none";
      scopedConfig.skipDirs = [];
    } else if ((configAdd && configAdd.length > 0) || (configRemove && configRemove.length > 0)) {
      const current = scopedConfig.skipMode === "custom"
        ? (Array.isArray(scopedConfig.skipDirs) ? scopedConfig.skipDirs : [])
        : DEFAULT_SKIP_DIRS;
      scopedConfig.skipMode = "custom";
      scopedConfig.skipDirs = mergeSkipDirs(current, configAdd, configRemove);
    } else {
      const input = await promptText(MESSAGES.configPrompt);
      if (input.trim().toLowerCase() === "default") {
        scopedConfig.skipMode = "default";
        scopedConfig.skipDirs = [];
      } else if (input.trim().toLowerCase() === "none") {
        scopedConfig.skipMode = "none";
        scopedConfig.skipDirs = [];
      } else {
        const nextSkipDirs = input
          ? input.split(",").map((item) => item.trim()).filter(Boolean)
          : DEFAULT_SKIP_DIRS;
        scopedConfig.skipMode = "custom";
        scopedConfig.skipDirs = normalizeList(nextSkipDirs);
      }
    }

    const commandsInput = await promptText(MESSAGES.commandsPrompt);
    if (commandsInput.trim().toLowerCase() === "none") {
      scopedConfig.commands = [];
    } else if (commandsInput.trim().length > 0) {
      let parsed = [];
      try {
        parsed = JSON.parse(commandsInput);
      } catch {
        parsed = commandsInput
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      scopedConfig.commands = Array.isArray(parsed) ? parsed : [];
    }

    if (Number.isFinite(timeoutMs)) {
      scopedConfig.timeoutMs = timeoutMs;
    }
    await saveConfig(normalized.root);
    logger.success(MESSAGES.configUpdated);
    return;
  }

  logger.info(MESSAGES.scanStart(depth));
  if (concurrencyProvided) {
    logger.info(`并发数: ${concurrency}`);
  }
  const effectiveSkipDirs = resolveEffectiveSkipDirs();
  if (effectiveSkipDirs.length > 0) {
    logger.info(`跳过目录: ${effectiveSkipDirs.join(", ")}`);
  } else {
    logger.info("跳过目录: 无");
  }
  const effectiveTimeout = Number.isFinite(timeoutMs)
    ? timeoutMs
    : Number.isFinite(scopedConfig.timeoutMs)
      ? scopedConfig.timeoutMs
      : null;
  if (Number.isFinite(effectiveTimeout)) {
    logger.info(`命令超时: ${effectiveTimeout}ms`);
  }

  const startTime = Date.now();
  const state = await loadState();
  if (state && !resume && !resumeForce) {
    logger.warn(MESSAGES.resumeHint);
  }
  let repos = [];
  const currentSignature = {
    skipDirs: effectiveSkipDirs,
    depth,
  };
  const isResumeValid =
    state &&
    state.signature &&
    JSON.stringify(state.signature) === JSON.stringify(currentSignature);

  if (resume && resumeForce) {
    await clearState();
  }

  if (resume && state?.repos?.length > 0) {
    if (!isResumeValid) {
      logger.warn(MESSAGES.resumeInvalid);
    } else {
      repos = state.repos;
      logger.info("已恢复上次扫描结果");
    }
  }
  if (repos.length === 0) {
    repos = await scanDirectories(
      process.cwd(),
      depth,
      logger,
      1,
      [],
      new Set(),
      new Set(effectiveSkipDirs)
    );
    await saveState({
      repos,
      index: 0,
      signature: currentSignature,
      updatedAt: new Date().toISOString(),
    });
  }

  if (repos.length === 0) {
    logger.warn(MESSAGES.noRepos);
    return;
  }

  printRepoSummary(repos, logger, verbose);

  logger.info(MESSAGES.startUpdate);

  const results = [];
  const startIndex = resume && state?.index ? state.index : 0;
  const queue = repos.map((repo, index) => ({ repo, index }))
    .filter((item) => item.index >= startIndex);
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      const result = await pullRepo(
        item.repo,
        logger,
        verbose,
        scopedConfig.commands,
        effectiveTimeout
      );
      results[item.index] = result;
      const nextIndex = item.index + 1;
      await saveState({
        repos,
        index: nextIndex,
        updatedAt: new Date().toISOString(),
      });
    }
  });

  await Promise.all(workers);

  await clearState();

  const report = generateReport(startTime, repos, results);
  printReport(report, logger);
};
