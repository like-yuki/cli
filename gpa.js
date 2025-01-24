#!/usr/bin/env node

import { promises as fs } from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

// 日志工具对象，支持不同级别的彩色输出
const logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn("\x1b[33m%s\x1b[0m", msg), // 黄色警告
  error: (msg) => console.error("\x1b[31m%s\x1b[0m", msg), // 红色错误
  success: (msg) => console.log("\x1b[32m%s\x1b[0m", msg), // 绿色成功
};

class GitPuller {
  constructor(maxDepth = 0) {
    // 限制递归深度在0-10之间
    this.maxDepth = Math.max(1, Math.min(10, parseInt(maxDepth) || 0));
    this.gitRepos = []; // 存储发现的所有git仓库
    this.successRepos = []; // 成功更新的仓库
    this.failedRepos = []; // 更新失败的仓库
    this.skippedRepos = []; // 跳过的仓库
    this.startTime = Date.now(); // 记录开始时间
  }

  /**
   * 执行git命令的通用方法
   * @param {string} command - git命令
   * @param {string} cwd - 执行命令的目录
   * @param {number} timeout - 超时时间(毫秒)
   */
  async executeGitCommand(command, cwd, timeout = 30000) {
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024 * 30, // 30MB缓冲区
      });
      return { success: true, output: stdout || stderr };
    } catch (error) {
      return {
        success: false,
        output: error.message,
        error,
      };
    }
  }

  /**
   * 检查目录是否可访问
   * @param {string} dirPath - 目录路径
   */
  async isDirectoryAccessible(dirPath) {
    try {
      await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否为git仓库
   * @param {string} dirPath - 目录路径
   */
  async isGitRepo(dirPath) {
    try {
      // 首先检查目录是否存在且可访问
      if (!(await this.isDirectoryAccessible(dirPath))) {
        return false;
      }
      // 使用git命令检查是否为git仓库
      const result = await this.executeGitCommand(
        "git rev-parse --is-inside-work-tree",
        dirPath
      );
      return result.success && result.output.trim() === "true";
    } catch {
      return false;
    }
  }

  // 检查git仓库状态
  async checkGitRepoStatus(repo) {
    try {
      // 检查是否能执行git命令
      const gitVersionResult = await this.executeGitCommand(
        "git --version",
        repo.path
      );
      if (!gitVersionResult.success) {
        throw new Error("Git命令不可用");
      }

      // 检查远程仓库是否可访问
      const remoteResult = await this.executeGitCommand(
        "git remote -v",
        repo.path
      );
      if (!remoteResult.success) {
        throw new Error("无法访问远程仓库");
      }

      return true;
    } catch (error) {
      console.error(`仓库 ${repo.name} 状态检查失败: ${error.message}`);
      return false;
    }
  }

  // 获取仓库详细信息
  async getRepoInfo(dirPath) {
    try {
      // 并行执行多个git命令获取仓库信息
      const [remoteUrlResult, branchResult, lastCommitResult] =
        await Promise.all([
          // 获取远程仓库URL
          this.executeGitCommand("git config --get remote.origin.url", dirPath),
          // 获取当前分支
          this.executeGitCommand("git rev-parse --abbrev-ref HEAD", dirPath),
          // 获取最后一次提交信息
          this.executeGitCommand(
            'git log -1 --format="%h - %s (%cr)"',
            dirPath
          ),
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
  }

  /**
   * 递归扫描目录查找git仓库
   * @param {string} currentPath - 当前扫描的路径
   * @param {number} currentDepth - 当前递归深度
   */
  async scanDirectories(currentPath, currentDepth = 1) {
    if (currentDepth > this.maxDepth) return;

    try {
      // 检查目录是否可访问
      if (!(await this.isDirectoryAccessible(currentPath))) {
        logger.warn(`警告: 目录 ${currentPath} 无法访问，已跳过`);
        return;
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      // 遍历目录中的所有条目
      for (const entry of entries) {
        // 跳过隐藏目录
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const fullPath = path.join(currentPath, entry.name);
          try {
            if (await this.isGitRepo(fullPath)) {
              // 如果是git仓库，获取详细信息并添加到列表
              const repoInfo = await this.getRepoInfo(fullPath);
              this.gitRepos.push({
                name: entry.name,
                path: fullPath,
                timestamp: new Date(),
                ...repoInfo,
              });
              logger.info(`发现 Git 仓库: ${entry.name}`);
            } else if (currentDepth < this.maxDepth) {
              // 如果不是git仓库且未达到最大深度，继续递归
              await this.scanDirectories(fullPath, currentDepth + 1);
            }
          } catch (error) {
            logger.warn(`警告: 处理目录 ${fullPath} 时出错: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`错误: 扫描目录 ${currentPath} 失败: ${error.message}`);
    }
  }

  /**
   * 更新单个仓库
   * @param {Object} repo - 仓库信息对象
   */
  async pullRepo(repo) {
    logger.info(`\n📁 正在处理仓库 ${repo.name}...`);

    try {
      if (!(await this.checkGitRepoStatus(repo))) {
        this.skippedRepos.push({ ...repo, reason: "仓库状态检查失败" });
        return;
      }
      // 检查是否有未提交的更改
      const statusResult = await this.executeGitCommand(
        "git status --porcelain",
        repo.path
      );
      const hasChanges = statusResult.output.length > 0;

      // 如果有未提交的更改，先暂存
      if (hasChanges) {
        logger.info(`发现未提交的更改，正在暂存 ${repo.name} 的更改...`);
        const stashResult = await this.executeGitCommand(
          "git stash --include-untracked",
          repo.path
        );
        if (!stashResult.success) {
          throw new Error("暂存更改失败");
        }
      }

      // 执行pull操作
      const pullResult = await this.executeGitCommand("git pull", repo.path);

      // 如果之前有暂存的更改，现在恢复
      if (hasChanges) {
        logger.info(`正在恢复 ${repo.name} 的暂存更改...`);
        const popResult = await this.executeGitCommand(
          "git stash pop",
          repo.path
        );
        if (!popResult.success) {
          logger.warn(`警告: ${repo.name} 恢复暂存更改失败，请手动处理`);
        }
      }

      if (pullResult.success) {
        this.successRepos.push(repo);
        logger.success(`✅ 更新成功: ${repo.name}\n${pullResult.output}`);
      } else {
        throw new Error(pullResult.output);
      }
    } catch (error) {
      this.failedRepos.push({
        ...repo,
        error: error.message,
      });
      logger.error(`❌ 更新失败: ${repo.name}\n${error.message}`);
    }
  }

  /**
   * 生成执行报告
   */
  generateReport() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    return {
      timestamp: new Date(),
      duration: `${duration}秒`,
      totalRepos: this.gitRepos.length,
      successCount: this.successRepos.length,
      failureCount: this.failedRepos.length,
      skippedCount: this.skippedRepos.length,
      successRepos: this.successRepos,
      failedRepos: this.failedRepos,
      skippedRepos: this.skippedRepos,
    };
  }

  /**
   * 主运行方法
   */
  async run() {
    logger.info(`🔍 正在扫描Git仓库(最大深度: ${this.maxDepth})...`);

    try {
      // 扫描目录
      await this.scanDirectories(process.cwd(),1);

      if (this.gitRepos.length === 0) {
        logger.warn("没有找到Git仓库！");
        return;
      }

      // 显示找到的仓库信息
      logger.info("\n找到以下Git仓库:");
      this.gitRepos.forEach((repo) => {
        logger.info(`\n- ${repo.name}`);
        logger.info(`  路径: ${repo.path}`);
        logger.info(`  远程仓库: ${repo.remoteUrl}`);
        logger.info(`  当前分支: ${repo.currentBranch}`);
        logger.info(`  最后提交: ${repo.lastCommit}`);
      });

      // 开始更新操作
      logger.info("\n🔄 开始更新操作...");
      // 串行执行更新操作，避免并发问题
      for (const repo of this.gitRepos) {
        await this.pullRepo(repo);
      }

      // 生成和显示报告
      const report = this.generateReport();
      logger.info("\n📊 更新总结:");
      logger.info(`执行时间: ${report.duration}`);
      logger.info(`仓库总数: ${report.totalRepos}`);
      logger.success(`更新成功: ${report.successCount}`);
      logger.error(`更新失败: ${report.failureCount}`);
      logger.warn(`已跳过: ${report.skippedCount}`);

      // 显示详细结果
      if (report.successCount > 0) {
        logger.success("\n✅ 更新成功的仓库:");
        report.successRepos.forEach((repo) => logger.success(`- ${repo.name}`));
      }

      if (report.failureCount > 0) {
        logger.error("\n❌ 更新失败的仓库:");
        report.failedRepos.forEach((repo) =>
          logger.error(`- ${repo.name} (原因: ${repo.error})`)
        );
      }

      if (report.skippedCount > 0) {
        logger.warn("\n⏭️ 跳过的仓库:");
        report.skippedRepos.forEach((repo) =>
          logger.warn(`- ${repo.name} (原因: ${repo.reason})`)
        );
      }
    } catch (error) {
      logger.error("程序执行过程中发生错误:", error);
      process.exit(1);
    }
  }
}

// 主程序入口
try {
  // 获取命令行参数中的递归深度
  const depth = process.argv[2] ? parseInt(process.argv[2]) : 0;
  if (isNaN(depth) || depth < 0) {
    throw new Error("递归深度必须是大于0的数字");
  }

  const puller = new GitPuller(depth);
  puller.run().catch((error) => {
    logger.error("程序执行失败:", error);
    process.exit(1);
  });
} catch (error) {
  logger.error("参数错误:", error.message);
  process.exit(1);
}
