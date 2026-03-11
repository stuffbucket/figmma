import { defineConfig } from "vite";

export default defineConfig({
  root: "dashboard/web",
  build: {
    outDir: "../../dist/dashboard/web",
    emptyOutDir: true,
  },
});
