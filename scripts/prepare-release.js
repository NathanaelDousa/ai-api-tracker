import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "com.nathanaeldousa.ai-api-tracker";
const sourceDir = path.join(root, `${pluginId}.sdPlugin`);
const stageRoot = path.join(root, "dist", "release");
const stageDir = path.join(stageRoot, `${pluginId}.sdPlugin`);

const requiredPaths = [
  "manifest.json",
  ".sdignore",
  "bin/plugin.cjs",
  "ui/sdpi-components.js",
  "ui/tracker-settings.html",
  "imgs/plugin-icon.png",
  "imgs/plugin-icon@2x.png",
  "imgs/category-icon.png",
  "imgs/category-icon@2x.png",
  "imgs/actions/tracker-icon.svg",
  "imgs/actions/tracker-key.svg",
  "imgs/providers/openai.png",
  "imgs/providers/claude.png",
  "imgs/providers/gemini.png",
  "imgs/providers/deepseek.png",
  "imgs/providers/openrouter.png",
  "imgs/providers/grok.png",
];

const forbiddenPathPatterns = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)logs(\/|$)/,
  /(^|\/).*\.log$/,
  /(^|\/)deepseek-spend\.json$/,
  /(^|\/)trend-store\.json$/,
  /(^|\/).*\.map$/,
  /(^|\/)node_modules(\/|$)/,
];

const forbiddenContentPatterns = [
  {
    path: "ui/tracker-settings.html",
    patterns: [
      /https?:\/\/cdn\./i,
      /jsdelivr/i,
      /bootstrap-icons/i,
      /<link\b[^>]+href=["']https?:\/\//i,
      /<script\b[^>]+src=["']https?:\/\//i,
      /raw response/i,
    ],
  },
  {
    path: "bin/plugin.cjs",
    patterns: [
      /\[Grok\] raw response/,
    ],
  },
];

function rel(filePath) {
  return path.relative(stageDir, filePath).split(path.sep).join("/");
}

function sourceRel(filePath) {
  return path.relative(sourceDir, filePath).split(path.sep).join("/");
}

function isForbiddenReleasePath(relativePath) {
  return forbiddenPathPatterns.some((pattern) => pattern.test(relativePath));
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

function assertExists(relativePath) {
  if (!existsSync(path.join(stageDir, relativePath))) {
    throw new Error(`Missing release file: ${relativePath}`);
  }
}

if (!existsSync(path.join(sourceDir, "manifest.json"))) {
  throw new Error(`Plugin folder not found: ${sourceDir}`);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

for (const item of requiredPaths) {
  const src = path.join(sourceDir, item);
  const dst = path.join(stageDir, item);
  if (!existsSync(src)) throw new Error(`Required source missing: ${item}`);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (candidate) => !isForbiddenReleasePath(sourceRel(candidate)),
  });
}

for (const required of requiredPaths) {
  assertExists(required);
}

const files = listFiles(stageDir);
const forbiddenFiles = files
  .map(rel)
  .filter(isForbiddenReleasePath);

if (forbiddenFiles.length > 0) {
  throw new Error(`Forbidden release files:\n${forbiddenFiles.map((file) => `- ${file}`).join("\n")}`);
}

for (const check of forbiddenContentPatterns) {
  const filePath = path.join(stageDir, check.path);
  const content = readFileSync(filePath, "utf8");
  const found = check.patterns.find((pattern) => pattern.test(content));
  if (found) {
    throw new Error(`Forbidden release content in ${check.path}: ${found}`);
  }
}

console.log(`Release staging folder ready: ${stageDir}`);
console.log(`Pack with: streamdeck pack ${path.relative(root, stageDir)}`);
