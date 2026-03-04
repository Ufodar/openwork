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

const readBool = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

// Solid devtools has significant runtime overhead in large routes.
// Keep it opt-in so headless-web / pod / docker flows stay responsive.
const solidDevtoolsEnabled = readBool(process.env.VITE_SOLID_DEVTOOLS);

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
    ...(solidDevtoolsEnabled
      ? [devtools({
        autoname: true,
        locator: {
          targetIDE: "vscode",
          componentLocation: true,
          jsxLocation: true,
        },
      })]
      : []),
    tailwindcss(),
    solid(),
  ],
  optimizeDeps: {
    // lucide-solid has ~3300 individual ESM icon modules. Pre-bundling
    // collapses them into one request, critical for SSH-tunneled dev.
    // The pnpm patch (patches/lucide-solid@0.562.0.patch) removes the
    // "solid" export condition so vite-plugin-solid won't exclude it.
    include: ["lucide-solid"],
  },
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
