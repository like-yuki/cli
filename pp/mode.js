export const MODE = {
  NORMAL: "normal",
  DRY_RUN: "dry-run",
  PLAN: "plan",
};

export const resolveMode = (options) => {
  if (options.planOnly) {
    return MODE.PLAN;
  }
  if (options.dryRun) {
    return MODE.DRY_RUN;
  }
  return MODE.NORMAL;
};

export const shouldRecordCommands = (mode) => mode !== MODE.NORMAL;
export const shouldValidateRemote = (mode) => mode !== MODE.PLAN;
export const shouldSkipMutations = (mode) => mode === MODE.DRY_RUN;
export const shouldSkipNetwork = (mode) => mode === MODE.PLAN;
export const shouldWriteState = (mode) => mode === MODE.NORMAL;
