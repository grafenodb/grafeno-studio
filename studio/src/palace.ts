// What the Palaces view reads from what a person types.

/** `hit, depends_on*, <maintains` → route steps: `*` repeats, `<` goes backwards. */
export function parseSteps(text: string): { label: string; backward: boolean; repeat: boolean }[] {
  return text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const backward = part.startsWith("<");
      const repeat = part.endsWith("*");
      const label = part.replace(/^</, "").replace(/\*$/, "").trim();
      return { label, backward, repeat };
    });
}
