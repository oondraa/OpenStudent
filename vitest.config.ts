import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't spin up the Cloudflare/PWA plugins.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
