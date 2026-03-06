#!/usr/bin/env node

import { createLogger } from "./utils/logger.js";
import { createLoggerOptions } from "./utils/logger-config.js";
import { run } from "./gpa/runner.js";

const logger = createLogger(
  createLoggerOptions({
    prefix: "lk-gpa",
    timestamp: true,
  })
);

run(logger).catch((error) => {
  logger.error("程序执行失败:", error);
  process.exit(1);
});
