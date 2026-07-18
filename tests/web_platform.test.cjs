const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('all browser JavaScript parses', () => {
  for (const file of [
    'shared/config.js', 'shared/api-client.js', 'shared/helpers.js', 'shared/validation.js',
    'app.js', 'portal/portal.js', 'admin/admin-config.js', 'admin/admin-api.js', 'admin/admin.js'
  ]) assert.doesNotThrow(() => new Function(read(file)), `${file} does not parse`);
});

test('the three published entry points exist', () => {
  for (const file of ['index.html', 'portal/index.html', 'admin/index.html', '.nojekyll', '404.html']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is missing`);
  }
});

test('local HTML resources resolve without root-relative paths', () => {
  const pages = ['index.html', 'portal/index.html', 'admin/index.html', 'privacy.html', 'terms.html'];
  for (const page of pages) {
    const html = read(page);
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const reference = match[1];
      if (/^(?:https?:|mailto:|#|data:)/i.test(reference)) continue;
      assert.doesNotMatch(reference, /^\//, `${page} uses a root-relative reference: ${reference}`);
      const clean = reference.split('#')[0].split('?')[0];
      if (!clean) continue;
      let target = path.resolve(path.dirname(path.join(root, page)), clean);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      assert.equal(fs.existsSync(target), true, `${page} references missing ${reference}`);
    }
  }
  assert.match(read('404.html'), /<base href="\/payment-organizer-finanzas\/">/);
});

test('shared configuration is the single backend URL source', () => {
  const files = [
    'shared/config.js', 'shared/api-client.js', 'app.js', 'portal/portal.js',
    'admin/admin-config.js', 'admin/admin-api.js', 'admin/admin.js'
  ];
  const occurrences = files.flatMap((file) => [...read(file).matchAll(/https:\/\/script\.google\.com\/macros\/s\//g)].map(() => file));
  assert.deepEqual(occurrences, ['shared/config.js']);
  assert.match(read('shared/config.js'), /portal:\s*"\/payment-organizer-finanzas\/portal\/"/);
  assert.match(read('shared/config.js'), /admin:\s*"\/payment-organizer-finanzas\/admin\/"/);
});

test('admin remains private-by-auth design and contains no embedded identity or password', () => {
  const files = ['admin/index.html', 'admin/admin-config.js', 'admin/admin-api.js', 'admin/admin.js'].map(read).join('\n');
  assert.match(read('admin/index.html'), /name="robots" content="noindex,nofollow"/i);
  assert.match(files, /adminPasswordLogin/);
  assert.doesNotMatch(files, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(read('admin/index.html'), /type="password"[^>]*\bvalue=/i);
  for (const action of ['adminUpdatePremiumAccess', 'adminSetFeatureEntitlement', 'adminRemoveFeatureEntitlement']) {
    assert.match(files, new RegExp(action), `${action} is not connected`);
  }
});

test('portal applies strict activation eligibility and exposes feature access', () => {
  const source = read('portal/portal.js');
  assert.match(source, /plan === "PREMIUM" && status === "ACTIVE"/);
  assert.match(source, /deviceLimit > 0/);
  assert.match(source, /featureEntitlements/);
  assert.match(read('portal/index.html'), /data-copy-code/);
});

test('public plan comparison names only implemented Premium features', () => {
  const page = read('index.html');
  for (const label of [
    'Recordatorios avanzados',
    'Reportes por categoría',
    'Planificador de pagos',
    'Frecuencias de pago personalizadas',
  ]) {
    assert.match(page, new RegExp(label, 'u'));
  }
});

test('all buttons declare their behavior', () => {
  for (const file of ['index.html', 'portal/index.html', 'admin/index.html']) {
    for (const match of read(file).matchAll(/<button\b([^>]*)>/gi)) {
      assert.match(match[1], /\btype="(?:button|submit)"/i, `${file} has a button without a type`);
    }
  }
});
