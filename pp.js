#!/usr/bin/env node

import { CONFIG_FILE } from "./pp/constants.js";
import { createLogger } from "./utils/logger.js";
import { createLoggerOptions } from "./utils/logger-config.js";
import { run } from "./pp/runner.js";

const logger = createLogger(
  createLoggerOptions({
    prefix: "lk-pp",
    timestamp: true,
    configFile: CONFIG_FILE,
  })
);

run(logger).catch((error) => {
  logger.error(error.message || String(error));
  process.exit(1);
});
