import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative so the build works wherever it is mounted -- here it is served
  // from <pages-site>/q2/, alongside the Quake 1 client at the root.
  base: "./",
  plugins: [
    {
      name: "quake2js-root-only",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split("?")[0] ?? "/";
          const retiredPathFragment = ["full", "game"].join("-");
          if (
            pathname.includes(retiredPathFragment)
            || (pathname.endsWith(".html") && pathname !== "/index.html")
          ) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split("?")[0] ?? "/";
          const retiredPathFragment = ["full", "game"].join("-");
          if (
            pathname.includes(retiredPathFragment)
            || (pathname.endsWith(".html") && pathname !== "/index.html")
          ) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          next();
        });
      }
    }
  ],
  build: {
    // Emit straight into the Quake 1 site so one Pages deploy serves both.
    // Quake 1 must build first: its own build empties dist/app.
    outDir: resolve(__dirname, "../../../dist/app/q2"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html")
      }
    }
  }
});
