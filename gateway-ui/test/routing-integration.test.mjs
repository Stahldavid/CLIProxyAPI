import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "../server.mjs";
import { createRoutingManager } from "../routing.mjs";
test("authenticated HTTP routes drive real routing adapter against fake ETag upstream", async () => {
  let value = "round-robin",
    version = "a".repeat(64),
    writes = 0;
  const requests = [];
  const manager = createRoutingManager({
    enabled: true,
    baseURL: "http://127.0.0.1:9999",
    token: "synthetic-admin",
    fetchImpl: async (url, options) => {
      requests.push({ path: url.pathname, method: options.method });
      assert.equal(url.pathname, "/v8/management/config/routing/strategy");
      if (options.method === "PUT") {
        assert.equal(options.headers["If-Match"], `"${version}"`);
        writes++;
        value = JSON.parse(options.body);
        version = "b".repeat(64);
        return new Response('{"status":"ok"}');
      }
      return new Response(JSON.stringify(value), {
        headers: { ETag: `"${version}"` },
      });
    },
  });
  const server = createServer({
    routingManager: manager,
    consolePassword: "synthetic-console-password",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`,
    headers = {
      Authorization: `Basic ${Buffer.from("gateway:synthetic-console-password").toString("base64")}`,
      "Content-Type": "application/json",
      "X-Gateway-Action": "explicit-confirmation",
    };
  try {
    const read = await fetch(base + "/api/routing?kind=strategy", { headers });
    assert.deepEqual(await read.json(), { value: "round-robin" });
    const preview = await fetch(base + "/api/routing/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "strategy", value: "fill-first" }),
    });
    const plan = await preview.json();
    assert.equal(writes, 0);
    const result = await fetch(base + "/api/routing/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmationToken: plan.confirmationToken }),
    });
    assert.deepEqual(await result.json(), { status: "applied" });
    assert.equal(writes, 1);
    const replay = await fetch(base + "/api/routing/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmationToken: plan.confirmationToken }),
    });
    assert.equal(replay.status, 409);
    assert.equal(writes, 1);
    assert.equal(requests.length, 4);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
