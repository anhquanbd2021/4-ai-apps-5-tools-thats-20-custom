import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer } from '../app/server.js';
import { once } from 'node:events';

async function withServer(fn) {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('/health and /version respond; static allowlist serves the lab', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');

    const version = await fetch(`${base}/version`);
    assert.equal(version.status, 200);
    assert.equal((await version.json()).name, '4-ai-apps-5-tools-thats-20-custom-demo');

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /Patch Bay/);
    assert.match(html, /<nav aria-label="Primary">/);

    const guide = await fetch(`${base}/guide.html`);
    assert.equal(guide.status, 200);
    assert.match(await guide.text(), /aria-current="page" href="\/guide\.html"/);

    for (const path of ['/app.js', '/lab.mjs', '/styles.css', '/pb-shell.css', '/pb-back.css']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
  });
});

test('/api/count returns the bespoke and mcp arithmetic', async () => {
  await withServer(async base => {
    const bespoke = await fetch(`${base}/api/count?mode=bespoke&apps=4&tools=5`);
    assert.equal(bespoke.status, 200);
    assert.deepEqual(await bespoke.json(), { mode: 'bespoke', apps: 4, tools: 5, count: 20 });

    const mcp = await fetch(`${base}/api/count?mode=mcp&apps=4&tools=5`);
    assert.equal((await mcp.json()).count, 9);

    assert.equal((await fetch(`${base}/api/count?mode=sideways&apps=4&tools=5`)).status, 400);
    assert.equal((await fetch(`${base}/api/count?mode=mcp&apps=x&tools=5`)).status, 400);
  });
});

test('unknown paths and traversal return 404; HEAD works', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/app/server.js`)).status, 404);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});
