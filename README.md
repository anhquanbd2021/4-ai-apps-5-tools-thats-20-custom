# The Connector Patch Bay — companion demo

Interactive lab for the article *4 Apps, 5 Tools, 20 Integrations — How One
Protocol Turns M×N into M+N*. Four AI apps face five tools; wire them
bespoke and every pair is a connector, or flip the bay to MCP and each side
plugs into one shared protocol bus.

Zero dependencies — Node 24+ only. The topology model is a single ES module
(`public/lab.mjs`) shared by the browser UI, the CLI, and the test suite.

## What it proves

- **M×N collapses to M+N.** Toggling bespoke → mcp unplugs 20 patch cables
  and re-routes them through the brass bus: `connectorCount` goes 20 → 9.
- **Growth explodes in bespoke.** *Add a tool* costs one connector per app
  (+4); *Add an app* costs one per tool (+5). In MCP each costs +1 adapter.
- **Duplicated connectors drift.** *Probe Postgres* sends one `SELECT`
  through every path: in bespoke the support chatbot's hand-rolled connector
  answers `{records:[…]}` with NULLs dropped while the other three answer
  `{rows:[…]}` — all four pass their own tests. In MCP all four are
  byte-identical.
- **Arrows point both ways.** Two bespoke Postgres connectors shipped
  read-only (`→` badge, write probes refused); every MCP adapter is
  read-write (`⇄`).

## Run it

```text
npm start        # serve the lab on :3000
npm test         # unit + server contract + e2e failure scenario
npm run matrix   # CLI: the 4×5 grid, 20 vs 9, drift report
npm run check    # both
```

`node scripts/matrix.mjs --mcp --add-tool redis` patches in a sixth tool and
prints the +1 vs +4 difference in a terminal.

## Layout

- `public/lab.mjs` — the whole model: `APPS`, `TOOLS`, `DRIFT`,
  `connectorCount`, `createTopology`, `addTool`, `addApp`, `probe`,
  `driftReport`
- `public/app.js` — patch-bay grid wiring, plain DOM, imports `./lab.mjs`
- `app/server.js` — static host: `/health`, `/version`, `/api/count`
- `examples/` — readable scenario wrappers for the two wiring worlds
- `scripts/matrix.mjs` — the CLI matrix
- `test/` — `node --test "test/*.test.mjs"`

## Honest limits

- Connectors are deterministic fixtures — real ones hide auth, retries,
  pagination, and rate limits.
- Drift is seeded in exactly one connector; real duplicated integrations
  diverge in subtler ways.
- The read-only cables illustrate direction only — a real MCP deployment
  still needs an authorization layer you design yourself.
- The counter is structural arithmetic, not a cost estimate: adapters still
  take real work, just once per side instead of once per pair.

This is an educational demo, not production infrastructure.

Repo: <https://github.com/anhquanbd2021/4-ai-apps-5-tools-thats-20-custom>
