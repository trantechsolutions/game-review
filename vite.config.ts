import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The app shell holds no game content; tools/build.mjs encrypts the data next to it.
// In `npm run dev`, the KDF settings are inlined so the gate works against a local public/ build.
const kdf = JSON.parse(readFileSync("tools/kdf.json", "utf8"));

export default defineConfig({
  root: "app",
  base: "./",
  plugins: [
    react(),
    {
      name: "kdf",
      transformIndexHtml: html => html.replace("<!-- KDF -->",
        `<script type="application/json" id="kdf">${JSON.stringify({ salt: kdf.salt, iterations: kdf.iterations })}</script>`),
    },
  ],
  build: { outDir: "../dist/app", emptyOutDir: true, assetsDir: "assets", sourcemap: false },
  test: { root: ".", include: ["app/src/**/*.test.ts", "tools/**/*.test.mjs"] },
});
