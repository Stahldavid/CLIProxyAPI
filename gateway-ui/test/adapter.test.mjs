import test from "node:test";
import assert from "node:assert/strict";
import { createManagementAdapter } from "../adapter.mjs";
const options = { baseURL: "http://127.0.0.1:8317", token: "test-only-token" };
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
const healthy = (url) =>
  json(url.pathname.endsWith("/credentials") ? { files: [] } : { models: [] });

test("only fixed v8 read endpoints, server authorization, no redirects or cookie forwarding", async () => {
  const calls = [];
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return healthy(url);
    },
  }).snapshot();
  assert.equal(result.status, "connected");
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(([url]) => url.pathname),
    [
      "/v8/management/credentials",
      ...["codex", "claude", "gemini"].map(
        (x) => `/v8/management/routing/model-definitions/${x}`,
      ),
    ],
  );
  for (const [url, init] of calls) {
    assert.equal(url.origin, options.baseURL);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, `Bearer ${options.token}`);
  }
});
test("accounts do not expose names, emails, paths, tokens or source fields", async () => {
  const secret = "SECRET-DO-NOT-EXPOSE";
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async (url) =>
      url.pathname.endsWith("/credentials")
        ? json({
            files: [
              {
                id: secret,
                name: secret,
                email: secret,
                path: secret,
                source: secret,
                label: secret,
                status_message: secret,
                access_token: secret,
                provider: "codex",
                status: "active",
                disabled: false,
                quota: { secret },
              },
            ],
          })
        : healthy(url),
  }).snapshot();
  assert.deepEqual(result.accounts, [
    {
      label: "Account 1",
      provider: "codex",
      status: "active",
      disabled: false,
    },
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(options.token));
});
test("model response only projects bounded IDs and names, never trusts returned provider", async () => {
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async (url) =>
      url.pathname.endsWith("/credentials")
        ? healthy(url)
        : json({
            models: [
              {
                id: "test-model",
                name: "Test model",
                provider: "secret",
                api_key: "secret",
              },
              { id: "sk-secret", name: "Bad" },
              { id: "<script>" },
            ],
          }),
  }).snapshot();
  assert.deepEqual(result.models[0], {
    id: "test-model",
    name: "Test model",
    provider: "codex",
  });
  assert.equal(result.models.length, 3);
});
test("partial response preserves successful independent reads and masks raw error contents", async () => {
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async (url) => {
      if (url.pathname.endsWith("/credentials"))
        return new Response("secret auth failure", { status: 401 });
      if (url.pathname.endsWith("/claude"))
        throw new Error("secret token and URL");
      return healthy(url);
    },
  }).snapshot();
  assert.equal(result.status, "partial");
  assert.equal(result.diagnostics[0].code, "http-401");
  assert.equal(result.diagnostics[2].code, "transport-error");
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("disconnected transport never throws secret diagnostics", async () => {
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async () => {
      throw new Error(options.token);
    },
  }).snapshot();
  assert.equal(result.status, "disconnected");
  assert.ok(!JSON.stringify(result).includes(options.token));
});
test("rejects malformed schemas and bodies", async () => {
  for (const response of [
    () => json({}),
    () => json({ files: [null], models: [null] }),
    () => new Response("not json"),
  ]) {
    const result = await createManagementAdapter({
      ...options,
      fetchImpl: async () => response(),
    }).snapshot();
    assert.equal(result.status, "disconnected");
    assert.ok(result.diagnostics.every((d) => d.code === "invalid-response"));
  }
});
test("rejects oversized declared and streamed bodies", async () => {
  for (const response of [
    () => new Response("{}", { headers: { "content-length": "1048577" } }),
    () => new Response("x".repeat(1048577)),
  ]) {
    const result = await createManagementAdapter({
      ...options,
      fetchImpl: async () => response(),
    }).snapshot();
    assert.ok(result.diagnostics.every((d) => d.code === "response-too-large"));
  }
});
test("redirected fake response rejected even if injected transport ignores redirect error", async () => {
  const result = await createManagementAdapter({
    ...options,
    fetchImpl: async () => ({ status: 200, redirected: true }),
  }).snapshot();
  assert.ok(result.diagnostics.every((d) => d.code === "redirect-rejected"));
});
test("validates URL, no credential URLs, remote plaintext or arbitrary path", () => {
  for (const baseURL of [
    "not a URL",
    "https://user:pass@example.com",
    "http://example.com",
    "https://example.com?x=1",
    "https://example.com/#x",
    "https://example.com/v8",
    "file:///tmp/x",
    "http://localhost.evil.test",
  ])
    assert.throws(
      () => createManagementAdapter({ ...options, baseURL }),
      TypeError,
    );
  for (const baseURL of [
    "https://example.com",
    "http://localhost:8317",
    "http://[::1]:8317",
  ])
    assert.doesNotThrow(() => createManagementAdapter({ ...options, baseURL }));
});
test("token required and no header injection", () => {
  for (const token of [
    undefined,
    "",
    " ",
    "abc\r\nX-Test:bad",
    "x".repeat(4097),
  ])
    assert.throws(
      () => createManagementAdapter({ ...options, token }),
      TypeError,
    );
});
