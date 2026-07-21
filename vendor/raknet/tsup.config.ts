import { defineConfig } from "tsup";

// Vendored SerenityJS package build, matching the upstream output shape
export default defineConfig({
  bundle: true,
  cjsInterop: true,
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: [/^@serenityjs/, "reflect-metadata"],
  format: ["cjs", "esm"],
  keepNames: true,
  minify: false,
  skipNodeModulesBundle: true,
  sourcemap: "inline",
  splitting: false,
  treeshake: false,
  tsconfig: "./tsconfig.json"
});
