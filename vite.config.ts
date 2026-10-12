import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { defineConfig } from "vitest/config";

// The app shell holds no game content; tools/build.mjs encrypts the data next to it.
// In `npm run dev`, the encrypted files come from the last `npm run build` in public/.
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
    {
      name: "encrypted-data",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const name = basename((req.url ?? "").split("?")[0]);
          const file = join("public", name);
          if (!/^[0-9a-f]{20}\.bin$/.test(name)) return next();
          if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", "application/octet-stream");
          res.end(readFileSync(file));
        });
      },
    },
  ],
  build: { outDir: "../dist/app", emptyOutDir: true, assetsDir: "assets", sourcemap: false },
  test: { root: ".", include: ["app/src/**/*.test.ts", "tools/**/*.test.mjs"] },
});
