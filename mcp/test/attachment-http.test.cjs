const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtempSync, rmSync, existsSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const directory = mkdtempSync(join(tmpdir(), 'agentation-attachment-http-'));
// Attachment files live under HOME/.agentation, so keep them out of the real home directory.
process.env.HOME = directory;
process.env.AGENTATION_TEST_DB_PATH = join(directory, 'test.db');
const { startHttpServer } = require('../.test-dist/http-entry.js');
const { png, jpeg } = require('./image-fixtures.cjs');
after(() => rmSync(directory, { recursive: true, force: true }));

const MIB = 1024 * 1024;
const attachmentsDir = join(directory, '.agentation', 'attachments');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileFor = (id, ext) => join(attachmentsDir, `${id}.${ext}`);

async function server(t) {
  const http = startHttpServer(0);
  await once(http, 'listening');
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}`;
}

function json(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function upload(base, bytes, contentType = 'image/png') {
  return fetch(`${base}/attachments`, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes });
}

async function session(base) {
  return (await fetch(`${base}/sessions`, json({ url: 'http://attach-http.localhost' }))).json();
}

function note(extra = {}) {
  return { x: 10, y: 20, comment: 'Reference', element: 'img', elementPath: 'body > img', timestamp: Date.now(), ...extra };
}

test('uploading a non-image is rejected with 415 and writes nothing', async t => {
  const base = await server(t);
  const res = await upload(base, Buffer.from('<html>not an image</html>'), 'image/png');
  assert.equal(res.status, 415);
  await res.text();
  assert.equal(existsSync(attachmentsDir), false);
});

test('an upload just over 2 MiB is rejected with 413 and nothing is stored', async t => {
  const base = await server(t);
  const oversized = Buffer.concat([png(4, 4), Buffer.alloc(2 * MIB + 1 - png(4, 4).length)]);
  assert.equal(oversized.length, 2 * MIB + 1);
  const res = await upload(base, oversized);
  assert.equal(res.status, 413);
  await res.text();
  assert.equal(existsSync(attachmentsDir), false);
});

test('an upload of exactly 2 MiB is accepted', async t => {
  const base = await server(t);
  const bytes = Buffer.concat([png(4, 4), Buffer.alloc(2 * MIB - png(4, 4).length)]);
  assert.equal(bytes.length, 2 * MIB);
  const res = await upload(base, bytes);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, sha256(bytes));
});

test('a JSON body over 1 MiB is rejected with 413', async t => {
  const base = await server(t);
  const res = await fetch(`${base}/sessions`, json({ url: 'http://big.localhost', padding: 'x'.repeat(MIB) }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /exceeds/);
});

test('re-uploading the same bytes returns the same id, 201 then 200, and one file', async t => {
  const base = await server(t);
  const bytes = png(3, 2);
  const first = await upload(base, bytes);
  assert.equal(first.status, 201);
  const a = await first.json();
  const second = await upload(base, bytes);
  assert.equal(second.status, 200);
  const b = await second.json();
  assert.equal(a.id, sha256(bytes));
  assert.equal(b.id, a.id);
  assert.deepEqual(readdirSync(attachmentsDir).filter(name => name.includes(a.id)), [`${a.id}.png`]);
});

test('real PNG and JPEG dimensions come back through HTTP', async t => {
  const base = await server(t);
  const p = await (await upload(base, png(1440, 900))).json();
  assert.deepEqual([p.mimeType, p.width, p.height], ['image/png', 1440, 900]);
  const j = await (await upload(base, jpeg(640, 480), 'image/jpeg')).json();
  assert.deepEqual([j.mimeType, j.width, j.height], ['image/jpeg', 640, 480]);
});

test('GET returns the stored bytes with the sniffed content type', async t => {
  const base = await server(t);
  const bytes = jpeg(640, 480);
  const { id } = await (await upload(base, bytes, 'image/jpeg')).json();
  const res = await fetch(`${base}/attachments/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('GET rejects non-hex ids with 400 and unknown ids with 404', async t => {
  const base = await server(t);
  for (const id of ['..%2F..%2Fetc%2Fpasswd', 'A'.repeat(64), 'abc', `${'a'.repeat(63)}.`]) {
    const res = await fetch(`${base}/attachments/${id}`);
    assert.equal(res.status, 400, id);
    await res.text();
  }
  const missing = await fetch(`${base}/attachments/${'e'.repeat(64)}`);
  assert.equal(missing.status, 404);
  await missing.text();
});

test('deleting an annotation keeps a file another annotation shares and removes the rest', async t => {
  const base = await server(t);
  const shared = await (await upload(base, png(10, 10))).json();
  const unique = await (await upload(base, png(20, 20))).json();
  const s = await session(base);
  const first = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [shared] })))).json();
  const second = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [shared, unique] })))).json();

  assert.equal((await fetch(`${base}/annotations/${first.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(fileFor(shared.id, 'png')), true);
  assert.equal(existsSync(fileFor(unique.id, 'png')), true);

  assert.equal((await fetch(`${base}/annotations/${second.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(fileFor(shared.id, 'png')), false);
  assert.equal(existsSync(fileFor(unique.id, 'png')), false);
});

test('annotations carry attachments with server paths and reject malformed references', async t => {
  const base = await server(t);
  const stored = await (await upload(base, png(5, 7))).json();
  const s = await session(base);

  const bad = [
    [{ id: 'nothex', mimeType: 'image/png', width: 1, height: 1, path: '/x' }],
    [{ ...stored, mimeType: 'image/gif' }],
    [{ ...stored, width: 0 }],
    [stored, stored, stored, stored, stored],
    'not-an-array',
  ];
  for (const attachments of bad) {
    const res = await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments })));
    assert.equal(res.status, 400, JSON.stringify(attachments).slice(0, 80));
    await res.text();
  }

  const created = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({
    attachments: [{ ...stored, path: '/etc/passwd' }],
  })))).json();
  assert.deepEqual(created.attachments, [{ ...stored, path: fileFor(stored.id, 'png') }]);

  const patched = await (await fetch(`${base}/annotations/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Edited' }),
  })).json();
  assert.deepEqual(patched.attachments, created.attachments);
  assert.equal(existsSync(fileFor(stored.id, 'png')), true);
});

test('patching attachments removes files the annotation dropped and keeps the rest', async t => {
  const base = await server(t);
  const kept = await (await upload(base, png(10, 10))).json();
  const dropped = await (await upload(base, png(20, 20))).json();
  const s = await session(base);
  const created = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [kept, dropped] })))).json();

  const res = await fetch(`${base}/annotations/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [kept] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).attachments.map(a => a.id), [kept.id]);
  assert.equal(existsSync(fileFor(dropped.id, 'png')), false);
  assert.equal(existsSync(fileFor(kept.id, 'png')), true);
});

test('patching away an attachment another annotation still uses keeps its file', async t => {
  const base = await server(t);
  const shared = await (await upload(base, png(30, 30))).json();
  const s = await session(base);
  const first = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [shared] })))).json();
  await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [shared] })));

  const res = await fetch(`${base}/annotations/${first.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).attachments, []);
  assert.equal(existsSync(fileFor(shared.id, 'png')), true);
});

test('webhook payloads carry attachment metadata but never the local path', async t => {
  const { createServer } = require('node:http');
  const received = new Promise(resolve => {
    const receiver = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        res.writeHead(200).end();
        resolve(JSON.parse(body));
      });
    });
    receiver.listen(0, '127.0.0.1', () => {
      process.env.AGENTATION_WEBHOOK_URL = `http://127.0.0.1:${receiver.address().port}/hook`;
      t.after(() => { receiver.close(); delete process.env.AGENTATION_WEBHOOK_URL; });
    });
  });

  const base = await server(t);
  const stored = await (await upload(base, png(6, 4))).json();
  const s = await session(base);
  const created = await (await fetch(`${base}/sessions/${s.id}/annotations`, json(note({ attachments: [stored] })))).json();
  assert.equal(created.attachments[0].path, fileFor(stored.id, 'png'));

  const action = await fetch(`${base}/sessions/${s.id}/action`, json({ output: 'Fix it' }));
  assert.equal(action.status, 200);
  await action.text();

  const payload = await Promise.race([
    received,
    new Promise((_, reject) => setTimeout(() => reject(new Error('webhook not delivered')), 5000)),
  ]);
  assert.deepEqual(payload.annotations[0].attachments, [{ id: stored.id, mimeType: 'image/png', width: 6, height: 4 }]);
  assert.equal(JSON.stringify(payload).includes(attachmentsDir), false);
});
