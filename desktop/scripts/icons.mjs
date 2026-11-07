// Renders the desktop app's icons (Tauri: PNG sizes, .ico and .icns) from
// Grafeno's mark, studio/public/grafeno-mark.svg (the one of the Grafeno
// site, grafeno-site/public/grafeno-mark.svg).
//
//   npm run icons
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = join(import.meta.dirname, "..");
const icons = join(here, "icons");
const mark = join(here, "..", "studio", "public", "grafeno-mark.svg");

execFileSync("npx", ["tauri", "icon", mark, "--output", icons], {
  cwd: here,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// Only desktop icons: no mobile or Windows Store tiles.
const keep = new Set(["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns"]);
for (const name of readdirSync(icons)) {
  if (!keep.has(name)) rmSync(join(icons, name), { recursive: true, force: true });
}
console.log("icons written");
