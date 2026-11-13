import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountAccountManagement } from "../src/management-ui.mjs";
test("status UI does not write until explicit preview and confirmation", async () => {
  const dom = new JSDOM("<main></main>");
  const root = dom.window.document.querySelector("main");
  const calls = [];
  mountAccountManagement(root, async (path, options = {}) => {
    calls.push({ path, options });
    return new Response(
      JSON.stringify(
        path.endsWith("/preview")
          ? { label: "Account 1", disabled: true, confirmationToken: "test" }
          : path.endsWith("/confirm")
            ? { status: "applied" }
            : {
                accounts: [
                  {
                    id: "opaque",
                    label: "Account 1",
                    provider: "codex",
                    disabled: false,
                  },
                ],
              },
      ),
    );
  });
  assert.equal(calls.length, 0);
  await root.querySelector("button").onclick();
  assert.equal(calls.length, 1);
  await [...root.querySelectorAll("button")]
    .find((x) => x.textContent === "Preparar desabilitação")
    .onclick();
  assert.equal(calls.length, 2);
  await [...root.querySelectorAll("button")]
    .find((x) => x.textContent === "Confirmar alteração")
    .onclick();
  assert.equal(calls.length, 3);
  assert.match(root.textContent, /aplicada e verificada/);
  assert.equal(
    calls[2].options.headers["X-Gateway-Action"],
    "explicit-confirmation",
  );
  dom.window.close();
});
test("cancelled plan never executes and disabled capability is explicit", async () => {
  const dom = new JSDOM("<main></main>");
  const root = dom.window.document.querySelector("main");
  mountAccountManagement(root, async () => new Response("{}", { status: 404 }));
  await root.querySelector("button").onclick();
  assert.match(root.textContent, /Gerenciamento desativado/);
  dom.window.close();
});

test("cancel after preview sends no mutation", async () => {
  const dom = new JSDOM("<main></main>");
  const root = dom.window.document.querySelector("main");
  const paths = [];
  mountAccountManagement(root, async (path) => {
    paths.push(path);
    return new Response(
      JSON.stringify(
        path.endsWith("/preview")
          ? { confirmationToken: "fake", label: "Account abc", disabled: true }
          : {
              accounts: [
                {
                  id: "abc",
                  label: "Account abc",
                  provider: "codex",
                  disabled: false,
                },
              ],
            },
      ),
    );
  });
  await root.querySelector("button").onclick();
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Preparar desabilitação")
    .onclick();
  [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Cancelar")
    .onclick();
  assert.equal(paths.length, 2);
  assert.ok(!paths.some((p) => p.endsWith("/confirm")));
  assert.match(root.textContent, /Cancelado/);
  dom.window.close();
});

test("account confirmation locks sibling actions and reports labeled outcome", async () => {
  const dom = new JSDOM('<p id="operation-notice"></p><main></main>'),
    root = dom.window.document.querySelector("main");
  let finish,
    writes = 0;
  mountAccountManagement(root, async (path, options) =>
    path.endsWith("/confirm")
      ? (writes++, new Promise((resolve) => (finish = resolve)))
      : new Response(
          JSON.stringify(
            path.endsWith("/preview")
              ? {
                  confirmationToken: "test",
                  label: "Account A",
                  disabled: true,
                }
              : {
                  accounts: [
                    {
                      id: "a",
                      label: "Account A",
                      provider: "codex",
                      disabled: false,
                    },
                    {
                      id: "b",
                      label: "Account B",
                      provider: "codex",
                      disabled: false,
                    },
                  ],
                },
          ),
        ),
  );
  await root.querySelector("button").onclick();
  const previews = [...root.querySelectorAll("button")].filter(
    (b) => b.textContent === "Preparar desabilitação",
  );
  assert.match(previews[0].getAttribute("aria-label"), /Account A/);
  await previews[0].onclick();
  const pending = [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Confirmar alteração")
    .onclick();
  assert.equal(previews[1].disabled, true);
  await previews[1].onclick();
  assert.equal(writes, 1);
  finish(new Response(JSON.stringify({ status: "applied" })));
  await pending;
  assert.equal(previews[1].disabled, false);
  assert.match(
    dom.window.document.querySelector("#operation-notice").textContent,
    /Account A.*aplicada/,
  );
  dom.window.close();
});
