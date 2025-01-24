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

function listDirectories(baseDir, depth = 1, currentDepth = 0) {
  if (currentDepth > depth) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  let directories = [];

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      directories.push(fullPath);
      directories = directories.concat(listDirectories(fullPath, depth, currentDepth + 1));
    }
  }

  return directories;
}

function isGitRepository(directory) {
  const gitPath = path.join(directory, '.git');
  return fs.existsSync(gitPath) && fs.lstatSync(gitPath).isDirectory();
}

function executeShellCommand(command, cwd) {
  try {
    return execSync(command, { cwd, stdio: 'pipe' }).toString().trim();
  } catch (error) {
    return { error: error.message };
  }
}

function main(recursionDepth = 1) {
  const baseDir = process.cwd();
  const allDirectories = listDirectories(baseDir, recursionDepth);

  const gitRepos = allDirectories.filter(isGitRepository);
  const nonGitRepos = allDirectories.filter(dir => !isGitRepository(dir));

  console.log('Git Repositories:\n', gitRepos.join('\n'));
  console.log('Non-Git Directories:\n', nonGitRepos.join('\n'));

  let successfulPulls = [];
  let failedPulls = [];

  for (const repo of gitRepos) {
    console.log(`Processing: ${repo}`);
    let stashRequired = false;

    const statusOutput = executeShellCommand('git status --porcelain', repo);
    if (statusOutput && !statusOutput.error) {
      stashRequired = statusOutput.length > 0;
    }

    if (stashRequired) {
      executeShellCommand('git stash push -u', repo);
    }

    const pullOutput = executeShellCommand('git pull', repo);

    if (stashRequired) {
      executeShellCommand('git stash pop', repo);
    }

    if (pullOutput.error) {
      console.log(`Failed to pull in ${repo}: ${pullOutput.error}`);
      failedPulls.push(repo);
    } else {
      console.log(`Success: ${pullOutput}`);
      successfulPulls.push(repo);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Successful Pulls (${successfulPulls.length}):`);
  console.log(successfulPulls.join('\n'));

  console.log(`\nFailed Pulls (${failedPulls.length}):`);
  console.log(failedPulls.join('\n'));
}

const recursionDepth = parseInt(process.argv[2]) || 1;
main(recursionDepth);
