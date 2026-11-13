/** Narrow, opt-in routing edits guarded by upstream strong ETags. */
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createManagementAdapter, readBounded } from "./adapter.mjs";
const channels = new Set([
  "vertex",
  "aistudio",
  "antigravity",
  "claude",
  "codex",
  "kimi",
  "xai",
  "meta",
]);
const strategies = new Set([
  "round-robin",
  "weighted-round-robin",
  "fill-first",
]);
const fields = new Set([
  "name",
  "alias",
  "fork",
  "display-name",
  "force-mapping",
]);
const problem = () =>
  new Error("Routing operation unsupported, invalid, expired or unavailable");
function pathFor({ kind, channel } = {}) {
  if (kind === "strategy" && channel === undefined)
    return "/v8/management/config/routing/strategy";
  if (kind === "aliases" && channels.has(channel))
    return `/v8/management/config/oauth/model-alias/${channel}`;
  throw problem();
}
const safe = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9 ._:/()-]{0,119}$/.test(value) &&
  !/sk-|ghp_|github_pat_|eyJ|bearer|https?:\/\//i.test(value);
function validate(kind, value) {
  if (kind === "strategy") {
    if (!strategies.has(value)) throw problem();
    return value;
  }
  if (!Array.isArray(value) || value.length > 100) throw problem();
  return value.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !fields.has(key)) ||
      !safe(row.name) ||
      !safe(row.alias)
    )
      throw problem();
    for (const key of ["fork", "force-mapping"])
      if (Object.hasOwn(row, key) && typeof row[key] !== "boolean")
        throw problem();
    if (Object.hasOwn(row, "display-name") && !safe(row["display-name"]))
      throw problem();
    return { ...row };
  });
}
export function createRoutingManager({
  enabled = false,
  baseURL,
  token,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  if (enabled === true) createManagementAdapter({ baseURL, token, fetchImpl });
  const pending = new Map();
  let busy = false;
  const check = () => {
    if (enabled !== true) throw problem();
  };
  const prune = () => {
    for (const [key, row] of pending)
      if (now() >= row.expiresAt) pending.delete(key);
  };
  async function request(path, method = "GET", value, etag) {
    return fetchImpl(new URL(path, baseURL), {
      method,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(method === "PUT"
          ? { "Content-Type": "application/json", "If-Match": etag }
          : {}),
      },
      ...(method === "PUT" ? { body: JSON.stringify(value) } : {}),
    });
  }
  async function readVersion(kind, path) {
    const response = await request(path);
    const etag = response.headers?.get("etag");
    if (
      response.redirected ||
      response.status !== 200 ||
      !/^"[a-fA-F0-9]{64}"$/.test(etag ?? "")
    ) {
      await response.body?.cancel?.();
      throw problem();
    }
    return { value: validate(kind, await readBounded(response)), etag };
  }
  return Object.freeze({
    async read(args) {
      check();
      try {
        return { value: (await readVersion(args.kind, pathFor(args))).value };
      } catch {
        throw problem();
      }
    },
    async preview(args = {}) {
      check();
      prune();
      if (pending.size >= 100) throw problem();
      try {
        const path = pathFor(args),
          after = validate(args.kind, args.value),
          before = await readVersion(args.kind, path);
        if (isDeepStrictEqual(before.value, after)) throw problem();
        const confirmationToken = randomBytes(32).toString("hex"),
          expiresAt = now() + 60000;
        if (pending.size >= 100) throw problem();
        pending.set(confirmationToken, {
          kind: args.kind,
          path,
          etag: before.etag,
          value: structuredClone(after),
          expiresAt,
        });
        return { confirmationToken, before: before.value, after, expiresAt };
      } catch {
        throw problem();
      }
    },
    async execute({ confirmationToken } = {}) {
      check();
      prune();
      const entry = pending.get(confirmationToken);
      pending.delete(confirmationToken);
      if (!entry || busy) throw problem();
      busy = true;
      try {
        const response = await request(
          entry.path,
          "PUT",
          entry.value,
          entry.etag,
        );
        if (response.redirected) {
          await response.body?.cancel?.();
          return { status: "uncertain" };
        }
        if (response.status === 412) {
          await response.body?.cancel?.();
          return { status: "conflict" };
        }
        if (response.status !== 200) {
          await response.body?.cancel?.();
          return { status: "uncertain" };
        }
        await response.body?.cancel?.();
        const result = await readVersion(entry.kind, entry.path);
        return {
          status: isDeepStrictEqual(result.value, entry.value)
            ? "applied"
            : "uncertain",
        };
      } catch {
        return { status: "uncertain" };
      } finally {
        busy = false;
      }
    },
  });
}
