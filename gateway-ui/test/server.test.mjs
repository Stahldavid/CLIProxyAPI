import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.mjs";
test("local console serves only allowlisted read-only resources with offline CSP", async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy"),
      /connect-src 'self'/,
    );
    assert.match(await response.text(), /Gateway/);
    for (const path of ["/config.yaml", "/api", "/.env", "/server.mjs"])
      assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    assert.equal(
      await new Promise((resolve) => {
        http.get(base, { headers: { host: "evil.test" } }, (r) => {
          r.resume();
          resolve(r.statusCode);
        });
      }),
      403,
    );
  } finally {
    await new Promise((r) => s.close(r));
  }
});
