import path from "path";
import { executeGitCommand } from "./git.js";
import { isDirectoryAccessible, readDirectory } from "./fs.js";
import { DEFAULT_SKIP_DIRS } from "./constants.js";

export const isGitRepo = async (dirPath) => {
  try {
    if (!(await isDirectoryAccessible(dirPath))) {
      return false;
    }
    const result = await executeGitCommand(
      ["rev-parse", "--is-inside-work-tree"],
      dirPath
    );
    return result.success && result.output.trim() === "true";
  } catch {
    return false;
  }
};

export const checkGitRepoStatus = async (repo, logger) => {
  try {
    const gitVersionResult = await executeGitCommand(["--version"], repo.path);
    if (!gitVersionResult.success) {
      throw new Error("Git命令不可用");
    }

    const remoteResult = await executeGitCommand(["remote", "-v"], repo.path);
    if (!remoteResult.success) {
      throw new Error("无法访问远程仓库");
    }

    return true;
  } catch (error) {
    logger.error(`仓库 ${repo.name} 状态检查失败: ${error.message}`);
    return false;
  }
};

export const getRepoInfo = async (dirPath) => {
  try {
    const [remoteUrlResult, branchResult, lastCommitResult] =
      await Promise.all([
        executeGitCommand(["config", "--get", "remote.origin.url"], dirPath),
        executeGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], dirPath),
        executeGitCommand([
          "log",
          "-1",
          "--format=%h - %s (%cr)",
        ], dirPath),
      ]);

    return {
      remoteUrl: remoteUrlResult.success
        ? remoteUrlResult.output.trim()
        : "未知",
      currentBranch: branchResult.success
        ? branchResult.output.trim()
        : "未知",
      lastCommit: lastCommitResult.success
        ? lastCommitResult.output.trim()
        : "未知",
    };
  } catch (error) {
    return {
      remoteUrl: "获取失败",
      currentBranch: "获取失败",
      lastCommit: "获取失败",
      error: error.message,
    };
  }
};

const isGitDir = (entry) => entry.isDirectory() && entry.name === ".git";

const hasGitDir = (entries) => entries.some((entry) => isGitDir(entry));

export const scanDirectories = async (
  currentPath,
  maxDepth,
  logger,
  currentDepth = 1,
  repos = [],
  seen = new Set(),
  skipDirs = new Set(DEFAULT_SKIP_DIRS)
) => {
  if (maxDepth === 0 && currentDepth === 1) {
    const fullPath = path.join(currentPath, "./");
    if (seen.has(fullPath)) {
      return repos;
    }
    seen.add(fullPath);
    if (await isGitRepo(fullPath)) {
      const repoInfo = await getRepoInfo(fullPath);
      repos.push({
        name: currentPath,
        path: fullPath,
        timestamp: new Date(),
        ...repoInfo,
      });
      logger.info(`发现 Git 仓库: ${currentPath}`);
    }
    return repos;
  }

  if (currentDepth > maxDepth) {
    return repos;
  }

  try {
    if (!(await isDirectoryAccessible(currentPath))) {
      logger.warn(`警告: 目录 ${currentPath} 无法访问，已跳过`);
      return repos;
    }

    const entries = await readDirectory(currentPath);
    if (hasGitDir(entries)) {
      const repoRoot = currentPath;
      if (!seen.has(repoRoot) && (await isGitRepo(repoRoot))) {
        seen.add(repoRoot);
        const repoInfo = await getRepoInfo(repoRoot);
        repos.push({
          name: path.basename(repoRoot),
          path: repoRoot,
          timestamp: new Date(),
          ...repoInfo,
        });
        logger.info(`发现 Git 仓库: ${path.basename(repoRoot)}`);
      }
      return repos;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        if (skipDirs.has(entry.name)) {
          continue;
        }
        const fullPath = path.join(currentPath, entry.name);
        try {
          if (entry.name === ".git") {
            continue;
          }
          if (seen.has(fullPath)) {
            continue;
          }
          seen.add(fullPath);
          if (await isGitRepo(fullPath)) {
            const repoInfo = await getRepoInfo(fullPath);
            repos.push({
              name: entry.name,
              path: fullPath,
              timestamp: new Date(),
              ...repoInfo,
            });
            logger.info(`发现 Git 仓库: ${entry.name}`);
          } else if (currentDepth < maxDepth) {
            await scanDirectories(
              fullPath,
              maxDepth,
              logger,
              currentDepth + 1,
              repos,
              seen,
              skipDirs
            );
          }
        } catch (error) {
          logger.warn(`警告: 处理目录 ${fullPath} 时出错: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error(`错误: 扫描目录 ${currentPath} 失败: ${error.message}`);
  }

  return repos;
};
