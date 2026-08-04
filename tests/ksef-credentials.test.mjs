import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialConfigurationError,
  validateChallengeTimestamp,
  validateKsefCredentials
} from '../supabase/functions/ksef-sync/credential-validation.ts';

const reference = '20260701-EC-1DCE3E3000-12ECB5B36E-45';
const secret = 'a'.repeat(64);
const token = `${reference}|nip-1234567890|${secret}`;

test('accepts a complete KSeF 2.0 token for the configured NIP', () => {
  assert.deepEqual(validateKsefCredentials(token, '123-456-78-90', '1234567890'), {
    nip: '1234567890',
    token
  });
});

test('rejects a copied reference number instead of the one-time token value', () => {
  assert.throws(
    () => validateKsefCredentials(reference, '1234567890'),
    (error) => error instanceof CredentialConfigurationError && /numer referencyjny/i.test(error.message)
  );
});

test('rejects a token generated for a different NIP', () => {
  const otherToken = `${reference}|nip-9876543210|${secret}`;
  assert.throws(() => validateKsefCredentials(otherToken, '1234567890'), /innego NIP/i);
});

test('rejects a NIP in the app that differs from the Edge Function secret', () => {
  assert.throws(() => validateKsefCredentials(token, '1234567890', '9876543210'), /nie zgadza się/i);
});

test('rejects whitespace copied into the token secret', () => {
  assert.throws(() => validateKsefCredentials(`${token}\n`, '1234567890'), /biały znak/i);
});

test('accepts only an integer timestampMs from the current challenge', () => {
  assert.equal(validateChallengeTimestamp(1785571200123), 1785571200123);
  assert.throws(() => validateChallengeTimestamp(1785571200123.5), /całkowita liczba milisekund/i);
});
