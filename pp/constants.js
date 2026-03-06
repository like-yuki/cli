import os from "os";
import path from "path";

export const CLI_NAME = "lk-pp";
export const CONFIG_SCOPE = "lk-pp";
export const CONFIG_DIR = path.join(os.homedir(), ".config", "like-yuki-cli");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const STATE_FILE = path.join(CONFIG_DIR, "pp-state.json");

export const DEFAULT_MERGE_STRATEGY = "--no-ff";
export const VALID_MERGE_STRATEGIES = new Set([
  "--no-ff",
  "--ff-only",
  "--squash",
]);

export const MESSAGES = {
  remotePrompt: (defaultValue) => `远端名 (${defaultValue}): `,
  branchesPrompt: (defaultValue) => `目标分支(空格分隔) (${defaultValue}): `,
  mergeStrategyPrompt: (defaultValue) =>
    `合并策略 (--no-ff/--ff-only/--squash) (${defaultValue}): `,
  commitPrompt: "请输入 commit message: ",
  defaultBranchPrompt: "当前在默认分支，请输入新分支名: ",
  uncommittedConfirm: "检测到未提交改动，是否现在提交并推送?",
  planUncommitted: "PLAN: 检测到未提交改动，将执行 add/commit/push",
  planCreateBranch: (name) => `PLAN: 当前为默认分支，将创建新分支 ${name}`,
  planModeInfo: "PLAN 模式: 仅输出命令，不做远端校验",
  dryRunModeInfo: "DRY RUN 模式: 不会执行实际变更",
  resumeNotFound: "未找到可恢复的目标分支，从头开始执行",
  resumeTargetsChanged: "目标分支已变更，无法恢复，从头开始执行",
};

export const usageLines = (cliName) => [
  `${cliName} 用法:`,
  `  ${cliName}               执行合并并推送`,
  `  ${cliName} -n | --no-verify    commit 时追加 -n`,
  `  ${cliName} --dry-run     演练运行，不执行变更但会校验远端`,
  `  ${cliName} --plan        仅输出命令，不做远端校验`,
  `  ${cliName} --config      修改当前仓库配置`,
  `  ${cliName} --edit        修改当前仓库配置`,
  `  ${cliName} --global      修改默认配置`,
  `  ${cliName} --show-config 查看当前仓库配置`,
  `  ${cliName} --resume      从上次失败位置继续`,
];
