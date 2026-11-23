/**
 * Tiny logger. By design it never receives user links or media URLs:
 * wittens only logs lifecycle events and error kinds.
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
