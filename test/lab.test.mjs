import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPS, TOOLS, MODES, DRIFT,
  connectorCount, createTopology, addTool, addApp, probe, driftReport,
} from '../public/lab.mjs';

const REDIS = { id: 'redis', name: 'Redis', kind: 'tool' };
const DEPLOY_BOT = { id: 'deploy-bot', name: 'Deploy Bot', kind: 'app' };

test('the stock bay is 4 apps x 5 tools', () => {
  assert.equal(APPS.length, 4);
  assert.equal(TOOLS.length, 5);
  assert.deepEqual(MODES, ['bespoke', 'mcp']);
  assert.equal(DRIFT.postgres.connector, 'support-chat');
});

test('connectorCount is M*N bespoke and M+N mcp', () => {
  assert.equal(connectorCount({ mode: 'bespoke' }), 20);
  assert.equal(connectorCount({ mode: 'mcp' }), 9);
  assert.equal(
    connectorCount({ mode: 'bespoke', apps: [...APPS, DEPLOY_BOT], tools: [...TOOLS, REDIS] }),
    30,
  );
  assert.equal(
    connectorCount({ mode: 'mcp', apps: [...APPS, DEPLOY_BOT], tools: [...TOOLS, REDIS] }),
    11,
  );
  assert.throws(() => connectorCount({ mode: 'sidebar' }), RangeError);
});

test('bespoke topology: one connector per cell, read-only seeds flagged', () => {
  const t = createTopology({ mode: 'bespoke' });
  assert.equal(t.connectors.length, 20);
  assert.equal(t.edges.length, 20);
  const pg = t.connectors.filter(c => c.tool === 'postgres');
  assert.equal(pg.length, 4);
  assert.deepEqual(
    pg.filter(c => c.direction === 'read').map(c => c.id).sort(),
    ['review-bot:postgres', 'triage-agent:postgres'],
  );
  assert.equal(pg.find(c => c.app === 'support-chat').shape, 'records');
});

test('mcp topology: one adapter per side, all read-write', () => {
  const t = createTopology({ mode: 'mcp' });
  assert.equal(t.connectors.length, 9);
  assert.equal(t.edges.length, 9);
  assert.equal(t.connectors.filter(c => c.kind === 'client').length, 4);
  assert.equal(t.connectors.filter(c => c.kind === 'server').length, 5);
  assert.ok(t.connectors.every(c => c.direction === 'read-write'));
});

test('failure mode 1: adding a tool costs +4 bespoke vs +1 mcp', () => {
  const b = addTool(createTopology({ mode: 'bespoke' }), REDIS);
  assert.equal(b.added.length, 4);
  assert.ok(b.added.every(c => c.tool === 'redis' && c.kind === 'connector'));
  assert.equal(b.topology.connectors.length, 24);

  const m = addTool(createTopology({ mode: 'mcp' }), REDIS);
  assert.equal(m.added.length, 1);
  assert.equal(m.added[0].id, 'server:redis');
  assert.equal(m.topology.connectors.length, 10);
});

test('adding an app costs +5 bespoke vs +1 mcp', () => {
  const b = addApp(createTopology({ mode: 'bespoke' }), DEPLOY_BOT);
  assert.equal(b.added.length, 5);
  const m = addApp(createTopology({ mode: 'mcp' }), DEPLOY_BOT);
  assert.equal(m.added.length, 1);
  assert.equal(m.added[0].id, 'client:deploy-bot');
});

test('failure mode 2: bespoke probe of postgres diverges per DRIFT', () => {
  const t = createTopology({ mode: 'bespoke' });
  const results = probe(t, 'postgres', { sql: 'SELECT id, email, phone FROM customers' });
  assert.equal(results.length, 4);
  const drifty = results.find(r => r.connectorId === 'support-chat:postgres');
  assert.ok(drifty.ok);
  assert.ok('records' in drifty.result);
  // NULLs dropped: the record has no phone key at all.
  assert.deepEqual(drifty.result.records[0], { id: 1, email: 'ada@example.com' });
  const normal = results.filter(r => r.connectorId !== 'support-chat:postgres');
  assert.ok(normal.every(r => 'rows' in r.result));
  assert.equal(normal[0].result.rows[0].phone, null);
});

test('mcp probe of postgres is uniform — one server, one behavior', () => {
  const t = createTopology({ mode: 'mcp' });
  const results = probe(t, 'postgres', { sql: 'SELECT id, email, phone FROM customers' });
  assert.equal(results.length, 4);
  const payloads = new Set(results.map(r => JSON.stringify(r.result)));
  assert.equal(payloads.size, 1);
  assert.ok(results.every(r => 'rows' in r.result));
});

test('a write probe fails on seeded read-only connectors, not on mcp', () => {
  const writeReq = { sql: 'UPDATE orders SET refunded = true', write: true };
  const b = probe(createTopology({ mode: 'bespoke' }), 'postgres', writeReq);
  const refused = b.filter(r => !r.ok).map(r => r.connectorId).sort();
  assert.deepEqual(refused, ['review-bot:postgres', 'triage-agent:postgres']);
  const m = probe(createTopology({ mode: 'mcp' }), 'postgres', writeReq);
  assert.ok(m.every(r => r.ok));
});

test('driftReport names the divergent connector bespoke, none mcp', () => {
  const b = driftReport(createTopology({ mode: 'bespoke' }), 'postgres');
  assert.deepEqual(b.divergent, ['support-chat:postgres']);
  assert.deepEqual(b.shapes, ['records', 'rows']);
  const m = driftReport(createTopology({ mode: 'mcp' }), 'postgres');
  assert.deepEqual(m.divergent, []);
  assert.deepEqual(m.shapes, ['rows']);
});

test('probe of an unknown tool returns nothing; added tool is probeable', () => {
  const t = createTopology({ mode: 'bespoke' });
  assert.deepEqual(probe(t, 'nope'), []);
  const { topology } = addTool(t, REDIS);
  assert.equal(probe(topology, 'redis').length, 4);
});
