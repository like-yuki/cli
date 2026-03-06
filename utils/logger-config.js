export const DEFAULT_LOGGER_COLORS = {
  warn: 33,
  error: 31,
  success: 32,
};

export const createLoggerOptions = ({
  prefix,
  timestamp = false,
  enableColors,
  configFile,
} = {}) => ({
  colors: DEFAULT_LOGGER_COLORS,
  prefix,
  timestamp,
  enableColors,
  configFile,
});
