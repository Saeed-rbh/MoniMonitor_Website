import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve } from "path";

const sharedModules = ['calendar', 'currency', 'financialSemantics', 'transactionNames', 'transactionCsv', 'accountBalances'];

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
  // Shared accounting helpers are CommonJS for the Node API. Prebundle them
  // for browser ESM imports during development as well as production builds.
  optimizeDeps: {
    include: sharedModules.map(name => `@monimonitor/shared/${name}`),
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
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
      ...Object.fromEntries(sharedModules.map(name => [`@monimonitor/shared/${name}`, resolve(repository, `shared/${name}.cjs`)])),
      "@": resolve(repository, "./src"),
      "react": resolve(repository, "./node_modules/react"),
      "react-dom": resolve(repository, "./node_modules/react-dom"),
      "@react-spring/shared": resolve(repository, "./node_modules/@react-spring/shared"),
    },
  },
});
// Force restart
