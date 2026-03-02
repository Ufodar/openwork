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
