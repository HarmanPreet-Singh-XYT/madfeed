// Stable ids for the sample data, so links in the screen index and in screenshots never change.
export const uid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const freshId = (): string => crypto.randomUUID();
