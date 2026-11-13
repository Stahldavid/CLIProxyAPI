# Gateway console

A standalone, read-only console inside the CLIProxyAPI fork. It does not replace the upstream management panel or change the inference pipeline. The working name is **Gateway**. The visual language is dark navy, violet and cyan, with eight distinct views: Overview, Accounts, Models, Routes, Clients, Activity, Security and Settings.

## Run locally

Requires Node 22.22.2+, 24.15+ or 26+ (matching the test tooling); no production dependencies or model API calls.

```sh
cd gateway-ui
npm start
# Open http://127.0.0.1:4173
```

The default is an explicitly labeled synthetic demonstration. It never discovers existing credentials, reads the user's proxy configuration, calls inference, or automatically connects to any service. The local server binds only to IPv4 loopback and rejects non-local Host headers. Connected mode requires local HTTP Basic authentication (user `gateway`, server environment `GATEWAY_CONSOLE_PASSWORD`, at least 16 characters, distinct from the management token). Demo mode does not require a password. Cross-origin/cross-site requests are rejected. Do not expose it publicly or through a tunnel: remote TLS, identity-provider authentication and multi-user access controls are not implemented.

## Real read-only management integration

The server supports an explicitly configured management adapter. A future authorized operator can supply `GATEWAY_MANAGEMENT_URL` (origin only) and `GATEWAY_MANAGEMENT_TOKEN` to the **server environment**, then start the console. The browser never receives this token. No token is stored by this project. Do not put secrets in the repository or shell history.

The adapter calls only these upstream v8 routes:

- `GET /v8/management/credentials`
- `GET /v8/management/routing/model-definitions/codex`
- `GET /v8/management/routing/model-definitions/claude`
- `GET /v8/management/routing/model-definitions/gemini`

It returns anonymized account labels and a bounded model catalog. Account labels are positional within a response, not persistent account identity. Catalog membership is not evidence of successful inference or account eligibility. Responses and error bodies cannot leak through to the browser. Redirects and non-loopback plaintext URLs are rejected. Each response is bounded at 1 MiB. The UI never gets full config, credential files, logs, raw API keys, source, client IP or prompts. The default adapter never mutates configuration. Optional file-account status management is described below; OAuth login, credential contents, quota resets, downloads and plugin installation are not implemented.

The Settings refresh button re-reads these same endpoints. The first page load reads the local server once; there is no polling. Partial failures are explicit. A missing source does not mean zero usage.

## Telemetry and attribution

Import a JSON snapshot with `records: [...]` or a plain array using the UI (5 MiB and 10,000-record limits). Alternatively, set `GATEWAY_SNAPSHOT_PATH` to an explicitly prepared local snapshot file. The server projects it before returning it to the browser. Never point this at a credential/config file.

Recognized raw record fields: `id`, ISO `timestamp`, `client_label`, `user_agent` (family inference only; raw discarded), `provider`, `alias`, `model`, `response_model`, `account_label`, `auth_type`, `tokens.{input_tokens,output_tokens,cached_tokens,total_tokens}`, `latency_ms`, `failed`.

The schema matches upstream usage event concepts but is deliberately a **safe snapshot contract**, not a claim that every raw upstream event includes these exact friendly labels. Upstream fields not on the allowlist are discarded. Do not rely on free-text label sanitization as a DLP system.

The console separates:

1. Initiating client/harness, such as Claude Code.
2. Requested alias, such as Sonnet.
3. Forwarded model and optional response model.
4. Executing provider, such as Codex.
5. A safe account label and authentication method.
6. Token evidence, with explicit coverage.
7. Actual billing/plan: unknown unless future authoritative support is implemented.

A Claude Code client using Codex is never counted as Anthropic billing just because of its harness. OAuth does not prove a subscription tier or remaining balance. Unknown values remain unknown, not zero. Token totals are not inferred by summing potentially overlapping cached/reasoning breakdowns. Success rate uses only known outcomes; p95 uses only observed latencies. Currency charges and quota percentages are not fabricated.

**Do not read the upstream usage queue from the browser.** `/v8/management/observability/usage/queue` destructively pops records. The console intentionally never calls it. The optional separate collector below is the sole component allowed to consume it; an existing consumer must not be raced or replaced.

## What works and what is not claimed

Implemented: eight views, responsive navigation, offline charts and statistics computed from records, exact attribution details, status/search filters, safe imports, local reset/clear, observed-route explanation, read-only live adapter, redacted partial failure handling and server isolation.

The route simulator explains an observed route; it is not a routing engine, fallback verifier or configuration editor. Settings change only this console session. Security shows boundaries rather than pretending Infisical or Executor is installed. Local authentication and a guarded, one-batch collector are included. No remote production authentication, automatic collection scheduler, actual billing integration, quota fetching, route writing or provider inference verification is included. File-account status management exists only behind explicit opt-in and per-action confirmation. Those are not hidden behind fake functional buttons.

## Validation

```sh
npm ci
npm run check
```

Tests use synthetic records, injected mock management responses, local HTTP and DOM simulation. They do not use a user subscription, key or provider API. `test/browser.cjs` is an optional Playwright visual/interaction check; it needs Playwright and a compatible Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`). DOM tests are not a substitute for visual browser validation.

Current implementation baseline: upstream/fork commit `1aaf56bc6a0fc6fce19049ba7ae8554c882304a6`, verified equal at development time. No upstream Go files were changed.

## Optional destructive queue collector

`node collector.mjs` reads **one batch of up to 100 events** from the upstream v8 usage queue and persists a safe snapshot for the console. It is never started by `npm start` or the browser. Only an explicitly authorized operator may configure it, after verifying no other consumer uses that queue. No real queue has been consumed during development.

Required server environment: `GATEWAY_MANAGEMENT_URL`, `GATEWAY_MANAGEMENT_TOKEN`, dedicated `GATEWAY_SNAPSHOT_PATH`, and `GATEWAY_QUEUE_OWNERSHIP=I_OWN_THE_DESTRUCTIVE_USAGE_QUEUE`. Keep this path outside the repository in an owner-private directory. Use the same snapshot path for the authenticated console. Refresh Settings to read new history.

The collector uses an exclusive local `.lock`, a sanitized 10,000-record and 4 MiB rolling history, owner-only new files, atomic replacement and fsync. Raw API keys, source, auth index, user agent, IP, response headers, prompts and arbitrary account/client labels are never persisted. Only a recognized client family is retained from user agent. Provider/executor/model names remain labels, never proof of plan or cost. The local lock does **not** coordinate multiple hosts or other software; exclusive upstream ownership is an operational prerequisite.

A fetch or persistence failure halts collection, retains its lock, and requires manual reconciliation. Do not automatically remove stale locks or retry. The upstream pop API has no acknowledgement transaction: a process crash or dropped response can lose popped events before disk persistence. This collector cannot promise exactly-once delivery or recover missing upstream data. An upstream transactional/acknowledged feed would be needed to eliminate that gap. The `.next` file may contain a sanitized uncommitted batch after a disk failure; preserve it for authorized reconciliation. Scheduling and remote deployment are intentionally not activated.

## Optional file-account status management

Default: **disabled**. No management control fetch happens merely by opening a screen. In Settings, an explicit button checks available controls. An authorized operator can set `GATEWAY_ALLOW_ACCOUNT_STATUS=explicit-confirmation` in the console server environment alongside the separate console password and management configuration. This has not been enabled against any real service.

Only enabling/disabling a supported file credential is implemented. The supported upstream operation is `PATCH /v8/management/credentials/status`; credential upload/delete/download, OAuth, bulk operations, config edits, plugins and quota reset are excluded. Runtime-only, memory, config-derived and virtual credentials are excluded from the editable list to avoid grouped upstream behavior.

Each change requires selecting an opaque account label, preparing a preview, then pressing **Confirmar alteração**. Pending confirmations expire after 60 seconds, are single-use, and bind the account identity and prior disabled state. The server re-reads identity/status before PATCH and after PATCH. Only a verified postcondition is called applied; ambiguous responses are reported uncertain, with no automatic retry. A process restart invalidates pending confirmations and account handles. No credential filename, ID, token or source is sent to the browser. Account labels are anonymized, so operators must establish which account is intended before enabling this feature; this UI is not an identity directory.

The upstream status API does not offer a compare-and-set transaction against previous state. The recheck narrows but cannot eliminate races with other administrators. Avoid concurrent status editors. The operation changes routing eligibility, not subscription, billing or quota. Mock tests prove contract behavior; production behavior remains unqualified.
