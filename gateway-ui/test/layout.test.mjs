import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("architecture narrow-screen override stacks nodes with downward connectors", async () => {
  const css = await readFile(
    new URL("../src/style.css", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<style>${css}</style>`);
  const media = [...dom.window.document.styleSheets[0].cssRules]
    .filter((rule) => rule.conditionText === "(max-width: 720px)")
    .at(-1);
  assert.ok(media);
  const rule = (selector) =>
    [...media.cssRules].find((r) => r.selectorText === selector).style;
  assert.equal(
    rule(".architecture").getPropertyValue("flex-direction"),
    "column",
  );
  assert.equal(rule(".architecture").getPropertyValue("flex-wrap"), "nowrap");
  assert.equal(rule(".architecture > span").getPropertyValue("width"), "100%");
  assert.equal(
    rule(".architecture > b").getPropertyValue("transform"),
    "rotate(90deg)",
  );
  assert.equal(
    rule(".architecture > b").getPropertyValue("align-self"),
    "center",
  );
  dom.window.close();
});
