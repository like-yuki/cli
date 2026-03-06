const formatMessage = (msg) => msg.join(" ");

const colorize = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

const formatPrefix = ({ prefix, timestamp }) => {
  const parts = [];
  if (timestamp) {
    parts.push(new Date().toISOString());
  }
  if (prefix) {
    parts.push(prefix);
  }
  return parts.length > 0 ? `[${parts.join(" ")}] ` : "";
};

const buildLogger = (options) => {
  const enableColors =
    typeof options.enableColors === "boolean"
      ? options.enableColors
      : !process.env.NO_COLOR;
  const prefix = formatPrefix(options);
  const colors = enableColors ? options.colors : null;

  return {
    info: (...msg) => console.log(prefix + formatMessage(msg)),
    warn: (...msg) => {
      const text = prefix + formatMessage(msg);
      console.warn(colors?.warn ? colorize(colors.warn, text) : text);
    },
    error: (...msg) => {
      const text = prefix + formatMessage(msg);
      console.error(colors?.error ? colorize(colors.error, text) : text);
    },
    success: (...msg) => {
      const text = prefix + formatMessage(msg);
      console.log(colors?.success ? colorize(colors.success, text) : text);
    },
  };
};

export const createLogger = (options = {}) => {
  const logger = buildLogger(options);

  return {
    info: options.info || logger.info,
    warn: options.warn || logger.warn,
    error: options.error || logger.error,
    success: options.success || logger.success,
    configFile: options.configFile,
  };
};
