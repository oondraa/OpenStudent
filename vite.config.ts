import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// Shown in Settings and on the splash. Bump "version" in package.json with every deploy.
const BUILT = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "short", timeStyle: "short" }).format(new Date());

// Security headers of the static app (Workers Static Assets reads _headers). The CSP allows index.html's inline
// scripts by hash, computed from the built page, so editing them can't silently break it.
function securityHeaders(): Plugin {
  return {
    name: "security-headers",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = bundle["index.html"];
      if (html?.type !== "asset") return;
      const hashes = [...String(html.source).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      );
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        // Výlety: OpenStreetMap map tiles and live nextbike stations (GBFS).
        "img-src 'self' data: blob: https://tile.openstreetmap.org",
        "font-src 'self' data:",
        "connect-src 'self' https://gbfs.nextbike.net",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; ");
      const headers = {
        "Content-Security-Policy": csp,
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
        "Strict-Transport-Security": "max-age=31536000",
      };
      const source = `/*\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}\n`).join("")}`;
      this.emitFile({ type: "asset", fileName: "_headers", source });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILT__: JSON.stringify(BUILT),
  },
  plugins: [
    react(),
    cloudflare(),
    { name: "app-version", transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", pkg.version) },
    VitePWA({
      // "prompt" so main.tsx can show "Aktualizace" before the new version reloads the page.
      registerType: "prompt",
      includeAssets: ["icon.svg", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "OpenSISAKHK",
        short_name: "OpenSISAKHK",
        description: "Rozvrh a známky SSAKHK",
        lang: "cs",
        theme_color: "#0e0e10",
        background_color: "#0e0e10",
        display: "standalone",
        orientation: "portrait", // Android: the layout is made for a phone held upright
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ["push-sw.js"],
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
    }),
    securityHeaders(),
  ],
});
