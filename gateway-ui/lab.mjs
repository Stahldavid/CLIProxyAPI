import { randomUUID } from "node:crypto";
import { createMockIntegrationServices } from "./lab-services.mjs";

// An architectural simulator, not an Infisical or Executor client.
// No network, filesystem credentials, subprocess, or environment reads.
export function createIntegrationLab({
  now = Date.now,
  credentialAvailable = true,
  services = createMockIntegrationServices({ now }),
} = {}) {
  const scope = "newton/development";
  const identity = services.vault.issue();
  services.vault.setAvailable(credentialAvailable);
  const policies = Object.freeze({
    "docs.search": "allow",
    "issue.create": "confirm",
    "production.deploy": "block",
  });
  const pending = new Map();
  const events = [];
  let count = 0;
  function record(tool, status) {
    events.unshift({
      sequence: ++count,
      tool,
      status,
      at: new Date(now()).toISOString(),
      scope,
      mode: "simulation",
    });
    events.splice(50);
  }
  function fail(message) {
    throw new Error(message);
  }
  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Invalid request");
    if (
      Object.keys(input).some(
        (k) => !["tool", "project", "environment"].includes(k),
      )
    )
      fail(
        "Unsupported field; secrets and arbitrary arguments are not accepted",
      );
    if (input.project !== "newton" || input.environment !== "development")
      fail("Scope denied");
    if (typeof input.tool !== "string" || !Object.hasOwn(policies, input.tool))
      fail("Tool not allowlisted");
  }
  function execute(tool) {
    // Resolve just in time. Do not retain credentials in approval or audit state.
    try {
      const credential = services.vault.resolve(identity, scope);
      const result = services.executor.run({
        tool,
        requestedScope: scope,
        credential,
      });
      record(tool, "completed");
      return { status: "completed", simulated: true, tool, result };
    } catch {
      // Never propagate a connector error containing credentials or payloads.
      record(tool, "failed");
      fail("Mock credential unavailable or executor failed");
    }
  }

  function expire() {
    for (const [id, item] of pending)
      if (item.expiresAt <= now()) {
        pending.delete(id);
        record(item.tool, "expired");
      }
  }
  return {
    snapshot() {
      expire();
      return {
        mode: "simulation",
        services: services.snapshot(),
        scope,
        secret: {
          reference: "mock://newton/development/TOOL_KEY",
          valueExposed: false,
          identity: "mock-newton-dev",
          permissions: "read one fixture only",
        },
        tools: Object.entries(policies).map(([tool, policy]) => ({
          tool,
          policy,
        })),
        model: {
          client: "Claude Code",
          provider: "Codex",
          model: "mock-model",
          billingSource: "Codex subscription (illustrative)",
          cost: null,
          quota: null,
          callsMade: 0,
        },
        pending: [...pending].map(([id, v]) => ({
          id,
          tool: v.tool,
          expiresAt: v.expiresAt,
        })),
        events: events.map((event) => ({ ...event })),
      };
    },
    revokeIdentity() {
      services.vault.revoke(identity);
      pending.clear();
      record("identity", "revoked");
    },
    request(input) {
      try {
        validate(input);
      } catch (error) {
        record("request", "denied");
        throw error;
      }
      expire();
      const policy = policies[input.tool];
      if (policy === "block") {
        record(input.tool, "blocked");
        return { status: "blocked", simulated: true };
      }
      if (policy === "allow") return execute(input.tool);
      if (pending.size >= 20) fail("Too many pending approvals");
      const id = randomUUID();
      const expiresAt = now() + 60000;
      pending.set(id, { tool: input.tool, expiresAt });
      record(input.tool, "awaiting-confirmation");
      return {
        status: "awaiting-confirmation",
        id,
        expiresAt,
        simulated: true,
        summary:
          "Create one fixture issue for Newton development; no external write",
      };
    },
    decide(input) {
      if (
        !input ||
        typeof input !== "object" ||
        Object.keys(input).some((k) => !["id", "approve"].includes(k)) ||
        typeof input.approve !== "boolean"
      )
        fail("Invalid decision");
      expire();
      const item = pending.get(input.id);
      if (!item) fail("Approval expired, unknown or already consumed");
      pending.delete(input.id);
      if (!input.approve) {
        record(item.tool, "cancelled");
        return { status: "cancelled", simulated: true };
      }
      return execute(item.tool);
    },
  };
}
