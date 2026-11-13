import { normalizeRecords, summarize } from "./telemetry.mjs";
import { demo } from "./demo.mjs";
import { mountRouting } from "./routing-ui.mjs";
import { mountAccountManagement } from "./management-ui.mjs";
const pages = [
  ["overview", "⌂", "Visão geral", "Tráfego e atribuição em um só lugar."],
  [
    "accounts",
    "◎",
    "Contas",
    "Identidade de execução, não identidade do aplicativo.",
  ],
  ["models", "◇", "Modelos", "Modelo solicitado, encaminhado e retornado."],
  [
    "routes",
    "⑂",
    "Rotas",
    "Entenda o caminho. Simule sem executar inferência.",
  ],
  [
    "clients",
    "▣",
    "Clientes",
    "O aplicativo que inicia a requisição não define quem a executa.",
  ],
  [
    "activity",
    "▥",
    "Atividade",
    "Evidência por requisição, sem prompts ou credenciais.",
  ],
  [
    "security",
    "♧",
    "Segurança",
    "Limites explícitos. Nenhum segredo no console.",
  ],
  [
    "settings",
    "⚙",
    "Configurações",
    "Fontes locais e operações opcionais com confirmação explícita.",
  ],
];
let records = normalizeRecords(demo),
  mode = "Demonstração",
  query = "",
  status = "all",
  connection = null;
let sourceRevision = 0;
const $ = (s) => document.querySelector(s),
  esc = (x) =>
    String(x ?? "Não informado").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  num = (x) =>
    x == null
      ? "Não informado"
      : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(x);
const evidence = (value) =>
  ({
    declared: "Declarado no registro",
    "user-agent heuristic": "Inferido do user-agent",
    unavailable: "Não informado",
  })[value] || "Não informado";
const tag = (s, c = "") => `<span class="badge ${c}">${esc(s)}</span>`;
const panel = (title, body, sub = "") =>
  `<article class="panel"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}${body}</article>`;
const table = (heads, rows) =>
  rows.length
    ? `<table><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nenhum registro neste recorte.</div>';
const group = (k) =>
  [...new Set(records.map((r) => r[k] ?? "Não informado"))].map((name) => ({
    name,
    rows: records.filter((r) => (r[k] ?? "Não informado") === name),
  }));
const bars = (groups) =>
  `<div class="bars">${groups.map((g) => `<div class="bar-row"><div class="bar-label"><span>${esc(g.name)}</span><b>${g.requests} requisições</b></div><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, (g.requests / Math.max(1, records.length)) * 100))}%"></div></div></div>`).join("")}</div>`;
function render() {
  const page = pages.find((p) => p[0] === location.hash.slice(1)) ?? pages[0];
  document.title = `${page[2]} · Gateway`;
  $("h1").textContent = page[2];
  $("#subtitle").textContent = page[3];
  $("#mode").textContent = mode;
  $("nav").innerHTML = pages
    .map(
      (p) =>
        `<a href="#${p[0]}" ${page === p ? 'aria-current="page"' : ""}><i aria-hidden="true">${p[1]}</i>${p[2]}</a>`,
    )
    .join("");
  $("#notice").innerHTML =
    `<div class="notice">${mode === "Demonstração" ? "Dados sintéticos para validar a interface. Nenhuma requisição real é enviada." : "Consulta/snapshot em memória. Dados podem estar desatualizados; não comprovam saldo nem disponibilidade do provedor."}</div>`;
  const s = summarize(records);
  let html = "";
  if (page[0] === "overview") {
    html = `<div class="cards">${[
      ["Requisições", num(s.total), "No conjunto carregado"],
      [
        "Sucesso",
        s.successRate == null ? "Não informado" : num(s.successRate) + "%",
        "Somente resultados conhecidos",
      ],
      [
        "Latência p95",
        s.p95LatencyMs == null ? "Não informado" : num(s.p95LatencyMs) + " ms",
        "Amostras com latência informada",
      ],
      [
        "Tokens conhecidos",
        num(s.totalTokens),
        `${s.tokensKnown}/${s.total} registros com total`,
      ],
    ]
      .map(
        ([a, b, c]) =>
          `<div class="card"><span class="label">${a}</span><div class="value">${b}</div><small>${c}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="grid">${panel("Distribuição por provedor", bars(s.providers), "Contagem de requisições, não disponibilidade do serviço.")}${panel("Aplicativos de origem", bars(s.clients), "Claude Code pode usar Codex. Os dois eixos são independentes.")}</div>${panel("Atribuição sem ambiguidades", `<div class="flow"><div class="node"><small>Aplicativo</small><b>Claude Code</b>Harness / cliente</div><span class="arrow">→</span><div class="node"><small>Gateway</small><b>Alias → modelo</b>Roteamento</div><span class="arrow">→</span><div class="node"><small>Executor</small><b>Codex</b>Conta de destino</div></div><p>Exemplo conceitual. OAuth não comprova plano, saldo nem cobrança. Custo monetário: não informado.</p>`)}`;
  }
  if (page[0] === "accounts" && connection?.management?.accounts?.length)
    html = panel(
      "Inventário administrativo",
      table(
        ["Conta", "Provedor", "Estado", "Desabilitada"],
        connection.management.accounts.map((a) => [
          esc(a.label),
          esc(a.provider),
          esc(a.status),
          a.disabled == null ? "Não informado" : a.disabled ? "Sim" : "Não",
        ]),
      ),
      "Consulta somente leitura. Sem saldo ou plano inferido.",
    );
  else if (page[0] === "accounts")
    html = panel(
      "Contas observadas",
      table(
        [
          "Rótulo seguro",
          "Provedor",
          "Autenticação",
          "Requisições",
          "Plano / custo",
        ],
        group("account").map((g) => [
          esc(g.name),
          esc([...new Set(g.rows.map((r) => r.provider))].join(", ")),
          esc([...new Set(g.rows.map((r) => r.authMethod))].join(", ")),
          g.rows.length,
          "Não informado",
        ]),
      ),
      "Não lemos credenciais nem deduzimos assinatura a partir de OAuth. Cotas não estão disponíveis neste snapshot.",
    );
  if (page[0] === "models" && connection?.management?.models?.length)
    html = panel(
      "Catálogo administrativo",
      table(
        ["Modelo", "Nome", "Provedor"],
        connection.management.models.map((m) => [
          esc(m.id),
          esc(m.name),
          esc(m.provider),
        ]),
      ),
      "Catálogo reportado, não prova acesso ou disponibilidade.",
    );
  else if (page[0] === "models")
    html = panel(
      "Caminhos de modelos",
      table(
        ["Solicitado / alias", "Encaminhado", "Resposta", "Provedor"],
        records
          .slice(0, 30)
          .map((r) => [
            esc(r.requestedModel),
            esc(r.forwardedModel),
            esc(r.responseModel),
            esc(r.provider),
          ]),
      ),
      "Primeiros 30 registros. O modelo de resposta pode não ser reportado.",
    );
  if (page[0] === "clients")
    html = panel(
      "Aplicativos observados",
      table(
        ["Cliente", "Evidência", "Provedores usados", "Requisições"],
        group("client").map((g) => [
          esc(g.name),
          esc(
            [...new Set(g.rows.map((r) => evidence(r.clientEvidence)))].join(
              ", ",
            ),
          ),
          esc([...new Set(g.rows.map((r) => r.provider))].join(", ")),
          g.rows.length,
        ]),
      ),
      "User-Agent é apenas indício. Não representa inventário de computadores nem conexão online.",
    );
  if (page[0] === "routes")
    html = panel(
      "Simulador local",
      `<p>Escolha um registro como exemplo de rota. Esta simulação explica a atribuição registrada, não modifica regras e não testa fallback.</p><label for="route">Caminho observado</label><div class="filters"><select id="route">${records.map((r, i) => `<option value="${i}">${esc(r.client)} · ${esc(r.requestedModel)} → ${esc(r.forwardedModel)}</option>`).join("")}</select><button id="simulate" class="primary" ${records.length ? "" : "disabled"}>Simular atribuição</button></div><div id="simulation" aria-live="polite"></div>`,
    );
  if (page[0] === "activity")
    html = panel(
      "Requisições",
      `<div class="filters"><input type="search" id="search" aria-label="Buscar requisições" placeholder="Cliente, modelo ou provedor…" value="${esc(query)}"><select id="status" aria-label="Filtrar resultado"><option value="all">Todos os resultados</option><option value="success">Sucesso</option><option value="failed">Falha</option><option value="unknown">Não informado</option></select></div><div id="rows"></div>`,
    );
  if (page[0] === "security")
    html = `<div class="grid">${panel("Proteções do console", `<dl><dt>Credenciais</dt><dd>Token administrativo permanece no servidor; senha do console é solicitada no modo conectado</dd><dt>Prompts e respostas</dt><dd>Não exibidos</dd><dt>Conexões do navegador</dt><dd>Somente este servidor local</dd><dt>Armazenamento</dt><dd>Exibição em memória da aba; coletor opcional grava histórico sanitizado no servidor</dd></dl>`)}${panel("Integrações", `<p>Infisical, Executor e autenticação de produção não estão configurados.</p>${tag("Não conectado", "gray")}<p>Este servidor é somente local. Não publique nem exponha por túnel.</p>`)}</div>${panel("Importação segura", "<p>O importador aceita até 5 MB de JSON, seleciona campos de telemetria e descarta campos não permitidos. Não importe arquivos de credenciais. Rótulos livres ainda podem conter dados pessoais: revise o arquivo antes de compartilhar.</p>")}`;
  if (page[0] === "settings")
    html = panel(
      "Sessão local",
      `<div class="settings-row split"><div><b>Adaptador administrativo</b><p>${esc(connection?.management?.status ?? "Não consultado")} · Telemetria: ${esc(connection?.telemetryStatus ?? "Não consultada")}</p><small>Última consulta: ${esc(connection?.checkedAt)}</small></div><button id="refresh">Atualizar fonte</button></div><div class="settings-row split"><div><b>Fonte atual</b><p>${esc(mode)} · ${records.length} registros</p></div><button id="reset">Restaurar demonstração</button></div><div class="settings-row split"><div><b>Limpar dados</b><p>Remove o conjunto da memória desta aba.</p></div><button id="clear">Limpar sessão</button></div><div class="settings-row"><b>Ambiente</b><p>Standalone · Adaptador v8 somente leitura · Sem API de inferência</p></div><div class="settings-row"><b>Produção permanece intocada</b><p>Alterações de estado de contas só ficam disponíveis com habilitação explícita no servidor e confirmação individual abaixo. Nenhum token administrativo é solicitado pelo navegador.</p></div>`,
    );
  $("#content").innerHTML = html;
  if (page[0] === "settings") mountAccountManagement($("#content"));
  if (page[0] === "routes") mountRouting($("#content"));
  if (page[0] === "activity") {
    const update = () => {
      const list = records.filter(
        (r) =>
          (status === "all" || r.status === status) &&
          [r.client, r.provider, r.requestedModel, r.forwardedModel]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
      );
      $("#rows").innerHTML = table(
        ["ID", "Cliente → provedor", "Modelo", "Tokens", "Resultado", ""],
        list
          .slice(0, 200)
          .map((r) => [
            esc(r.id),
            `${esc(r.client)} <small>→ ${esc(r.provider)}</small>`,
            esc(r.forwardedModel),
            num(r.tokens.total),
            tag(
              r.status === "success"
                ? "Sucesso"
                : r.status === "failed"
                  ? "Falha"
                  : "Não informado",
              r.status === "success"
                ? "green"
                : r.status === "failed"
                  ? "amber"
                  : "gray",
            ),
            `<button data-detail="${records.indexOf(r)}">Detalhes</button>`,
          ]),
      );
      $("#rows")
        .querySelectorAll("[data-detail]")
        .forEach((b) => (b.onclick = () => detail(records[+b.dataset.detail])));
    };
    $("#status").value = status;
    $("#status").onchange = (e) => {
      status = e.target.value;
      update();
    };
    $("#search").oninput = (e) => {
      query = e.target.value;
      update();
    };
    update();
  }
  if ($("#refresh")) $("#refresh").onclick = loadSource;
  if ($("#simulate"))
    $("#simulate").onclick = () => {
      $("#simulation").innerHTML = details(records[+$("#route").value]);
    };
  if ($("#reset"))
    $("#reset").onclick = () => {
      sourceRevision++;
      connection = null;
      records = normalizeRecords(demo);
      mode = "Demonstração";
      query = "";
      status = "all";
      render();
    };
  if ($("#clear"))
    $("#clear").onclick = () => {
      sourceRevision++;
      connection = null;
      records = [];
      mode = "Sessão vazia";
      render();
    };
}
function details(r) {
  return `<dl>${[
    ["Cliente", r.client],
    ["Evidência do cliente", evidence(r.clientEvidence)],
    ["Modelo solicitado", r.requestedModel],
    ["Modelo encaminhado", r.forwardedModel],
    ["Modelo na resposta", r.responseModel],
    ["Provedor", r.provider],
    [
      "Executor",
      r.executor && r.executor !== "Unknown executor"
        ? r.executor
        : "Não informado",
    ],
    ["Conta", r.account],
    ["Método de autenticação", r.authMethod],
    ["Assinatura / plano", "Não informado"],
    ["Cobrança real", "Não informada"],
    ["Tokens totais", num(r.tokens.total)],
    ["Data do registro", r.timestamp],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
    .join("")}</dl>`;
}
function detail(r) {
  $("#detail-body").innerHTML = details(r);
  $("#detail").showModal();
}
$(".skip").onclick = (event) => {
  event.preventDefault();
  $("#main").focus();
};
$("#close").onclick = () => $("#detail").close();
window.addEventListener("hashchange", () => {
  if ($("#detail").open) $("#detail").close();
  render();
  $("h1").focus();
});
$("#import").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Arquivo maior que 5 MB.");
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) && !Array.isArray(data?.records))
      throw new Error("Use um array ou um objeto com records.");
    sourceRevision++;
    connection = null;
    records = normalizeRecords(data);
    mode = "Snapshot importado";
    query = "";
    status = "all";
    render();
  } catch (error) {
    $("#notice").textContent =
      "Importação recusada. Use um JSON válido com records, até 5 MB e 10.000 registros. O conjunto anterior foi preservado.";
  } finally {
    e.target.value = "";
  }
};
render();

async function loadSource() {
  const revision = ++sourceRevision;
  try {
    const response = await fetch("/api/snapshot");
    if (!response.ok) throw new Error("Fonte indisponível");
    const incoming = await response.json();
    if (revision !== sourceRevision) return;
    connection = incoming;
    if (connection.mode !== "demo") {
      records = connection.records;
      mode = "Fonte administrativa · leitura";
    }
    render();
    if (
      connection.management.status === "disconnected" ||
      connection.management.status === "partial" ||
      connection.telemetryStatus === "unavailable"
    )
      $("#notice").textContent =
        "Fonte parcialmente indisponível. Dados ausentes não representam zero; confira a configuração local.";
  } catch {
    if (revision !== sourceRevision) return;
    connection = null;
    $("#notice").textContent =
      "Não foi possível consultar a fonte local. O conjunto anterior foi preservado.";
  }
}
loadSource();
