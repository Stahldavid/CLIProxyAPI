import test from "node:test";
import assert from "node:assert/strict";
import { createHomeAdapter, panelOrigin } from "../home.mjs";
import { createServer } from "../server.mjs";

test("Home reads only nodes and projects no identities, secrets or arbitrary strings", async () => {
  const calls = [];
  const adapter = createHomeAdapter({
    baseURL: "http://127.0.0.1:29327",
    token: "private-test-token",
    fetchImpl: async (url, opts) => {
      calls.push([url, opts]);
      return new Response(
        JSON.stringify({
          nodes: [
            {
              node_id: "private-id",
              ip: "private-ip",
              node_name: "<script>secret</script>",
              healthy: true,
              client_count: 2,
              AccessToken: "secret",
            },
            { healthy: "true", client_count: -1 },
          ],
          refresh_token: "secret",
        }),
      );
    },
  });
  const result = await adapter.snapshot();
  assert.equal(result.status, "connected");
  assert.deepEqual(result.nodes, [
    { label: "CPA 1", healthy: true, clients: 2 },
    { label: "CPA 2", healthy: null, clients: null },
  ]);
  assert.equal(calls[0][0], "http://127.0.0.1:29327/v8/management/nodes");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].redirect, "error");
  assert.doesNotMatch(JSON.stringify(result), /secret|private|script/);
});
test("Home invalid, unavailable, unauthorized and oversize responses fail closed", async () => {
  for (const response of [
    new Response("{}"),
    new Response("{"),
    new Response("private error", { status: 401 }),
    new Response("{}", { headers: { "content-length": "2000000" } }),
  ]) {
    const result = await createHomeAdapter({
      baseURL: "http://localhost:29327",
      token: "test",
      fetchImpl: async () => response,
    }).snapshot();
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.nodes, []);
    assert.doesNotMatch(JSON.stringify(result), /private error/);
  }
});
test("Native panels reject embedded credentials, query, fragments, paths and unsafe protocols", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://example.com",
    "https://a:secret@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
    "https://example.com/path",
  ])
    assert.throws(() => panelOrigin(value));
  assert.equal(panelOrigin("http://localhost:29327"), "http://localhost:29327");
  assert.equal(panelOrigin(null), null);
});
test("Home requires separate console authentication and cannot be combined with simulated lab", () => {
  const homeAdapter = {
    snapshot: async () => ({ status: "connected", nodes: [] }),
  };
  assert.throws(() => createServer({ homeAdapter }));
  assert.throws(() =>
    createServer({
      homeAdapter,
      consolePassword: "secret-password-test",
      homeToken: "secret-password-test",
    }),
  );
  assert.throws(() =>
    createServer({
      homeAdapter,
      integrationLab: {},
      consolePassword: "console-password-test",
    }),
  );
});

test("Home snapshot HTTP endpoint requires auth and preserves native links without a token", async () => {
  const server = createServer({
    homeAdapter: {
      snapshot: async () => ({
        status: "connected",
        nodes: [{ label: "CPA 1", healthy: true, clients: 1 }],
      }),
    },
    consolePassword: "separate-console-password",
    homeToken: "private-test-token",
    homePanelOrigin: "http://localhost:29327",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/snapshot`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from("gateway:separate-console-password").toString("base64")}`,
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "connected");
    assert.equal(body.home.nodes[0].healthy, true);
    assert.equal(body.panels.home, "http://localhost:29327");
    assert.doesNotMatch(
      JSON.stringify(body),
      /private-test-token|separate-console-password/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
