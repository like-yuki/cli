export const getCommandName = (command) => {
  if (Array.isArray(command)) {
    return command[0] || "";
  }
  return command.trim().split(/\s+/)[0] || "";
};

export const isMutatingCommand = (command) =>
  /^(checkout|merge|push|pull|add|commit)\b/.test(getCommandName(command));

export const isNetworkCommand = (command) =>
  /^(fetch|pull|push|ls-remote)\b/.test(getCommandName(command));

export const formatGitCommand = (command) => {
  const args = Array.isArray(command)
    ? command
    : command.trim().split(/\s+/);
  const formatted = args
    .map((arg) => {
      if (/\s|"/.test(arg)) {
        return `"${arg.replace(/"/g, "\\\"")}"`;
      }
      return arg;
    })
    .join(" ");
  return `git ${formatted}`;
};
