/** Publish only the latest evaluation, including failures that arrive out of order. */
export function createLatestEvaluation<Input, Output>(
  evaluate: (input: Input) => Promise<Output>,
  publish: (output: Output) => void,
  reject: () => void,
) {
  let revision = 0;
  return async (input: Input): Promise<void> => {
    const current = ++revision;
    try {
      const output = await evaluate(input);
      if (current !== revision) return;
      publish(output);
    } catch {
      if (current !== revision) return;
      reject();
    }
  };
}
