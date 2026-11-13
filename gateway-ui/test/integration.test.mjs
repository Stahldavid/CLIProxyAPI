import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.mjs";
import { createManagementAdapter } from "../adapter.mjs";

async function withServer(options, check) {
  const server = createServer({
    ...options,
    consolePassword: "mock-console-password-only",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sidecar projects fake management and file telemetry without exposing credentials", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gateway-fixture-"));
  try {
    const snapshotPath = join(folder, "snapshot.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({
        records: [
          {
            api_key: "PRIVATE_KEY_SENTINEL",
            source: "PRIVATE_EMAIL_SENTINEL",
            client_ip: "PRIVATE_IP_SENTINEL",
            user_agent: "claude-cli/2",
            alias: "sonnet",
            model: "mock-codex",
            provider: "codex",
            failed: false,
            tokens: { total_tokens: 0 },
          },
        ],
      }),
    );
    const seen = [];
    const adapter = createManagementAdapter({
      baseURL: "http://127.0.0.1:8317",
      token: "PRIVATE_TOKEN_SENTINEL",
      fetchImpl: async (url) => {
        seen.push(url.pathname);
        return new Response(
          JSON.stringify(
            url.pathname.endsWith("/credentials")
              ? {
                  files: [
                    {
                      name: "PRIVATE_NAME_SENTINEL",
                      email: "PRIVATE_EMAIL_SENTINEL",
                      provider: "codex",
                      status: "active",
                    },
                  ],
                }
              : {
                  models: [
                    {
                      id: "mock-model",
                      name: "Mock model",
                      api_key: "PRIVATE_KEY_SENTINEL",
                    },
                  ],
                },
          ),
        );
      },
    });
    await withServer({ adapter, snapshotPath }, async (base) => {
      const response = await fetch(base + "/api/snapshot", {
        headers: {
          Authorization: `Basic ${Buffer.from("gateway:mock-console-password-only").toString("base64")}`,
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const text = await response.text();
      assert.ok(!text.includes("PRIVATE_"));
      const body = JSON.parse(text);
      assert.equal(body.mode, "connected");
      assert.equal(body.telemetryStatus, "loaded");
      assert.equal(body.management.status, "connected");
      assert.equal(body.records[0].client, "Claude Code");
      assert.equal(body.records[0].provider, "codex");
      assert.equal(body.records[0].tokens.total, 0);
      assert.equal(body.records[0].cost, null);
      assert.equal(body.management.accounts[0].disabled, null);
      assert.equal(seen.length, 4);
      assert.ok(seen.every((path) => !path.includes("queue")));
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("missing telemetry file retains independent management result and explicit gap", async () => {
  const adapter = {
    snapshot: async () => ({
      status: "partial",
      accounts: [],
      models: [{ id: "mock-model", name: "Mock", provider: "codex" }],
      diagnostics: [
        {
          endpoint: "/v8/management/credentials",
          status: "unavailable",
          code: "http-401",
        },
      ],
    }),
  };
  await withServer(
    { adapter, snapshotPath: "/unavailable/gateway-fixture.json" },
    async (base) => {
      const body = await (
        await fetch(base + "/api/snapshot", {
          headers: {
            Authorization: `Basic ${Buffer.from("gateway:mock-console-password-only").toString("base64")}`,
          },
        })
      ).json();
      assert.equal(body.telemetryStatus, "unavailable");
      assert.deepEqual(body.records, []);
      assert.equal(body.management.models[0].id, "mock-model");
    },
  );
});

test("offline default makes zero management calls and advertises no configured source", async () => {
  await withServer({}, async (base) => {
    const body = await (
      await fetch(base + "/api/snapshot", {
        headers: {
          Authorization: `Basic ${Buffer.from("gateway:mock-console-password-only").toString("base64")}`,
        },
      })
    ).json();
    assert.equal(body.mode, "demo");
    assert.equal(body.management.status, "not-configured");
    assert.equal(body.telemetryStatus, "not-configured");
    assert.deepEqual(body.records, []);
  });
});

test("adapter exception returns generic server error without exception text", async () => {
  await withServer(
    {
      adapter: {
        snapshot: async () => {
          throw new Error("PRIVATE_ERROR_SENTINEL");
        },
      },
    },
    async (base) => {
      const response = await fetch(base + "/api/snapshot", {
        headers: {
          Authorization: `Basic ${Buffer.from("gateway:mock-console-password-only").toString("base64")}`,
        },
      });
      assert.equal(response.status, 502);
      assert.ok(!(await response.text()).includes("PRIVATE_ERROR_SENTINEL"));
    },
  );
});
