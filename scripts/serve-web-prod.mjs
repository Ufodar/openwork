import http from "node:http";
import https from "node:https";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_DIST_DIR = resolve(SCRIPT_PATH, "..", "..", "packages", "app", "dist");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

export function resolveProxyPath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  let pathname = url.pathname;
  if (pathname === "/openwork") pathname = "/";
  else if (pathname.startsWith("/openwork/")) pathname = pathname.slice("/openwork".length) || "/";
  return `${pathname}${url.search}`;
}

export function shouldServeSpaFallback(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const pathname = url.pathname;
  if (pathname === "/" || pathname === "") return true;
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
  return lastSegment !== "" && !lastSegment.includes(".");
}

function resolveWithinRoot(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decoded.replace(/^\/+/, "");
  const candidate = resolve(rootDir, relativePath);
  const normalizedRoot = resolve(rootDir);
  if (candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`)) {
    return candidate;
  }
  return null;
}

export function resolveStaticFilePath(rootDir, requestUrl) {
  const rawUrl = String(requestUrl);
  if (/\/\.\.?(?:\/|$)/.test(rawUrl) || /%2e%2e/i.test(rawUrl)) {
    return null;
  }

  const url = new URL(requestUrl, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const candidate = resolveWithinRoot(rootDir, pathname);
  if (!candidate) {
    return null;
  }
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  if (!shouldServeSpaFallback(requestUrl)) {
    return null;
  }

  const indexPath = resolve(rootDir, "index.html");
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    return indexPath;
  }

  return null;
}

export function contentTypeForPath(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function proxyRequest(request, response, backendUrl) {
  const target = new URL(resolveProxyPath(request.url || "/"), backendUrl);
  const client = target.protocol === "https:" ? https : http;
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;

  const proxy = client.request(
    target,
    {
      method: request.method,
      headers,
    },
    (upstream) => {
      response.writeHead(upstream.statusCode || 502, upstream.headers);
      if (request.method === "HEAD") {
        upstream.resume();
        response.end();
        return;
      }
      upstream.pipe(response);
    },
  );

  proxy.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Proxy error: ${error.message}`);
  });

  request.on("aborted", () => proxy.destroy());
  response.on("close", () => {
    if (!proxy.destroyed) {
      proxy.destroy();
    }
  });

  if (request.method === "GET" || request.method === "HEAD") {
    request.resume();
    proxy.end();
    return;
  }

  request.pipe(proxy);
}

function serveStaticFile(request, response, filePath) {
  const stat = statSync(filePath);
  response.writeHead(200, {
    "cache-control": filePath.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    "content-length": stat.size,
    "content-type": contentTypeForPath(filePath),
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.message);
  });
  stream.pipe(response);
}

function createServer({ backendUrl, distDir, host, port }) {
  const server = http.createServer((request, response) => {
    const requestUrl = request.url || "/";
    if (requestUrl === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok");
      return;
    }

    if (requestUrl === "/openwork" || requestUrl.startsWith("/openwork/")) {
      proxyRequest(request, response, backendUrl);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method Not Allowed");
      return;
    }

    const filePath = resolveStaticFilePath(distDir, requestUrl);
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    serveStaticFile(request, response, filePath);
  });

  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 300_000;
  server.headersTimeout = 301_000;

  server.listen(port, host, () => {
    console.log(`[prod-web] Serving ${distDir}`);
    console.log(`[prod-web] Listening on http://${host}:${port}`);
    console.log(`[prod-web] Proxying /openwork -> ${backendUrl}`);
  });

  const shutdown = (signal) => {
    console.log(`[prod-web] Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const host = process.env.OPENWORK_WEB_HOST?.trim() || process.env.HOST?.trim() || "0.0.0.0";
  const port = Number.parseInt(process.env.OPENWORK_WEB_PORT?.trim() || process.env.PORT?.trim() || "5173", 10);
  const openworkPort = Number.parseInt(process.env.OPENWORK_PORT?.trim() || "8789", 10);
  const distDir = resolve(process.env.OPENWORK_WEB_DIST_DIR?.trim() || DEFAULT_DIST_DIR);
  const backendUrl = process.env.OPENWORK_WEB_BACKEND_URL?.trim() || `http://127.0.0.1:${openworkPort}`;

  const indexPath = resolve(distDir, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`[prod-web] Missing built UI at ${indexPath}. Run the web build first.`);
    process.exit(1);
  }
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`[prod-web] Invalid port: ${process.env.OPENWORK_WEB_PORT || process.env.PORT}`);
    process.exit(1);
  }

  createServer({ backendUrl, distDir, host, port });
}
