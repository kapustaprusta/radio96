import react from "@vitejs/plugin-react";
import { createLogger } from "vite";
import { defineConfig } from "vitest/config";

const logger = createLogger();

export default defineConfig({
  plugins: [react()],
  customLogger: {
    ...logger,
    error(message, options) {
      if (message.includes("http proxy error")) {
        logger.error("API proxy request failed", { ...options, error: undefined });
      } else {
        logger.error(message, options);
      }
    },
  },
  server: {
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    clearMocks: true,
    restoreMocks: true,
  },
});
