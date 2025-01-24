// git pull all
// 用 nodejs 20+ 写一个脚本，自动 git pull 所有的git仓库
// 1. 读取当前目录下的所有文件夹
//  1.1 递归读取所有文件夹，可以通过参数控制递归深度，默认为1
// 2. 判断该文件夹是否是git仓库
// 3. 输出所有是git仓库的文件夹名称及路径
// 4. 根据前一步的结果，在每个是git仓库的文件夹中行git pull
//   4.1 判断git status, 如果有未提交的文件，git stash 暂存所有文件，包括未跟踪的
//   4.2 git pull
//   4.3 git stash pop 恢复所有暂存的文件
// 5. 如果不是git仓库，跳过，输出提示
// 6. 输出pull的结果
// 7. 输出所有仓库的pull结果
// 8. 输出pull成功的仓库数量
// 9. 输出pull失败的仓库数量
// 10. 输出pull失败的仓库名称
// 11. 输出pull成功的仓库名称

const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");

const execPromise = util.promisify(exec);

class GitPuller {
  constructor(maxDepth = 1) {
    // 参数验证
    this.maxDepth = Math.max(1, Math.min(10, parseInt(maxDepth) || 1)); // 限制递归深度在1-10之间
    this.gitRepos = [];
    this.successRepos = [];
    this.failedRepos = [];
    this.skippedRepos = []; // 新增：记录跳过的仓库（如权限问题等）
  }

  // 安全的执行git命令
  async executeGitCommand(command, cwd, timeout = 30000) {
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        timeout, // 添加超时限制
        maxBuffer: 1024 * 1024 * 10, // 增加缓冲区大小到10MB
      });
      return { success: true, output: stdout || stderr };
    } catch (error) {
      return {
        success: false,
        output: error.message,
        error: error,
      };
    }
  }

  // 检查目录是否可访问
  async isDirectoryAccessible(dirPath) {
    try {
      await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // 检查是否为git仓库
  async isGitRepo(dirPath) {
    try {
      // 1. 首先检查目录是否存在且可访问
      if (!(await this.isDirectoryAccessible(dirPath))) {
        return false;
      }

      // 2. 使用 git rev-parse 命令检查
      const result = await this.executeGitCommand(
        "git rev-parse --is-inside-work-tree",
        dirPath
      );

      // 3. 如果命令执行成功且输出为 "true"，则确认是 git 仓库
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
            // 获取远程仓库URL
            const remoteUrlResult = await this.executeGitCommand('git config --get remote.origin.url', dirPath);
            const remoteUrl = remoteUrlResult.success ? remoteUrlResult.output.trim() : '未知';

            // 获取当前分支
            const branchResult = await this.executeGitCommand('git rev-parse --abbrev-ref HEAD', dirPath);
            const currentBranch = branchResult.success ? branchResult.output.trim() : '未知';

            // 获取最后一次提交信息
            const lastCommitResult = await this.executeGitCommand('git log -1 --format="%h - %s (%cr)"', dirPath);
            const lastCommit = lastCommitResult.success ? lastCommitResult.output.trim() : '未知';

            return {
                remoteUrl,
                currentBranch,
                lastCommit
            };
        } catch (error) {
            return {
                remoteUrl: '获取失败',
                currentBranch: '获取失败',
                lastCommit: '获取失败',
                error: error.message
            };
        }
    }

  // 递归扫描目录
  async scanDirectories(currentPath, currentDepth = 0) {
    if (currentDepth > this.maxDepth) return;

    try {
      // 检查目录是否可访问
      if (!(await this.isDirectoryAccessible(currentPath))) {
        console.warn(`警告: 目录 ${currentPath} 无法访问，已跳过`);
        return;
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          // 跳过隐藏目录
          const fullPath = path.join(currentPath, entry.name);
          try {
            if (await this.isGitRepo(fullPath)) {
              const repoInfo = await this.getRepoInfo(fullPath);
              this.gitRepos.push({
                name: entry.name,
                path: fullPath,
                timestamp: new Date(),
                ...repoInfo
              });
            } else if (currentDepth < this.maxDepth) {
              await this.scanDirectories(fullPath, currentDepth + 1);
            }
          } catch (error) {
            console.warn(`警告: 处理目录 ${fullPath} 时出错: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`错误: 扫描目录 ${currentPath} 失败: ${error.message}`);
    }
  }

  // 处理单个仓库
  async pullRepo(repo) {
    console.log(`\n📁 正在处理仓库 ${repo.name}...`);

    try {
      // 检查仓库状态
      if (!(await this.checkGitRepoStatus(repo))) {
        this.skippedRepos.push({ ...repo, reason: "仓库状态检查失败" });
        return;
      }

      // 检查工作区状态
      const statusResult = await this.executeGitCommand(
        "git status --porcelain",
        repo.path
      );
      const hasChanges = statusResult.output.length > 0;

      if (hasChanges) {
        console.log(`发现未提交的更改，正在暂存 ${repo.name} 的更改...`);
        const stashResult = await this.executeGitCommand(
          "git stash --include-untracked",
          repo.path
        );
        if (!stashResult.success) {
          throw new Error("暂存更改失败");
        }
      }

      // 执行pull
      const pullResult = await this.executeGitCommand("git pull", repo.path);

      // 恢复暂存的更改
      if (hasChanges) {
        console.log(`正在恢复 ${repo.name} 的暂存更改...`);
        const popResult = await this.executeGitCommand(
          "git stash pop",
          repo.path
        );
        if (!popResult.success) {
          console.warn(`警告: ${repo.name} 恢复暂存更改失败，请手动处理`);
        }
      }

      if (pullResult.success) {
        this.successRepos.push(repo);
        console.log(`✅ 更新成功: ${repo.name}\n${pullResult.output}`);
      } else {
        throw new Error(pullResult.output);
      }
    } catch (error) {
      this.failedRepos.push({
        ...repo,
        error: error.message,
      });
      console.log(`❌ 更新失败: ${repo.name}\n${error.message}`);
    }
  }

  // 生成报告
  generateReport() {
    return {
      timestamp: new Date(),
      totalRepos: this.gitRepos.length,
      successCount: this.successRepos.length,
      failureCount: this.failedRepos.length,
      skippedCount: this.skippedRepos.length,
      successRepos: this.successRepos,
      failedRepos: this.failedRepos,
      skippedRepos: this.skippedRepos,
    };
  }

  // 主运行方法
  async run() {
    console.log(`🔍 正在扫描Git仓库(最大深度: ${this.maxDepth})...`);

    try {
      await this.scanDirectories(process.cwd());

      if (this.gitRepos.length === 0) {
        console.log("没有找到Git仓库！");
        return;
      }

      console.log("\n找到以下Git仓库:");
      this.gitRepos.forEach((repo) =>{
        console.log(`\n- ${repo.name}`);
            console.log(`  路径: ${repo.path}`);
            console.log(`  远程仓库: ${repo.remoteUrl}`);
            console.log(`  当前分支: ${repo.currentBranch}`);
            console.log(`  最后提交: ${repo.lastCommit}`);
      });

      console.log("\n🔄 开始更新操作...");
      // 串行执行以避免并发问题
      for (const repo of this.gitRepos) {
        await this.pullRepo(repo);
      }

      // 输出总结报告
      const report = this.generateReport();
      console.log("\n📊 更新总结:");
      console.log(`仓库总数: ${report.totalRepos}`);
      console.log(`更新成功: ${report.successCount}`);
      console.log(`更新失败: ${report.failureCount}`);
      console.log(`已跳过: ${report.skippedCount}`);

      if (report.successCount > 0) {
        console.log("\n✅ 更新成功的仓库:");
        report.successRepos.forEach((repo) => console.log(`- ${repo.name}`));
      }

      if (report.failureCount > 0) {
        console.log("\n❌ 更新失败的仓库:");
        report.failedRepos.forEach((repo) =>
          console.log(`- ${repo.name} (原因: ${repo.error})`)
        );
      }

      if (report.skippedCount > 0) {
        console.log("\n⏭️ 跳过的仓库:");
        report.skippedRepos.forEach((repo) =>
          console.log(`- ${repo.name} (原因: ${repo.reason})`)
        );
      }
    } catch (error) {
      console.error("程序执行过程中发生错误:", error);
      process.exit(1);
    }
  }
}

// 参数验证和使用示例
try {
  const depth = process.argv[2] ? parseInt(process.argv[2]) : 1;
  if (isNaN(depth) || depth < 1) {
    throw new Error("递归深度必须是大于0的数字");
  }

  const puller = new GitPuller(depth);
  puller.run().catch((error) => {
    console.error("程序执行失败:", error);
    process.exit(1);
  });
} catch (error) {
  console.error("参数错误:", error.message);
  process.exit(1);
}
