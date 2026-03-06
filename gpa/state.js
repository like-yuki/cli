import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { CONFIG_DIR, STATE_FILE } from "./constants.js";

const stateDir = path.join(os.homedir(), CONFIG_DIR);
const statePath = path.join(stateDir, STATE_FILE);

const ensureStateDir = async () => {
  await fs.mkdir(stateDir, { recursive: true });
};

export const loadState = async () => {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveState = async (state) => {
  await ensureStateDir();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
};

export const clearState = async () => {
  try {
    await fs.unlink(statePath);
  } catch {}
};
