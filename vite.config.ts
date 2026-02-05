import { defineConfig } from "vite";

const fileName = "ha-tplink-router-card";

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => `${fileName}.js`,
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: `${fileName}.js`,
        chunkFileNames: `${fileName}.js`,
        assetFileNames: `${fileName}.[ext]`,
      },
    },
  },
});
