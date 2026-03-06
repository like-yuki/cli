import { executeGitCommand } from "./git.js";
import { checkGitRepoStatus } from "./repo.js";
import { executeCommand } from "./command.js";

const runPreCommands = async (repo, logger, commands, timeoutMs) => {
  if (!commands || commands.length === 0) {
    return { success: true };
  }

  for (const command of commands) {
    const result = await executeCommand(command, repo.path, timeoutMs);
    if (!result.success) {
      logger.warn(`⚠️ 命令执行失败: ${command}`);
      return { success: false, output: result.output };
    }
  }

  return { success: true };
};

export const pullRepo = async (
  repo,
  logger,
  verbose,
  commands = [],
  timeoutMs
) => {
  logger.info(`\n📁 正在处理仓库 ${repo.name}...`);

  try {
    if (!(await checkGitRepoStatus(repo, logger))) {
      return { status: "skipped", repo, reason: "仓库状态检查失败" };
    }

    const commandResult = await runPreCommands(
      repo,
      logger,
      commands,
      timeoutMs
    );
    if (!commandResult.success) {
      return {
        status: "failed",
        repo,
        error: commandResult.output || "命令执行失败",
      };
    }

    if (commands.length > 0) {
      logger.success(`✅ 自定义命令执行完成: ${repo.name}`);
      return { status: "success", repo };
    }

    const statusResult = await executeGitCommand(
      ["status", "--porcelain"],
      repo.path
    );
    const hasChanges = statusResult.output.length > 0;

    if (hasChanges) {
      if (verbose) {
        logger.info(`发现未提交的更改，正在暂存 ${repo.name} 的更改...`);
      }
      const stashResult = await executeGitCommand(
        ["stash", "--include-untracked"],
        repo.path
      );
      if (!stashResult.success) {
        throw new Error("暂存更改失败");
      }
    }

    const pullResult = await executeGitCommand(["pull"], repo.path);

    if (hasChanges) {
      if (verbose) {
        logger.info(`正在恢复 ${repo.name} 的暂存更改...`);
      }
      const popResult = await executeGitCommand(
        ["stash", "pop"],
        repo.path
      );
      if (!popResult.success) {
        logger.warn(`警告: ${repo.name} 恢复暂存更改失败，请手动处理`);
      }
    }

    if (pullResult.success) {
      logger.success(
        `✅ 更新成功: ${repo.name}\n${verbose ? pullResult.output : ""}`
      );
      return { status: "success", repo };
    }

    throw new Error(pullResult.output);
  } catch (error) {
    logger.error(
      `❌ 更新失败: ${repo.name}\n${verbose ? error.message : ""}`
    );
    return { status: "failed", repo, error: error.message };
  }
};
