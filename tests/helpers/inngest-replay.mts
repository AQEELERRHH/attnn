/**
 * Runs an Inngest handler the way Inngest does: each invocation replays the function
 * from the top, finished steps return their memoized (JSON round-tripped) result, code
 * outside steps runs again, and the first NEW step ends the invocation after running.
 * A sleep ends it too. Use it to prove a resumed run can't skip work.
 */
type Step = {
  run: (id: string, fn: () => unknown) => Promise<unknown>;
  sleep: (id: string, d: string) => Promise<void>;
  sendEvent: (id: string, e: unknown) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any job handler
type Handler = (ctx: { event: any; step: any }) => Promise<unknown>;

const INTERRUPT = Symbol("invocation ends here");

export async function runLikeInngest(
  handler: Handler,
  event: unknown,
  opts: { between?: (lastStepId: string) => Promise<void> | void; maxInvocations?: number } = {},
) {
  const memo = new Map<string, unknown>();
  const executed: string[] = [];
  let invocations = 0;
  for (;;) {
    if (++invocations > (opts.maxInvocations ?? 500)) throw new Error("runLikeInngest: too many invocations (a loop?)");
    const step: Step = {
      run: async (id, fn) => {
        if (memo.has(id)) return memo.get(id);
        const value = await fn();
        memo.set(id, value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
        executed.push(id);
        throw INTERRUPT;
      },
      sleep: async (id) => {
        if (memo.has(id)) return;
        memo.set(id, null);
        executed.push(id);
        throw INTERRUPT;
      },
      sendEvent: async (id) => {
        if (memo.has(id)) return;
        memo.set(id, null);
        executed.push(id);
        throw INTERRUPT;
      },
    };
    try {
      const output = await handler({ event, step });
      return { output, executed, invocations };
    } catch (err) {
      if (err !== INTERRUPT) throw err;
      await opts.between?.(executed[executed.length - 1]!);
    }
  }
}
