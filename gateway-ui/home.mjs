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
  return {
    async snapshot() {
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
