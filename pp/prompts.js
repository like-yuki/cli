import readline from "readline/promises";
import { MESSAGES } from "./constants.js";

const createDisposableInterface = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    rl,
    [Symbol.dispose]() {
      rl.close();
    },
  };
};

export const promptText = async (question) => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const answer = await rl.question(question);
  return answer.trim();
};

export const promptYesNo = async (question) => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const answer = await rl.question(`${question} (Y/n): `);
  const normalized = answer.trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  return normalized === "y";
};

export const promptConfigInput = async (existingConfig, defaults) => {
  const remoteName = await promptText(
    MESSAGES.remotePrompt(existingConfig.remoteName || defaults.remoteName)
  );
  const targetBranchesInput = await promptText(
    MESSAGES.branchesPrompt(defaults.branchesDefault)
  );
  const mergeStrategy = await promptText(
    MESSAGES.mergeStrategyPrompt(defaults.strategyDefault)
  );

  return {
    remoteName,
    targetBranchesInput,
    mergeStrategy,
  };
};

export const promptCommitMessage = async () =>
  promptText(MESSAGES.commitPrompt);

export const promptNewBranchName = async () =>
  promptText(MESSAGES.defaultBranchPrompt);
