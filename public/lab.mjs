// lab.mjs — the Connector Patch Bay domain model.
// Single source of truth, imported by the browser app, the CLI, and the tests.
//
// The claim under test: pairwise bespoke connectors cost M×N and drift; a
// shared protocol layer costs M+N and behaves identically for every app.

export const APPS = [
  { id: 'ide-copilot', name: 'IDE Copilot', kind: 'app' },
  { id: 'support-chat', name: 'Support Chatbot', kind: 'app' },
  { id: 'triage-agent', name: 'Triage Agent', kind: 'app' },
  { id: 'review-bot', name: 'Review Bot', kind: 'app' },
];

export const TOOLS = [
  { id: 'postgres', name: 'Postgres', kind: 'tool' },
  { id: 'github', name: 'GitHub', kind: 'tool' },
  { id: 'slack', name: 'Slack', kind: 'tool' },
  { id: 'jira', name: 'Jira', kind: 'tool' },
  { id: 'filesystem', name: 'Filesystem', kind: 'tool' },
];

export const MODES = ['bespoke', 'mcp'];

// Seeded divergence: the support chatbot's hand-rolled Postgres connector
// returns {records:[...]} and silently drops NULL fields while every other
// connector returns {rows:[...]}. Every implementation passes its own tests.
export const DRIFT = {
  postgres: { connector: 'support-chat', shape: 'records', dropsNulls: true },
};

// Two bespoke Postgres connectors shipped scoped SELECT-only: the arrows on
// those cables point one way. MCP adapters are always read-write.
const READ_ONLY = new Set(['triage-agent:postgres', 'review-bot:postgres']);

// Frozen "real" tool responses. Every connector — bespoke or MCP — reads the
// same bytes; what differs is the shape each hand-built connector wraps them in.
const CANONICAL = {
  postgres: [
    { id: 1, email: 'ada@example.com', phone: null },
    { id: 2, email: 'grace@example.com', phone: '+1-555-0142' },
    { id: 3, email: 'edsger@example.com', phone: null },
  ],
  github: [
    { pr: 412, title: 'Fix retry backoff', state: 'open' },
    { pr: 418, title: 'Bump pg driver', state: 'merged' },
  ],
  slack: [
    { channel: '#incidents', text: 'deploy 2.14 rolled back' },
    { channel: '#alerts', text: 'pg replica lag 41s' },
  ],
  jira: [
    { key: 'OPS-1201', status: 'open', summary: 'stuck order batch' },
    { key: 'OPS-1198', status: 'done', summary: 'rotate api keys' },
  ],
  filesystem: [
    { path: '/var/log/app.log', bytes: 831102 },
    { path: '/etc/app/config.yml', bytes: 2044 },
  ],
};

const connectorId = (appId, toolId) => `${appId}:${toolId}`;

function bespokeConnectors(apps, tools) {
  const connectors = [];
  for (const app of apps) {
    for (const tool of tools) {
      const id = connectorId(app.id, tool.id);
      const drift = DRIFT[tool.id];
      connectors.push({
        id,
        app: app.id,
        tool: tool.id,
        kind: 'connector',
        direction: READ_ONLY.has(id) ? 'read' : 'read-write',
        shape: drift && drift.connector === app.id ? drift.shape : 'rows',
      });
    }
  }
  return connectors;
}

function mcpConnectors(apps, tools) {
  return [
    ...apps.map(app => ({
      id: `client:${app.id}`, app: app.id, tool: null,
      kind: 'client', direction: 'read-write', shape: 'mcp',
    })),
    ...tools.map(tool => ({
      id: `server:${tool.id}`, app: null, tool: tool.id,
      kind: 'server', direction: 'read-write', shape: 'mcp',
    })),
  ];
}

export function connectorCount({ mode, apps = APPS, tools = TOOLS }) {
  if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`);
  return mode === 'bespoke' ? apps.length * tools.length : apps.length + tools.length;
}

export function createTopology({ mode = 'bespoke', apps = APPS, tools = TOOLS } = {}) {
  if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`);
  const connectors = mode === 'bespoke' ? bespokeConnectors(apps, tools) : mcpConnectors(apps, tools);
  const edges = mode === 'bespoke'
    ? connectors.map(c => ({ from: c.app, to: c.tool, via: c.id }))
    : [
        ...apps.map(a => ({ from: a.id, to: 'mcp', via: `client:${a.id}` })),
        ...tools.map(t => ({ from: 'mcp', to: t.id, via: `server:${t.id}` })),
      ];
  return { mode, apps, tools, connectors, edges };
}

export function addTool(topology, tool) {
  const next = createTopology({
    mode: topology.mode,
    apps: topology.apps,
    tools: [...topology.tools, tool],
  });
  const added = topology.mode === 'bespoke'
    ? topology.apps.map(app => next.connectors.find(c => c.id === connectorId(app.id, tool.id)))
    : [next.connectors.find(c => c.id === `server:${tool.id}`)];
  return { topology: next, added };
}

export function addApp(topology, app) {
  const next = createTopology({
    mode: topology.mode,
    apps: [...topology.apps, app],
    tools: topology.tools,
  });
  const added = topology.mode === 'bespoke'
    ? topology.tools.map(tool => next.connectors.find(c => c.id === connectorId(app.id, tool.id)))
    : [next.connectors.find(c => c.id === `client:${app.id}`)];
  return { topology: next, added };
}

const stripNulls = row =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));

function respond(connector, toolId, request) {
  if (request.write && connector.direction === 'read') {
    return { connectorId: connector.id, ok: false, error: 'read-only connector cannot write' };
  }
  const rows = (CANONICAL[toolId] ?? []).map(r => ({ ...r }));
  const drift = DRIFT[toolId];
  if (connector.shape === 'records' && drift?.dropsNulls) {
    return { connectorId: connector.id, ok: true, result: { records: rows.map(stripNulls) } };
  }
  return { connectorId: connector.id, ok: true, result: { rows } };
}

// Run one request through every path from the apps to `toolId`.
// Bespoke: one connector per app, each its own implementation — drift shows.
// MCP: every client hits the same server adapter, so results are identical.
export function probe(topology, toolId, request = {}) {
  if (!topology.tools.some(t => t.id === toolId)) return [];
  if (topology.mode === 'bespoke') {
    return topology.connectors
      .filter(c => c.tool === toolId)
      .map(c => respond(c, toolId, request));
  }
  const server = topology.connectors.find(c => c.id === `server:${toolId}`);
  return topology.connectors
    .filter(c => c.kind === 'client')
    .map(client => {
      const r = respond(server, toolId, request);
      return { ...r, connectorId: `${client.id}+${server.id}` };
    });
}

export function driftReport(topology, toolId) {
  const results = probe(topology, toolId);
  const byPayload = new Map();
  for (const r of results) {
    const key = JSON.stringify(r.ok ? r.result : { error: r.error });
    byPayload.set(key, [...(byPayload.get(key) ?? []), r.connectorId]);
  }
  const majority = [...byPayload.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const shapes = [...new Set(
    results.map(r => (r.ok ? Object.keys(r.result)[0] : 'error')),
  )].sort();
  return {
    divergent: results.map(r => r.connectorId).filter(id => !majority.includes(id)),
    shapes,
  };
}
