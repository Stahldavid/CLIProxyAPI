/** Deliberate two-step account status changes; no automatic write or retry. */
export function mountAccountManagement(root, fetchImpl = globalThis.fetch) {
  const document = root.ownerDocument;
  const panel = document.createElement("section");
  panel.className = "panel";
  const title = document.createElement("h2");
  title.textContent = "Estado das contas · operação opcional";
  panel.append(title);
  const note = document.createElement("p");
  note.textContent =
    "Habilitação e desabilitação afetam o roteamento do proxy. Não alteram assinatura nem cotas.";
  panel.append(note);
  const list = document.createElement("div");
  panel.append(list);
  const refresh = document.createElement("button");
  refresh.textContent = "Consultar controles disponíveis";
  panel.append(refresh);
  root.append(panel);
  const message = (text) => {
    list.replaceChildren();
    const p = document.createElement("p");
    p.textContent = text;
    list.append(p);
  };
  const post = async (path, body) => {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Action": "explicit-confirmation",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Action unavailable");
    return response.json();
  };
  refresh.onclick = async () => {
    refresh.disabled = true;
    message("Consultando…");
    try {
      const response = await fetchImpl("/api/account-status");
      if (response.status === 404) {
        message(
          "Gerenciamento desativado no servidor. Nenhuma mudança pode ser enviada.",
        );
        return;
      }
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (!Array.isArray(data.accounts)) throw new Error("Invalid");
      list.replaceChildren();
      for (const account of data.accounts) {
        const row = document.createElement("div");
        row.className = "settings-row split";
        const text = document.createElement("span");
        text.textContent = `${account.label} · ${account.provider} · ${account.disabled ? "desabilitada" : "habilitada"}`;
        const preview = document.createElement("button");
        preview.textContent = account.disabled
          ? "Preparar habilitação"
          : "Preparar desabilitação";
        row.append(text, preview);
        list.append(row);
        preview.onclick = async () => {
          preview.disabled = true;
          try {
            const plan = await post("/api/account-status/preview", {
              id: account.id,
              disabled: !account.disabled,
            });
            row.replaceChildren();
            const warning = document.createElement("p");
            warning.textContent = `Confirmar ${plan.disabled ? "desabilitação" : "habilitação"} de ${plan.label}? Isso altera quais contas o proxy pode usar. Confirmação expira em 60 segundos.`;
            const confirm = document.createElement("button");
            confirm.textContent = "Confirmar alteração";
            const cancel = document.createElement("button");
            cancel.textContent = "Cancelar";
            cancel.onclick = () => {
              row.replaceChildren();
              row.textContent = "Cancelado. Nenhuma alteração enviada.";
            };
            confirm.onclick = async () => {
              confirm.disabled = true;
              cancel.disabled = true;
              try {
                const result = await post("/api/account-status/confirm", {
                  confirmationToken: plan.confirmationToken,
                });
                row.replaceChildren();
                row.textContent =
                  result.status === "applied"
                    ? "Alteração aplicada e verificada."
                    : "Resultado não comprovado. Consulte o estado; não repita automaticamente.";
              } catch {
                row.replaceChildren();
                row.textContent =
                  "Resultado não comprovado. Consulte o estado antes de decidir nova tentativa.";
              }
            };
            row.append(warning, confirm, cancel);
          } catch {
            preview.disabled = false;
            text.textContent =
              "Não foi possível preparar. Consulte novamente; nenhuma confirmação foi enviada.";
          }
        };
      }
      if (!data.accounts.length)
        message("Nenhuma conta gerenciável disponível.");
    } catch {
      message("Controles indisponíveis. Nenhuma alteração enviada.");
    } finally {
      refresh.disabled = false;
    }
  };
  return panel;
}
