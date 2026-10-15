# golden-valley-guns

Production site for Golden Valley Guns LLC (Shawn, Arizona). Live storefront with real
customers, real card payments, and real FFL transfers.

## THIS IS PRODUCTION. ASK FIRST.

Do not edit files, deploy, or touch the database unless Braeden has said so **in the current
conversation**. Prior approval does not carry over between sessions. Reading and local analysis
are fine; writing is not.

Deploys hit a live payment flow. There is no staging.

## Stack

- Cloudflare Worker (`src/worker.js`) in front of static assets, `nodejs_compat`
- Supabase for data, Authorize.Net for payments, Resend for email
- `pdf-lib` for generated documents, `mimetext` for mail
- Distributor catalog sync: Lipsey's, Davidson's, RSR (separate cron schedules)

## Commands

```
npx wrangler dev
npx wrangler deploy
```

## Two things in wrangler.jsonc that will bite you

1. **`account_id` is pinned on purpose.** Braeden's wrangler login is
   `braeden.culp@elkhorndigital.com`, a member of GVG's account. Without the pin, deploys land
   in the wrong account.
2. **`assets.run_worker_first: true` is load-bearing.** Without it Cloudflare serves static
   files from edge cache and never invokes the Worker, so `src/lib/securityHeaders.js` silently
   stops applying to real pages. Confirmed empirically 2026-07-18.

The file's existing comments explain the cron cadences in detail. Read them before changing a
schedule.

## Layout

- `*.html` at root are the pages. `js/` holds the browser-side scripts.
- `src/api/` is one file per endpoint (checkout, pay, refundOrder, fflSearch, intake, uploads...).
- `src/lib/` holds shared logic: `authorizeNet.js`, `catalogSync.js`, `adminAuth.js`,
  `securityHeaders.js`, `imageCache.js`, `rateLimit.js`, `paymentAttempts.js`,
  `settlementSync.js`, `orderNumber.js`, `stock.js`, `supabaseAdmin.js`, `pdf.js`.
- `src/sync/` holds the distributor integrations (`lipseys.js` and friends); `relay/` holds the
  systemd relay units that feed them.

## Rules

- **No em dashes in site copy.**
- Payment, FFL gating, and compliance disclaimers are legally sensitive. Do not reword or
  restructure them casually.
- The FFL dealer search is ATF-data-backed with a red/yellow/green gate. It needs a monthly
  ATF refresh.
- Never pull a prospect's or customer's photos and logos from their own site into anything here.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
