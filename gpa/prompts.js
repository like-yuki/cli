import readline from "readline/promises";

const createDisposableInterface = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    rl,
    [Symbol.dispose]() {
      rl.close();
    },
  };
};

export const promptText = async (question) => {
  using rlResource = createDisposableInterface();
  const rl = rlResource.rl;
  const answer = await rl.question(question);
  return answer.trim();
};
