/** Explicitly enabled credential status management; no automatic mutation or retry. */
import { createHmac, randomBytes } from "node:crypto";
import { createManagementAdapter, readBounded } from "./adapter.mjs";
const providers = new Set([
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
const string = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 2048 &&
  !/[\x00-\x1f]/.test(value);
const fail = () =>
  new Error(
    "Credential status operation unavailable, invalid, expired or stale",
  );
export function createStatusManager({
  baseURL,
  token,
  fetchImpl = globalThis.fetch,
  enabled = false,
  now = Date.now,
} = {}) {
  if (enabled) createManagementAdapter({ baseURL, token, fetchImpl });
  const secret = randomBytes(32),
    pending = new Map();
  let busy = false;
  const opaque = (value) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const identity = (row) =>
    opaque(JSON.stringify([row.name, row.auth_index, row.id, row.provider]));
  const check = () => {
    if (enabled !== true) throw fail();
  };
  async function request(path, options = {}) {
    const response = await fetchImpl(new URL(path, baseURL), {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (response.redirected || response.status !== 200) {
      await response.body?.cancel?.();
      throw fail();
    }
    return readBounded(response);
  }
  async function rows() {
    const body = await request("/v8/management/credentials");
    if (!body || !Array.isArray(body.files) || body.files.length > 10000)
      throw fail();
    const names = new Set();
    return body.files
      .filter((row) => row?.runtime_only !== true && row?.source !== "memory")
      .map((row) => {
        if (
          !row ||
          row.runtime_only !== false ||
          row.source !== "file" ||
          !string(row.name) ||
          row.name !== row.name.trim() ||
          !string(row.auth_index) ||
          !string(row.id) ||
          typeof row.disabled !== "boolean" ||
          names.has(row.name)
        )
          throw fail();
        names.add(row.name);
        return {
          ...row,
          opaqueId: opaque(row.name),
          label: `Account ${opaque(row.name).slice(0, 8)}`,
        };
      });
  }
  const prune = () => {
    for (const [key, value] of pending)
      if (now() >= value.expiresAt) pending.delete(key);
  };
  return Object.freeze({
    async list() {
      check();
      try {
        return {
          enabled: true,
          accounts: (await rows()).map((row) => ({
            id: row.opaqueId,
            label: row.label,
            provider: providers.has(row.provider) ? row.provider : "unknown",
            disabled: row.disabled,
          })),
        };
      } catch {
        throw fail();
      }
    },
    async preview({ id, disabled } = {}) {
      check();
      prune();
      if (
        typeof id !== "string" ||
        typeof disabled !== "boolean" ||
        pending.size >= 100
      )
        throw fail();
      try {
        const row = (await rows()).find((row) => row.opaqueId === id);
        if (!row || row.disabled === disabled) throw fail();
        const confirmationToken = randomBytes(32).toString("hex"),
          expiresAt = now() + 60000;
        pending.set(confirmationToken, {
          id,
          fingerprint: identity(row),
          previous: row.disabled,
          disabled,
          expiresAt,
        });
        return { confirmationToken, label: row.label, disabled, expiresAt };
      } catch {
        throw fail();
      }
    },
    async execute({ confirmationToken } = {}) {
      check();
      prune();
      const preview = pending.get(confirmationToken);
      pending.delete(confirmationToken);
      if (!preview || busy) throw fail();
      busy = true;
      let attempted = false;
      try {
        const row = (await rows()).find((row) => row.opaqueId === preview.id);
        if (
          !row ||
          identity(row) !== preview.fingerprint ||
          row.disabled !== preview.previous ||
          now() >= preview.expiresAt
        )
          throw fail();
        attempted = true;
        const result = await request("/v8/management/credentials/status", {
          method: "PATCH",
          body: JSON.stringify({
            name: row.name,
            auth_index: row.auth_index,
            disabled: preview.disabled,
          }),
        });
        if (
          !result ||
          result.status !== "ok" ||
          result.disabled !== preview.disabled
        )
          return { status: "uncertain" };
        const verified = (await rows()).find(
          (item) => item.opaqueId === preview.id,
        );
        return {
          status:
            verified &&
            identity(verified) === preview.fingerprint &&
            verified.disabled === preview.disabled
              ? "applied"
              : "uncertain",
        };
      } catch {
        if (attempted) return { status: "uncertain" };
        throw fail();
      } finally {
        busy = false;
      }
    },
  });
}
