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


const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 控制递归深度，默认为1
const RECURSION_DEPTH = process.argv[2] ? parseInt(process.argv[2]) : 1;

// 存储所有 Git 仓库的信息
const gitRepos = [];

// 读取文件夹并判断是否为 Git 仓库
function readFolders(dir, currentDepth = 0) {
    if (currentDepth > RECURSION_DEPTH) return;

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        if (item.isDirectory()) {
            const fullPath = path.join(dir, item.name);
            const gitDir = path.join(fullPath, '.git');

            // 判断是否为 Git 仓库
            if (fs.existsSync(gitDir)) {
                gitRepos.push(fullPath);
            } else {
                readFolders(fullPath, currentDepth + 1);
            }
        }
    }
}

// 执行 git pull 操作
function gitPull(repoPath) {
    try {
        // 检查是否有未提交的文件
        const status = execSync('git status --porcelain', { cwd: repoPath }).toString();

        if (status) {
            // 如果有未提交的文件，先 stash
            execSync('git stash push -u', { cwd: repoPath });
        }

        // 执行 git pull
        const pullResult = execSync('git pull', { cwd: repoPath }).toString();

        // 如果之前 stash 了，现在 pop
        if (status) {
            execSync('git stash pop', { cwd: repoPath });
        }

        return { success: true, repoPath, result: pullResult };
    } catch (error) {
        return { success: false, repoPath, error: error.message };
    }
}

// 主函数
function main() {
    const currentDir = process.cwd();

    console.log(`Reading folders in: ${currentDir}`);
    readFolders(currentDir);

    console.log(`Found ${gitRepos.length} Git repositories:`);
    console.log(gitRepos.map(repo => path.relative(currentDir, repo)).join('\n'));

    const results = gitRepos.map(repoPath => gitPull(repoPath));

    const successfulRepos = results.filter(result => result.success);
    const failedRepos = results.filter(result => !result.success);

    console.log('\nPull results:');
    results.forEach(result => {
        if (result.success) {
            console.log(`✅ ${path.relative(currentDir, result.repoPath)}`);
            console.log(result.result);
        } else {
            console.log(`❌ ${path.relative(currentDir, result.repoPath)}`);
            console.log(`Error: ${result.error}`);
        }
    });

    console.log(`\nPull successful for ${successfulRepos.length} repositories:`);
    successfulRepos.forEach(repo => console.log(`- ${path.relative(currentDir, repo.repoPath)}`));

    console.log(`\nPull failed for ${failedRepos.length} repositories:`);
    failedRepos.forEach(repo => console.log(`- ${path.relative(currentDir, repo.repoPath)}`));
}

main();
