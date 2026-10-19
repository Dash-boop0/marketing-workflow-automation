import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sha256Hex, shortId } from '../src/lib/hash.js';

test('SHA-256 matches FIPS 180-4 test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256 matches node:crypto across block boundaries and Unicode', () => {
  const samples = ['é', 'Ünïcødé ✓ 日本', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'y'.repeat(1000)];
  for (const s of samples) assert.equal(sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), `length ${s.length}`);
});

test('shortId is deterministic and prefixed', () => {
  assert.equal(shortId('L', 'email:a@example.com'), shortId('L', 'email:a@example.com'));
  assert.match(shortId('T', 'x'), /^T-[0-9a-f]{12}$/);
  assert.notEqual(shortId('L', 'a'), shortId('L', 'b'));
});
