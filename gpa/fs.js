import { promises as fs } from "fs";

export const isDirectoryAccessible = async (dirPath) => {
  try {
    await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

export const readDirectory = async (dirPath) =>
  fs.readdir(dirPath, { withFileTypes: true });
