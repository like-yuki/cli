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


const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class GitPuller {
    constructor(maxDepth = 1) {
        this.maxDepth = maxDepth;
        this.successRepos = [];
        this.failedRepos = [];
    }

    async isGitRepo(dirPath) {
        try {
            const gitDir = path.join(dirPath, '.git');
            await fs.access(gitDir);
            return true;
        } catch {
            return false;
        }
    }

    async getAllDirs(currentPath, currentDepth = 0) {
        if (currentDepth > this.maxDepth) return [];

        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        let dirs = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const fullPath = path.join(currentPath, entry.name);
                dirs.push(fullPath);
                if (currentDepth < this.maxDepth) {
                    const subdirs = await this.getAllDirs(fullPath, currentDepth + 1);
                    dirs = dirs.concat(subdirs);
                }
            }
        }

        return dirs;
    }

    async gitPull(repoPath) {
        try {
            console.log(`\n处理仓库: ${repoPath}`);

            // 检查是否有未提交的更改
            const status = execSync('git status --porcelain', { cwd: repoPath }).toString();

            if (status) {
                console.log('发现未提交的更改，执行 stash...');
                execSync('git stash -u', { cwd: repoPath });
            }

            // 执行 git pull
            const pullResult = execSync('git pull', { cwd: repoPath }).toString();
            console.log('Pull 结果:', pullResult);

            // 如果之前有 stash，现在恢复
            if (status) {
                console.log('恢复 stash...');
                execSync('git stash pop', { cwd: repoPath });
            }

            this.successRepos.push({
                path: repoPath,
                name: path.basename(repoPath)
            });
            return true;
        } catch (error) {
            console.error(`Pull 失败: ${error.message}`);
            this.failedRepos.push({
                path: repoPath,
                name: path.basename(repoPath)
            });
            return false;
        }
    }

    async run() {
        try {
            const currentDir = process.cwd();
            const allDirs = await this.getAllDirs(currentDir);
            const gitRepos = [];

            // 找出所有 git 仓库
            for (const dir of allDirs) {
                if (await this.isGitRepo(dir)) {
                    gitRepos.push(dir);
                    console.log(`发现 git 仓库: ${dir}`);
                }
            }

            console.log(`\n共发现 ${gitRepos.length} 个 git 仓库`);

            // 执行 git pull
            for (const repo of gitRepos) {
                await this.gitPull(repo);
            }

            // 输出结果统计
            console.log('\n=== 执行结果统计 ===');
            console.log(`成功数量: ${this.successRepos.length}`);
            console.log(`失败数量: ${this.failedRepos.length}`);

            if (this.successRepos.length > 0) {
                console.log('\n成功的仓库:');
                this.successRepos.forEach(repo => console.log(`- ${repo.name} (${repo.path})`));
            }

            if (this.failedRepos.length > 0) {
                console.log('\n失败的仓库:');
                this.failedRepos.forEach(repo => console.log(`- ${repo.name} (${repo.path})`));
            }

        } catch (error) {
            console.error('执行过程中发生错误:', error);
        }
    }
}

// 使用方法
const depth = process.argv[2] ? parseInt(process.argv[2]) : 1;
const puller = new GitPuller(depth);
puller.run();
