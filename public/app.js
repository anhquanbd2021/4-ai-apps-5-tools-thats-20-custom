import {
  APPS, TOOLS,
  connectorCount, createTopology, addTool, addApp, probe, driftReport,
} from './lab.mjs';

const $ = sel => document.querySelector(sel);
const bay = $('#bay');
const countBadge = $('#count-badge');
const matrixBadge = $('#matrix-badge');
const serverCheck = $('#server-check');
const probeList = $('#probe-results');
const verdict = $('#probe-verdict');

const NEXT_TOOLS = [
  { id: 'redis', name: 'Redis', kind: 'tool' },
  { id: 'sentry', name: 'Sentry', kind: 'tool' },
  { id: 'stripe', name: 'Stripe', kind: 'tool' },
];
const NEXT_APPS = [
  { id: 'deploy-bot', name: 'Deploy Bot', kind: 'app' },
  { id: 'metrics-agent', name: 'Metrics Agent', kind: 'app' },
  { id: 'oncall-pal', name: 'On-call Pal', kind: 'app' },
];

let topology = createTopology({ mode: 'bespoke' });
let fresh = new Set();
let probed = false;

const PROBE_REQUEST = { sql: 'SELECT id, email, phone FROM customers LIMIT 3' };

function el(tag, cls) {
  const d = document.createElement(tag);
  d.className = cls;
  return d;
}

function jackCell(item, cls) {
  const d = el('div', `jack ${cls}`);
  d.innerHTML = `<code>${item.id}</code><span class="sock" aria-hidden="true"></span>`;
  return d;
}

function connectorCard(c) {
  const d = el('div', `conn dir-${c.direction === 'read' ? 'read' : 'rw'}`
    + `${c.shape === 'records' ? ' drift' : ''}${fresh.has(c.id) ? ' fresh' : ''}`);
  d.title = `${c.id} — ${c.direction}, shape ${c.shape}`;
  d.innerHTML = `<span class="sock" aria-hidden="true"></span>`
    + `<span class="dir" aria-hidden="true">${c.direction === 'read' ? '→' : '⇄'}</span>`
    + `<span class="chores" title="build · test · secure · maintain">B·T·S·M</span>`;
  return d;
}

function adapterCard(c) {
  const d = el('div', `adapter ${c.kind}${fresh.has(c.id) ? ' fresh' : ''}`);
  d.title = `${c.id} — ${c.direction}`;
  d.innerHTML = `<span class="sock" aria-hidden="true"></span><code>${c.id}</code>`
    + `<span class="dir" aria-hidden="true">⇄</span>`;
  return d;
}

function renderBay() {
  bay.innerHTML = '';
  bay.className = `bay mode-${topology.mode}`;
  const grid = el('div', 'bay-grid');
  grid.style.setProperty('--tools', String(topology.tools.length));
  grid.appendChild(el('div', 'corner'));
  for (const tool of topology.tools) grid.appendChild(jackCell(tool, 'tool-jack'));

  if (topology.mode === 'mcp') {
    grid.appendChild(el('div', 'rail-pad'));
    for (const c of topology.connectors.filter(k => k.kind === 'server')) {
      grid.appendChild(adapterCard(c));
    }
    const spine = el('div', 'spine');
    spine.innerHTML = '<span>MCP · shared protocol bus</span>';
    grid.appendChild(spine);
  }

  for (const app of topology.apps) {
    grid.appendChild(jackCell(app, 'app-jack'));
    if (topology.mode === 'mcp') {
      const client = topology.connectors.find(c => c.id === `client:${app.id}`);
      const card = adapterCard(client);
      card.style.gridColumn = '2 / -1';
      grid.appendChild(card);
    } else {
      for (const tool of topology.tools) {
        const c = topology.connectors.find(k => k.id === `${app.id}:${tool.id}`);
        grid.appendChild(connectorCard(c));
      }
    }
  }
  bay.appendChild(grid);
}

function renderCounts() {
  const n = connectorCount(topology);
  const unit = topology.mode === 'bespoke' ? 'connectors' : 'adapters';
  countBadge.textContent = `${n} ${unit}`;
  countBadge.className = `badge ${topology.mode === 'mcp' ? 'pass' : 'warn'}`;
  matrixBadge.textContent = topology.mode === 'bespoke'
    ? `${topology.apps.length} × ${topology.tools.length}`
    : `${topology.apps.length} + ${topology.tools.length}`;
  fetch(`/api/count?mode=${topology.mode}&apps=${topology.apps.length}&tools=${topology.tools.length}`)
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(j => { serverCheck.textContent = `server recount: ${j.count} ${unit}`; })
    .catch(() => { serverCheck.textContent = ''; });
}

function runProbe() {
  probed = true;
  const results = probe(topology, 'postgres', PROBE_REQUEST);
  const report = driftReport(topology, 'postgres');
  const divergent = new Set(report.divergent);
  probeList.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = `probe ${divergent.has(r.connectorId) ? 'divergent' : 'uniform'}`;
    const payload = JSON.stringify(r.ok ? r.result : { error: r.error }, null, 1);
    li.innerHTML = `<code class="pid">${r.connectorId}</code><pre>${payload}</pre>`;
    probeList.appendChild(li);
  }
  verdict.textContent = report.divergent.length
    ? `drift — ${report.divergent.join(', ')} answers with shape {records} and drops NULLs while the rest return {rows}. Every connector still passes its own tests.`
    : `uniform — ${results.length} paths, 1 payload shape. One server, one behavior.`;
  verdict.className = `verdict ${report.divergent.length ? 'warn' : 'pass'}`;
}

function render() {
  renderBay();
  renderCounts();
  if (probed) runProbe();
}

for (const input of document.querySelectorAll('input[name="mode"]')) {
  input.addEventListener('change', () => {
    topology = createTopology({
      mode: input.value,
      apps: topology.apps,
      tools: topology.tools,
    });
    fresh = new Set();
    render();
  });
}

$('#add-tool').addEventListener('click', () => {
  const pool = NEXT_TOOLS[topology.tools.length - TOOLS.length];
  const tool = pool ?? { id: `tool-${topology.tools.length + 1}`, name: `Tool ${topology.tools.length + 1}`, kind: 'tool' };
  const r = addTool(topology, tool);
  topology = r.topology;
  fresh = new Set(r.added.map(c => c.id));
  render();
});

$('#add-app').addEventListener('click', () => {
  const pool = NEXT_APPS[topology.apps.length - APPS.length];
  const app = pool ?? { id: `app-${topology.apps.length + 1}`, name: `App ${topology.apps.length + 1}`, kind: 'app' };
  const r = addApp(topology, app);
  topology = r.topology;
  fresh = new Set(r.added.map(c => c.id));
  render();
});

$('#reset').addEventListener('click', () => {
  topology = createTopology({ mode: topology.mode });
  fresh = new Set();
  render();
});

$('#probe').addEventListener('click', runProbe);

render();
