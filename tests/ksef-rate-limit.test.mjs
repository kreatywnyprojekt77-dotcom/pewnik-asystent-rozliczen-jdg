import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackRetryDelayMs,
  METADATA_MIN_INTERVAL_MS,
  parseRetryAfterMs,
  RequestGate
} from '../supabase/functions/ksef-sync/rate-limit.ts';

test('respects Retry-After expressed in seconds without shortening it', () => {
  assert.equal(parseRetryAfterMs('30', 1_000), 30_000);
  assert.equal(parseRetryAfterMs('0.5', 1_000), 500);
});

test('supports Retry-After expressed as an HTTP date', () => {
  const now = Date.parse('2026-08-08T12:00:00Z');
  assert.equal(parseRetryAfterMs('Sat, 08 Aug 2026 12:00:30 GMT', now), 30_000);
  assert.equal(parseRetryAfterMs('invalid', now), null);
});

test('uses bounded exponential fallback when Retry-After is missing', () => {
  assert.deepEqual([0, 1, 2, 10].map(fallbackRetryDelayMs), [2_000, 4_000, 8_000, 30_000]);
});

test('spaces all metadata reservations through one rolling gate', () => {
  const gate = new RequestGate(METADATA_MIN_INTERVAL_MS);
  assert.equal(gate.reserve(10_000), 0);
  assert.equal(gate.reserve(10_000), METADATA_MIN_INTERVAL_MS);
  assert.equal(gate.reserve(11_000), 2 * METADATA_MIN_INTERVAL_MS - 1_000);
});
