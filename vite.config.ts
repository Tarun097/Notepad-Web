import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@codemirror/") || id.includes("/node_modules/codemirror/")) {
            return "codemirror";
          }
          if (id.includes("/node_modules/")) {
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
