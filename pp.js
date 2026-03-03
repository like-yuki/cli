#!/usr/bin/env node

import { promises as fs } from "fs";
import { spawn } from "child_process";
import os from "os";
import path from "path";
import readline from "readline/promises";

const CONFIG_DIR = path.join(os.homedir(), ".config", "like-yuki-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_MERGE_STRATEGY = "--no-ff";

const logger = {
  info: (...msg) => console.log(msg.join(" ")),
  warn: (...msg) => console.warn("\x1b[33m%s\x1b[0m", msg.join(" ")),
  error: (...msg) => console.error("\x1b[31m%s\x1b[0m", msg.join(" ")),
  success: (...msg) => console.log("\x1b[32m%s\x1b[0m", msg.join(" ")),
};

const VALID_MERGE_STRATEGIES = new Set(["--no-ff", "--ff-only", "--squash"]);
let plannedCommands = null;

const isMutatingCommand = (command) =>
  /^(checkout|merge|push|fetch|pull|add|commit)\b/.test(command.trim());

const createGitProcess = (args, cwd) => {
  const child = spawn("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    child,
    [Symbol.dispose]() {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
};

const runGit = async (command, options = {}) => {
  const { cwd = process.cwd(), dryRun = false } = options;
  if (dryRun && plannedCommands) {
    plannedCommands.push(`git ${command}`);
  }
  if (dryRun && isMutatingCommand(command)) {
    logger.info(`DRY RUN: git ${command}`);
    return { success: true, output: "" };
  }

  const args = command.trim().split(/\s+/);
  using processResource = createGitProcess(args, cwd);
  const { child } = processResource;

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return await new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({
        success: false,
        output: (error?.message || "").trim(),
        error,
      });
    });

    child.on("close", (code) => {
      const output = (stdout || stderr || "").trim();
      resolve({
        success: code === 0,
        output,
      });
    });
  });
};

const ensureGitRepo = async () => {
  const result = await runGit("rev-parse --is-inside-work-tree");
  if (!result.success || result.output !== "true") {
    throw new Error("当前目录不是 Git 仓库");
  }
};

const getRepoRoot = async () => {
  const result = await runGit("rev-parse --show-toplevel");
  if (!result.success) {
    throw new Error(`无法获取仓库根目录: ${result.output}`);
  }
  return result.output;
};

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

const getRepoKey = async (repoRoot) => {
  const remoteResult = await runGit("config --get remote.origin.url", {
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

const getCurrentBranch = async () => {
  const result = await runGit("rev-parse --abbrev-ref HEAD");
  if (!result.success) {
    throw new Error(`无法获取当前分支: ${result.output}`);
  }
  return result.output;
};

const getDefaultBranch = async (remoteName, dryRun) => {
  const result = await runGit(`symbolic-ref refs/remotes/${remoteName}/HEAD`, {
    dryRun,
  });
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

const getWorkingTreeStatus = async () => {
  const result = await runGit("status --porcelain");
  if (!result.success) {
    throw new Error(`无法获取工作区状态: ${result.output}`);
  }
  return result.output;
};

const getStatusDetails = async () => {
  const stagedResult = await runGit("diff --cached --name-only");
  if (!stagedResult.success) {
    throw new Error(`无法获取暂存区状态: ${stagedResult.output}`);
  }
  const unstagedResult = await runGit("diff --name-only");
  if (!unstagedResult.success) {
    throw new Error(`无法获取工作区差异: ${unstagedResult.output}`);
  }

  return {
    staged: stagedResult.output.length > 0,
    unstaged: unstagedResult.output.length > 0,
  };
};

const parseAheadBehind = (output) => {
  const parts = output.trim().split(/\s+/).map((item) => Number(item));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return { ahead: 0, behind: 0 };
  }
  return { behind: parts[0], ahead: parts[1] };
};

const checkBranchPushed = async () => {
  const upstream = await runGit(
    "rev-parse --abbrev-ref --symbolic-full-name @{u}"
  );
  if (!upstream.success) {
    logger.warn("当前分支未设置上游分支，无法判断是否已推送");
    return;
  }

  const aheadBehind = await runGit("rev-list --left-right --count @{u}...HEAD");
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

const hasMergeConflict = async () => {
  const result = await runGit("diff --name-only --diff-filter=U");
  if (!result.success) {
    return false;
  }
  return result.output.length > 0;
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

const ensureBranchAvailable = async (branch, remoteName, dryRun) => {
  const localCheck = await runGit(`rev-parse --verify ${branch}`, { dryRun });
  if (localCheck.success) {
    return;
  }

  const remoteCheck = await runGit(`ls-remote --heads ${remoteName} ${branch}`, {
    dryRun,
  });
  if (!remoteCheck.success || remoteCheck.output.length === 0) {
    throw new Error(`远端分支不存在: ${remoteName}/${branch}`);
  }

  const trackResult = await runGit(
    `checkout -b ${branch} ${remoteName}/${branch}`,
    { dryRun }
  );
  if (!trackResult.success) {
    throw new Error(`创建本地分支失败: ${trackResult.output}`);
  }
};

const validateTargetBranches = async (branches, remoteName, dryRun) => {
  for (const branch of branches) {
    const result = await runGit(`ls-remote --heads ${remoteName} ${branch}`, {
      dryRun,
    });
    if (!result.success || result.output.length === 0) {
      throw new Error(`远端分支不存在: ${remoteName}/${branch}`);
    }
  }
};

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

const loadConfig = async () => {
  try {
    await using fileResource = await createFileHandle(CONFIG_FILE, "r");
    const raw = await fileResource.handle.readFile({ encoding: "utf-8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveConfig = async (config) => {
  await ensureConfigDir();
  try {
    const stat = await fs.stat(CONFIG_FILE);
    if (stat.isFile()) {
      const backupPath = `${CONFIG_FILE}.bak`;
      await fs.copyFile(CONFIG_FILE, backupPath);
      logger.info(`配置已备份: ${backupPath}`);
    }
  } catch {}
  await using fileResource = await createFileHandle(CONFIG_FILE, "w");
  await fileResource.handle.writeFile(JSON.stringify(config, null, 2), "utf-8");
};

const normalizeBranches = (input) =>
  input
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const createDisposableInterface = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    rl,
    [Symbol.dispose]() {
      rl.close();
    },
  };
};

const promptConfig = async (existingConfig = {}) => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;

  const remoteNameInput = await rl.question(
    `远端名 (${existingConfig.remoteName || "origin"}): `
  );
  const remoteName = (remoteNameInput || existingConfig.remoteName || "origin").trim();
  if (!remoteName) {
    throw new Error("远端名不能为空");
  }

  const branchesDefault = Array.isArray(existingConfig.targetBranches)
    ? existingConfig.targetBranches.join(" ")
    : "deploy_beta deploy_sit";
  const targetBranchesInput = await rl.question(
    `目标分支(空格分隔) (${branchesDefault}): `
  );
  const targetBranches = normalizeBranches(
    targetBranchesInput || branchesDefault
  );
  if (targetBranches.length === 0) {
    throw new Error("目标分支不能为空");
  }

  const strategyDefault =
    existingConfig.mergeStrategy || DEFAULT_MERGE_STRATEGY;
  const mergeStrategyInput = await rl.question(
    `合并策略 (--no-ff/--ff-only/--squash) (${strategyDefault}): `
  );
  const mergeStrategy = (mergeStrategyInput || strategyDefault).trim();
  if (!VALID_MERGE_STRATEGIES.has(mergeStrategy)) {
    throw new Error("合并策略无效，仅支持 --no-ff / --ff-only / --squash");
  }

  return {
    remoteName,
    targetBranches,
    mergeStrategy,
  };
};

const promptYesNo = async (question) => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const answer = await rl.question(`${question} (Y/n): `);
  const normalized = answer.trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  return normalized === "y";
};

const promptCommitMessage = async () => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const message = await rl.question("请输入 commit message: ");
  return message.trim();
};

const promptNewBranchName = async () => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const name = await rl.question("当前在默认分支，请输入新分支名: ");
  return name.trim();
};

const normalizeConfigShape = (config) => {
  const root = config && typeof config === "object" ? config : {};
  const hasScope = Object.prototype.hasOwnProperty.call(root, "lk-pp");
  const otherKeys = Object.keys(root).filter(
    (key) => key !== "default" && key !== "repos" && key !== "lk-pp"
  );
  const isLegacy = !hasScope && otherKeys.length === 0;
  const scoped = hasScope ? root["lk-pp"] : isLegacy ? root : null;

  if (!scoped) {
    return {
      root: { ...root, "lk-pp": { default: null, repos: {} } },
      scope: "lk-pp",
    };
  }

  const normalized = {
    default: scoped.default || null,
    repos: scoped.repos || {},
  };

  return {
    root: { ...root, "lk-pp": normalized },
    scope: "lk-pp",
  };
};

const ensureConfig = async (repoKey, repoRoot) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const repoConfig = scopedConfig.repos[repoKey];
  const legacyRepoConfig = repoRoot
    ? scopedConfig.repos[repoRoot]
    : null;

  if (repoConfig) {
    return { rootConfig: normalized.root, repoConfig };
  }

  if (legacyRepoConfig) {
    scopedConfig.repos[repoKey] = legacyRepoConfig;
    delete scopedConfig.repos[repoRoot];
    await saveConfig(normalized.root);
    return { rootConfig: normalized.root, repoConfig: legacyRepoConfig };
  }

  logger.warn("当前仓库未找到配置，开始初始化...");
  const newRepoConfig = await promptConfig(scopedConfig.default || {});
  scopedConfig.repos[repoKey] = newRepoConfig;
  await saveConfig(normalized.root);
  logger.success(`配置已保存: ${CONFIG_FILE}`);
  return { rootConfig: normalized.root, repoConfig: newRepoConfig };
};

const editConfig = async (repoKey, repoRoot) => {
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
  await saveConfig(normalized.root);
  logger.success(`配置已更新: ${CONFIG_FILE}`);
};

const editGlobalConfig = async () => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const updatedGlobalConfig = await promptConfig(scopedConfig.default || {});
  scopedConfig.default = updatedGlobalConfig;
  await saveConfig(normalized.root);
  logger.success(`全局配置已更新: ${CONFIG_FILE}`);
};

const showRepoConfig = async (repoKey, repoRoot) => {
  const rawConfig = await loadConfig();
  const normalized = normalizeConfigShape(rawConfig);
  const scopedConfig = normalized.root[normalized.scope];
  const repoConfig =
    scopedConfig.repos[repoKey] ||
    (repoRoot ? scopedConfig.repos[repoRoot] : null) ||
    null;
  const output = {
    repo: repoKey,
    config: repoConfig,
  };
  logger.info(JSON.stringify(output, null, 2));
};

const mergeIntoBranch = async (sourceBranch, targetBranch, config, dryRun) => {
  logger.info(`\n🔀 合并 ${sourceBranch} -> ${targetBranch}`);

  await ensureBranchAvailable(targetBranch, config.remoteName, dryRun);

  const checkoutResult = await runGit(`checkout ${targetBranch}`, { dryRun });
  if (!checkoutResult.success) {
    throw new Error(`切换到 ${targetBranch} 失败: ${checkoutResult.output}`);
  }

  const pullResult = await runGit(`pull ${config.remoteName} ${targetBranch}`, {
    dryRun,
  });
  if (!pullResult.success) {
    throw new Error(`拉取 ${targetBranch} 失败: ${pullResult.output}`);
  }

  const mergeResult = await runGit(
    `merge ${config.mergeStrategy} ${sourceBranch}`,
    { dryRun }
  );
  if (!mergeResult.success) {
    const conflict = await hasMergeConflict();
    if (conflict) {
      throw new Error(
        `合并 ${sourceBranch} -> ${targetBranch} 冲突，请手动解决后再继续。`
      );
    }
    const hint = classifyGitError(mergeResult.output);
    throw new Error(`合并失败: ${hint || mergeResult.output}`);
  }

  const pushResult = await runGit(`push ${config.remoteName} ${targetBranch}`, {
    dryRun,
  });
  if (!pushResult.success) {
    const hint = classifyGitError(pushResult.output);
    throw new Error(`推送 ${targetBranch} 失败: ${hint || pushResult.output}`);
  }

  logger.success(`✅ 已合并并推送: ${targetBranch}`);
};

const maybeCommitAndPush = async (remoteName, sourceBranch, dryRun) => {
  const status = await getWorkingTreeStatus();
  if (status.length === 0) {
    return;
  }

  const { staged, unstaged } = await getStatusDetails();
  
  const shouldCommit = await promptYesNo(
    "检测到未提交改动，是否现在提交并推送?"
  );
  if (!shouldCommit) {
    throw new Error("存在未提交改动，已中止执行");
  }

  const message = await promptCommitMessage();
  if (!message) {
    throw new Error("commit message 不能为空，已中止执行");
  }

  if (unstaged || !staged) {
    const addResult = await runGit("add -A", { dryRun });
    if (!addResult.success) {
      throw new Error(`暂存改动失败: ${addResult.output}`);
    }
  }

  const commitResult = await runGit(`commit -m "${message}"`, { dryRun });
  if (!commitResult.success) {
    throw new Error(`提交失败: ${commitResult.output}`);
  }

  const upstream = await runGit(
    "rev-parse --abbrev-ref --symbolic-full-name @{u}",
    { dryRun }
  );
  const pushCommand = upstream.success
    ? `push ${remoteName} ${sourceBranch}`
    : `push -u ${remoteName} ${sourceBranch}`;
  const pushResult = await runGit(pushCommand, { dryRun });
  if (!pushResult.success) {
    const hint = classifyGitError(pushResult.output);
    throw new Error(`推送当前分支失败: ${hint || pushResult.output}`);
  }
};

const maybeCreateBranch = async (remoteName, sourceBranch, dryRun) => {
  const defaultBranch = await getDefaultBranch(remoteName, dryRun);
  if (!isDefaultBranchName(sourceBranch, defaultBranch)) {
    return sourceBranch;
  }

  const newBranch = await promptNewBranchName();
  if (!newBranch) {
    throw new Error("新分支名不能为空，已中止执行");
  }

  const checkoutResult = await runGit(`checkout -b ${newBranch}`, { dryRun });
  if (!checkoutResult.success) {
    throw new Error(`创建分支失败: ${checkoutResult.output}`);
  }

  return newBranch;
};

const printUsage = () => {
  logger.info("lk-pp 用法:");
  logger.info("  lk-pp               执行合并并推送");
  logger.info("  lk-pp --dry-run     演练运行，不执行变更");
  logger.info("  lk-pp --config      修改当前仓库配置");
  logger.info("  lk-pp --edit        修改当前仓库配置");
  logger.info("  lk-pp --global      修改默认配置");
  logger.info("  lk-pp --show-config 查看当前仓库配置");
};

const main = async () => {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
      printUsage();
      return;
    }

    const dryRun = args.includes("--dry-run");

    if (args.includes("--global")) {
      await editGlobalConfig();
      return;
    }

    const repoRoot = await getRepoRoot();
    const repoKey = await getRepoKey(repoRoot);

    if (args.includes("--config") || args.includes("--edit")) {
      await editConfig(repoKey, repoRoot);
      return;
    }

    if (args.includes("--show-config")) {
      await showRepoConfig(repoKey, repoRoot);
      return;
    }

    await ensureGitRepo();

    const { repoConfig } = await ensureConfig(repoKey, repoRoot);
    const originalBranch = await getCurrentBranch();
    const sourceBranch = await maybeCreateBranch(
      repoConfig.remoteName,
      originalBranch,
      dryRun
    );
    await maybeCommitAndPush(repoConfig.remoteName, sourceBranch, dryRun);

    logger.info(`当前分支: ${sourceBranch}`);
    logger.info(`远端: ${repoConfig.remoteName}`);
    logger.info(`目标分支: ${repoConfig.targetBranches.join(", ")}`);
    logger.info(`合并策略: ${repoConfig.mergeStrategy}`);

    if (dryRun) {
      logger.info("DRY RUN 模式: 不会执行实际变更");
      plannedCommands = [];
    }

    const fetchResult = await runGit(`fetch ${repoConfig.remoteName}`, {
      dryRun,
    });
    if (!fetchResult.success) {
      const hint = classifyGitError(fetchResult.output);
      throw new Error(`拉取远端失败: ${hint || fetchResult.output}`);
    }

    await validateTargetBranches(
      repoConfig.targetBranches,
      repoConfig.remoteName,
      dryRun
    );

    await checkBranchPushed();

    let hasConflict = false;
    const shouldReturnToOriginal = originalBranch === sourceBranch;
    try {
      for (const targetBranch of repoConfig.targetBranches) {
        await mergeIntoBranch(sourceBranch, targetBranch, repoConfig, dryRun);
      }
    } catch (error) {
      hasConflict = await hasMergeConflict();
      throw error;
    } finally {
      if (!hasConflict && shouldReturnToOriginal) {
        const backResult = await runGit(`checkout ${originalBranch}`, {
          dryRun,
        });
        if (backResult.success) {
          logger.info(`已切回分支: ${originalBranch}`);
        } else {
          logger.warn(`切回分支失败: ${backResult.output}`);
        }
      }
    }

    if (dryRun && plannedCommands) {
      logger.info("\nDRY RUN 将执行的命令:");
      for (const cmd of plannedCommands) {
        logger.info(cmd);
      }
    }

    logger.success("\n🎉 全部合并并推送完成");
  } finally {
    // logger.info("资源已释放");
  }
};

main().catch((error) => {
  logger.error(error.message || String(error));
  process.exit(1);
});
