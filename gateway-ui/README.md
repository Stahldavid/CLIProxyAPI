# Gateway console

A standalone, read-only console inside the CLIProxyAPI fork. It does not replace the upstream management panel or change the inference pipeline. The working name is **Gateway**. The visual language is dark navy, violet and cyan, with eight distinct views: Overview, Accounts, Models, Routes, Clients, Activity, Security and Settings.

## Run locally

Requires Node 20+; no production dependencies or model API calls.

```sh
cd gateway-ui
npm start
# Open http://127.0.0.1:4173
```

The default is an explicitly labeled synthetic demonstration. It never discovers existing credentials, reads the user's proxy configuration, calls inference, or automatically connects to any service. The local server binds only to IPv4 loopback and rejects non-local Host headers. Do not expose it publicly or through a tunnel: production authentication/access controls are not implemented.

## Real read-only management integration

The server supports an explicitly configured management adapter. A future authorized operator can supply `GATEWAY_MANAGEMENT_URL` (origin only) and `GATEWAY_MANAGEMENT_TOKEN` to the **server environment**, then start the console. The browser never receives this token. No token is stored by this project. Do not put secrets in the repository or shell history.

The adapter calls only these upstream v8 routes:

- `GET /v8/management/credentials`
- `GET /v8/management/routing/model-definitions/codex`
- `GET /v8/management/routing/model-definitions/claude`
- `GET /v8/management/routing/model-definitions/gemini`

It returns anonymized account labels and a bounded model catalog. Account labels are positional within a response, not persistent account identity. Catalog membership is not evidence of successful inference or account eligibility. Responses and error bodies cannot leak through to the browser. Redirects and non-loopback plaintext URLs are rejected. Each response is bounded at 1 MiB. The UI never gets full config, credential files, logs, raw API keys, source, client IP or prompts. No config mutations, OAuth login, credential updates, quota resets, downloads or plugin installations are implemented.

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

**Do not read the upstream usage queue from the browser.** `/v8/management/observability/usage/queue` destructively pops records. This implementation intentionally never calls it. A future live activity pipeline needs one dedicated collector plus durable sanitized history and explicit ownership of that queue; an existing consumer must not be raced or replaced.

## What works and what is not claimed

Implemented: eight views, responsive navigation, offline charts and statistics computed from records, exact attribution details, status/search filters, safe imports, local reset/clear, observed-route explanation, read-only live adapter, redacted partial failure handling and server isolation.

The route simulator explains an observed route; it is not a routing engine, fallback verifier or configuration editor. Settings change only this console session. Security shows boundaries rather than pretending Infisical or Executor is installed. No production-grade auth, live usage collector, actual billing integration, quota fetching, route writing or provider inference verification is included. Those are not hidden behind fake functional buttons.

## Validation

```sh
npm ci
npm run check
```

Tests use synthetic records, injected mock management responses, local HTTP and DOM simulation. They do not use a user subscription, key or provider API. `test/browser.cjs` is an optional Playwright visual/interaction check; it needs Playwright and a compatible Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`). DOM tests are not a substitute for visual browser validation.

Current implementation baseline: upstream/fork commit `1aaf56bc6a0fc6fce19049ba7ae8554c882304a6`, verified equal at development time. No upstream Go files were changed.
