# Performance Baseline

This document tracks lightweight load/performance baseline numbers for key pages and APIs.

## Method

- Runner: Playwright perf smoke (`tests/e2e/perf-smoke.spec.ts`)
- Authenticated run with seeded "large data" fixture (`/api/test/seed-large-data`)
- Metrics: average, p50, p95 latency
- Environment: local dev server (`http://localhost:3000`)

## Latest baseline

- Date: 2026-02-21
- Command:

```bash
E2E_BASE_URL='http://localhost:3000' E2E_EMAIL='...' E2E_PASSWORD='...' pnpm test:e2e:spec tests/e2e/perf-smoke.spec.ts
```

| Target | avg (ms) | p50 (ms) | p95 (ms) |
|---|---:|---:|---:|
| page:/ | 2314.9 | 2073.0 | 3411.2 |
| page:/login | 764.1 | 756.3 | 793.9 |
| api:/api/jobs?limit=50 | 261.4 | 206.9 | 396.8 |
| api:/api/bids?limit=50 | 227.3 | 216.3 | 280.6 |
| api:/api/cost-codes?limit=50 | 216.6 | 171.8 | 376.0 |

## Notes

- The perf smoke test includes thresholds to catch obvious regressions.
- Update the table after each intentional performance pass or major schema/query change.
