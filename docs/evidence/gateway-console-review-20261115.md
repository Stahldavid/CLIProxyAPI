# Isolated gateway console review — 2026-11-15

## Scope and provenance

Reviewed fork `aeac8909f1886c305163e84bcec6237cd68f2700` in a fresh isolated checkout. Compared source/README with upstream CPA `e96d4c4818851cf0e96d27b2bc8b67379e449d9e`, Home `f31b149c18c50a84fdb9f6ba5194a45754ad0749` and HMC `56c9051bc97a36309f6ce59d55d50e7620dc0d24`. No merge, deployment, credential reads, real provider calls, queue consumption, or changes to the user's PC/VM occurred.

## Native capability comparison

Home is the control plane; CPA nodes execute inference; HMC is Home's official administration UI. HMC already covers accounts, client keys, models, usage, logs, config and node information. Its README lists English, Chinese and Russian, not Portuguese. Our console's concrete differences are its Portuguese attribution-oriented UI, intentionally narrow projections, and isolated mock lab. It is not a cluster scheduler, not an ingress failover service, and not a Home adapter.

Do not add a second cluster implementation to this console. First qualify Home/HMC for the actual topology, then retain only justified attribution/UX improvements. Existing CPA v8 management routes must not be assumed to match Home routes. Do not expose this local-only console over Tailnet before implementing and verifying remote authentication/TLS. Do not combine its optional destructive queue collector with another consumer. This source comparison is not live Home or multi-node validation.

References:
- https://github.com/router-for-me/CLIProxyAPIHome
- https://github.com/router-for-me/Home-Management-Center
- https://github.com/router-for-me/CLIProxyAPI/blob/main/docker-compose.cluster.yml

## Reproduced and fixed UI defects

1. An imported syntactically valid JSON with invalid records (e.g. `[null]`) cleared the current management connection before validation failed. The notice claimed preservation, but account/model inventory disappeared on navigation. The fix validates to a temporary value before committing any state.
2. A slow file import could overwrite a newer clear/reset/refresh/import. The fix uses the existing source revision mechanism before asynchronous file reading, discards stale completions/errors, and avoids clearing the newer input selection.

Regression coverage includes invalid-normalization inventory preservation and slow-import-after-clear. These use synthetic data only and do not create an additional routing engine.

## Verification

- Baseline: 84 tests passed.
- Red regression: invalid-normalization test failed, showing Account 1 missing from the connected inventory.
- After fix: `npm run check`, 84 tests passed (additional assertions in existing UI scenario).
- `npm run format:check`: passed.
- `git diff --check`: passed.
- Browser script attempted against isolated demo on loopback port 44173: Chromium launch blocked by environment socket permission/crashpad setup; no visual QA claimed.
- Required Go build not run successfully: this environment's `/usr/bin/go` is not the Go compiler (`go version` returns `Unknown option: version`). No Go sources changed. Full upstream suite not run.
- Initial npm install failed because default cache was unavailable; retry with dedicated `/tmp` cache succeeded. No lockfile changes.

## Remaining acceptance gates

Read actual PC/VM versions and safe configuration metadata; qualify credentials/refresh ownership without duplicating grants; configure synthetic two-node Home in isolation; test ingress and node failures separately; verify each harness protocol, streaming/tools/resumption; validate Azure deployment endpoint and actual credit eligibility. Real credentials, real API calls, migration and replacement of the current proxy remain outside this review.
