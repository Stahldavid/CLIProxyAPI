const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4173");
    await page.screenshot({ path: "gateway-overview.png", fullPage: true });
    for (const id of [
      "accounts",
      "models",
      "routes",
      "clients",
      "activity",
      "security",
      "settings",
      "overview",
    ]) {
      await page.locator(`nav a[href="#${id}"]`).click();
      assert.equal(await page.locator("nav [aria-current=page]").count(), 1);
      assert.ok((await page.locator("#content").innerText()).length > 40);
    }
    await page.locator('nav a[href="#routes"]').click();
    await page.locator("#route").selectOption("1");
    await page.getByText("Simular atribuição", { exact: true }).click();
    assert.match(await page.locator("#simulation").innerText(), /Codex|codex/);
    await page.locator('nav a[href="#activity"]').click();
    await page
      .getByRole("button", { name: "Detalhes", exact: true })
      .first()
      .click();
    assert.equal(await page.locator("dialog").evaluate((d) => d.open), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog").evaluate((d) => d.open), false);
    await page
      .getByRole("button", { name: "Detalhes", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Fechar detalhes" }).click();
    await page.locator("#search").fill("no such record");
    assert.match(await page.locator("#rows").innerText(), /Nenhum registro/);
    await page
      .locator("#file")
      .setInputFiles({
        name: "safe.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            records: [
              {
                id: "test",
                client_label: "Claude Code",
                provider: "codex",
                model: "<img src=x onerror=alert(1)>",
                api_key: "SECRET-DO-NOT-RENDER",
                failed: false,
              },
            ],
          }),
        ),
      });
    assert.equal(await page.locator("#mode").innerText(), "Snapshot importado");
    assert.ok(
      !(await page.locator("body").innerText()).includes(
        "SECRET-DO-NOT-RENDER",
      ),
    );
    assert.equal(await page.locator("#rows img").count(), 0);
    await page
      .locator("#file")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from("{bad"),
      });
    assert.match(await page.locator("#notice").innerText(), /recusada/);
    await page.locator('nav a[href="#settings"]').click();
    await page.getByText("Limpar sessão", { exact: true }).click();
    await page.locator('nav a[href="#overview"]').click();
    assert.match(await page.locator("#mode").innerText(), /vazia/);
    await page.locator('nav a[href="#settings"]').click();
    await page.getByText("Restaurar demonstração", { exact: true }).click();
    await page.locator('nav a[href="#overview"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "gateway-mobile.png", fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Browser QA passed: 8 pages, navigation, simulation, dialogs, filters, safe import, invalid import, reset, mobile, no JS errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
