export const CLI_NAME = "lk-gpa";
export const CONFIG_SCOPE = "lk-gpa";
export const CONFIG_DIR = ".config/like-yuki-cli";
export const CONFIG_FILE = "config.json";
export const STATE_FILE = "gpa-state.json";
export const DEFAULT_MAX_DEPTH = 1;
export const MAX_DEPTH_LIMIT = 10;
export const MIN_DEPTH = 0;
export const DEFAULT_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_MS = 600000;
export const DEFAULT_SKIP_DIRS = ["node_modules", "dist", "build"];
export const COMMAND_TIMEOUT = 30000;
export const MAX_BUFFER_SIZE = 1024 * 1024 * 30;

export const MESSAGES = {
  scanStart: (depth) => `🔍 正在扫描Git仓库(最大深度: ${depth})...`,
  noRepos: "没有找到Git仓库！",
  foundRepos: "\n找到以下Git仓库:",
  startUpdate: "\n🔄 开始更新操作...",
  summaryTitle: "\n📊 更新总结:",
  successTitle: "\n✅ 更新成功的仓库:",
  failedTitle: "\n❌ 更新失败的仓库:",
  skippedTitle: "\n⏭️ 跳过的仓库:",
  invalidDepth: "递归深度必须是大于等于0的数字",
  configInit: "配置已初始化",
  configUpdated: "配置已更新",
  configPrompt: "请输入要跳过的目录(逗号分隔, 输入 default 使用默认, 输入 none 不跳过): ",
  commandsPrompt: "请输入要执行的命令(JSON 数组或逗号分隔, 输入 none 清空, 直接回车保留): ",
  resumeHint: "检测到未完成任务，可使用 --resume 继续",
  resumeInvalid: "配置或跳过目录已变更，无法恢复，请重新扫描",
};

export const usageLines = (cliName) => [
  `${cliName} 用法:`,
  `  ${cliName}               扫描并更新仓库`,
  `  ${cliName} <depth>        指定扫描深度`,
  `  ${cliName} -d | --detail  输出详细信息`,
  `  ${cliName} -c | --concurrency <n>  并发数(默认1)`,
  `  ${cliName} --skip <dirs>  逗号分隔的跳过目录`,
  `  ${cliName} --skip-only <dirs>  仅使用传入的跳过目录`,
  `  ${cliName} --skip-none     本次不跳过任何目录`,
  `  ${cliName} --timeout <ms> 执行超时时间(毫秒)`,
  `  ${cliName} --config       配置跳过目录`,
  `  ${cliName} --config --add <dirs>    追加跳过目录`,
  `  ${cliName} --config --remove <dirs> 移除跳过目录`,
  `  ${cliName} --config --default       使用默认跳过目录`,
  `  ${cliName} --config --none          不跳过任何目录`,
  `  ${cliName} --show-config  查看当前配置`,
  `  ${cliName} --resume       从上次中断处继续`,
  `  ${cliName} --resume --force 忽略状态文件重新开始`,
  `  ${cliName} -h | --help    显示帮助`,
];
