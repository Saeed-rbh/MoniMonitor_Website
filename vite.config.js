import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve } from "path";

const repository = fileURLToPath(new URL(".", import.meta.url));
const versionBase = JSON.parse(readFileSync(resolve(repository, "app-version.json"), "utf8"));

const commitsSinceVersionBase = (() => {
  try {
    return Number(execFileSync("git", ["-C", repository, "rev-list", "--count", `${versionBase.baselineCommit}..HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()) || 0;
  } catch {
    return 0;
  }
})();

const appVersion = `${versionBase.major}.${versionBase.minor}.${Number(versionBase.patch || 0) + commitsSinceVersionBase}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
