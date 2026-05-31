/**
 * Cross-platform asset builder.
 *
 * macOS  → .icns via sips, .svg via qlmanage (both built-in, no dependencies).
 * Windows/Linux → .png/.svg via sharp (optionalDependency).
 *
 * Run via:  npm run assets
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join, basename, dirname } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const root      = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId  = "com.nathanaeldousa.ai-api-tracker";
const outDir    = join(root, `${pluginId}.sdPlugin/imgs/providers`);
mkdirSync(outDir, { recursive: true });

/**
 * Provider icon definitions.
 * Priority: icns > svg > fallback (png).
 */
const icons = [
  { icns: "chatgpt.icns",    svg: null,              fallback: "chatgpt-logo.png",  out: "openai.png"    },
  { icns: "claude.icns",     svg: null,              fallback: "claude-logo.png",   out: "claude.png"    },
  { icns: "Gemini.icns",     svg: null,              fallback: "gemini-google.png", out: "gemini.png"    },
  { icns: "deepseek.icns",   svg: null,              fallback: "deepseek-logo.png", out: "deepseek.png"  },
  { icns: "openrouter.icns", svg: "openrouter.svg",  fallback: "fallback.png",      out: "openrouter.png"},
  { icns: "grok.icns",       svg: "grok-color.svg",  fallback: "fallback.png",      out: "grok.png"      },
];

const isMac = process.platform === "darwin";

if (isMac) {
  for (const { icns, svg, fallback, out } of icons) {
    const dst      = join(outDir, out);
    const icnsPath = join(root, "src/assets", icns);
    const svgPath  = svg ? join(root, "src/assets", svg) : null;
    const pngPath  = join(root, "src/assets", fallback);

    if (existsSync(icnsPath)) {
      // .icns → PNG via sips
      execSync(`sips -s format png -z 144 144 "${icnsPath}" --out "${dst}"`, { stdio: "inherit" });
    } else if (svgPath && existsSync(svgPath)) {
      // .svg → PNG via qlmanage (QuickLook, ships with every Mac)
      const tmp = mkdtempSync(join(tmpdir(), "sdicon-"));
      try {
        execSync(`qlmanage -t -s 144 -o "${tmp}" "${svgPath}"`, { stdio: "pipe" });
        const rendered = join(tmp, `${basename(svg)}.png`);
        renameSync(rendered, dst);
        console.log(`${svgPath}`);
        console.log(`  ${dst}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      // .png fallback via sips
      execSync(`sips -s format png -z 144 144 "${pngPath}" --out "${dst}"`, { stdio: "inherit" });
    }
  }
} else {
  // Windows / Linux: use sharp (supports icns, png, svg)
  let sharp;
  try {
    const mod = await import("sharp");
    sharp = mod.default;
  } catch {
    console.error(
      "ERROR: 'sharp' is required on non-macOS to build assets.\n" +
      "Run: npm install sharp"
    );
    process.exit(1);
  }

  for (const { icns, svg, fallback, out } of icons) {
    const dst      = join(outDir, out);
    const icnsPath = join(root, "src/assets", icns);
    const svgPath  = svg ? join(root, "src/assets", svg) : null;
    const pngPath  = join(root, "src/assets", fallback);

    const src = existsSync(icnsPath) ? icnsPath
              : svgPath && existsSync(svgPath) ? svgPath
              : pngPath;

    if (!existsSync(src)) {
      console.warn(`⚠  No source for ${out}`);
      continue;
    }

    await sharp(src).resize(144, 144, { fit: "cover" }).png().toFile(dst);
    console.log(`✓  ${basename(src)} → ${out}`);
  }
}

console.log("Assets built.");
