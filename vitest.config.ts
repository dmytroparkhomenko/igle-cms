import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@igle/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
      "@igle/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@igle/html-engine": new URL("./packages/html-engine/src/index.ts", import.meta.url).pathname,
      "@igle/build": new URL("./packages/build/src/index.ts", import.meta.url).pathname,
      "@igle/deployer": new URL("./packages/deployer/src/index.ts", import.meta.url).pathname
    }
  }
});
