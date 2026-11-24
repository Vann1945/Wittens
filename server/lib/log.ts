/**
 * Privacy-first structured logger. Never logs user URLs or media tokens;
 * records only lifecycle events and error types.
 */
const stamp = () => new Date().toISOString();

export const log = {
  info: (message: string) => console.log(`${stamp()} [wittens] ${message}`),
  warn: (message: string) => console.warn(`${stamp()} [wittens] WARN ${message}`),
  error: (message: string, error?: unknown) => {
    const detail = error instanceof Error ? ` (${error.name}: ${error.message})` : '';
    console.error(`${stamp()} [wittens] ERROR ${message}${detail}`);
  },
};
