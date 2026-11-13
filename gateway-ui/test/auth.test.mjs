import test from "node:test";
import assert from "node:assert/strict";
import { createConsoleAuth } from "../auth.mjs";
import { createServer } from "../server.mjs";

const password = "fake-console-password-for-tests";
const authorization = `Basic ${Buffer.from(`gateway:${password}`).toString("base64")}`;

test("connected console fails closed, rejects shared credentials and weak passwords", () => {
  assert.throws(() => createServer({ adapter: {} }), /requires/);
  assert.throws(() => createServer({ snapshotPath: "/fixture" }), /requires/);
  assert.throws(() => createConsoleAuth({ password: "short" }), /requires/);
  assert.throws(
    () => createConsoleAuth({ password, managementToken: password }),
    /different/,
  );
  assert.doesNotThrow(() => createServer());
});

test("Basic authentication validates exact username, password and canonical encoding", () => {
  const check = createConsoleAuth({ password });
  assert.equal(check({ headers: { authorization } }), true);
  for (const value of [
    undefined,
    "Bearer secret",
    "Basic !!!!",
    "Basic Z2F0ZXdheTo=",
    `Basic ${Buffer.from(`other:${password}`).toString("base64")}`,
    `${authorization}junk`,
  ]) {
    assert.equal(check({ headers: { authorization: value } }), false);
  }
});

test("protected server challenges before source access and rejects cross-origin access", async () => {
  let calls = 0;
  const server = createServer({
    consolePassword: password,
    adapter: {
      snapshot: async () => {
        calls++;
        return { status: "connected" };
      },
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauth = await fetch(base + "/api/snapshot");
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), /^Basic/);
    assert.equal(calls, 0);
    for (const extra of [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
    ]) {
      assert.equal(
        (
          await fetch(base + "/api/snapshot", {
            headers: { authorization, ...extra },
          })
        ).status,
        403,
      );
    }
    assert.equal(calls, 0);
    const response = await fetch(base + "/api/snapshot", {
      headers: { authorization, Origin: base },
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.ok(!(await response.text()).includes(password));
    assert.equal(
      (await fetch(base + "/auth.mjs", { headers: { authorization } })).status,
      404,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("UTF-8 password byte limit prevents valid setup producing an unusable Basic header", () => {
  assert.throws(
    () => createConsoleAuth({ password: "漢".repeat(1024) }),
    /1024 UTF-8 bytes/,
  );
  const password = "漢".repeat(300);
  const check = createConsoleAuth({ password });
  const authorization = `Basic ${Buffer.from(`gateway:${password}`).toString("base64")}`;
  assert.ok(authorization.length <= 2048);
  assert.equal(check({ headers: { authorization } }), true);
});
