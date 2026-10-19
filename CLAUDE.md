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

A knowledge graph of this repo lives in `graphify-out/` (408 nodes, 1019 edges,
59 communities), rebuilt by a post-commit, post-checkout and post-merge hook. It
maps symbols to files, lines and each other, which is the fastest way to find
your way around a production repo without opening half of it.

It changes nothing about the rule at the top of this file. The graph is for
reading. Edits, deploys and database access still need Braeden's say-so in the
current conversation.

Commands worth reaching for:

- `graphify query "<question>"` to find where something lives when you do not
  already know the file. **Pass `--budget`**: the 2000-token default truncates
  silently on anything broad. The output states the budget the complete answer
  needs, so raise it and re-run rather than acting on a partial subgraph.
- `graphify affected "<symbol>"` before proposing a change to anything shared.
  Reverse traversal, so it answers "what breaks if this changes" in one shot.
  On a live site with real customers, that question is the whole job.
- `graphify path "<A>" "<B>"` for how two things connect, and
  `graphify explain "<X>"` for one symbol and its neighbors.
- `graphify god-nodes` for the architectural hubs.
- `graphify diagnose multigraph` if you suspect the graph is merging distinct
  edges. This repo reports 0 collapsed edges as of 2026-10-19.

What it is NOT good at, so do not force it:

- **Exact strings, flags, config keys and copy: use grep.** The graph indexes
  symbols, not text.
- **Community names are unreliable here.** Measured examples from this repo:
  `securityHeaders.js` and `handleFacebookFeed()` are both labeled "Order
  Fulfillment API", and `refundTransaction()` is labeled "checkout.js". Trust
  the edges and the file/line refs; treat a cluster name as a loose hint.
- It cannot tell you whether a comment is still true. Two stale comments in
  this repo claimed payments were not live, long after they were. Check
  wrangler vars, secrets and the deployed endpoints, not the prose.
- `GRAPH_REPORT.md` is for broad architecture review only. There is no
  `graphify-out/wiki/`; no graphify command generates one.

Cross-repo, for porting a pattern from here into timberline (the Authorize.net
and Accept.js flow being the live example):

```
node ~/.graphify/merged/refresh.mjs          # re-merge after either repo rebuilds
graphify query "<question>" --graph ~/.graphify/merged/graph.json --budget 6000
```

Every path in that graph is prefixed with its repo, because both repos have a
`src/worker.js` and acting on the wrong one means editing this one by mistake.
The direction is always read here, write there. Expect 0 edges between the two
repos: it is for comparing implementations side by side, not tracing a
dependency across them.

Housekeeping:

- `graphify update .` keeps the graph current (AST only, no API cost). The
  commit hook already does this.
- `graphify-out/`, `.gitattributes` and `.claude/` are gitignored, so the graph
  is local and a fresh clone starts without one.
- `graphify-out/graph.json` is rewritten whole on every build, so a large diff
  is expected. Do not flag it as churn or suggest skipping the hooks.
