# Validation record

Date: 2026-11-13. Execution: isolated assistant workspace only.

- Fork and upstream HEAD matched `1aaf56bc6a0fc6fce19049ba7ae8554c882304a6`.
- Node syntax, telemetry tests, adapter mocked-contract tests, loopback HTTP protection tests and eight-screen DOM interaction tests passed (final count in task report).
- DOM flows include navigation, simulator, details Close, filter empty result, snapshot import, XSS-shaped text, credential exclusion, malformed import preserving state, clearing, reset and management-backed inventory display.
- No provider inference, user API, real credential, subscription, user PC, production proxy, Codex/T3/Work task, merge or deploy was used.
- Full visual Chromium test was attempted but this runtime rejected browser startup with `socket() failed: Operation not permitted`; no screenshot or visual pass is claimed.
- Upstream Go build verification is separate; no Go files changed. An official Go 1.26.10 toolchain was downloaded into this isolated workspace and `go build -o /tmp/gateway-proxy-build ./cmd/server` passed. The upstream full test suite was attempted separately; environmental failures are recorded below. Do not interpret passing console tests as an upstream full test pass.
- Live administrative connection and production behavior were not tested. Adapters were exercised only against injected fakes/local fixtures.

- Console: 28/28 tests passed after review fixes, including stale asynchronous refresh protection.
- The full upstream suite reports sandbox network-interface/socket failures in `internal/client/codex/live` and `internal/discovery`; these files are unchanged by this work. Full suite is not a pass.

- The broad upstream run was stopped after it had already reported the four environmental failures (81 packages reported success). Remaining packages were not certified. The isolated console test suite and upstream compile completed independently.
- Formatting check passed. Node test tooling requires ^22.22.2, ^24.15.0, or >=26.0.0; package metadata now records this requirement.

## Local hardening follow-up (2026-11-13)

- 35/35 Node tests pass, including authenticated connected-mode startup, cross-origin rejection, exact credential comparison, exclusive collector locking, sanitized disk persistence, resume, and uncertain-pop failure with no automatic retry.
- Prettier check passed; no upstream Go implementation files changed.
- Collector uses only injected fake fetch responses in tests. No real queue, inference endpoint, user credential, subscription, PC, T3 agent, or existing proxy was accessed.
- A one-batch collector is not an activated background collection service. Pop-before-persist loss remains possible because upstream has no acknowledgement transaction. Ownership lock is local, not distributed.
- Authentication protects the local loopback console. Remote HTTPS/SSO/multi-user deployment remains unqualified.
- Quotas, actual billing, route mutation and credential management remain intentionally unsupported rather than simulated controls.
- Browser visual QA remains pending; shared browser is reserved for the active call.

## Explicit account-status control follow-up (2026-11-13)

- 46/46 tests pass, including disabled-by-default controls, authenticated same-origin JSON requests, bounded action bodies, preview/cancel/confirm UI, single-use/expired confirmations, stale identities, changed prior state, virtual/memory exclusions, verified readback and uncertain outcomes without retry.
- Upstream route and handler contract inspected in this checkout; no real management endpoint was called.
- Only file-credential routing eligibility is editable. Runtime/config/plugin virtual credentials, OAuth, upload/delete, quota reset, billing and route configuration are excluded.
- Upstream has no compare-and-set transaction; concurrent administrators remain an operational race risk. Production and visual browser validation remain pending.

## Conditional routing editor follow-up (2026-11-13)

- 58/58 local Node tests pass. New coverage includes strong/missing ETags, exact subpath payloads, conditional writes, 412 conflicts, expired/replayed confirmations, readback, alias optional fields, preview/cancel UI, in-flight outcome visibility and authenticated HTTP → adapter → simulated upstream integration.
- Independent review found malformed URL targets could reject outside the handler; now return 400 with regression coverage. It also found in-flight route writes could lose visible outcomes when navigating; panel controls now lock and completion is posted to the persistent notice even if the panel was detached.
- Local upstream Go `TestConfigV8ETagIfMatch` passed, confirming the inspected conditional-write contract. Full server build and Prettier passed. No upstream implementation changed.
- Missing alias configuration, unsupported fields and absent strong ETags fail closed; no wholesale config reads or writes. The config handler can normalize YAML when saving.
- No real endpoint was called, no deployment occurred, and browser visual QA is still pending.

## Accessibility and final hardening follow-up (2026-11-13)

- 66/66 Node tests pass, including page-heading focus, table scopes, persistent operation announcements, named account actions, sibling-action lockout, oversized telemetry file rejection, UTF-8 credential bounds and concurrent preview limits.
- Fixed check-before-await races in both preview maps: 110 parallel requests produce exactly 100 accepted previews and 10 rejections, no writes.
- Fixed Unicode passwords accepted at startup but larger than the Basic header limit: upper bound now applies to UTF-8 bytes.
- Telemetry file input is bounded before parsing; optional-manager-only mode no longer incorrectly advertises demo.
- Browser and screen-reader QA remain pending. DOM/structural checks do not constitute full accessibility certification.

## Browser visual and keyboard QA (2026-11-13)

After the executor loopback was inaccessible from CUA, the same demo server was started through the cloud computer's native terminal with the already-installed Node runtime. No installation, public tunnel, user PC, account or external API was used.

- CUA opened a separate localhost tab and inspected all eight screens.
- Desktop (1180 CSS px), narrow (598 px) and compact (500 px) layouts showed no document-level horizontal overflow. Tables retained local scrolling. Widths below 500 px and physical touch devices were not tested.
- Verified activity failure filter (four synthetic failures), details modal, Escape dismissal, route attribution example, clear/restore session, and explicit disabled-management messages.
- Found a real keyboard defect: the skip link changed hash routing to Overview. Fixed it to retain the current route and focus main; browser retest confirmed Models remained selected and main received focus.
- Corrected provider aggregates mislabeled as executor and translated display evidence labels. Executor remains independently reported or unknown in request details.
- Restored the browser window to its initial desktop width. The unrelated Infisical tab was not modified.
- 66/66 automated tests still pass after fixes. Connected authentication/write controls remain mock-tested rather than browser-qualified against a live source. This is not screen-reader/WCAG certification.

## 2026-11-13: isolated integration lab

- Added opt-in mock-only Infisical/Executor/model-console architecture preview.
- `npm run check`: 75 tests passed (including 9 new lab API, policy and DOM flow tests).
- `npm run format:check`: passed.
- Go 1.26.10 `go build -o /tmp/gateway-lab-build ./cmd/server`: passed; no Go source changes.
- Independent review identified mixed-mode construction and tool-array coercion;
  both corrected with regression tests before checkpointing.
- Browser-rendered visual QA of the new page has not yet been performed in this
  checkpoint. DOM tests cover query, request, confirm, cancel, block and scope denial.
- No live Infisical/Executor API, real machine identity, secret, user subscription,
  provider call, production computer or external write was used.
- Pending confirmations are not restored to the frontend after reload; server
  expires them after 60 seconds. This is an explicitly isolated prototype.

### Integration lab browser follow-up

- Cloud Chromium tab 12 opened `/lab.html` at port 4175, using a dedicated
  cloud Terminal tab (not the user's PC and not the existing console server).
- Inspected rendered dark three-layer layout and policy panel at 1180 CSS px;
  document scroll width 1165 px, no horizontal page overflow.
- Browser-verified fixture documentation lookup, pending confirmation, confirmed
  MOCK-001 result with `createdExternally:false`, blocked deploy, and denied
  production scope. Sanitized trail updated after each operation.
- No real service or credential involved. Narrow-layout visual QA and screen
  reader testing remain unperformed; automated DOM cancellation tests passed.
