#!/usr/bin/env node

import { CONFIG_FILE } from "./pp/constants.js";
import { run } from "./pp/runner.js";

const logger = {
  info: (...msg) => console.log(msg.join(" ")),
  warn: (...msg) => console.warn("\x1b[33m%s\x1b[0m", msg.join(" ")),
  error: (...msg) => console.error("\x1b[31m%s\x1b[0m", msg.join(" ")),
  success: (...msg) => console.log("\x1b[32m%s\x1b[0m", msg.join(" ")),
  configFile: CONFIG_FILE,
};

run(logger).catch((error) => {
  logger.error(error.message || String(error));
  process.exit(1);
});
