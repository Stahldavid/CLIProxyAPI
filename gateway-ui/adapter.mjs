/** Server-only, explicitly configured read-only projection of the v8 management API. */
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 10000;
const CHANNELS = ["codex", "claude", "gemini"];
const PATHS = [
  "/v8/management/credentials",
  ...CHANNELS.map(
    (channel) => `/v8/management/routing/model-definitions/${channel}`,
  ),
];
const PROVIDERS = new Set([
  "codex",
  "claude",
  "gemini",
  "openai",
  "antigravity",
  "qwen",
  "iflow",
  "kimi",
  "copilot",
  "vertex",
  "aistudio",
]);
const STATUSES = new Set([
  "active",
  "disabled",
  "error",
  "unavailable",
  "pending",
  "unknown",
]);
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9 ._:/()\-]{0,119}$/.test(value) &&
  !/(?:sk-|ghp_|github_pat_|bearer|eyJ|https?:\/\/)/i.test(value)
    ? value
    : null;
const problem = (code) =>
  Object.assign(new Error(code), { diagnosticCode: code });

export async function readBounded(response) {
  const declared = response.headers?.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    await response.body?.cancel?.();
    throw problem("response-too-large");
  }
  if (!response.body || typeof response.body.getReader !== "function")
    throw problem("invalid-response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw problem("response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw problem("invalid-response");
  }
}

function accountsFrom(payload) {
  if (
    !plain(payload) ||
    !Array.isArray(payload.files) ||
    payload.files.length > MAX_ITEMS ||
    payload.files.some((row) => !plain(row))
  )
    throw problem("invalid-response");
  return payload.files.map((row, index) => ({
    label: `Account ${index + 1}`,
    provider: PROVIDERS.has(row.provider) ? row.provider : "unknown",
    status: STATUSES.has(row.status) ? row.status : "unknown",
    disabled: typeof row.disabled === "boolean" ? row.disabled : null,
  }));
}

function modelsFrom(payload, provider) {
  if (
    !plain(payload) ||
    !Array.isArray(payload.models) ||
    payload.models.length > MAX_ITEMS ||
    payload.models.some((row) => !plain(row))
  )
    throw problem("invalid-response");
  return payload.models
    .map((row) => ({
      id: text(row.id),
      name: text(row.name) || text(row.id),
      provider,
    }))
    .filter((row) => row.id !== null);
}

export function createManagementAdapter({
  baseURL,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  let base;
  try {
    base = new URL(baseURL);
  } catch {
    throw new TypeError("A valid management base URL is required.");
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== "/" && base.pathname !== "")
  )
    throw new TypeError(
      "Management URL must be an origin without credentials, query, or path.",
    );
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))
    throw new TypeError("HTTPS is required except for explicit loopback HTTP.");
  if (
    typeof token !== "string" ||
    !token.trim() ||
    token.length > 4096 ||
    /[^\x21-\x7e]/.test(token)
  )
    throw new TypeError("A nonempty server-side management token is required.");
  if (typeof fetchImpl !== "function")
    throw new TypeError("A fetch implementation is required.");
  return Object.freeze({
    async snapshot() {
      const accounts = [],
        models = [],
        diagnostics = [];
      for (const [index, endpoint] of PATHS.entries()) {
        try {
          const response = await fetchImpl(new URL(endpoint, base.origin), {
            method: "GET",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });
          if (!response || !Number.isInteger(response.status))
            throw problem("invalid-response");
          if (response.redirected) throw problem("redirect-rejected");
          if (response.status < 200 || response.status >= 300) {
            await response.body?.cancel?.();
            throw problem(
              `http-${response.status >= 100 && response.status <= 599 ? response.status : "error"}`,
            );
          }
          const payload = await readBounded(response);
          if (index === 0) accounts.push(...accountsFrom(payload));
          else models.push(...modelsFrom(payload, CHANNELS[index - 1]));
          diagnostics.push({ endpoint, status: "ok", code: "ok" });
        } catch (error) {
          const safeCode =
            typeof error?.diagnosticCode === "string" &&
            /^(?:invalid-response|response-too-large|redirect-rejected|http-(?:[1-5][0-9]{2}|error))$/.test(
              error.diagnosticCode,
            )
              ? error.diagnosticCode
              : "transport-error";
          diagnostics.push({ endpoint, status: "unavailable", code: safeCode });
        }
      }
      const succeeded = diagnostics.filter(
        (item) => item.status === "ok",
      ).length;
      return {
        status:
          succeeded === PATHS.length
            ? "connected"
            : succeeded
              ? "partial"
              : "disconnected",
        accounts,
        models,
        diagnostics,
      };
    },
  });
}
