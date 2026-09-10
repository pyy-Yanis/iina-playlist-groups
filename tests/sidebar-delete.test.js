'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { itemMetaText } = require('../ui/sidebar.js');

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

test('playlist rows hide file paths while retaining exceptional status text', () => {
  assert.equal(itemMetaText({ path: '/Users/test/Videos/A.mp4' }), '');
  assert.equal(itemMetaText({ path: '/Users/test/Videos/A.mp4', missing: true }), '文件缺失');
  assert.equal(itemMetaText({ path: '/Users/test/Videos/A.mp4', damaged: true }), '无法播放，可点击重试');
  assert.match(read('ui/sidebar.css'), /\.item-meta:empty\s*\{\s*display:\s*none;/);
});
