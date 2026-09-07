'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('group deletion uses an in-sidebar confirmation dialog supported by IINA WebKit', () => {
  const html = read('ui/sidebar.html');
  const script = read('ui/sidebar.js');

  assert.match(html, /id="delete-group-dialog"/);
  assert.match(html, /data-delete-action="cancel"/);
  assert.match(html, /data-delete-action="confirm"/);
  assert.doesNotMatch(script, /window\.confirm\s*\(/);
  assert.match(script, /send\('deleteGroup', \{ groupId: pendingDeleteGroupId \}\)/);
});
