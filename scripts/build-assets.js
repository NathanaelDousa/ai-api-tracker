/**
 * Cross-platform asset builder.
 *
 * macOS  → converts .icns → 144×144 PNG using sips (built-in, no dependencies).
 * Windows/Linux → resizes the fallback .png sources using sharp.
 *
 * Run via:  npm run assets
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root    = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "com.nathanaeldousa.ai-api-tracker";
const outDir  = join(root, `${pluginId}.sdPlugin/imgs/providers`);
mkdirSync(outDir, { recursive: true });

/** Provider icon definitions — ordered by display preference. */
const icons = [
  { icns: "chatgpt.icns",   fallback: "chatgpt-logo.png",  out: "openai.png"   },
  { icns: "claude.icns",    fallback: "claude-logo.png",   out: "claude.png"   },
  { icns: "Gemini.icns",    fallback: "gemini-google.png", out: "gemini.png"   },
  { icns: "deepseek.icns",  fallback: "deepseek-logo.png", out: "deepseek.png" },
];

const isMac = process.platform === "darwin";

if (isMac) {
  // macOS: use sips (ships with every Mac, no npm dependency needed)
  for (const { icns, fallback, out } of icons) {
    const icnsPath     = join(root, "src/assets", icns);
    const fallbackPath = join(root, "src/assets", fallback);
    const src = existsSync(icnsPath) ? icnsPath : fallbackPath;
    const dst = join(outDir, out);

    execSync(`sips -s format png -z 144 144 "${src}" --out "${dst}"`, { stdio: "inherit" });
  }
} else {
  // Windows / Linux: use sharp (installed as a devDependency)
  let sharp;
  try {
    const mod = await import("sharp");
    sharp = mod.default;
  } catch {
    console.error(
      "ERROR: 'sharp' is required on non-macOS to build assets.\n" +
      "Run: npm install --save-dev sharp"
    );
    process.exit(1);
  }

  for (const { fallback, out } of icons) {
    const src = join(root, "src/assets", fallback);
    const dst = join(outDir, out);

    if (!existsSync(src)) {
      console.warn(`⚠  No source for ${out} (expected src/assets/${fallback})`);
      continue;
    }

    await sharp(src).resize(144, 144, { fit: "cover" }).png().toFile(dst);
    console.log(`✓  ${fallback} → ${out}`);
  }
}

console.log("Assets built.");
