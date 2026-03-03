import { spawn } from "child_process";
import {
  shouldRecordCommands,
  shouldSkipMutations,
  shouldSkipNetwork,
  MODE,
} from "./mode.js";
import {
  formatGitCommand,
  isMutatingCommand,
  isNetworkCommand,
} from "./git-utils.js";

const createGitProcess = (args, cwd) => {
  const child = spawn("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    child,
    [Symbol.dispose]() {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
};

export const createGitRunner = ({ mode, plannedCommands, logger }) => {
  const runGit = async (command, options = {}) => {
    const { cwd = process.cwd() } = options;

    if (shouldRecordCommands(mode) && plannedCommands) {
      plannedCommands.push(formatGitCommand(command));
    }

    if (shouldSkipMutations(mode) && isMutatingCommand(command)) {
      logger.info(`DRY RUN: ${formatGitCommand(command)}`);
      return { success: true, output: "" };
    }

    if (shouldSkipNetwork(mode) && (isMutatingCommand(command) || isNetworkCommand(command))) {
      logger.info(`PLAN: ${formatGitCommand(command)}`);
      return { success: true, output: "" };
    }

    const args = Array.isArray(command)
      ? command
      : command.trim().split(/\s+/);
    using processResource = createGitProcess(args, cwd);
    const { child } = processResource;

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    return await new Promise((resolve) => {
      child.on("error", (error) => {
        resolve({
          success: false,
          output: (error?.message || "").trim(),
          error,
        });
      });

      child.on("close", (code) => {
        const output = (stdout || stderr || "").trim();
        resolve({
          success: code === 0,
          output,
        });
      });
    });
  };

  return {
    mode,
    plannedCommands,
    runGit,
  };
};

export const isPlanMode = (mode) => mode === MODE.PLAN;
