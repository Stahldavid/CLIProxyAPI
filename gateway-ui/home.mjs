/** Separate, read-only Home projection. Never request config, grants or credentials. */
import { readBounded } from "./adapter.mjs";

export function panelOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new TypeError(
      "Panel origin requires HTTPS or loopback HTTP, without credentials, path or query.",
    );
  return url.origin;
}

export function createHomeAdapter({ baseURL, token, fetchImpl = fetch } = {}) {
  const origin = panelOrigin(baseURL);
  if (
    !origin ||
    typeof token !== "string" ||
    !token ||
    token.length > 4096 ||
    /[^\x21-\x7e]/.test(token)
  )
    throw new TypeError("Explicit Home origin and server-side token required.");
  async function usageSnapshot() {
    const to = new Date().toISOString();
    const from = new Date(Date.parse(to) - 86400000).toISOString();
    const query = new URLSearchParams({
      from,
      to,
      timezone: "Asia/Jerusalem",
      interval: "hour",
    });
    try {
      const response = await fetchImpl(
        `${origin}/v8/management/usage/overview?${query}`,
        {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok || response.redirected) {
        await response.body?.cancel?.();
        throw new Error("unavailable");
      }
      const data = await readBounded(response);
      const count = (x) => (Number.isSafeInteger(x) && x >= 0 ? x : null);
      const latency = (x) =>
        typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
      const totals = data?.totals;
      if (
        Date.parse(data?.range?.from) !== Date.parse(from) ||
        Date.parse(data?.range?.to) !== Date.parse(to)
      )
        throw new Error("range-mismatch");
      if (
        !totals ||
        typeof totals !== "object" ||
        count(totals.request_count) === null ||
        count(totals.success_count) === null ||
        totals.success_count > totals.request_count
      )
        throw new Error("schema");
      const timestamp = (value) =>
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        Number.isFinite(Date.parse(value))
          ? new Date(value).toISOString()
          : null;
      return {
        status: "loaded",
        from,
        to,
        timezone: "Asia/Jerusalem",
        checkedAt: new Date().toISOString(),
        requests: totals.request_count,
        successes: totals.success_count,
        failed: count(totals.failed_count),
        tokens: count(totals.total_tokens),
        p95LatencyMs: latency(totals.p95_latency_ms),
        trend:
          Array.isArray(data.trend) && data.trend.length <= 25
            ? data.trend
                .map((row) => ({
                  timestamp: timestamp(row?.bucket_start),
                  requests: count(row?.request_count),
                  tokens: count(row?.total_tokens),
                }))
                .filter((row) => row.timestamp)
            : [],
      };
    } catch {
      return { status: "unavailable", from, to, timezone: "Asia/Jerusalem" };
    }
  }
  return {
    async snapshot() {
      const usagePromise = usageSnapshot();
      const nodes = await this.nodesSnapshot();
      return { ...nodes, usage: await usagePromise };
    },
    async nodesSnapshot() {
      try {
        const response = await fetchImpl(`${origin}/v8/management/nodes`, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok || response.redirected) {
          await response.body?.cancel?.();
          return {
            status: "unavailable",
            nodes: [],
            code:
              response.status === 401 || response.status === 403
                ? "authentication-required"
                : "source-unavailable",
          };
        }
        const payload = await readBounded(response);
        if (
          !Array.isArray(payload?.nodes) ||
          payload.nodes.length > 1000 ||
          payload.nodes.some(
            (n) => !n || typeof n !== "object" || Array.isArray(n),
          )
        )
          throw new Error("schema");
        return {
          status: "connected",
          checkedAt: new Date().toISOString(),
          nodes: payload.nodes.map((node, index) => ({
            label: `CPA ${index + 1}`,
            healthy: typeof node.healthy === "boolean" ? node.healthy : null,
            clients:
              Number.isSafeInteger(node.client_count) && node.client_count >= 0
                ? node.client_count
                : null,
          })),
        };
      } catch {
        return { status: "unavailable", nodes: [], code: "source-unavailable" };
      }
    },
  };
}
