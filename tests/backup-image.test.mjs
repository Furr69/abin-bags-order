import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadBackupImage } from '../app/backup-image.mjs';

test('retries network interruptions and preserves image bytes', async () => {
  let attempts = 0;
  const bytes = new Uint8Array([255, 216, 255, 224, 1, 2]);
  const blob = await downloadBackupImage('/photo', async () => {
    if (++attempts < 3) throw new TypeError('network failure');
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal(attempts, 3);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test('rejects HTML login responses and does not save them as images', async () => {
  let attempts = 0;
  await assert.rejects(downloadBackupImage('/photo', async () => {
    attempts++;
    return new Response('<html>Login required</html>');
  }), /不是有效图片/);
  assert.equal(attempts, 3);
});

test('stops immediately on authorization failure', async () => {
  let attempts = 0;
  await assert.rejects(downloadBackupImage('/photo', async () => {
    attempts++;
    return new Response('Forbidden', { status: 403 });
  }), /登录已失效/);
  assert.equal(attempts, 1);
});
