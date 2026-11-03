import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// foliate-js lives in public/ and is imported at runtime. In dev, Vite refuses JS module requests
// for public files, so serve that folder raw ahead of Vite's own middleware (the build just
// copies it, as for any public file).
function serveFoliate(): Plugin {
  const root = join(import.meta.dirname, "public/foliate-js");
  const types: Record<string, string> = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
  };
  return {
    name: "serve-foliate",
    configureServer(server) {
      server.middlewares.use("/foliate-js", async (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
        if (path.includes("..")) return next();
        try {
          const body = await readFile(join(root, path));
          res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

// BASE_PATH is set by the GitHub Pages build ("/ebook-reader/"); local dev serves from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [serveFoliate(), react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
