const status = document.querySelector("#status");
const approval = document.querySelector("#approval");
let pending = null;
let busy = false;
async function api(path = "", body) {
  const response = await fetch(
    `/api/lab${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function refresh() {
  const data = await api();
  const list = document.querySelector("#events");
  list.replaceChildren();
  for (const event of data.events) {
    const item = document.createElement("li");
    item.textContent = `${event.tool} · ${event.status} · ${event.scope}`;
    list.append(item);
  }
  if (!data.events.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhuma operação simulada ainda.";
    list.append(item);
  }
}
async function action(path, body) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const result = await api(path, body);
    status.textContent = JSON.stringify(result, null, 2);
    if (path === "/decide") pending = null;
    if (result.status === "awaiting-confirmation") pending = result.id;
    approval.hidden = !pending;
    await refresh();
  } catch (error) {
    status.textContent = `Operação recusada: ${error.message}`;
    if (path === "/decide") {
      pending = null;
      approval.hidden = true;
    }
  } finally {
    busy = false;
    for (const b of document.querySelectorAll("button")) b.disabled = false;
  }
}
for (const button of document.querySelectorAll("[data-tool]"))
  button.addEventListener("click", () => {
    if (pending) {
      status.textContent =
        "Conclua ou cancele a confirmação pendente primeiro.";
      return;
    }
    action("/request", {
      tool: button.dataset.tool,
      project: "newton",
      environment: "development",
    });
  });
document.querySelector("#deny").addEventListener("click", () =>
  action("/request", {
    tool: "docs.search",
    project: "newton",
    environment: "production",
  }),
);
document
  .querySelector("#confirm")
  .addEventListener("click", () =>
    action("/decide", { id: pending, approve: true }),
  );
document
  .querySelector("#cancel")
  .addEventListener("click", () =>
    action("/decide", { id: pending, approve: false }),
  );
refresh()
  .then(() => {
    status.textContent = "Pronto. Selecione um fluxo fictício.";
  })
  .catch(() => {
    status.textContent =
      "Laboratório desativado. Inicie a console em modo isolado com GATEWAY_INTEGRATION_LAB=mock. Nenhuma API real será conectada.";
    for (const b of document.querySelectorAll("button")) b.disabled = true;
  });
