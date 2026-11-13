import http from "node:http";
import { createConsoleAuth, isSameOriginRequest } from "./auth.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeRecords } from "./src/telemetry.mjs";
import { createManagementAdapter } from "./adapter.mjs";
const files = new Set([
  "index.html",
  "style.css",
  "app.mjs",
  "telemetry.mjs",
  "demo.mjs",
]);
export function createServer({
  adapter = null,
  snapshotPath = null,
  consolePassword = null,
  managementToken = null,
} = {}) {
  const authorized = createConsoleAuth({
    password: consolePassword,
    required: Boolean(adapter || snapshotPath),
    managementToken,
  });
  return http.createServer(async (req, res) => {
    const headers = {
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403, headers);
      res.end("Local access only");
      return;
    }
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, headers);
      res.end("Same-origin access only");
      return;
    }
    if (!authorized(req)) {
      res.writeHead(401, {
        ...headers,
        "WWW-Authenticate": 'Basic realm="Gateway console", charset="UTF-8"',
      });
      res.end("Authentication required");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...headers, Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/api/snapshot") {
      try {
        let records = [];
        let telemetryStatus = "not-configured";
        if (snapshotPath) {
          try {
            const raw = await readFile(snapshotPath);
            if (raw.length > 5 * 1024 * 1024) throw new Error("too large");
            records = normalizeRecords(JSON.parse(raw));
            telemetryStatus = "loaded";
          } catch {
            telemetryStatus = "unavailable";
          }
        }
        const management = adapter
          ? await adapter.snapshot()
          : {
              status: "not-configured",
              accounts: [],
              models: [],
              diagnostics: [],
            };
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            mode: adapter || snapshotPath ? "connected" : "demo",
            checkedAt: new Date().toISOString(),
            records,
            telemetryStatus,
            management,
          }),
        );
      } catch {
        res.writeHead(502, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Management source unavailable" }));
      }
      return;
    }
    const file = path === "/" ? "index.html" : path.slice(1);
    if (!files.has(file)) {
      res.writeHead(404, headers);
      res.end("Not found");
      return;
    }
    try {
      const data = await readFile(new URL(`src/${file}`, import.meta.url));
      res.writeHead(200, {
        ...headers,
        "Content-Type": file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css"
            : "text/javascript",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(500, headers);
      res.end("Asset unavailable");
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  let adapter = null;
  if (process.env.GATEWAY_MANAGEMENT_URL) {
    adapter = createManagementAdapter({
      baseURL: process.env.GATEWAY_MANAGEMENT_URL,
      token: process.env.GATEWAY_MANAGEMENT_TOKEN,
    });
  }
  createServer({
    adapter,
    consolePassword: process.env.GATEWAY_CONSOLE_PASSWORD ?? null,
    managementToken: process.env.GATEWAY_MANAGEMENT_TOKEN ?? null,
    snapshotPath: process.env.GATEWAY_SNAPSHOT_PATH ?? null,
  }).listen(port, "127.0.0.1", () =>
    console.log(
      `Gateway local console: http://127.0.0.1:${port} (${adapter ? "read-only management adapter" : "no provider access"})`,
    ),
  );
}
