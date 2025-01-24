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

// 检查是否为git仓库
function isGitRepo(dir) {
    try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

// 执行git命令
function execGitCommand(command, dir) {
    try {
        return execSync(command, { cwd: dir, encoding: 'utf8' });
    } catch (e) {
        throw new Error(`执行命令失败: ${command}\n${e.message}`);
    }
}

// 处理单个git仓库
async function handleGitRepo(dir) {
    try {
        // 检查git状态
        const status = execGitCommand('git status --porcelain', dir);

        // 如果有未提交的更改，执行stash
        if (status) {
            execGitCommand('git stash --include-untracked', dir);
        }

        // 执行git pull
        const pullResult = execGitCommand('git pull', dir);

        // 如果之前有stash，恢复stash
        if (status) {
            execGitCommand('git stash pop', dir);
        }

        return {
            success: true,
            message: pullResult,
            repo: path.basename(dir)
        };
    } catch (error) {
        return {
            success: false,
            message: error.message,
            repo: path.basename(dir)
        };
    }
}

// 主函数
async function gitPullAll(baseDir = '.', depth = 1) {
    const results = {
        successful: [],
        failed: [],
    };

    async function scanDirectory(currentDir, currentDepth) {
        if (currentDepth > depth) return;

        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const fullPath = path.join(currentDir, entry.name);

            if(['node_modules', '.git', 'dist'].includes(entry.name)) continue;

            if (isGitRepo(fullPath)) {
                console.log(`处理仓库: ${entry.name}`);
                const result = await handleGitRepo(fullPath);

                if (result.success) {
                    results.successful.push(result);
                } else {
                    results.failed.push(result);
                }
            } else {
                console.log(`跳过非git仓库: ${entry.name}`);
                // 继续递归搜索子目录
                await scanDirectory(fullPath, currentDepth + 1);
            }
        }
    }

    await scanDirectory(baseDir, 1);

    // 输出结果统计
    console.log('\n=== 执行结果统计 ===');
    console.log(`成功数量: ${results.successful.length}`);
    console.log(`失败数量: ${results.failed.length}`);

    if (results.successful.length > 0) {
        console.log('\n成功的仓库:');
        results.successful.forEach(result => {
            console.log(`✅ ${result.repo}`);
            console.log(result.message);
        });
    }

    if (results.failed.length > 0) {
        console.log('\n失败的仓库:');
        results.failed.forEach(result => {
            console.log(`❌ ${result.repo}`);
            console.log(result.message);
        });
    }

    return results;
}

// 命令行参数处理
const args = process.argv.slice(2);
const dir = args[0] || '.';
const depth = parseInt(args[1]) || 1;

// 执行脚本
gitPullAll(dir, depth).catch(error => {
    console.error('执行出错:', error);
    process.exit(1);
});
