import { promises as fs } from "fs";
import path from "path";
import { STATE_FILE } from "./constants.js";

const ensureStateDir = async () => {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
};

export const loadState = async () => {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveState = async (state) => {
  await ensureStateDir();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
};

export const clearState = async () => {
  try {
    await fs.unlink(STATE_FILE);
  } catch {}
};
