import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

/**
 * Rollup configuration for the Stream Deck plugin.
 * - Bundles TypeScript source into a single output file.
 * - Outputs CommonJS (.cjs extension) so Node treats it as CJS
 *   regardless of package.json "type": "module".
 * - The output goes into the .sdPlugin/bin/ directory.
 */
export default {
  input: "src/plugin.ts",
  output: {
    file: "com.nathanaeldousa.ai-api-tracker.sdPlugin/bin/plugin.cjs",
    format: "cjs",
  },
  plugins: [
    nodeResolve({ browser: false, preferBuiltins: true }),
    commonjs({ requireReturnsDefault: "auto" }),
    typescript(),
  ],
};
