#!/usr/bin/env node

import { exec } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { promisify } from "util";

const execPromise = promisify(exec);

const isWindows = process.platform === 'win32';
const possibleGitPaths = [
  '%ProgramFiles%\\Git\\bin\\git.exe',
  '%ProgramFiles(x86)%\\Git\\bin\\git.exe',
  '%LocalAppData%\\Programs\\Git\\bin\\git.exe'
];

const DEFAULT_CONFIG = {
  maxDepth: 1,
  verbose: false,
  parallel: false,
  concurrentLimit: 5,
  retryCount: 3,
  retryDelay: 1000,
  exclude: ['.git', 'node_modules'],
  timeout: 30000,
  maxBuffer: 1024 * 1024 * 10, // 10MB 缓冲区限制
  memoryLimit: 512, // 内存使用限制(MB)
  gcInterval: 10, // 垃圾回收间隔(处理仓库数)
  connectTimeout: 10000,    // Git连接超时时间(ms)
  progressFile: '.gpa-progress', // 进度文件
  logFormat: 'text',        // 日志格式 (text/json)
  cleanupTimeout: 5000,     // 清理超时时间(ms)
  networkRetries: 3,        // 网络相关操作重试次数
  signalHandling: true,     // 是否处理信号
  commandTimeout: 5000,     // 单个命令超时时间(ms)
  maxConcurrentCommands: 3, // 最大并发命令数
  errorRetryMap: {          // 错误重试策略
    network: 5,             // 网络错误重试次数
    permission: 2,          // 权限错误重试次数
    timeout: 3              // 超时错误重试次数
  }
};

// 显示帮助信息
function showHelp() {
  console.log(`
使用方法: gpa [选项] [深度]

选项:
  -h, --help     显示帮助信息
  -d, --detail   显示详细信息
  -p, --parallel 并行处理
  -c, --config   指定配置文件
  -r, --retry    失败重试次数
  
示例:
  gpa           在当前目录搜索深度为1
  gpa 2         在当前目录搜索深度为2
  gpa -p        并行处理模式
  gpa -d        显示详细信息
  `);
  process.exit(0);
}

// 增强的日志工具对象
const logger = {
  info: (...msg) => console.log(msg.join(" ")),
  warn: (...msg) => console.warn("\x1b[33m%s\x1b[0m", msg.join(" ")), // 黄色警告
  error: (...msg) => console.error("\x1b[31m%s\x1b[0m", msg.join(" ")), // 红色错误
  success: (...msg) => console.log("\x1b[32m%s\x1b[0m", msg.join(" ")), // 绿色成功
  progress: (current, total) => {
    const percent = Math.floor((current / total) * 100);
    process.stdout.write(`\r进度: ${percent}% [${current}/${total}]`);
  }
};

// 添加内存监控工具
const memoryMonitor = {
  getMemoryUsage() {
    const used = process.memoryUsage();
    return {
      heapUsed: Math.round(used.heapUsed / 1024 / 1024),
      heapTotal: Math.round(used.heapTotal / 1024 / 1024),
      rss: Math.round(used.rss / 1024 / 1024),
    };
  },

  checkMemoryLimit(limit) {
    const { heapUsed } = this.getMemoryUsage();
    return heapUsed > limit;
  },

  logMemoryUsage(verbose = false) {
    const { heapUsed, heapTotal, rss } = this.getMemoryUsage();
    if (verbose) {
      logger.info(`内存使用情况: ${heapUsed}MB/${heapTotal}MB (RSS: ${rss}MB)`);
    }
  },
};

// 修改性能监控工具实现
const performanceMonitor = {
  startTimes: new Map(),
  metrics: new Map(),

  start(label) {
    this.startTimes.set(label, process.hrtime());
  },

  end(label) {
    const startTime = this.startTimes.get(label);
    if (!startTime) return 0;

    const diff = process.hrtime(startTime);
    const duration = (diff[0] * 1e9 + diff[1]) / 1e6; // 转换为毫秒
    this.metrics.set(label, duration);
    this.startTimes.delete(label); // 清理开始时间
    return duration;
  },

  getMetrics() {
    try {
      const startTime = this.startTimes.get('total') || [0, 0];
      const diff = process.hrtime(startTime);
      const totalTime = (diff[0] * 1e9 + diff[1]) / 1e6;

      return {
        totalTime,
        metrics: Object.fromEntries(this.metrics)
      };
    } catch (error) {
      return { totalTime: 0, metrics: {} };
    }
  }
};

async function findGitPath() {
  // 缓存找到的 Git 路径
  if (global.cachedGitPath) return global.cachedGitPath;

  // 在 Windows 下展开环境变量
  const expandEnvVars = (path) => {
    return path.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '');
  };

  // 检查路径是否可用
  const checkPath = async (gitPath) => {
    try {
      const { stdout } = await execPromise(`"${gitPath}" --version`);
      return stdout.includes('git version');
    } catch {
      return false;
    }
  };

  if (isWindows) {
    // 在 Windows 下检查所有可能的路径
    for (const path of possibleGitPaths) {
      const expandedPath = expandEnvVars(path);
      if (await checkPath(expandedPath)) {
        global.cachedGitPath = expandedPath;
        return expandedPath;
      }
    }

    // 从 PATH 环境变量中查找
    const pathDirs = process.env.PATH.split(';');
    for (const dir of pathDirs) {
      const gitPath = path.join(dir, 'git.exe');
      if (await checkPath(gitPath)) {
        global.cachedGitPath = gitPath;
        return gitPath;
      }
    }

    throw new Error('未找到 Git 可执行文件，请确保 Git 已正确安装并添加到 PATH 环境变量中');
  }

  // 非 Windows 系统直接返回 'git'
  global.cachedGitPath = 'git';
  return 'git';
}

// 添加错误分类工具
const ErrorClassifier = {
  classify(error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('connection')) return 'network';
    if (msg.includes('permission') || msg.includes('access')) return 'permission';
    if (msg.includes('timeout')) return 'timeout';
    return 'unknown';
  }
};

// 添加命令行解析器
class CommandParser {
  static parse(args) {
    const options = {
      depth: 1,
      verbose: false,
      parallel: false,
      configPath: null,
      force: false,
      dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i].toLowerCase();
      switch (arg) {
        case '-h':
        case '--help':
          showHelp();
          break;
        case '-d':
        case '--detail':
          options.verbose = true;
          break;
        case '-p':
        case '--parallel':
          options.parallel = true;
          break;
        case '-c':
        case '--config':
          const nextArg = args[++i];
          if (!nextArg) {
            throw new Error('配置文件路径未指定');
          }
          options.configPath = nextArg;
          break;
        case '-f':
        case '--force':
          options.force = true;
          break;
        case '--dry-run':
          options.dryRun = true;
          break;
        default:
          const depth = parseInt(arg);
          if (!isNaN(depth)) {
            if (depth < 0 || depth > 10) {
              throw new Error('搜索深度必须在0-10之间');
            }
            options.depth = depth;
          } else {
            logger.warn(`忽略未知参数: ${arg}`);
          }
      }
    }
    return options;
  }
}

// 添加信号处理器
class SignalHandler {
  constructor(cleanup) {
    this.cleanup = cleanup;
    this.handled = false;
  }

  handle(signal) {
    if (this.handled) return;
    this.handled = true;

    console.log(`\n收到 ${signal}，正在清理...`);
    this.cleanup()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }

  register() {
    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
      process.on(signal, () => this.handle(signal));
    });
  }
}

// 添加并发控制器
class ConcurrencyController {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.current--;
    }
  }
}

class GitPuller {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.maxDepth = Math.max(0, Math.min(10, this.config.maxDepth));
    this.verbose = this.config.verbose;
    this.parallel = this.config.parallel;
    this.concurrentLimit = this.config.concurrentLimit;
    this.retryCount = this.config.retryCount;
    this.gitRepos = []; // 存储发现的所有git仓库
    this.successRepos = []; // 成功更新的仓库
    this.failedRepos = []; // 更新失败的仓库
    this.skippedRepos = []; // 跳过的仓库
    this.startTime = Date.now(); // 记录开始时间
    this.processedCount = 0;
    this.weakRefs = new WeakMap(); // 使用弱引用存储临时数据
    this.gitPath = null; // 添加 Git 路径属性
    this.metrics = new Map();
    this.progressData = null;
    this.commandController = new ConcurrencyController(
      this.config.maxConcurrentCommands
    );
    this.signalHandler = new SignalHandler(() => this.cleanup());
    if (this.config.signalHandling) {
      this.signalHandler.register();
    }
  }

  // 重试机制包装器
  async withRetry(operation, retryCount = this.retryCount) {
    let lastError;
    for (let i = 0; i < retryCount; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errorType = ErrorClassifier.classify(error);
        const delay = this.getRetryDelay(errorType, i);
        if (i < retryCount - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          this.verbose && logger.warn(
            `重试第 ${i + 1} 次 (${errorType} 错误)...`
          );
        }
      }
    }
    throw lastError;
  }

  // 获取动态重试延迟
  getRetryDelay(errorType, attempt) {
    const baseDelay = this.config.retryDelay;
    const multiplier = errorType === 'network' ? 2 : 1;
    return baseDelay * multiplier * (attempt + 1);
  }

  // 优化的进度显示
  updateProgress(current, total, message = '') {
    const width = 30;
    const percent = Math.floor((current / total) * 100);
    const filled = Math.floor((width * current) / total);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    process.stdout.write(`\r${message}[${bar}] ${percent}% (${current}/${total})`);
  }

  /**
   * 执行git命令的通用方法
   * @param {string} command - git命令
   * @param {string} cwd - 执行命令的目录
   * @param {number} timeout - 超时时间(毫秒)
   */
  async executeGitCommand(command, cwd, timeout = this.config.timeout) {
    const cmdLabel = `git-${command.split(' ')[0]}`;
    await this.commandController.acquire();

    try {
      performanceMonitor.start(cmdLabel);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.config.connectTimeout);

      return this.withRetry(async () => {
        try {
          await this.initGitPath(); // 确保已初始化 Git 路径
          const gitCommand = isWindows
            ? `"${this.gitPath}" ${command.replace(/^git\s+/, '')}`
            : command;

          const { stdout, stderr } = await execPromise(gitCommand, {
            cwd,
            timeout,
            maxBuffer: this.config.maxBuffer,
            env: { ...process.env, PATH: process.env.PATH },
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          performanceMonitor.end(cmdLabel);

          return { success: true, output: (stdout || stderr).trim() };
        } catch (error) {
          clearTimeout(timeoutId);
          performanceMonitor.end(cmdLabel);
          if (error.name === 'AbortError') {
            throw new Error('Git命令执行超时');
          }
          return {
            success: false,
            output: error.message,
            error: new Error(error.message),
          };
        }
      }, this.getRetryCount(command));
    } finally {
      this.commandController.release();
    }
  }

  // 获取针对性的重试次数
  getRetryCount(command) {
    const commandType = command.split(' ')[0];
    if (commandType === 'pull') return this.config.errorRetryMap.network;
    if (commandType === 'stash') return this.config.errorRetryMap.permission;
    return this.config.retryCount;
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

      // 使用更严格的检查，确认目录是否包含 .git 目录
      const dotGitPath = path.join(dirPath, '.git');
      try {
        const stats = await fs.stat(dotGitPath);
        if (!stats.isDirectory()) {
          return false;
        }
      } catch {
        return false;
      }

      // 使用git命令进行双重检查
      const result = await this.executeGitCommand(
        "git rev-parse --git-dir",
        dirPath
      );

      if (this.verbose) {
        logger.info(`检查目录: ${dirPath}`);
        logger.info(`Git命令返回: ${JSON.stringify(result)}`);
      }

      // 确保命令成功执行且返回值是一个有效的.git目录路径
      return result.success && result.output.trim().endsWith('.git');
    } catch (error) {
      if (this.verbose) {
        logger.error(`检查Git仓库失败: ${dirPath}`, error);
      }
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

  // 修改 scanDirectories 方法，使用迭代器处理大目录
  async *createDirectoryIterator(currentPath, currentDepth = 1) {
    if (this.config.exclude.some(pattern =>
      currentPath.includes(pattern) ||
      new RegExp(pattern).test(currentPath)
    )) {
      return;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          yield { path: path.join(currentPath, entry.name), depth: currentDepth };
        }
      }
    } catch (error) {
      logger.warn(`无法读取目录 ${currentPath}: ${error.message}`);
    }
  }

  // 优化的扫描方法
  async scanDirectories(currentPath, currentDepth = 1) {
    const processDirectory = async (dirPath, depth) => {
      if (await this.isGitRepo(dirPath)) {
        const repoInfo = await this.getRepoInfo(dirPath);
        this.gitRepos.push({
          name: path.basename(dirPath),
          path: dirPath,
          timestamp: new Date(),
          ...repoInfo,
        });

        this.processedCount++;
        if (this.processedCount % this.config.gcInterval === 0) {
          global.gc && global.gc(); // 提示进行垃圾回收
          memoryMonitor.logMemoryUsage(this.verbose);
        }

        // 检查内存使用
        if (memoryMonitor.checkMemoryLimit(this.config.memoryLimit)) {
          logger.warn("内存使用接近限制，正在强制进行垃圾回收...");
          global.gc && global.gc(true); // 强制垃圾回收
        }
      }
    };

    if (this.maxDepth === 0) {
      await processDirectory(currentPath, currentDepth);
      return;
    }

    const stack = [{ path: currentPath, depth: currentDepth }];
    while (stack.length > 0) {
      const { path: dirPath, depth } = stack.pop();

      if (depth > this.maxDepth) continue;

      await processDirectory(dirPath, depth);

      for await (const subDir of this.createDirectoryIterator(dirPath, depth + 1)) {
        stack.push(subDir);
      }
    }
  }

  /**
   * 更新单个仓库
   * @param {Object} repo - 仓库信息对象
   */
  async pullRepo(repo) {
    return this.withRetry(async () => {
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
          this.verbose &&
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
          this.verbose && logger.info(`正在恢复 ${repo.name} 的暂存更改...`);
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
          logger.success(
            `✅ 更新成功: ${repo.name}\n${this.verbose ? pullResult.output : ""}`
          );
        } else {
          throw new Error(pullResult.output);
        }
      } catch (error) {
        this.failedRepos.push({
          ...repo,
          error: error.message,
        });
        logger.error(
          `❌ 更新失败: ${repo.name}\n${this.verbose ? error.message : ""}`
        );
      }
    });
  }

  // 优化更新方法
  async pullRepos() {
    if (this.parallel) {
      const chunks = [];
      const batchSize = Math.min(this.concurrentLimit,
        Math.floor(this.config.memoryLimit / 50)); // 基于内存限制动态调整并发数
      for (let i = 0; i < this.gitRepos.length; i += batchSize) {
        chunks.push(this.gitRepos.slice(i, i + batchSize));
      }

      for (const chunk of chunks) {
        await Promise.all(chunk.map(repo => this.pullRepo(repo)));
        this.updateProgress(
          Math.min(this.successRepos.length + this.failedRepos.length, this.gitRepos.length),
          this.gitRepos.length
        );
      }
    } else {
      for (let i = 0; i < this.gitRepos.length; i++) {
        await this.pullRepo(this.gitRepos[i]);
        this.updateProgress(i + 1, this.gitRepos.length);
      }
    }
    console.log('\n'); // 换行
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

  // 添加进度保存功能
  async saveProgress() {
    const progress = {
      timestamp: new Date().toISOString(),
      completed: this.successRepos.map(r => r.path),
      failed: this.failedRepos.map(r => r.path),
      skipped: this.skippedRepos.map(r => r.path),
      remaining: this.gitRepos
        .filter(r => !this.successRepos.includes(r) &&
          !this.failedRepos.includes(r) &&
          !this.skippedRepos.includes(r))
        .map(r => r.path)
    };

    try {
      await fs.writeFile(
        this.config.progressFile,
        JSON.stringify(progress, null, 2)
      );
    } catch (error) {
      logger.warn('无法保存进度信息:', error.message);
    }
  }

  // 添加进度恢复功能
  async loadProgress() {
    try {
      const data = await fs.readFile(this.config.progressFile, 'utf8');
      this.progressData = JSON.parse(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 主运行方法
   */
  async run() {
    try {
      performanceMonitor.start('total');

      // 尝试加载之前的进度
      if (await this.loadProgress()) {
        logger.info('发现上次执行的进度，是否继续？[Y/n]');
        // 这里可以添加用户交互逻辑
      }

      await this.initGitPath();
      logger.info(`🔍 正在扫描Git仓库(最大深度: ${this.maxDepth})...`);
      await this.scanDirectories(process.cwd());

      if (this.gitRepos.length === 0) {
        logger.warn("没有找到Git仓库！");
        return;
      }

      // 显示找到的仓库信息
      logger.info("\n找到以下Git仓库:");
      this.gitRepos.forEach((repo) => {
        logger.info(`\n- ${repo.name}`);
        if (this.verbose) {
          logger.info(`  路径: ${repo.path}`);
          logger.info(`  远程仓库: ${repo.remoteUrl}`);
          logger.info(`  当前分支: ${repo.currentBranch}`);
          logger.info(`  最后提交: ${repo.lastCommit}`);
        }
      });

      // 开始更新操作
      logger.info("\n🔄 开始更新操作...");
      // 使用新的pullRepos方法替代原来的循环
      await this.pullRepos();

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
          logger.error(`- ${repo.name}\n 原因: ${repo.error}\n\n`)
        );
      }

      if (report.skippedCount > 0) {
        logger.warn("\n⏭️ 跳过的仓库:");
        report.skippedRepos.forEach((repo) =>
          logger.warn(`- ${repo.name}\n 原因: ${repo.reason}\n\n`)
        );
      }

      // 保存执行进度
      await this.saveProgress();

      // 添加性能指标到报告
      const metrics = performanceMonitor.getMetrics();
      logger.info('\n📊 性能指标:');
      logger.info(`总执行时间: ${metrics.totalTime.toFixed(2)}ms`);
      Object.entries(metrics.metrics).forEach(([key, value]) => {
        if (typeof value === 'number') {
          logger.info(`${key}: ${value.toFixed(2)}ms`);
        }
      });

    } finally {
      performanceMonitor.end('total');
      // 清理工作
      this.cleanup();
    }
  }

  async initGitPath() {
    if (!this.gitPath) {
      this.gitPath = await findGitPath();
    }
    return this.gitPath;
  }

  // 添加清理方法
  async cleanup() {
    try {
      // 清理临时文件
      await Promise.race([
        fs.unlink(this.config.progressFile).catch(() => { }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('清理超时')),
            this.config.cleanupTimeout)
        )
      ]);
    } catch (error) {
      logger.warn('清理临时文件失败:', error.message);
    }
  }
}

// 配置验证函数
function validateConfig(config) {
  const validators = {
    maxDepth: (v) => Number.isInteger(v) && v >= 0 && v <= 10,
    verbose: (v) => typeof v === 'boolean',
    parallel: (v) => typeof v === 'boolean',
    concurrentLimit: (v) => Number.isInteger(v) && v > 0 && v <= 10,
    retryCount: (v) => Number.isInteger(v) && v >= 0 && v <= 5,
    retryDelay: (v) => Number.isInteger(v) && v >= 0,
    exclude: (v) => Array.isArray(v),
    timeout: (v) => Number.isInteger(v) && v > 0
  };

  const errors = [];
  for (const [key, validator] of Object.entries(validators)) {
    if (key in config && !validator(config[key])) {
      errors.push(`无效的配置项 ${key}: ${config[key]}`);
    }
  }
  return errors;
}

// 主程序入口优化
async function main() {
  let puller;
  try {
    const options = CommandParser.parse(process.argv.slice(2));

    // 读取并合并配置
    let config = { ...DEFAULT_CONFIG };
    if (options.configPath) {
      try {
        const configContent = await fs.readFile(options.configPath, 'utf8');
        const fileConfig = JSON.parse(configContent);
        const validationErrors = validateConfig(fileConfig);

        if (validationErrors.length > 0) {
          throw new Error(`配置文件验证失败:\n${validationErrors.join('\n')}`);
        }

        config = { ...config, ...fileConfig };
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`配置文件格式错误: ${error.message}`);
        }
        throw new Error(`无法读取配置文件: ${error.message}`);
      }
    }

    // 合并命令行选项
    config = {
      ...config,
      maxDepth: options.depth,
      verbose: options.verbose,
      parallel: options.parallel,
      configPath: options.configPath,
      force: options.force,
      dryRun: options.dryRun
    };

    // 验证最终配置
    const finalValidationErrors = validateConfig(config);
    if (finalValidationErrors.length > 0) {
      throw new Error(`配置验证失败:\n${finalValidationErrors.join('\n')}`);
    }

    // 启用垃圾回收提示（需要使用 --expose-gc 参数启动）
    if (global.gc) {
      logger.info("垃圾回收已启用");
    } else {
      logger.warn("建议使用 --expose-gc 参数启动以优化内存使用");
    }

    // 在创建 GitPuller 实例之前先验证 Git 是否可用
    try {
      await findGitPath();
    } catch (error) {
      throw new Error(`Git 环境检查失败: ${error.message}`);
    }

    puller = new GitPuller(config);
    if (options.dryRun) {
      logger.info("执行干运行模式，不会实际修改任何文件");
    }

    // 定期监控内存使用
    const memoryCheckInterval = setInterval(() => {
      memoryMonitor.logMemoryUsage(config.verbose);
    }, 30000); // 每30秒记录一次

    await puller.run();

    clearInterval(memoryCheckInterval);
  } catch (error) {
    logger.error(`错误:`, error.message);
    if (config?.verbose) {
      logger.error('详细错误信息:', error.stack);
    }
    process.exit(1);
  } finally {
    if (puller) {
      await puller.cleanup().catch(error =>
        logger.warn('清理过程中出错:', error.message)
      );
    }
  }
}

main();
