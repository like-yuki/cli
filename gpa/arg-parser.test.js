import assert from "assert";
import { test } from "node:test";
import { parseArgs, normalizeList } from "./arg-parser.js";
import { DEFAULT_SKIP_DIRS } from "./constants.js";

const createLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
});

test("normalizeList sorts and dedupes", () => {
  assert.deepStrictEqual(normalizeList(["b", "a", "b"]), ["a", "b"]);
});

test("parseArgs merges repeated --skip and preserves depth", () => {
  const logger = createLogger();
  const config = { skipDirs: [] };
  const result = parseArgs(
    ["--skip", "a", "--skip", "b", "2"],
    logger,
    config
  );

  assert.strictEqual(result.depth, 2);
  assert.ok(result.skipDirs.includes("a"));
  assert.ok(result.skipDirs.includes("b"));
});

test("parseArgs supports --skip-only", () => {
  const logger = createLogger();
  const config = { skipDirs: ["node_modules"] };
  const result = parseArgs(["--skip-only", "dist"], logger, config);

  assert.deepStrictEqual(result.skipOverrides, ["dist"]);
  assert.strictEqual(result.skipOverrideMode, "only");
});

test("parseArgs uses default skip dirs when config empty", () => {
  const logger = createLogger();
  const config = { skipDirs: [] };
  const result = parseArgs(["1"], logger, config);

  for (const dir of DEFAULT_SKIP_DIRS) {
    assert.ok(result.skipDirs.includes(dir));
  }
});

test("parseArgs does not treat concurrency value as depth", () => {
  const logger = createLogger();
  const config = { skipDirs: [] };
  const result = parseArgs(["--concurrency", "2"], logger, config);

  assert.strictEqual(result.depth, 1);
  assert.strictEqual(result.concurrency, 2);
});
