/** Guarded config subpath editor: preview and confirmation, never implicit writes. */
export function mountRouting(root, fetchImpl = globalThis.fetch) {
  const d = root.ownerDocument,
    panel = d.createElement("section");
  panel.className = "panel";
  const make = (tag, text) => {
    const e = d.createElement(tag);
    if (text) e.textContent = text;
    return e;
  };
  panel.append(
    make("h2", "Configuração de roteamento · opcional"),
    make(
      "p",
      "Estratégia global ou aliases OAuth já existentes. Não comprova disponibilidade de modelo nem altera cobrança. O editor envia apenas o subcampo selecionado. O upstream pode normalizar o YAML ao salvar.",
    ),
  );
  const kind = make("select");
  kind.setAttribute("aria-label", "Tipo de configuração");
  for (const [value, label] of [
    ["strategy", "Estratégia"],
    ["aliases", "Aliases OAuth"],
  ]) {
    const o = make("option", label);
    o.value = value;
    kind.append(o);
  }
  const channel = make("select");
  channel.setAttribute("aria-label", "Canal OAuth");
  for (const value of [
    "codex",
    "claude",
    "aistudio",
    "vertex",
    "antigravity",
    "kimi",
    "xai",
    "meta",
  ]) {
    const o = make("option", value);
    o.value = value;
    channel.append(o);
  }
  const load = make("button", "Carregar configuração");
  const area = make("div");
  panel.append(kind, channel, load, area);
  root.append(panel);
  let revision = 0;
  const clear = () => {
    revision++;
    area.replaceChildren();
  };
  kind.onchange = clear;
  channel.onchange = clear;
  const post = async (path, body) => {
    const r = await fetchImpl(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Action": "explicit-confirmation",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("Unavailable");
    return r.json();
  };
  load.onclick = async () => {
    const current = ++revision,
      k = kind.value,
      c = channel.value;
    load.disabled = true;
    area.textContent = "Consultando…";
    try {
      const r = await fetchImpl(
        `/api/routing?kind=${encodeURIComponent(k)}${k === "aliases" ? `&channel=${encodeURIComponent(c)}` : ""}`,
      );
      if (current !== revision) return;
      if (r.status === 404) {
        area.textContent = "Edição desativada no servidor.";
        return;
      }
      if (!r.ok) throw new Error("Unavailable");
      const data = await r.json();
      if (current !== revision) return;
      area.replaceChildren();
      let input;
      if (k === "strategy") {
        input = make("select");
        for (const v of ["round-robin", "weighted-round-robin", "fill-first"]) {
          const o = make("option", v);
          o.value = v;
          input.append(o);
        }
        input.value = data.value;
      } else {
        input = make("textarea");
        input.rows = 12;
        input.style.width = "100%";
        input.value = JSON.stringify(data.value, null, 2);
        area.append(
          make(
            "p",
            "Editor avançado: preserve campos opcionais existentes. A lista inteira deste canal será substituída. Aliases iguais entre provedores podem ser ambíguos; aliases por credencial podem ter prioridade.",
          ),
        );
      }
      input.setAttribute("aria-label", "Novo valor");
      const preview = make("button", "Revisar alteração");
      area.append(input, preview);
      preview.onclick = async () => {
        preview.disabled = true;
        try {
          const value =
            k === "strategy" ? input.value : JSON.parse(input.value);
          const plan = await post("/api/routing/preview", {
            kind: k,
            ...(k === "aliases" ? { channel: c } : {}),
            value,
          });
          if (current !== revision) return;
          area.replaceChildren();
          area.append(
            make("h3", "Antes"),
            make("pre", JSON.stringify(plan.before, null, 2)),
            make("h3", "Depois"),
            make("pre", JSON.stringify(plan.after, null, 2)),
            make(
              "p",
              "A gravação exige a mesma versão de configuração lida. Expira em 60 segundos. Altera o roteamento real quando confirmado.",
            ),
          );
          const confirm = make("button", "Confirmar roteamento"),
            cancel = make("button", "Cancelar");
          area.append(confirm, cancel);
          cancel.onclick = () => {
            revision++;
            area.textContent = "Cancelado. Nenhuma gravação enviada.";
          };
          confirm.onclick = async () => {
            confirm.disabled = true;
            cancel.disabled = true;
            kind.disabled = channel.disabled = load.disabled = true;
            const announce = (text) => {
              const notice =
                d.querySelector("#operation-notice") ||
                d.querySelector("#notice");
              if (notice) notice.textContent = text;
            };
            announce(
              "Alteração de roteamento em andamento; aguarde o resultado.",
            );
            try {
              const result = await post("/api/routing/confirm", {
                confirmationToken: plan.confirmationToken,
              });
              area.textContent =
                result.status === "applied"
                  ? "Configuração gravada e verificada. Não comprova inferência."
                  : result.status === "conflict"
                    ? "Outra alteração ocorreu. Recarregue e revise novamente; nada foi sobrescrito."
                    : "Resultado incerto. Verifique o estado antes de tentar novamente.";
              announce(area.textContent);
            } catch {
              if (current === revision)
                area.textContent =
                  "Resultado incerto. Não repita automaticamente.";
              announce(
                "Resultado de roteamento incerto. Não repita automaticamente.",
              );
            } finally {
              kind.disabled = channel.disabled = load.disabled = false;
            }
          };
        } catch {
          if (current === revision) {
            preview.disabled = false;
            const error = make(
              "p",
              "Prévia indisponível. Verifique JSON, campos permitidos e versão; nenhuma confirmação enviada.",
            );
            area.append(error);
          }
        }
      };
    } catch {
      if (current === revision)
        area.textContent =
          "Configuração indisponível ou sem ETag seguro. Nenhuma gravação enviada.";
    } finally {
      load.disabled = false;
    }
  };
  return panel;
}
