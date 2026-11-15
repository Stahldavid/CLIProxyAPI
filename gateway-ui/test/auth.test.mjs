import http from "node:http";
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

// Native http preserves the explicit Host header for reverse-proxy regression tests.
function wireRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("private origin opt-in is exact and requires console authentication", () => {
  for (const privateOrigin of [
    "https://evil.example",
    "https://workspace-01.tail61573a.ts.net",
    "https://workspace-01.tail61573a.ts.net:10005",
    "http://workspace-01.tail61573a.ts.net:10006",
  ])
    assert.throws(
      () => createServer({ privateOrigin, consolePassword: password }),
      /approved/,
    );
  assert.throws(
    () =>
      createServer({
        privateOrigin: "https://workspace-01.tail61573a.ts.net:10006",
      }),
    /requires/,
  );
});

test("private Host accepts only approved host and port, authenticates and enforces HTTPS same-origin", async () => {
  const privateOrigin = "https://workspace-01.tail61573a.ts.net:10006";
  const privateHost = "workspace-01.tail61573a.ts.net:10006";
  const server = createServer({ privateOrigin, consolePassword: password });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/snapshot`;
  try {
    const request = (extra) =>
      wireRequest(url, {
        headers: { Host: privateHost, authorization, ...extra },
      });
    assert.equal(
      (await wireRequest(url, { headers: { Host: privateHost } })).status,
      401,
    );
    assert.equal(
      (
        await request({
          Origin: privateOrigin,
          "Sec-Fetch-Site": "same-origin",
        })
      ).status,
      200,
    );
    for (const extra of [
      { Host: "workspace-01.tail61573a.ts.net" },
      { Host: "workspace-01.tail61573a.ts.net:443" },
      { Host: "workspace-01.tail61573a.ts.net:10005" },
      { Host: "evil.workspace-01.tail61573a.ts.net:10006" },
      { Host: "workspace-01.tail61573a.ts.net.evil.example:10006" },
      { Origin: "http://" + privateHost },
      { Origin: "https://workspace-01.tail61573a.ts.net:10005" },
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      {
        Host: "evil.example",
        "X-Forwarded-Host": privateHost,
        "X-Forwarded-Proto": "https",
      },
      {
        Origin: "https://evil.example",
        "X-Forwarded-Host": privateHost,
        "X-Forwarded-Proto": "https",
      },
    ])
      assert.equal((await request(extra)).status, 403, JSON.stringify(extra));
    assert.equal(
      (
        await wireRequest(url, {
          headers: { authorization, Origin: new URL(url).origin },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("private host remains denied when private origin is not explicitly configured", async () => {
  const server = createServer({ consolePassword: password });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await wireRequest(
      `http://127.0.0.1:${server.address().port}/`,
      {
        headers: {
          Host: "workspace-01.tail61573a.ts.net:10006",
          authorization,
        },
      },
    );
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approved private origin permits only user-initiated GET entry document from another site", async () => {
  let calls = 0;
  const server = createServer({
    privateOrigin: "https://workspace-01.tail61573a.ts.net:10006",
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
  const navigation = {
    Host: "workspace-01.tail61573a.ts.net:10006",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-User": "?1",
  };
  try {
    assert.equal(
      (await wireRequest(base + "/", { headers: navigation })).status,
      401,
    );
    assert.equal(
      (
        await wireRequest(base + "/", {
          headers: { ...navigation, authorization },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await wireRequest(base + "/index.html", {
          headers: { ...navigation, authorization },
        })
      ).status,
      200,
    );
    assert.equal(calls, 0);
    for (const [path, method, extra] of [
      ["/api/snapshot", "GET", {}],
      ["/api/status", "POST", {}],
      ["/", "POST", {}],
      ["/", "HEAD", {}],
      ["/?query=1", "GET", {}],
      ["/lab.html", "GET", {}],
      ["/style.css", "GET", {}],
      ["/", "GET", { "Sec-Fetch-Dest": "iframe" }],
      ["/", "GET", { "Sec-Fetch-Mode": "cors" }],
      ["/", "GET", { "Sec-Fetch-User": "?0" }],
      ["/", "GET", { Origin: "https://chatgpt.com" }],
      ["/", "GET", { Origin: "null" }],
      ["/", "GET", { Host: "evil.example" }],
    ])
      assert.equal(
        (
          await wireRequest(base + path, {
            method,
            headers: { ...navigation, authorization, ...extra },
          })
        ).status,
        403,
        JSON.stringify([path, method, extra]),
      );
    assert.equal(calls, 0);
    assert.equal(
      (
        await wireRequest(base + "/api/snapshot", {
          headers: {
            Host: navigation.Host,
            authorization,
            Origin: "https://workspace-01.tail61573a.ts.net:10006",
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
