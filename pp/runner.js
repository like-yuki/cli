import path from "path";
import {
  loadState,
  saveState,
  clearState,
} from "./state.js";
import {
  CLI_NAME,
  CONFIG_SCOPE,
  DEFAULT_MERGE_STRATEGY,
  VALID_MERGE_STRATEGIES,
  MESSAGES,
  usageLines,
} from "./constants.js";
import {
  getTargetsSignature,
  loadConfig,
  normalizeConfigShape,
  saveConfig,
} from "./config.js";
import {
  promptConfigInput,
  promptYesNo,
  promptCommitMessage,
  promptNewBranchName,
} from "./prompts.js";
import {
  shouldValidateRemote,
  shouldWriteState,
  resolveMode,
  MODE,
} from "./mode.js";
import { createGitRunner, isPlanMode } from "./git.js";

const normalizeBranches = (input) =>
  input
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const parseRepoKeyFromRemote = (remoteUrl) => {
  const cleaned = remoteUrl.trim().replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^[^@]+@[^:]+:(.+\/[^/]+)$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const httpMatch = cleaned.match(/^https?:\/\/[^/]+\/(.+\/[^/]+)$/);
  if (httpMatch) {
    return httpMatch[1];
  }

  return null;
};

const classifyGitError = (output) => {
  const lower = output.toLowerCase();
  if (lower.includes("non-fast-forward") || lower.includes("rejected")) {
    return "远端拒绝（非快进），可能需要先拉取或处理分支保护规则";
  }
  if (lower.includes("protected branch")) {
    return "分支受保护，无法直接推送";
  }
  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "权限不足，无法访问远端仓库";
  }
  if (lower.includes("could not read from remote repository")) {
    return "无法访问远端仓库，请检查网络与权限";
  }
  if (lower.includes("not found")) {
    return "远端仓库或分支不存在";
  }
  if (lower.includes("pathspec")) {
    return "分支不存在或名称错误";
  }
  return null;
};

const parseAheadBehind = (output) => {
  const parts = output.trim().split(/\s+/).map((item) => Number(item));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return { ahead: 0, behind: 0 };
  }
  return { behind: parts[0], ahead: parts[1] };
};

const getRepoKey = async (runGit, repoRoot) => {
  const remoteResult = await runGit(["config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
  });
  if (remoteResult.success && remoteResult.output) {
    const parsed = parseRepoKeyFromRemote(remoteResult.output);
    if (parsed) {
      return parsed;
    }
  }
  return path.basename(repoRoot);
};

const getDefaultBranch = async (runGit, remoteName) => {
  const result = await runGit([
    "symbolic-ref",
    `refs/remotes/${remoteName}/HEAD`,
  ]);
  if (!result.success) {
    return null;
  }
  const ref = result.output.trim();
  const prefix = `refs/remotes/${remoteName}/`;
  if (ref.startsWith(prefix)) {
    return ref.slice(prefix.length);
  }
  return null;
};

const isDefaultBranchName = (branch, remoteDefault) => {
  if (!branch) {
    return false;
  }
  if (remoteDefault && branch === remoteDefault) {
    return true;
  }
  return branch === "main" || branch === "master";
};

const ensureGitRepo = async (runGit) => {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!result.success || result.output !== "true") {
    throw new Error("当前目录不是 Git 仓库");
  }
};

const getRepoRoot = async (runGit) => {
  const result = await runGit(["rev-parse", "--show-toplevel"]);
  if (!result.success) {
    throw new Error(`无法获取仓库根目录: ${result.output}`);
  }
  return result.output;
};

const getCurrentBranch = async (runGit) => {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.success) {
    throw new Error(`无法获取当前分支: ${result.output}`);
  }
  return result.output;
};

const getWorkingTreeStatus = async (runGit) => {
  const result = await runGit(["status", "--porcelain"]);
  if (!result.success) {
    throw new Error(`无法获取工作区状态: ${result.output}`);
  }
  return result.output;
};

const getStatusDetails = async (runGit) => {
  const stagedResult = await runGit(["diff", "--cached", "--name-only"]);
  if (!stagedResult.success) {
    throw new Error(`无法获取暂存区状态: ${stagedResult.output}`);
  }
  const unstagedResult = await runGit(["diff", "--name-only"]);
  if (!unstagedResult.success) {
    throw new Error(`无法获取工作区差异: ${unstagedResult.output}`);
  }

  return {
    staged: stagedResult.output.length > 0,
    unstaged: unstagedResult.output.length > 0,
  };
};

const checkBranchPushed = async (runGit, logger) => {
  const upstream = await runGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (!upstream.success) {
    logger.warn("当前分支未设置上游分支，无法判断是否已推送");
    return;
  }

  const aheadBehind = await runGit([
    "rev-list",
    "--left-right",
    "--count",
    "@{u}...HEAD",
  ]);
  if (!aheadBehind.success) {
    logger.warn("无法判断当前分支与远端的差异");
    return;
  }

  const { ahead, behind } = parseAheadBehind(aheadBehind.output);
  if (ahead > 0) {
    logger.warn(`当前分支有 ${ahead} 个提交未推送到远端`);
  }
  if (behind > 0) {
    logger.warn(`当前分支落后远端 ${behind} 个提交`);
  }
};

const hasMergeConflict = async (runGit) => {
  const result = await runGit(["diff", "--name-only", "--diff-filter=U"]);
  if (!result.success) {
    return false;
  }
  return result.output.length > 0;
};

const ensureBranchAvailable = async (runGit, branch, remoteName, mode) => {
  if (isPlanMode(mode)) {
    return;
  }
  const localCheck = await runGit(["rev-parse", "--verify", branch]);
  if (localCheck.success) {
    return;
  }

  const remoteCheck = await runGit(["ls-remote", "--heads", remoteName, branch]);
  if (!remoteCheck.success || remoteCheck.output.length === 0) {
    throw new Error(`远端分支不存在: ${remoteName}/${branch}`);
  }

  const trackResult = await runGit([
    "checkout",
    "-b",
    branch,
    `${remoteName}/${branch}`,
  ]);
  if (!trackResult.success) {
    throw new Error(`创建本地分支失败: ${trackResult.output}`);
  }
};

const validateTargetBranches = async (runGit, branches, remoteName, mode) => {
  if (isPlanMode(mode)) {
    return;
  }
  for (const branch of branches) {
    const result = await runGit(["ls-remote", "--heads", remoteName, branch]);
    if (!result.success || result.output.length === 0) {
      throw new Error(`远端分支不存在: ${remoteName}/${branch}`);
    }
  }
};

const promptConfig = async (existingConfig) => {
  const remoteDefault = existingConfig.remoteName || "origin";
  const branchesDefault = Array.isArray(existingConfig.targetBranches)
    ? existingConfig.targetBranches.join(" ")
    : "sit beta";
  const strategyDefault = existingConfig.mergeStrategy || DEFAULT_MERGE_STRATEGY;

  const result = await promptConfigInput(existingConfig, {
    remoteName: remoteDefault,
    branchesDefault,
    strategyDefault,
  });

  const remoteName = result.remoteName || remoteDefault;
  if (!remoteName) {
    throw new Error("远端名不能为空");
  }

  const targetBranches = normalizeBranches(
    result.targetBranchesInput || branchesDefault
  );
  if (targetBranches.length === 0) {
    throw new Error("目标分支不能为空");
  }

  const mergeStrategy = result.mergeStrategy || strategyDefault;
  if (!VALID_MERGE_STRATEGIES.has(mergeStrategy)) {
    throw new Error("合并策略无效，仅支持 --no-ff / --ff-only / --squash");
  }

  return {
    remoteName,
    targetBranches,
    mergeStrategy,
  };
};

const ensureConfig = async (repoKey, repoRoot, logger) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const repoConfig = scopedConfig.repos[repoKey];
  const legacyRepoConfig = repoRoot ? scopedConfig.repos[repoRoot] : null;

  if (repoConfig) {
    return { rootConfig: normalized.root, repoConfig };
  }

  if (legacyRepoConfig) {
    scopedConfig.repos[repoKey] = legacyRepoConfig;
    delete scopedConfig.repos[repoRoot];
    await saveConfig(normalized.root, logger);
    return { rootConfig: normalized.root, repoConfig: legacyRepoConfig };
  }

  logger.warn("当前仓库未找到配置，开始初始化...");
  const newRepoConfig = await promptConfig(scopedConfig.default || {});
  scopedConfig.repos[repoKey] = newRepoConfig;
  await saveConfig(normalized.root, logger);
  logger.success(`配置已保存: ${logger.configFile}`);
  return { rootConfig: normalized.root, repoConfig: newRepoConfig };
};

const editConfig = async (repoKey, repoRoot, logger) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const existingRepoConfig =
    scopedConfig.repos[repoKey] ||
    (repoRoot ? scopedConfig.repos[repoRoot] : null) ||
    scopedConfig.default ||
    {};
  const updatedRepoConfig = await promptConfig(existingRepoConfig);
  scopedConfig.repos[repoKey] = updatedRepoConfig;
  if (repoRoot && repoRoot !== repoKey) {
    delete scopedConfig.repos[repoRoot];
  }
  await saveConfig(normalized.root, logger);
  logger.success(`配置已更新: ${logger.configFile}`);
};

const editGlobalConfig = async (logger) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const updatedGlobalConfig = await promptConfig(scopedConfig.default || {});
  scopedConfig.default = updatedGlobalConfig;
  await saveConfig(normalized.root, logger);
  logger.success(`全局配置已更新: ${logger.configFile}`);
};

const showRepoConfig = async (repoKey, repoRoot, logger) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const repoConfig =
    scopedConfig.repos[repoKey] ||
    (repoRoot ? scopedConfig.repos[repoRoot] : null) ||
    null;
  const mergedConfig = {
    ...(scopedConfig.default || {}),
    ...(repoConfig || {}),
  };
  const state = scopedConfig.state?.[repoKey] || null;
  const output = {
    repoKey,
    default: scopedConfig.default || null,
    repo: repoConfig,
    effective: repoConfig ? mergedConfig : null,
    state,
  };
  logger.info(JSON.stringify(output, null, 2));
};

const maybeCommitAndPush = async (
  runGit,
  logger,
  remoteName,
  sourceBranch,
  mode,
  noVerify
) => {
  const status = await getWorkingTreeStatus(runGit);
  if (status.length === 0) {
    return;
  }

  const { staged, unstaged } = await getStatusDetails(runGit);

  if (mode === MODE.PLAN) {
    logger.info(MESSAGES.planUncommitted);
    const message = "<commit-message>";
    if (unstaged || !staged) {
      await runGit(["add", "-A"]);
    }
    const commitArgs = noVerify
      ? ["commit", "-n", "-m", message]
      : ["commit", "-m", message];
    await runGit(commitArgs);
    await runGit(["push", remoteName, sourceBranch]);
    return;
  }

  const shouldCommit = await promptYesNo(MESSAGES.uncommittedConfirm);
  if (!shouldCommit) {
    throw new Error("存在未提交改动，已中止执行");
  }

  const message = await promptCommitMessage();
  if (!message) {
    throw new Error("commit message 不能为空，已中止执行");
  }

  if (unstaged || !staged) {
    const addResult = await runGit(["add", "-A"]);
    if (!addResult.success) {
      throw new Error(`暂存改动失败: ${addResult.output}`);
    }
  }

  const commitResult = await runGit(
    noVerify ? ["commit", "-n", "-m", message] : ["commit", "-m", message]
  );
  if (!commitResult.success) {
    throw new Error(`提交失败: ${commitResult.output}`);
  }

  const upstream = await runGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const pushCommand = upstream.success
    ? ["push", remoteName, sourceBranch]
    : ["push", "-u", remoteName, sourceBranch];
  const pushResult = await runGit(pushCommand);
  if (!pushResult.success) {
    const hint = classifyGitError(pushResult.output);
    throw new Error(`推送当前分支失败: ${hint || pushResult.output}`);
  }
};

const maybeCreateBranch = async (runGit, logger, remoteName, sourceBranch, mode) => {
  const defaultBranch = await getDefaultBranch(runGit, remoteName);
  if (!isDefaultBranchName(sourceBranch, defaultBranch)) {
    return sourceBranch;
  }

  if (mode === MODE.PLAN) {
    const placeholder = "<new-branch>";
    logger.info(MESSAGES.planCreateBranch(placeholder));
    await runGit(["checkout", "-b", placeholder]);
    return placeholder;
  }

  const newBranch = await promptNewBranchName();
  if (!newBranch) {
    throw new Error("新分支名不能为空，已中止执行");
  }

  const checkoutResult = await runGit(["checkout", "-b", newBranch]);
  if (!checkoutResult.success) {
    throw new Error(`创建分支失败: ${checkoutResult.output}`);
  }

  return newBranch;
};

const mergeIntoBranch = async (runGit, sourceBranch, targetBranch, config, mode) => {
  await ensureBranchAvailable(runGit, targetBranch, config.remoteName, mode);

  const checkoutResult = await runGit(["checkout", targetBranch]);
  if (!checkoutResult.success) {
    throw new Error(`切换到 ${targetBranch} 失败: ${checkoutResult.output}`);
  }

  const pullResult = await runGit(["pull", config.remoteName, targetBranch]);
  if (!pullResult.success) {
    throw new Error(`拉取 ${targetBranch} 失败: ${pullResult.output}`);
  }

  const mergeResult = await runGit(["merge", config.mergeStrategy, sourceBranch]);
  if (!mergeResult.success) {
    const conflict = await hasMergeConflict(runGit);
    if (conflict) {
      throw new Error(
        `合并 ${sourceBranch} -> ${targetBranch} 冲突，请手动解决后再继续。`
      );
    }
    const hint = classifyGitError(mergeResult.output);
    throw new Error(`合并失败: ${hint || mergeResult.output}`);
  }

  const pushResult = await runGit(["push", config.remoteName, targetBranch]);
  if (!pushResult.success) {
    const hint = classifyGitError(pushResult.output);
    throw new Error(`推送 ${targetBranch} 失败: ${hint || pushResult.output}`);
  }
};

const printUsage = (logger) => {
  for (const line of usageLines(CLI_NAME)) {
    logger.info(line);
  }
};

export const run = async (logger, argv) => {
  const args = argv ?? process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage(logger);
    return;
  }

  const dryRun = args.includes("--dry-run");
  const planOnly = args.includes("--plan");
  const noVerify = args.includes("--no-verify") || args.includes("-n");
  const resume = args.includes("--resume");
  if (dryRun && planOnly) {
    throw new Error("--dry-run 与 --plan 不能同时使用");
  }

  const mode = resolveMode({ dryRun, planOnly });
  const plannedCommands = mode === MODE.NORMAL ? null : [];
  const { runGit } = createGitRunner({ mode, plannedCommands, logger });

  if (args.includes("--global")) {
    await editGlobalConfig(logger);
    return;
  }

  const repoRoot = await getRepoRoot(runGit);
  const repoKey = await getRepoKey(runGit, repoRoot);

  if (args.includes("--config") || args.includes("--edit")) {
    await editConfig(repoKey, repoRoot, logger);
    return;
  }

  if (args.includes("--show-config")) {
    await showRepoConfig(repoKey, repoRoot, logger);
    return;
  }

  await ensureGitRepo(runGit);

  const { repoConfig, rootConfig } = await ensureConfig(repoKey, repoRoot, logger);
  if (rootConfig?.[CONFIG_SCOPE]?.state && Object.keys(rootConfig[CONFIG_SCOPE].state).length > 0) {
    rootConfig[CONFIG_SCOPE].state = {};
    await saveConfig(rootConfig, logger, { backup: false });
  }
  const originalBranch = await getCurrentBranch(runGit);
  const state = await loadState();
  const sourceBranch = await maybeCreateBranch(
    runGit,
    logger,
    repoConfig.remoteName,
    originalBranch,
    mode
  );
  await maybeCommitAndPush(
    runGit,
    logger,
    repoConfig.remoteName,
    sourceBranch,
    mode,
    noVerify
  );

  logger.info(`当前分支: ${sourceBranch}`);
  logger.info(`远端: ${repoConfig.remoteName}`);
  logger.info(`目标分支: ${repoConfig.targetBranches.join(", ")}`);
  logger.info(`合并策略: ${repoConfig.mergeStrategy}`);

  if (mode === MODE.DRY_RUN) {
    logger.info(MESSAGES.dryRunModeInfo);
  }
  if (mode === MODE.PLAN) {
    logger.info(MESSAGES.planModeInfo);
  }

  if (shouldValidateRemote(mode)) {
    const fetchResult = await runGit(["fetch", repoConfig.remoteName]);
    if (!fetchResult.success) {
      const hint = classifyGitError(fetchResult.output);
      throw new Error(`拉取远端失败: ${hint || fetchResult.output}`);
    }

    await validateTargetBranches(
      runGit,
      repoConfig.targetBranches,
      repoConfig.remoteName,
      mode
    );

    await checkBranchPushed(runGit, logger);
  }

  let hasConflict = false;
  const shouldReturnToOriginal = originalBranch === sourceBranch;
  try {
    const resumeState = state || null;
    const targetsSignature = getTargetsSignature(repoConfig.targetBranches);
    let startIndex = 0;
    if (resume && resumeState) {
      if (resumeState.targetsSignature !== targetsSignature) {
        logger.info(MESSAGES.resumeTargetsChanged);
      } else {
        const foundIndex = repoConfig.targetBranches.indexOf(
          resumeState.targetBranch
        );
        if (foundIndex === -1) {
          logger.info(MESSAGES.resumeNotFound);
        } else {
          startIndex = foundIndex;
        }
      }
    }

    const targets = repoConfig.targetBranches;
    if (mode === MODE.PLAN) {
      for (let i = startIndex; i < targets.length; i += 1) {
        const targetBranch = targets[i];
        await runGit(["checkout", targetBranch]);
        await runGit(["pull", repoConfig.remoteName, targetBranch]);
        await runGit(["merge", repoConfig.mergeStrategy, sourceBranch]);
        await runGit(["push", repoConfig.remoteName, targetBranch]);
      }
      return;
    }

    for (let i = startIndex; i < targets.length; i += 1) {
      const targetBranch = targets[i];
      if (shouldWriteState(mode)) {
        await saveState({
          targetBranch,
          sourceBranch,
          targetsSignature,
        });
      }
      await mergeIntoBranch(runGit, sourceBranch, targetBranch, repoConfig, mode);
      if (shouldWriteState(mode)) {
        await clearState();
      }
    }
  } catch (error) {
    hasConflict = await hasMergeConflict(runGit);
    throw error;
  } finally {
    if (!hasConflict) {
      const targetBranch = shouldReturnToOriginal ? originalBranch : sourceBranch;
      const backResult = await runGit(["checkout", targetBranch]);
      if (backResult.success) {
        logger.info(`已切回分支: ${targetBranch}`);
      } else {
        logger.warn(`切回分支失败: ${backResult.output}`);
      }
    }
  }

  if (plannedCommands && plannedCommands.length > 0) {
    const label = mode === MODE.PLAN ? "PLAN" : "DRY RUN";
    logger.info(`\n${label} 将执行的命令:`);
    for (const cmd of plannedCommands) {
      logger.info(cmd);
    }
  }

  logger.success("\n🎉 全部合并并推送完成");
};
