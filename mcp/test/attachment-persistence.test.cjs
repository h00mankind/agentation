const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createSQLiteStore, getStore, clearAll } = require('../.test-dist/integration.js');

const sample = { x: 10, y: 20, comment: 'Match this', element: 'img', elementPath: 'body > img', timestamp: Date.now() };
const shot = { id: 'ab'.repeat(32), mimeType: 'image/png', width: 1440, height: 900, path: '/data/attachments/x.png' };
const other = { id: 'cd'.repeat(32), mimeType: 'image/jpeg', width: 800, height: 600, path: '/data/attachments/y.jpg' };

function sqlite(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agentation-attachment-persistence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'test.db');
}

function memory(t) {
  const previous = process.env.AGENTATION_STORE;
  process.env.AGENTATION_STORE = 'memory';
  clearAll();
  t.after(() => {
    clearAll();
    if (previous === undefined) delete process.env.AGENTATION_STORE;
    else process.env.AGENTATION_STORE = previous;
  });
  return getStore();
}

test('attachments survive a SQLite reopen and are kept by unrelated and placement edits', t => {
  const path = sqlite(t);
  const placement = { componentType: 'button', width: 10, height: 10, scrollY: 0 };
  let store = createSQLiteStore(path);
  const session = store.createSession('http://attach.localhost');
  const note = store.addAnnotation(session.id, { ...sample, kind: 'placement', placement, attachments: [shot, other] });
  store.updateAnnotation(note.id, { comment: 'Changed' });
  store.close();

  store = createSQLiteStore(path);
  t.after(() => store.close());
  assert.deepEqual(store.getAnnotation(note.id).attachments, [shot, other]);
  assert.deepEqual(store.updateAnnotation(note.id, { x: 40 }).attachments, [shot, other]);
  const resized = store.updateAnnotation(note.id, { placement: { ...placement, width: 20 } });
  assert.deepEqual(resized.attachments, [shot, other]);
  assert.equal(store.getAnnotation(note.id).placement.width, 20);
});

test('an empty attachments list in an update clears the stored references', t => {
  const path = sqlite(t);
  const store = createSQLiteStore(path);
  t.after(() => store.close());
  const session = store.createSession('http://attach.localhost');
  const note = store.addAnnotation(session.id, { ...sample, attachments: [shot] });
  assert.deepEqual(store.updateAnnotation(note.id, { attachments: [] }).attachments, []);
  assert.deepEqual(store.getAnnotation(note.id).attachments, []);
  assert.deepEqual([...store.referencedAttachmentIds()], []);
});

test('referenced ids cover every annotation and drop ids once no annotation holds them', t => {
  const store = createSQLiteStore(sqlite(t));
  t.after(() => store.close());
  const session = store.createSession('http://attach.localhost');
  const first = store.addAnnotation(session.id, { ...sample, attachments: [shot] });
  store.addAnnotation(session.id, { ...sample, attachments: [shot, other] });
  assert.deepEqual([...store.referencedAttachmentIds()].sort(), [shot.id, other.id].sort());
  store.deleteAnnotation(first.id);
  assert.ok(store.referencedAttachmentIds().has(shot.id));
});

test('memory store keeps attachments through add, edit and reference queries', t => {
  const store = memory(t);
  const session = store.createSession('http://attach.localhost');
  const note = store.addAnnotation(session.id, { ...sample, attachments: [shot] });
  assert.deepEqual(store.getAnnotation(note.id).attachments, [shot]);
  store.updateAnnotation(note.id, { comment: 'Changed' });
  assert.deepEqual(store.getAnnotation(note.id).attachments, [shot]);
  store.updateAnnotation(note.id, { attachments: [other] });
  assert.deepEqual([...store.referencedAttachmentIds()], [other.id]);
});
