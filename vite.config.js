import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist", // Change the output directory to 'build'
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.js"],
  },
  server: {
    port: 3000,
    host: "localhost", // Bind to localhost
  },
});
