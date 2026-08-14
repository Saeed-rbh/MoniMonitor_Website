import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist", // Change the output directory to 'build'
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.js"],
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
  server: {
    port: 3000,
    host: "localhost", // Bind to localhost
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "react": resolve(__dirname, "./node_modules/react"),
      "react-dom": resolve(__dirname, "./node_modules/react-dom"),
      "@react-spring/shared": resolve(__dirname, "./node_modules/@react-spring/shared"),
    },
  },
});
// Force restart
