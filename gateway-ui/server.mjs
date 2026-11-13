import http from "node:http";
import { createRoutingManager } from "./routing.mjs";
import { createStatusManager } from "./management.mjs";
import { createConsoleAuth, isSameOriginRequest } from "./auth.mjs";
import { readFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeRecords } from "./src/telemetry.mjs";
import { createManagementAdapter } from "./adapter.mjs";
const files = new Set([
  "index.html",
  "style.css",
  "app.mjs",
  "telemetry.mjs",
  "demo.mjs",
  "management-ui.mjs",
  "routing-ui.mjs",
]);
export function createServer({
  adapter = null,
  statusManager = null,
  routingManager = null,
  snapshotPath = null,
  consolePassword = null,
  managementToken = null,
} = {}) {
  const authorized = createConsoleAuth({
    password: consolePassword,
    required: Boolean(
      adapter || snapshotPath || statusManager || routingManager,
    ),
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
    let requestURL;
    try {
      requestURL = new URL(req.url, "http://localhost");
    } catch {
      res.writeHead(400, headers);
      res.end("Invalid request target");
      return;
    }
    const actionPath = requestURL.pathname;
    const routingAction = actionPath.startsWith("/api/routing");
    const actionBase = routingAction ? "/api/routing" : "/api/account-status";
    const actionManager = routingAction ? routingManager : statusManager;
    if (routingAction || actionPath.startsWith("/api/account-status")) {
      const respond = (code, body) => {
        res.writeHead(code, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (!actionManager) {
        respond(404, { error: "Management capability disabled" });
        return;
      }
      try {
        if (actionPath === actionBase && req.method === "GET") {
          const params = requestURL.searchParams;
          respond(
            200,
            routingAction
              ? await actionManager.read({
                  kind: params.get("kind"),
                  channel: params.get("channel") ?? undefined,
                })
              : await actionManager.list(),
          );
          return;
        }
        if (
          ![`${actionBase}/preview`, `${actionBase}/confirm`].includes(
            actionPath,
          ) ||
          req.method !== "POST"
        ) {
          respond(405, { error: "Unsupported action" });
          return;
        }
        if (
          req.headers["content-type"] !== "application/json" ||
          req.headers["x-gateway-action"] !== "explicit-confirmation"
        ) {
          respond(403, { error: "Explicit same-origin action required" });
          return;
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > (routingAction ? 65536 : 2048))
            throw new Error("Too large");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("Invalid request");
        const result = actionPath.endsWith("/preview")
          ? await actionManager.preview(body)
          : await actionManager.execute(body);
        respond(200, result);
      } catch {
        respond(409, {
          error:
            "Action unavailable or outcome uncertain. Refresh state; do not automatically retry.",
        });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...headers, Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const path = requestURL.pathname;
    if (path === "/api/snapshot") {
      try {
        let records = [];
        let telemetryStatus = "not-configured";
        if (snapshotPath) {
          try {
            const input = await open(snapshotPath, "r");
            let raw;
            try {
              const limit = 5 * 1024 * 1024;
              if ((await input.stat()).size > limit)
                throw new Error("too large");
              const buffer = Buffer.alloc(limit + 1);
              const { bytesRead } = await input.read(
                buffer,
                0,
                buffer.length,
                0,
              );
              if (bytesRead > limit) throw new Error("too large");
              raw = buffer.subarray(0, bytesRead);
            } finally {
              await input.close();
            }
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
            mode:
              adapter || snapshotPath || statusManager || routingManager
                ? "connected"
                : "demo",
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
  const statusManager =
    process.env.GATEWAY_ALLOW_ACCOUNT_STATUS === "explicit-confirmation"
      ? createStatusManager({
          baseURL: process.env.GATEWAY_MANAGEMENT_URL,
          token: process.env.GATEWAY_MANAGEMENT_TOKEN,
          enabled: true,
        })
      : null;
  const routingManager =
    process.env.GATEWAY_ALLOW_ROUTING === "explicit-confirmation"
      ? createRoutingManager({
          baseURL: process.env.GATEWAY_MANAGEMENT_URL,
          token: process.env.GATEWAY_MANAGEMENT_TOKEN,
          enabled: true,
        })
      : null;
  createServer({
    adapter,
    routingManager,
    statusManager,
    consolePassword: process.env.GATEWAY_CONSOLE_PASSWORD ?? null,
    managementToken: process.env.GATEWAY_MANAGEMENT_TOKEN ?? null,
    snapshotPath: process.env.GATEWAY_SNAPSHOT_PATH ?? null,
  }).listen(port, "127.0.0.1", () =>
    console.log(
      `Gateway local console: http://127.0.0.1:${port} (${adapter ? "read-only management adapter" : "no provider access"})`,
    ),
  );
}
