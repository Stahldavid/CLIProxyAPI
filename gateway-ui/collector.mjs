/** Opt-in sole consumer. Never invoked by the console or its browser. */
import { open, rename, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createManagementAdapter, readBounded } from "./adapter.mjs";
import { normalizeRecords } from "./src/telemetry.mjs";
const ACK = "I_OWN_THE_DESTRUCTIVE_USAGE_QUEUE";
const safeName = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:/()-]{0,99}$/.test(value) &&
  !/sk-|ghp_|github_pat_|eyJ/i.test(value)
    ? value
    : null;
function project(raw) {
  const [r] = normalizeRecords([raw]);
  const family =
    r.clientEvidence === "user-agent heuristic"
      ? raw.user_agent.match(/claude[- /]?code|claude-cli|codex|opencode/i)?.[0]
      : null;
  return {
    timestamp: r.timestamp,
    user_agent: family,
    provider: safeName(raw.provider),
    executor_type: safeName(raw.executor_type),
    alias: safeName(raw.alias),
    model: safeName(raw.model),
    response_model: safeName(raw.response_model),
    auth_type: ["oauth", "api_key", "apikey"].includes(raw.auth_type)
      ? raw.auth_type
      : null,
    tokens: {
      input_tokens: r.tokens.input,
      output_tokens: r.tokens.output,
      cached_tokens: r.tokens.cached,
      total_tokens: r.tokens.total,
    },
    latency_ms: r.latencyMs,
    failed: raw.failed === true ? true : raw.failed === false ? false : null,
  };
}
export async function createCollector({
  baseURL,
  token,
  snapshotPath,
  acknowledgement,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (acknowledgement !== ACK)
    throw new Error(
      "Explicit exclusive queue ownership acknowledgement required",
    );
  createManagementAdapter({ baseURL, token, fetchImpl }); // Validate origin and token without a request.
  if (!snapshotPath) throw new Error("Dedicated snapshot path required");
  const path = resolve(snapshotPath),
    lockPath = path + ".lock",
    tempPath = path + ".next";
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(lockPath, "wx", 0o600);
  let history = [],
    busy = false,
    halted = false,
    closed = false;
  try {
    try {
      const input = await open(path, "r");
      let saved;
      try {
        const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
        const { bytesRead } = await input.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 5 * 1024 * 1024) throw new Error("History too large");
        saved = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      } finally {
        await input.close();
      }
      if (
        saved.schema !== 1 ||
        !Array.isArray(saved.records) ||
        saved.records.length > 10000
      )
        throw new Error("Invalid history");
      history = saved.records.map(project);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Prove destination is writable before removing any event from upstream.
    const probe = await open(tempPath, "wx", 0o600);
    await probe.close();
    await unlink(tempPath);
  } catch {
    await lock.close();
    await unlink(lockPath);
    throw new Error("History initialization failed; queue untouched");
  }
  return {
    async poll() {
      if (closed || halted)
        throw new Error("Collector stopped; manual reconciliation required");
      if (busy) throw new Error("Collection already in progress");
      busy = true;
      try {
        const response = await fetchImpl(
          new URL(
            "/v8/management/observability/usage/queue?count=100",
            baseURL,
          ),
          {
            method: "GET",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );
        if (response.redirected || response.status !== 200) {
          await response.body?.cancel?.();
          throw new Error("Source rejected");
        }
        const raw = await readBounded(response);
        if (!Array.isArray(raw) || raw.length > 100)
          throw new Error("Invalid batch");
        const records = raw.map(project);
        const candidates = [...history, ...records].slice(-10000);
        const sizes = candidates.map(
          (row) => Buffer.byteLength(JSON.stringify(row)) + 1,
        );
        let bytes = sizes.reduce((sum, size) => sum + size, 0),
          start = 0;
        while (bytes > 4 * 1024 * 1024) bytes -= sizes[start++];
        const next = candidates.slice(start);
        const file = await open(tempPath, "wx", 0o600);
        try {
          await file.writeFile(
            JSON.stringify({
              schema: 1,
              checkedAt: new Date().toISOString(),
              records: next,
            }),
          );
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(tempPath, path);
        const dir = await open(dirname(path), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
        history = next;
        return { received: records.length, retained: history.length };
      } catch {
        halted = true;
        throw new Error(
          "Collection halted: queue outcome may be uncertain; do not automatically retry",
        );
      } finally {
        busy = false;
      }
    },
    async close() {
      if (busy) throw new Error("Cannot close during collection");
      if (!closed) {
        closed = true;
        await lock.close();
        if (!halted) await unlink(lockPath);
      }
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const collector = await createCollector({
      baseURL: process.env.GATEWAY_MANAGEMENT_URL,
      token: process.env.GATEWAY_MANAGEMENT_TOKEN,
      snapshotPath: process.env.GATEWAY_SNAPSHOT_PATH,
      acknowledgement: process.env.GATEWAY_QUEUE_OWNERSHIP,
    });
    // One explicit batch per invocation. Scheduling belongs to an authorized operator.
    try {
      console.log(JSON.stringify(await collector.poll()));
    } finally {
      await collector.close();
    }
  } catch {
    console.error(
      "Collector failed safely; inspect local configuration and reconcile queue before retrying.",
    );
    process.exitCode = 1;
  }
}
