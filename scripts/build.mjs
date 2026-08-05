import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

const localEnvPath = resolve(root, '.env');
const localEnv = (await fileExists(localEnvPath))
  ? parseEnv(await readFile(localEnvPath, 'utf8'))
  : {};

const supabaseUrl = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || localEnv.SUPABASE_PUBLISHABLE_KEY;

const missing = [
  ['SUPABASE_URL', supabaseUrl],
  ['SUPABASE_PUBLISHABLE_KEY', supabasePublishableKey]
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length) {
  throw new Error(
    `Brak wymaganych zmiennych srodowiskowych: ${missing.join(', ')}. ` +
    'Ustaw je w panelu hostingu i ponow wdrozenie.'
  );
}

if (!/^https:\/\/.+\.supabase\.co\/?$/.test(supabaseUrl)) {
  throw new Error('SUPABASE_URL musi byc adresem HTTPS projektu Supabase.');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const runtimeFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'supabase-sync.js',
  'invoice-input.mjs',
  'ryczalt-calculator.mjs',
  'ryczalt-adapter.mjs',
  'vat-calculator.mjs',
  'vat-adapter.mjs',
  'zus-rules.mjs',
  'zus-calculator.mjs',
  'zus-adapter.mjs'
];

await Promise.all(runtimeFiles.map(file =>
  copyFile(resolve(root, file), resolve(output, file))
));

const publicConfig = `window.PEWNIK_SUPABASE_CONFIG = ${JSON.stringify({
  url: supabaseUrl,
  publishableKey: supabasePublishableKey
}, null, 2)};\n`;

await writeFile(resolve(output, 'supabase-config.js'), publicConfig, 'utf8');
console.log('Build zakonczony: utworzono katalog dist/.');
