import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "../server.mjs";
test("management routes require local auth, explicit JSON action, and bounded body", async () => {
  let writes = 0;
  const manager = {
    list: async () => ({ accounts: [] }),
    preview: async () => ({ confirmationToken: "test" }),
    execute: async () => {
      writes++;
      return { status: "applied" };
    },
  };
  const server = createServer({
    statusManager: manager,
    consolePassword: "synthetic-password-long",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: `Basic ${Buffer.from("gateway:synthetic-password-long").toString("base64")}`,
    "Content-Type": "application/json",
    "X-Gateway-Action": "explicit-confirmation",
  };
  try {
    assert.equal((await fetch(base + "/api/account-status")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/account-status/confirm", {
          method: "POST",
          headers: { ...headers, "X-Gateway-Action": "wrong" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/account-status/confirm", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/account-status/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ value: "x".repeat(2100) }),
        })
      ).status,
      409,
    );
    assert.equal(writes, 0);
    assert.equal(
      (
        await fetch(base + "/api/account-status/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ confirmationToken: "test" }),
        })
      ).status,
      200,
    );
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("malformed request targets return 400 without terminating server", async () => {
  const { request } = await import("node:http");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    const status = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "//[%",
          headers: { Host: `127.0.0.1:${port}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
