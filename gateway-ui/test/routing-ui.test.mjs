import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountRouting } from "../src/routing-ui.mjs";
test("routing UI loads previews exact before/after and explicitly confirms", async () => {
  const dom = new JSDOM("<main></main>"),
    root = dom.window.document.querySelector("main");
  const calls = [];
  mountRouting(root, async (path, options = {}) => {
    calls.push({ path, options });
    return new Response(
      JSON.stringify(
        path.endsWith("/preview")
          ? {
              confirmationToken: "test",
              before: "round-robin",
              after: "fill-first",
            }
          : path.endsWith("/confirm")
            ? { status: "applied" }
            : { value: "round-robin" },
      ),
    );
  });
  assert.equal(calls.length, 0);
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Carregar configuração")
    .onclick();
  root.querySelector('[aria-label="Novo valor"]').value = "fill-first";
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Revisar alteração")
    .onclick();
  assert.match(root.textContent, /round-robin/);
  assert.match(root.textContent, /fill-first/);
  assert.equal(calls.length, 2);
  assert.equal(
    Object.hasOwn(JSON.parse(calls[1].options.body), "channel"),
    false,
  );
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Confirmar roteamento")
    .onclick();
  assert.equal(calls.length, 3);
  assert.match(root.textContent, /gravada e verificada/);
  dom.window.close();
});
test("aliases editor preserves optional properties in preview and can cancel", async () => {
  const dom = new JSDOM("<main></main>"),
    root = dom.window.document.querySelector("main");
  const original = [
    { name: "gpt-test", alias: "smart", fork: true, "display-name": "Test" },
  ];
  const calls = [];
  mountRouting(root, async (path, options = {}) => {
    calls.push({ path, options });
    return new Response(
      JSON.stringify(
        path.endsWith("/preview")
          ? { confirmationToken: "test", before: original, after: original }
          : { value: original },
      ),
    );
  });
  root.querySelector('[aria-label="Tipo de configuração"]').value = "aliases";
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Carregar configuração")
    .onclick();
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Revisar alteração")
    .onclick();
  assert.deepEqual(JSON.parse(calls[1].options.body).value, original);
  [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Cancelar")
    .onclick();
  assert.equal(calls.length, 2);
  assert.match(root.textContent, /Cancelado/);
  dom.window.close();
});

test("in-flight confirmation locks panel controls and reports outcome globally", async () => {
  const dom = new JSDOM('<p id="notice"></p><main></main>'),
    root = dom.window.document.querySelector("main");
  let finish;
  mountRouting(root, async (path) =>
    path.endsWith("/confirm")
      ? new Promise((resolve) => (finish = resolve))
      : new Response(
          JSON.stringify(
            path.endsWith("/preview")
              ? {
                  confirmationToken: "test",
                  before: "round-robin",
                  after: "fill-first",
                }
              : { value: "round-robin" },
          ),
        ),
  );
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Carregar configuração")
    .onclick();
  root.querySelector('[aria-label="Novo valor"]').value = "fill-first";
  await [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Revisar alteração")
    .onclick();
  const pending = [...root.querySelectorAll("button")]
    .find((b) => b.textContent === "Confirmar roteamento")
    .onclick();
  assert.ok(root.querySelector('[aria-label="Tipo de configuração"]').disabled);
  assert.ok(root.querySelector('[aria-label="Canal OAuth"]').disabled);
  root.replaceChildren();
  finish(new Response(JSON.stringify({ status: "applied" })));
  await pending;
  assert.match(
    dom.window.document.querySelector("#notice").textContent,
    /gravada e verificada/,
  );
  dom.window.close();
});
