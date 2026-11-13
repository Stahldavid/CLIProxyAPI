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
