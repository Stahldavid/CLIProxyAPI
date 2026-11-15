import {
  normalizeRecords,
  summarize,
  normalizeSnapshotMetadata,
} from "./telemetry.mjs";
import { demo } from "./demo.mjs";
import { mountRouting } from "./routing-ui.mjs";
import { mountAccountManagement } from "./management-ui.mjs";
const pages = [
  [
    "infrastructure",
    "◈",
    "Home e nós",
    "Controle central, execução distribuída e acesso completo aos painéis nativos.",
  ],
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
let telemetrySource = null;
let infrastructure = { home: null, panels: {}, stale: false };
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
  const page =
    pages.find((p) => p[0] === location.hash.slice(1)) ??
    pages.find((p) => p[0] === "overview");
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
  if (telemetrySource) {
    const sourceTime = (value) =>
      value
        ? new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "medium",
            timeZone: "Asia/Jerusalem",
          }).format(new Date(value))
        : "Não informado";
    $("#notice").innerHTML +=
      `<div class="notice"><b>Snapshot histórico sanitizado · não é tempo real</b><p>Fonte: ${esc(telemetrySource.sourceId)} · coletado ${esc(sourceTime(telemetrySource.observedAt))} · Jerusalém</p><p>Eventos: ${esc(sourceTime(telemetrySource.firstEventAt))} até ${esc(sourceTime(telemetrySource.lastEventAt))}. ${records.length} carregados / ${esc(num(telemetrySource.retainedRecordCount))} retidos na fonte. Cobertura ${telemetrySource.truncated === true ? "PARCIAL: exportação truncada" : telemetrySource.truncated === false ? "do snapshot exportado, não vitalícia" : "não informada"}.</p><p>Atualizar fonte relê o arquivo; não regenera a coleta. Não somar estes eventos aos agregados Home ou ledgers sobrepostos. Saldo, quota atual e fatura permanecem desconhecidos.</p></div>`;
  }
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
      )}</div><div class="grid">${panel("Canal executor", bars(s.providers), "Contagem de requisições, não disponibilidade do serviço.")}${panel("Aplicativos de origem", bars(s.clients), "Claude Code pode usar Codex. Os dois eixos são independentes.")}</div>${panel("Atribuição sem ambiguidades", `<div class="flow"><div class="node"><small>Aplicativo</small><b>Claude Code</b>Harness / cliente</div><span class="arrow">→</span><div class="node"><small>Gateway</small><b>Alias → modelo</b>Roteamento</div><span class="arrow">→</span><div class="node"><small>Executor</small><b>Codex</b>Conta de destino</div></div><p>Exemplo conceitual. OAuth não comprova plano, saldo nem cobrança. Custo monetário: não informado.</p>`)}`;
  }
  if (
    page[0] === "overview" &&
    records.some(
      (record) => record.billingOrigin !== "unknown" && record.billingOrigin,
    )
  ) {
    const names = {
      subscription: "Subscription Codex",
      openai_api: "OpenAI API",
      azure_api: "Azure API",
      unknown: "Não identificado",
    };
    html += panel(
      "Origem de cobrança declarada pela fonte",
      bars(
        s.billingOrigins.map((group) => ({
          ...group,
          name: names[group.name] ?? "Não identificado",
        })),
      ),
      "Atribuição pelo vínculo da credencial com a configuração atual do guarda, não pelo modelo. Não é custo faturado nem saldo. Alterações históricas podem exigir reconciliação.",
    );
  }
  if (
    page[0] === "overview" &&
    mode !== "Demonstração" &&
    mode !== "Snapshot importado" &&
    records.length === 0
  ) {
    const usage = infrastructure.home?.usage;
    const timeLabel = (value) =>
      typeof value === "string" && Number.isFinite(Date.parse(value))
        ? new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Asia/Jerusalem",
          }).format(new Date(value))
        : "Não informado";
    if (usage?.status === "loaded") {
      const fields = [
        ["Requisições registradas", num(usage.requests)],
        [
          "Sucesso",
          usage.requests > 0
            ? num((100 * usage.successes) / usage.requests) + "%"
            : "Sem requisições",
        ],
        ["Tokens registrados", num(usage.tokens)],
        [
          "Latência p95",
          usage.p95LatencyMs === null
            ? "Não informada"
            : num(usage.p95LatencyMs) + " ms",
        ],
      ];
      const trend = usage.trend ?? [];
      const maximum = Math.max(1, ...trend.map((row) => row.requests ?? 0));
      html = `${panel("Uso real registrado pelo Home · últimas 24 horas", `<p>${esc(timeLabel(usage.from))} até ${esc(timeLabel(usage.to))} · Jerusalém</p><p>Consulta: ${esc(timeLabel(usage.checkedAt))}${infrastructure.stale ? " · DESATUALIZADA: a atualização falhou" : ""}</p><button id="refresh">Atualizar dados reais</button><p>Fonte: consulta agregada não destrutiva ao Home. Não inclui tráfego que não foi registrado por ele, nem comprova histórico completo, saldo ou cobrança.</p>`)}<div class="cards">${fields.map(([title, value]) => `<div class="card"><span class="label">${esc(title)}</span><div class="value">${esc(value)}</div><small>Somente intervalo consultado</small></div>`).join("")}</div>${panel("Requisições por hora", trend.length ? `<div class="bars">${trend.map((row) => `<div class="bar-row"><div class="bar-label"><span>${esc(timeLabel(row.timestamp))}</span><b>${esc(num(row.requests))}</b></div><div class="track"><div class="fill" style="width:${row.requests === null ? 0 : Math.max(0, Math.min(100, (100 * row.requests) / maximum))}%"></div></div></div>`).join("")}</div>` : "<p>Sem série horária disponível.</p>")}${panel("Registros individuais e atribuição", '<p>Estes totais são agregados reais; não foram convertidos em eventos fictícios. Atividade, cliente/harness e detalhamento por requisição precisam de fonte própria de registros. A fila de uso não foi consumida.</p><p><a href="#infrastructure">Abrir Home e nós para acessar o HMC completo</a></p>')}`;
    } else {
      html = panel(
        "Telemetria de uso ainda indisponível",
        `<p>${usage?.status === "unavailable" ? "O Home não retornou agregados válidos nesta consulta. Isso não significa consumo zero." : "A conexão aos nós não fornece histórico de uso. Nenhum snapshot de eventos ou agregado Home está disponível."}</p><button id="refresh">Atualizar fontes</button><p>Contas saudáveis e modelos disponíveis não medem uso. Nenhuma fila destrutiva é consultada automaticamente.</p><p><a href="#infrastructure">Ver fontes e abrir o HMC nativo</a></p>`,
      );
    }
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
    html = `<div class="grid">${panel("Proteções do console", `<dl><dt>Credenciais</dt><dd>Token administrativo permanece no servidor; senha do console é solicitada no modo conectado</dd><dt>Prompts e respostas</dt><dd>Não exibidos</dd><dt>Conexões do navegador</dt><dd>Somente este servidor local</dd><dt>Armazenamento</dt><dd>Exibição em memória da aba; coletor opcional grava histórico sanitizado no servidor</dd></dl>`)}${panel("Integrações", `<p>Esta tela não consulta o estado global do Infisical ou Executor. O laboratório demonstra integrações simuladas, não comprova configuração de produção.</p>${tag("Não conectado", "gray")}<p>Este servidor é somente local. Não publique nem exponha por túnel.</p>`)}</div>${panel("Importação segura", "<p>O importador aceita até 5 MB de JSON, seleciona campos de telemetria e descarta campos não permitidos. Não importe arquivos de credenciais. Rótulos livres ainda podem conter dados pessoais: revise o arquivo antes de compartilhar.</p>")}`;
  if (page[0] === "infrastructure") {
    const home = infrastructure.home;
    const homeStatus = infrastructure.stale
      ? "Última leitura · atualização falhou"
      : ({
          connected: "Conectado · somente leitura",
          unavailable: "Home indisponível",
          "not-configured": "Home não conectado",
        }[home?.status] ?? "Consulta ainda não realizada");
    const checked =
      home?.checkedAt && Number.isFinite(Date.parse(home.checkedAt))
        ? new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "medium",
            timeZone: "Asia/Jerusalem",
          }).format(new Date(home.checkedAt)) + " · Jerusalém"
        : "Ainda sem consulta concluída";
    const links = (origin, entries, variable) =>
      origin
        ? `<div class="native-links">${entries.map(([label, path]) => `<a href="${esc(origin + path)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>`).join("")}</div>`
        : `<div class="empty"><b>Acesso direto ainda não configurado</b><p>Configure ${esc(variable)} com a origem acessível neste navegador. Não use o localhost de outra máquina.</p><p>Isso não significa que o serviço esteja desligado. O painel continua disponível pelo endereço que você já utiliza.</p></div>`;
    const nodes = home?.nodes ?? [];
    const nodesBody = nodes.length
      ? table(
          ["Nó anonimizado", "Saúde reportada", "Clientes"],
          nodes.map((n) => [
            esc(n.label),
            tag(
              n.healthy === true
                ? "Saudável"
                : n.healthy === false
                  ? "Não saudável"
                  : "Não informada",
              n.healthy === true ? "green" : "gray",
            ),
            num(n.clients),
          ]),
        )
      : `<div class="empty"><b>${home?.status === "connected" ? "Nenhum nó retornado pelo Home" : "Sem inventário disponível"}</b><p>${home?.status === "connected" ? "A consulta foi concluída, mas não retornou nós. Verifique o cadastro no HMC; não confunda lista vazia com falha de inferência." : home?.status === "unavailable" ? "Confira conectividade e autenticação no servidor do console. Não cole tokens aqui. A ausência de dados não comprova que os nós estejam desligados." : "Conecte a fonte Home no servidor para consultar os nós. O console nunca inventa nomes, saúde ou endereços."}</p></div>`;
    html = `${panel("Como este ambiente se conecta", '<div class="architecture"><span>Harness<small>Codex · OpenCode · Claude Code</small></span><b>→</b><span>Seletor<small>Escolha PC / VM</small></span><b>→</b><span>CPA<small>Executa a requisição</small></span><b>→</b><span>Provedor<small>Subscription ou API</small></span></div><p>O Home coordena credenciais e configuração dos CPAs. O HMC administra o Home. O console visualiza; não substitui nem altera esse caminho.</p>')}
    <div class="grid">${panel("Home · plano de controle", `${tag(homeStatus, home?.status === "connected" && !infrastructure.stale ? "green" : "gray")}<p>${esc(checked)}</p><button id="refresh">Atualizar fonte</button><p>Credenciais, renovação e configuração são administradas no HMC, não nesta tela.</p>`)}${panel("CPAs · execução", `${nodesBody}<p>${infrastructure.stale ? "Atenção: dados da última leitura, atualização falhou. " : ""}Saúde reportada não comprova inferência nem fallback. Rótulos anônimos são posicionais, não identidades estáveis.</p>`)}</div>
    <div class="grid">${panel(
      "HMC completo · painel oficial",
      links(
        infrastructure.panels?.home,
        [
          ["Dashboard", "/management.html#/admin/dashboard"],
          ["Contas · OAuth · APIs", "/management.html#/admin/upstream"],
          ["Nós e sistema", "/management.html#/admin/system-nodes"],
          ["Uso", "/management.html#/admin/usage"],
          ["Chaves de acesso", "/management.html#/admin/access-keys"],
          ["Quotas", "/management.html#/admin/quota"],
          ["Plugins", "/management.html#/admin/plugins"],
          ["Logs", "/management.html#/admin/logs"],
          ["Diagnósticos", "/management.html#/admin/diagnostics"],
          ["Configuração e demais recursos", "/management.html#/admin/config"],
        ],
        "GATEWAY_HOME_PANEL_ORIGIN",
      ),
      "Abre em outra aba com autenticação própria. Nenhum token no link.",
    )}${panel("CPA · painel nativo", links(infrastructure.panels?.cpa, [["Abrir painel completo", "/management.html"]], "GATEWAY_CPA_PANEL_ORIGIN"), "Acesso opcional ao painel de um CPA. O HMC acima permanece a administração central do Home.")}</div>
    ${panel("O que está integrado, sem perder recursos", "<p><b>Neste console:</b> saúde e clientes dos nós Home, telemetria CPA opcional e atribuição por harness/provedor.</p><p><b>No HMC completo:</b> OAuth, renovação, quotas, certificados, plugins, logs e administração. Nenhuma função nativa foi removida.</p><p>WebSocket, fallback, cobrança e disponibilidade real exigem evidências de execução. A consulta não consome a fila de uso. Este console ainda não oferece paridade visual integral com o HMC.</p>")}`;
  }
  if (page[0] === "settings")
    html = panel(
      "Sessão local",
      `<div class="settings-row split"><div><b>Adaptador administrativo</b><p>${esc(connection?.management?.status ?? "Não consultado")} · Telemetria: ${esc(connection?.telemetryStatus ?? "Não consultada")}</p><small>Última consulta: ${esc(connection?.checkedAt)}</small></div><button id="refresh">Atualizar fonte</button></div><div class="settings-row split"><div><b>Fonte atual</b><p>${esc(mode)} · ${records.length} registros</p></div><button id="reset">Restaurar demonstração</button></div><div class="settings-row split"><div><b>Limpar telemetria</b><p>Remove os registros desta aba; preserva a última leitura Home e os acessos nativos.</p></div><button id="clear">Limpar sessão</button></div><div class="settings-row"><b>Ambiente</b><p>Standalone · Adaptador v8 somente leitura · Sem API de inferência</p></div><div class="settings-row"><b>Produção permanece intocada</b><p>Alterações de estado de contas só ficam disponíveis com habilitação explícita no servidor e confirmação individual abaixo. Nenhum token administrativo é solicitado pelo navegador.</p></div>`,
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
      telemetrySource = null;
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
      telemetrySource = null;
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
    ["Canal executor", r.provider],
    [
      "Origem de cobrança",
      {
        subscription: "Subscription Codex",
        openai_api: "OpenAI API",
        azure_api: "Azure API",
      }[r.billingOrigin] ?? "Não informado",
    ],
    [
      "Evidência da origem",
      r.billingEvidence === "source-current-configuration"
        ? "Vínculo com configuração atual, informado pela fonte"
        : "Não informada",
    ],
    ["Evento canônico", r.sourceEventId ?? "Não informado"],
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
  const revision = ++sourceRevision;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Arquivo maior que 5 MB.");
    const contents = await file.text();
    if (revision !== sourceRevision) return;
    const data = JSON.parse(contents);
    if (!Array.isArray(data) && !Array.isArray(data?.records))
      throw new Error("Use um array ou um objeto com records.");
    const imported = normalizeRecords(data);
    connection = null;
    telemetrySource = normalizeSnapshotMetadata(data);
    records = imported;
    mode = "Snapshot importado";
    query = "";
    status = "all";
    render();
  } catch (error) {
    if (revision !== sourceRevision) return;
    $("#notice").textContent =
      "Importação recusada. Use um JSON válido com records, até 5 MB e 10.000 registros. O conjunto anterior foi preservado.";
  } finally {
    if (revision === sourceRevision) e.target.value = "";
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
    telemetrySource = incoming.telemetrySource ?? null;
    infrastructure = {
      home: incoming.home ?? null,
      panels: incoming.panels ?? {},
      stale: false,
    };
    if (connection.mode !== "demo") {
      records = connection.records;
      mode = "Fonte administrativa · leitura";
    }
    render();
    if (
      connection.management.status === "disconnected" ||
      connection.management.status === "partial" ||
      connection.telemetryStatus === "unavailable" ||
      connection.home?.status === "unavailable"
    )
      $("#notice").textContent =
        "Fonte parcialmente indisponível. Dados ausentes não representam zero; confira a configuração local.";
  } catch {
    if (revision !== sourceRevision) return;
    connection = null;
    infrastructure = { ...infrastructure, stale: true };
    render();
    $("#notice").textContent =
      "Não foi possível consultar a fonte local. O conjunto anterior foi preservado.";
  }
}
loadSource();
