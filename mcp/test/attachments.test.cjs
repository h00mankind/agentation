const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync, statSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { sniffImage, attachmentId, writeAttachment, readAttachment, parseAttachments, releaseAttachments, gcAttachments, ATTACHMENT_ORPHAN_GRACE_MS } = require('../.test-dist/integration.js');
const { png, jpeg } = require('./image-fixtures.cjs');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agentation-attachments-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'attachments');
}

const DAY = 24 * 60 * 60 * 1000;

test('sniffing accepts real PNG and JPEG bytes and reads width and height in the right order', () => {
  assert.deepEqual(sniffImage(png(3, 2)), { mimeType: 'image/png', width: 3, height: 2 });
  assert.deepEqual(sniffImage(jpeg(640, 480)), { mimeType: 'image/jpeg', width: 640, height: 480 });
});

test('sniffing rejects other formats, truncated headers and zero dimensions', () => {
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1');
  const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
  const pngWithoutIhdr = Buffer.concat([png(1, 1).subarray(0, 8), Buffer.alloc(16)]);
  const jpegWithoutFrame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  for (const bytes of [gif, webp, Buffer.from('plain text'), pngWithoutIhdr, jpegWithoutFrame, png(0, 5)]) {
    assert.equal(sniffImage(bytes), null);
  }
});

test('attachment ids are the sha256 of the bytes', () => {
  const bytes = png(4, 4);
  assert.equal(attachmentId(bytes), createHash('sha256').update(bytes).digest('hex'));
  assert.match(attachmentId(bytes), /^[a-f0-9]{64}$/);
});

test('same bytes map to one file and a repeat upload reports created false', t => {
  const dir = fixture(t);
  const bytes = png(8, 8);
  const first = writeAttachment(dir, bytes);
  const second = writeAttachment(dir, bytes);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(second.attachment, first.attachment);
  assert.equal(first.attachment.path, join(dir, `${first.attachment.id}.png`));
  assert.deepEqual(readdirSync(dir), [`${first.attachment.id}.png`]);
});

test('a repeat upload refreshes the mtime that startup GC measures', t => {
  const dir = fixture(t);
  const bytes = png(8, 8);
  const { attachment } = writeAttachment(dir, bytes);
  const old = new Date(Date.now() - 30 * DAY);
  utimesSync(attachment.path, old, old);
  writeAttachment(dir, bytes);
  assert.ok(statSync(attachment.path).mtimeMs > Date.now() - DAY);
});

test('non-image bytes are rejected without touching the directory', t => {
  const dir = fixture(t);
  assert.equal(writeAttachment(dir, Buffer.from('<svg></svg>')), null);
  assert.equal(existsSync(dir), false);
});

test('reads return stored bytes by id and refuse anything that is not a 64-hex id', t => {
  const dir = fixture(t);
  const bytes = jpeg(16, 9);
  const { attachment } = writeAttachment(dir, bytes);
  const read = readAttachment(dir, attachment.id);
  assert.equal(read.mimeType, 'image/jpeg');
  assert.ok(read.bytes.equals(bytes));
  assert.equal(readAttachment(dir, '../../etc/passwd'), null);
  assert.equal(readAttachment(dir, attachment.id.toUpperCase()), null);
  assert.equal(readAttachment(dir, attachment.id.slice(0, 63)), null);
  assert.equal(readAttachment(dir, 'f'.repeat(64)), null);
});

test('client-supplied attachments are validated and get the server path', () => {
  const dir = '/server/attachments';
  const id = 'a'.repeat(64);
  const valid = { id, mimeType: 'image/png', width: 10, height: 20, path: '/attacker/chosen.png' };
  assert.deepEqual(parseAttachments([valid], dir), [{ ...valid, path: join(dir, `${id}.png`) }]);
  assert.deepEqual(parseAttachments([], dir), []);
  const rejected = [
    'not-an-array',
    [valid, valid, valid, valid, valid],
    [{ ...valid, id: '../x' }],
    [{ ...valid, mimeType: 'image/gif' }],
    [{ ...valid, width: 0 }],
    [{ ...valid, height: 1.5 }],
    [null],
  ];
  for (const raw of rejected) assert.equal(parseAttachments(raw, dir), null);
});

test('releasing an attachment deletes it unless another annotation still references the id', t => {
  const dir = fixture(t);
  const shared = writeAttachment(dir, png(2, 2)).attachment;
  const solo = writeAttachment(dir, png(5, 5)).attachment;
  releaseAttachments(dir, [shared, solo], new Set([shared.id]));
  assert.ok(existsSync(shared.path));
  assert.equal(existsSync(solo.path), false);
});

test('startup GC removes old orphans and temp files, and keeps referenced and fresh files', t => {
  const dir = fixture(t);
  const old = new Date(Date.now() - ATTACHMENT_ORPHAN_GRACE_MS - 1000);
  const age = path => utimesSync(path, old, old);
  const referenced = writeAttachment(dir, png(2, 2)).attachment;
  const oldOrphan = writeAttachment(dir, png(3, 3)).attachment;
  const freshOrphan = writeAttachment(dir, png(4, 4)).attachment;
  const temp = join(dir, `.${'a'.repeat(64)}.${'b'.repeat(12)}.tmp`);
  writeFileSync(temp, 'partial');
  writeFileSync(join(dir, 'notes.txt'), 'not ours');
  [referenced.path, oldOrphan.path, temp, join(dir, 'notes.txt')].forEach(age);

  assert.equal(gcAttachments(dir, new Set([referenced.id]), ATTACHMENT_ORPHAN_GRACE_MS), 2);
  assert.ok(existsSync(referenced.path), 'referenced file survives regardless of age');
  assert.ok(existsSync(freshOrphan.path), 'fresh upload not yet attached survives');
  assert.equal(existsSync(oldOrphan.path), false);
  assert.equal(existsSync(temp), false);
  assert.ok(existsSync(join(dir, 'notes.txt')));
});

test('startup GC tolerates a missing directory', t => {
  assert.equal(gcAttachments(join(fixture(t), 'missing'), new Set(), ATTACHMENT_ORPHAN_GRACE_MS), 0);
});
