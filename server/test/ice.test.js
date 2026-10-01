// ICE server list: free public STUN plus our own coturn with use-auth-secret credentials.
// The HMAC vector was computed outside Node with
//   printf '%s' '1759262400:7' | openssl dgst -sha1 -hmac 'coturn-test-secret' -binary | openssl base64
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIceServers } from '../src/services/calls/ice.js';

const NOW = Date.UTC(2025, 8, 30, 8, 0, 0); // 1759219200 s
const stun = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const turn = ['turn:turn.example:3478?transport=udp', 'turn:turn.example:3478?transport=tcp'];

test('TURN credential: username = <expiry>:<userId>, credential = base64(HMAC-SHA1(secret, username)) — known vector', () => {
  const servers = buildIceServers({ config: { stunUrls: stun, turnUrls: turn, turnSecret: 'coturn-test-secret', turnTtlSecs: 43200 }, userId: 7, now: () => NOW });
  assert.deepEqual(servers, [
    { urls: stun },
    { urls: turn, username: '1759262400:7', credential: 'jeL4tvfcO8VHEfN0Kld/LqARXC8=' },
  ]);
});

test('now may be a number; ttl defaults to 43200 s when the config has none', () => {
  const servers = buildIceServers({ config: { stunUrls: [], turnUrls: turn, turnSecret: 'coturn-test-secret' }, userId: 7, now: NOW });
  assert.deepEqual(servers, [{ urls: turn, username: '1759262400:7', credential: 'jeL4tvfcO8VHEfN0Kld/LqARXC8=' }]);
});

test('no TURN entry without a secret or without TURN urls; STUN only when configured', () => {
  assert.deepEqual(buildIceServers({ config: { stunUrls: stun, turnUrls: turn, turnSecret: '' }, userId: 1, now: NOW }), [{ urls: stun }]);
  assert.deepEqual(buildIceServers({ config: { stunUrls: stun, turnUrls: [], turnSecret: 'x' }, userId: 1, now: NOW }), [{ urls: stun }]);
  assert.deepEqual(buildIceServers({ config: { stunUrls: [], turnUrls: [], turnSecret: '' }, userId: 1, now: NOW }), []);
});

test('a hand-built config with no call keys at all gives an empty list (no throw)', () => {
  assert.deepEqual(buildIceServers({ config: {}, userId: 1 }), []);
  assert.deepEqual(buildIceServers({ userId: 1 }), []);
});

test('the default expiry follows the real clock when now is not given', () => {
  const [t] = buildIceServers({ config: { turnUrls: turn, turnSecret: 's' }, userId: 3 });
  const [expiry, uid] = t.username.split(':');
  assert.equal(uid, '3');
  const expected = Math.floor(Date.now() / 1000) + 43200;
  assert.ok(Math.abs(Number(expiry) - expected) <= 2);
});
