import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDigest } from '../src/services/digest/digest.service.js';
import { createSmtpSender } from '../src/services/digest/mail.js';

test('digestEnabled false: no timer, no queries, nothing sent', async () => {
  const realSet = globalThis.setInterval;
  let timers = 0;
  globalThis.setInterval = (...a) => {
    timers++;
    return realSet(...a);
  };
  try {
    const db = {
      query: async () => {
        throw new Error('should not query');
      },
    };
    const d = startDigest({ db, config: { digestEnabled: false } });
    assert.equal(timers, 0);
    d.stop();
  } finally {
    globalThis.setInterval = realSet;
  }
});

test('enabled: schedules an unref-ed 10 minute timer; stop clears it', () => {
  const realSet = globalThis.setInterval,
    realClear = globalThis.clearInterval;
  const seen = { ms: null, unref: false, cleared: false };
  globalThis.setInterval = (fn, ms) => {
    seen.ms = ms;
    return {
      unref() {
        seen.unref = true;
      },
    };
  };
  globalThis.clearInterval = () => {
    seen.cleared = true;
  };
  try {
    const d = startDigest({ db: {}, config: { digestEnabled: true, digestHourUtc: 8 }, sendMail: async () => {} });
    assert.equal(seen.ms, 600000);
    assert.ok(seen.unref);
    d.stop();
    assert.ok(seen.cleared);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
});

test('tick runs once per UTC date at digestHourUtc only', async () => {
  const realSet = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return { unref() {} };
  };
  let queries = 0,
    clock = new Date('2026-09-30T07:50:00Z');
  const db = {
    query: async () => {
      queries++;
      return { rows: [] };
    },
  };
  try {
    startDigest({ db, config: { digestEnabled: true, digestHourUtc: 8 }, sendMail: async () => {}, now: () => clock });
  } finally {
    globalThis.setInterval = realSet;
  }
  const run = async (iso) => {
    clock = new Date(iso);
    await tick();
  };
  await run('2026-09-30T07:50:00Z');
  assert.equal(queries, 0);
  await run('2026-09-30T08:00:00Z');
  assert.equal(queries, 1);
  await run('2026-09-30T08:10:00Z');
  assert.equal(queries, 1);
  await run('2026-10-01T08:00:00Z');
  assert.equal(queries, 2);
});

test('a failed run does not use up the day: a later tick in the same hour retries', async () => {
  const realSet = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return { unref() {} };
  };
  let queries = 0,
    failing = true;
  const db = {
    query: async () => {
      queries++;
      if (failing) throw new Error('db down');
      return { rows: [] };
    },
  };
  const clock = new Date('2026-09-30T08:00:00Z');
  try {
    startDigest({ db, config: { digestEnabled: true, digestHourUtc: 8 }, sendMail: async () => {}, now: () => clock });
  } finally {
    globalThis.setInterval = realSet;
  }
  const origErr = console.error;
  console.error = () => {};
  try {
    await tick();
    assert.equal(queries, 1);
    failing = false;
    await tick();
    assert.equal(queries, 2);
    await tick();
    assert.equal(queries, 2, 'success marks the day done');
  } finally {
    console.error = origErr;
  }
});

test('overlapping ticks: only one pass runs, and none again that day after it finishes', async () => {
  const realSet = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return { unref() {} };
  };
  let queries = 0,
    release;
  const gate = new Promise((r) => {
    release = r;
  });
  const db = {
    query: async () => {
      queries++;
      await gate;
      return { rows: [] };
    },
  };
  const clock = new Date('2026-09-30T08:00:00Z');
  try {
    startDigest({ db, config: { digestEnabled: true, digestHourUtc: 8 }, sendMail: async () => {}, now: () => clock });
  } finally {
    globalThis.setInterval = realSet;
  }
  const first = tick();
  await tick();
  assert.equal(queries, 1, 'second tick skipped while the first is in flight');
  release();
  await first;
  await tick();
  assert.equal(queries, 1, 'day is done once the first pass resolved');
});

test('createSmtpSender throws a clear error at send time when host or from is missing', async () => {
  const noHost = createSmtpSender({ smtp: { host: '' }, mailFrom: 'a@b' });
  await assert.rejects(noHost({ to: 'x@y', subject: 's', text: 't' }), /SMTP_HOST/);
  const noFrom = createSmtpSender({ smtp: { host: 'h', port: 25 }, mailFrom: '' });
  await assert.rejects(noFrom({ to: 'x@y', subject: 's', text: 't' }), /MAIL_FROM/);
});
