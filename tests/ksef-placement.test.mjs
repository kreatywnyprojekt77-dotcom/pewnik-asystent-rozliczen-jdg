import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('KSeF controls belong to the invoices view, not the business profile', () => {
  const invoicesView = html.slice(
    html.indexOf('id="invoicesView"'),
    html.indexOf('id="declarationsView"')
  );
  const settingsView = html.slice(
    html.indexOf('id="settingsView"'),
    html.indexOf('</main>')
  );

  assert.match(invoicesView, /id="testKsefConnection"/);
  assert.match(invoicesView, /id="syncKsefInvoices"/);
  assert.doesNotMatch(settingsView, /id="testKsefConnection"|id="syncKsefInvoices"/);
});
