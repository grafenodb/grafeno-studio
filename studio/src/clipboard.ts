export function copyValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
