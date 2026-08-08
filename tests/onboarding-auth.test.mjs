import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../supabase-sync.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('automatic onboarding is gated by an authenticated cloud session', () => {
  assert.match(
    appSource,
    /const isSignedIn = Boolean\(window\.PewnikCloud && window\.PewnikCloud\.isSignedIn\(\)\);[\s\S]*?\(state\.onboardingCompleted && !forceOnboarding\) \|\| !isSignedIn/
  );
});

test('onboarding is refreshed when authentication state changes', () => {
  assert.match(
    appSource,
    /window\.addEventListener\('pewnik:cloud-session', refreshOnboarding\)/
  );
});

test('a demo account can force a prefilled onboarding wizard once per login session', () => {
  assert.match(syncSource, /user_metadata\.force_onboarding_each_login === true/);
  assert.match(syncSource, /onboardingPromptedUserId !== currentUser\.id/);
  assert.match(syncSource, /detail: \{ signedIn: Boolean\(currentUser\), forceOnboarding \}/);
  assert.match(appSource, /state\.onboardingCompleted && !forceOnboarding/);
  assert.match(appSource, /state\.company\.nip === '0000000000' \? '' : state\.company\.name/);
});

test('the application starts behind a mandatory authentication gate', () => {
  assert.match(htmlSource, /<body class="auth-locked">/);
  assert.match(htmlSource, /<div class="app-shell" inert aria-hidden="true">/);
  assert.match(htmlSource, /id="authModal" aria-hidden="false"/);
});

test('the authentication gate follows the Supabase session', () => {
  assert.match(syncSource, /setAuthGate\(!currentUser\)/);
  assert.match(syncSource, /appShell\.inert = locked/);
  assert.match(syncSource, /modal\.classList\.add\('visible', 'auth-required'\)/);
});

test('the mandatory login modal cannot be closed while signed out', () => {
  assert.match(
    appSource,
    /modal\.id === 'authModal' && window\.PewnikCloud && !window\.PewnikCloud\.isSignedIn\(\)/
  );
});
