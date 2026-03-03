import os from "node:os";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import solid from "vite-plugin-solid";
import devtools from "solid-devtools/vite";

const portValue = Number.parseInt(process.env.PORT ?? "", 10);
const devPort = Number.isFinite(portValue) && portValue > 0 ? portValue : 5173;
const openworkPortValue = Number.parseInt(process.env.OPENWORK_PORT ?? "", 10);
const openworkPort = Number.isFinite(openworkPortValue) && openworkPortValue > 0 ? openworkPortValue : 8789;
const allowedHosts = new Set<string>();
const envAllowedHosts = process.env.VITE_ALLOWED_HOSTS ?? "";

const addHost = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return;
  allowedHosts.add(trimmed);
};

envAllowedHosts.split(",").forEach(addHost);
addHost(process.env.OPENWORK_PUBLIC_HOST ?? null);
const hostname = os.hostname();
addHost(hostname);
const shortHostname = hostname.split(".")[0];
if (shortHostname && shortHostname !== hostname) {
  addHost(shortHostname);
}

export default defineConfig({
  plugins: [
    devtools({
      autoname: true,
      locator: {
        targetIDE: "vscode",
        componentLocation: true,
        jsxLocation: true,
      },
    }),
    tailwindcss(),
    solid(),
    // Force pre-bundle lucide-solid. The vite-plugin-solid auto-detects
    // packages with Solid exports and adds them to optimizeDeps.exclude,
    // but lucide-solid ships pre-compiled JS (no JSX) and has ~3300 icon
    // modules. Without pre-bundling, each icon is a separate HTTP request
    // that saturates the browser's 6-connection HTTP/1.1 limit.
    {
      name: "force-prebundle-lucide",
      config() {
        return { optimizeDeps: { include: ["lucide-solid"] } };
      },
      configResolved(resolvedConfig) {
        // The solid plugin adds lucide-solid to optimizeDeps.exclude because
        // its package.json exports have a "solid" condition. Remove it here
        // so Vite's esbuild optimizer can bundle the pre-compiled ESM icons.
        const exclude = resolvedConfig.optimizeDeps.exclude;
        if (Array.isArray(exclude)) {
          const idx = exclude.indexOf("lucide-solid");
          if (idx >= 0) exclude.splice(idx, 1);
        }
      },
    },
  ],
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      "/openwork": {
        target: `http://127.0.0.1:${openworkPort}`,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/openwork/, ""),
      },
    },
    ...(allowedHosts.size > 0 ? { allowedHosts: Array.from(allowedHosts) } : {}),
  },
  build: {
    target: "esnext",
  },
});
