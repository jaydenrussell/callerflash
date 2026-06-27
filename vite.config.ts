import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inject the package version at build time so the renderer always
// shows the real running version (read by AppSidebar / About /
// AutoUpdate header / Recent-Calls tooltip, etc.).
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_REPO__: JSON.stringify(pkg.repository?.url || "https://github.com/jaydenrussell/CallerFlash"),
    __APP_BUILD_TIMESTAMP__: Date.now(),
  },
});
