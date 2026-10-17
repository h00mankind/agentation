const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const directory = mkdtempSync(join(tmpdir(), 'agentation-mcp-attachments-'));
// The MCP process stores fetched files under HOME/.agentation, so keep them out of the real home directory.
process.env.HOME = directory;
const { handleTool, setHttpBaseUrl, attachmentId } = require('../.test-dist/integration.js');
const { png, jpeg } = require('./image-fixtures.cjs');

const BASE = 'http://agentation.test';
const realFetch = global.fetch;
const attachmentsDir = join(directory, '.agentation', 'attachments');
const bytes = png(1440, 900);
const id = attachmentId(bytes);
const localFile = join(attachmentsDir, `${id}.png`);
const remoteRef = { id, mimeType: 'image/png', width: 1440, height: 900, path: `/remote-machine/.agentation/attachments/${id}.png` };

after(() => {
  global.fetch = realFetch;
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(attachmentsDir, { recursive: true, force: true });
  setHttpBaseUrl(BASE);
});

function annotation(attachments) {
  return {
    id: 'note-1',
    sessionId: 'session-1',
    comment: 'Match this',
    element: 'img',
    elementPath: 'body > img',
    timestamp: 1,
    status: 'pending',
    kind: 'feedback',
    attachments,
  };
}

const sessionBody = {
  id: 'session-1',
  url: 'http://agentation.localhost',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  annotations: [annotation([remoteRef])],
};

const pendingBody = { count: 1, annotations: [annotation([remoteRef])] };

function json(body, status = 200) {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function imageResponse(data) {
  return () => new Response(data, { status: 200, headers: { 'content-type': 'image/png' } });
}

// Routes are keyed by pathname. Each handler returns a Response.
function stubFetch(routes) {
  const requested = [];
  global.fetch = async (url, init = {}) => {
    const { pathname } = new URL(String(url));
    requested.push(pathname);
    const route = routes[pathname];
    if (!route) return new Response('{"error":"Not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
    return route(init);
  };
  return requested;
}

function parseText(result) {
  assert.equal(result.content.length, 1, 'output stays a single text block');
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

test('get_session fetches a missing file and rewrites the path to a local absolute path', async () => {
  const requested = stubFetch({
    '/sessions/session-1': json(sessionBody),
    [`/attachments/${id}`]: imageResponse(bytes),
  });

  const session = parseText(await handleTool('agentation_get_session', { sessionId: 'session-1' }));

  assert.equal(session.annotations[0].attachments[0].path, localFile);
  assert.deepEqual(readFileSync(localFile), bytes);
  assert.deepEqual(requested.filter(p => p.startsWith('/attachments/')), [`/attachments/${id}`]);
});

test('a file already on disk is used without another request', async () => {
  mkdirSync(attachmentsDir, { recursive: true });
  writeFileSync(localFile, bytes);
  const requested = stubFetch({ '/sessions/session-1': json(sessionBody) });

  const session = parseText(await handleTool('agentation_get_session', { sessionId: 'session-1' }));

  assert.equal(session.annotations[0].attachments[0].path, localFile);
  assert.equal(requested.some(p => p.startsWith('/attachments/')), false);
});

test('a failed fetch drops the path and keeps the metadata', async () => {
  stubFetch({
    '/sessions/session-1': json(sessionBody),
    [`/attachments/${id}`]: () => new Response('{"error":"gone"}', { status: 404 }),
  });

  const session = parseText(await handleTool('agentation_get_session', { sessionId: 'session-1' }));

  assert.deepEqual(session.annotations[0].attachments[0], {
    id, mimeType: 'image/png', width: 1440, height: 900,
  });
  assert.equal(existsSync(localFile), false);
});

test('bytes that do not hash to the id are never written and the path is dropped', async () => {
  stubFetch({
    '/sessions/session-1': json(sessionBody),
    [`/attachments/${id}`]: imageResponse(png(2, 2)),
  });

  const session = parseText(await handleTool('agentation_get_session', { sessionId: 'session-1' }));

  assert.equal('path' in session.annotations[0].attachments[0], false);
  assert.deepEqual(existsSync(attachmentsDir) ? readdirSync(attachmentsDir) : [], []);
});

test('an id or mime type that could escape the directory is never fetched or used as a path', async () => {
  const hostile = [
    { id: '../../../../tmp/owned', mimeType: 'image/png', width: 1, height: 1 },
    { id, mimeType: 'image/gif', width: 1, height: 1 },
    { id: id.toUpperCase(), mimeType: 'image/png', width: 1, height: 1 },
  ];
  const requested = stubFetch({
    '/sessions/session-1': json({ ...sessionBody, annotations: [annotation(hostile)] }),
  });

  const session = parseText(await handleTool('agentation_get_session', { sessionId: 'session-1' }));

  for (const ref of session.annotations[0].attachments) assert.equal('path' in ref, false);
  assert.equal(requested.some(p => p.startsWith('/attachments/')), false);
});

test('get_pending and get_all_pending localize attachments too', async () => {
  stubFetch({
    '/sessions/session-1/pending': json(pendingBody),
    '/pending': json(pendingBody),
    [`/attachments/${id}`]: imageResponse(bytes),
  });

  const pending = parseText(await handleTool('agentation_get_pending', { sessionId: 'session-1' }));
  assert.equal(pending.annotations[0].attachments[0].path, localFile);

  rmSync(localFile, { force: true });
  const all = parseText(await handleTool('agentation_get_all_pending', {}));
  assert.equal(all.annotations[0].attachments[0].path, localFile);
  assert.deepEqual(readFileSync(localFile), bytes);
});

test('the watch drain returns localized attachments before blocking on SSE', async () => {
  stubFetch({
    '/sessions/session-1/pending': json(pendingBody),
    [`/attachments/${id}`]: imageResponse(bytes),
  });

  const watch = parseText(await handleTool('agentation_watch_annotations', { sessionId: 'session-1' }));

  assert.equal(watch.timeout, false);
  assert.equal(watch.annotations[0].attachments[0].path, localFile);
});
