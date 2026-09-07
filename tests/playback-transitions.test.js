'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  mpvOptionsForMode,
  playNativePlaylistIndex,
  transitionAutoplay,
} = require('../src/controller.js');

test('group modes preserve their required end-of-playlist behavior', () => {
  assert.deepEqual(mpvOptionsForMode('loop'), { keepOpen: 'no', loopPlaylist: 'inf' });
  assert.deepEqual(mpvOptionsForMode('once'), { keepOpen: 'yes', loopPlaylist: 'no' });
  assert.deepEqual(mpvOptionsForMode('manual'), { keepOpen: 'always', loopPlaylist: 'no' });
});

test('item selection uses mpv live playlist index instead of IINA cached playlist', () => {
  const operations = [];
  playNativePlaylistIndex({
    command(name, args) { operations.push([name, args]); },
  }, 0);
  assert.deepEqual(operations, [['playlist-play-index', ['0']]]);
});

test('automatic transitions continue for loop and once but not manual groups', () => {
  assert.equal(transitionAutoplay('loop', true), true);
  assert.equal(transitionAutoplay('once', true), true);
  assert.equal(transitionAutoplay('manual', true), false);
  assert.equal(transitionAutoplay('manual', false), true);
});
