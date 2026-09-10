'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  importSyncStrategy,
  replaceNativePlaylist,
  synchronizedCurrentIndex,
} = require('../src/controller.js');

test('native replacement atomically replaces the first item and appends the rest', () => {
  const operations = [];
  replaceNativePlaylist({
    command(name, args) { operations.push([name, args]); },
  }, ['/media/a.mp4', '/media/b.mp4']);

  assert.deepEqual(operations, [
    ['loadfile', ['/media/a.mp4', 'replace']],
    ['loadfile', ['/media/b.mp4', 'append']],
  ]);
});

test('completed synchronization identifies the media mpv already loaded', () => {
  const expected = ['/media/a.mp4', '/media/b.mp4'];
  assert.equal(synchronizedCurrentIndex(expected, '/media/a.mp4', 0), 0);
  assert.equal(synchronizedCurrentIndex(expected, '/media/b.mp4', 1), 1);
  assert.equal(synchronizedCurrentIndex(expected, '/foreign.mp4', 0), -1);
  assert.equal(synchronizedCurrentIndex(expected, '/media/a.mp4', -1), -1);
});

test('file import recovers from a temporarily mismatched native playlist', () => {
  assert.equal(importSyncStrategy(false, 2, false, false), 'none');
  assert.equal(importSyncStrategy(true, 2, false, true), 'append');
  assert.equal(importSyncStrategy(true, 2, false, false), 'resynchronize');
  assert.equal(importSyncStrategy(true, 2, true, true), 'resynchronize');
  assert.equal(importSyncStrategy(true, 0, false, false), 'resynchronize');
});
