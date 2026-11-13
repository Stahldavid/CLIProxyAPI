import { randomUUID, timingSafeEqual } from "node:crypto";

// In-memory contract doubles only. These are not vendor API implementations.
// No external client, credentials, filesystem, subprocess or network access.
export function createMockIntegrationServices({ now = Date.now } = {}) {
  const scope = "newton/development";
  let active = true;
  let version = 1;
  let secret = `SIMULATED-${randomUUID()}`;
  let failNext = false;
  let issueCount = 0;
  const identities = new Map();
  const counters = { resolutions: 0, executions: 0, externalCalls: 0 };
  const same = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  const deny = () => {
    throw new Error("Mock credential unavailable");
  };
  const vault = {
    issue({ requestedScope = scope, ttlMs = 300000 } = {}) {
      if (
        requestedScope !== scope ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs <= 0 ||
        ttlMs > 300000
      )
        throw new Error("Mock identity scope or lifetime denied");
      for (const [id, entry] of identities)
        if (entry.expiresAt <= now()) identities.delete(id);
      if (identities.size >= 20)
        throw new Error("Mock identity capacity reached");
      const id = randomUUID();
      identities.set(id, { scope, expiresAt: now() + ttlMs });
      return id;
    },
    resolve(id, requestedScope) {
      const identity = identities.get(id);
      if (
        !active ||
        !identity ||
        identity.expiresAt <= now() ||
        identity.scope !== requestedScope
      )
        deny();
      counters.resolutions++;
      // Only the server-side connector receives this opaque fixture.
      return { value: secret, version };
    },
    revoke(id) {
      identities.delete(id);
    },
    rotate() {
      secret = `SIMULATED-${randomUUID()}`;
      version++;
    },
    setAvailable(value) {
      if (typeof value !== "boolean") throw new Error("Invalid availability");
      active = value;
    },
  };
  const executor = {
    run({ tool, requestedScope, credential }) {
      if (
        !["docs.search", "issue.create"].includes(tool) ||
        requestedScope !== scope
      )
        throw new Error("Mock executor scope or tool denied");
      if (
        !active ||
        credential?.version !== version ||
        !same(credential?.value, secret)
      )
        deny();
      if (failNext) {
        failNext = false;
        throw new Error("Mock executor unavailable");
      }
      counters.executions++;
      return tool === "docs.search"
        ? {
            matches: [
              { title: "Newton mock development guide", source: "fixture" },
            ],
          }
        : {
            issue: `MOCK-${String(++issueCount).padStart(3, "0")}`,
            createdExternally: false,
          };
    },
    failNext() {
      failNext = true;
    },
  };
  return {
    vault,
    executor,
    snapshot() {
      return { mode: "simulation", credentialVersion: version, ...counters };
    },
  };
}
