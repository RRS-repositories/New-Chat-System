/** Settles like `p`, or rejects with Error(message) after `ms` if `p` has not settled by then. */
export function withTimeout<T>(p: Promise<T>, ms: number, message = 'Timed out'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
