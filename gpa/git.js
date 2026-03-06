import { spawn } from "child_process";
import { COMMAND_TIMEOUT, MAX_BUFFER_SIZE } from "./constants.js";

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

export const executeGitCommand = async (
  args,
  cwd,
  timeout = COMMAND_TIMEOUT
) => {
  using processResource = createGitProcess(args, cwd);
  const { child } = processResource;

  let stdout = "";
  let stderr = "";
  let truncated = false;

  const appendOutput = (target, chunk) => {
    if (target.length >= MAX_BUFFER_SIZE) {
      truncated = true;
      return target;
    }
    const next = target + chunk.toString();
    if (next.length > MAX_BUFFER_SIZE) {
      truncated = true;
      return next.slice(0, MAX_BUFFER_SIZE);
    }
    return next;
  };

  child.stdout?.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });

  child.stderr?.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        success: false,
        output: `命令执行超时(${timeout}ms)`,
      });
    }, timeout);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: (error?.message || "").trim(),
        error,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = (stdout || stderr || "").trim();
      resolve({
        success: code === 0,
        output: truncated ? `${output}\n[输出已截断]` : output,
      });
    });
  });
};
