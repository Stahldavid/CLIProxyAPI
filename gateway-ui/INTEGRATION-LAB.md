# Isolated integration lab

This preview is an **architectural simulator**, not an installed Infisical instance,
Executor instance, vendor SDK or verified live adapter. All records, identities,
secrets, approvals, issues and model attribution are fictitious. No real APIs,
OAuth sessions, credentials, subscriptions, user PC, T3, Codex or Work are used.
No external writes occur. The existing management adapter remains separate.

## Run

From `gateway-ui`, in an environment without management configuration:

```sh
GATEWAY_INTEGRATION_LAB=mock PORT=4175 npm start
```

Open `http://127.0.0.1:4175/lab.html`. The ordinary model console is at `/`.
The lab is disabled by default. Startup and server construction reject mixing the
lab with a connected adapter, snapshot, management token or management writer.
The server binds loopback and inherits same-origin/Host checks and no-store/CSP.
Do not expose it through a public tunnel: it is a single-user local simulation,
not a multi-user access-control boundary. Host isolation is not authentication.

## Implemented contract

- **Secrets:** a server-side dummy fixture scoped to `newton/development`.
  The browser receives a fake reference and metadata, never the fixture value.
  No user-supplied credential, tool argument, URL or executable is accepted.
- **Tools:** an allowlisted simulated gateway. `docs.search` returns a fixture;
  `issue.create` requires an explicit one-use confirmation valid for 60 seconds;
  `production.deploy` is blocked. Cancellation consumes the confirmation.
- **Models:** Claude Code is the illustrative harness/client; Codex the provider
  and subscription attribution. Zero inference calls. Cost/quota remain unknown.
- **Trace:** bounded, in-memory sanitized events. No arguments/prompts/secret
  values. Restart discards all state. This is not a durable production audit log.
- **Failure:** missing mock credentials fail closed; other projects/environments,
  extra fields and tools are rejected. Confirmations cannot be replayed or
  retargeted. Failed execution does not silently recreate an approval.

## Proposed production integration, NOT implemented

Use Infisical as a scoped service-credential source and Executor as a separate
MCP/OpenAPI tool gateway. Keep CLIProxyAPI responsible for model routing and its
own OAuth refresh state. This is a proposed adapter boundary, **not a claim of a
native Infisical–Executor connector**. Executor code execution/sandboxing is not
implemented or tested here, and this preview does not execute arbitrary code.

The broker would authenticate with a narrowly scoped machine identity, retrieve
only a required service key, and provide it only to the target connector. The
browser/model transcript should receive references and sanitized results, never
credentials. Tool outputs are untrusted; approvals must bind identity, exact
operation, arguments, target, expiry and policy version. OAuth support and
available scopes must be checked against the selected real connector; a PAT is
not automatically a scoped alternative. Infisical does not by itself prevent a
process/controller from reading secrets injected into its environment.

Production work still requires separate authorization and validation: provider
accounts and plans, machine identity lifecycle, real API schemas and permissions,
network/egress controls, TLS/authentication, revocation, storage/retention, error
redaction, secret rotation and recovery, policy enforcement inside Executor, and
integration/acceptance tests. The simulated approval is not authorization for any
real T3 task creation/message, production write, deployment, or paid service.
No Agent Vault is required by the proposed basic flow.

## Verification

`npm test` includes existing regressions and lab cases covering secret omission,
model/tool separation, invalid scope/tools/arguments, blocked operations,
confirmation/replay/expiry/cancellation, bounded state, missing fixture credentials,
HTTP origin/content-type/body-size boundaries, module non-disclosure, and rejection
of mixed live configuration. Passing mocks proves only the local behavior, not
compatibility or security of either vendor or a complete real secret lifecycle.

## Isolated service lifecycle (2026-11-13)

The simulator now separates a mock vault from a mock tool executor. A server-side
opaque identity expires after five minutes, reads only the Newton development
fixture, and can be revoked. Restart creates a fresh mock identity; there is no
silent renewal. Mock rotation invalidates the old value and the next operation
resolves the current value just in time. Secrets never enter approval records,
UI responses or audit events. These are in-memory contract doubles, **not vendor
SDKs, wire-protocol adapters or self-hosted vendor instances**.

Approval, cancellation and blocked operations resolve no credential and invoke no
tool. Execution consumes approval before attempting the downstream operation,
with no retry after failure. Query/read tools are not assumed inherently safe:
the mock allowlist grants only the exact fixture search. A real Executor setup or
query may have effects, so approval must precede sensitive setup/connection work.
Denied requests, expired approvals, failures and revocation produce sanitized,
bounded events. Reload recovers a pending approval from the single-user mock
server. Revocation/rotation/fault controls are module-test APIs only, not exposed
as browser administrative endpoints.

Added deterministic tests cover identity expiry, scope denial, revocation,
rotation, old credential rejection, sensitive-error sanitization, no hidden retry,
competing decisions, recovered approval UI, and zero resolution before approval.
They exercise the local broker design; they do not prove native vendor integration,
real network isolation, OAuth, TLS, vendor permissions or actual billing behavior.
