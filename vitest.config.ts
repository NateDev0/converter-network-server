import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@cn/engine/registry": fileURLToPath(new URL("./vendor/engine-registry.ts", import.meta.url)),
      "@cn/tokens": fileURLToPath(new URL("./vendor/tokens.ts", import.meta.url)),
    },
  },
});
