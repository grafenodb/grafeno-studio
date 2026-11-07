export function isBenchmarkRoute(hash: string): boolean {
  return /^#\/?bench(?:\?|$)/.test(hash);
}
