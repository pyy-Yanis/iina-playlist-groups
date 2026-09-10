'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createController,
  manualEndItemIndex,
  commandNextItemIndex,
  waitingAfterEofChange,
} = require('../src/controller.js');
const { adjacentPlaybackPayload } = require('../ui/sidebar.js');

test('IINA manifest registers the global coordinator with the supported key', () => {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../Info.json'), 'utf8'));
  assert.equal(info.global, 'global.js');
  assert.equal(Object.hasOwn(info, 'globalEntry'), false);
});

test('main entry starts the window controller without an asynchronous coordinator dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(source, /createController\(iina\)\.start\(\)/);
  assert.doesNotMatch(source, /startMain/);
});

test('opening media from IINA initial window starts fallback before the file event is lost', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main-coordinator.js'), 'utf8');
  assert.match(source, /iina\.event\.on\('iina\.window-loaded',[\s\S]*!controller[\s\S]*startLocalFallback\(\)/);
  assert.match(source, /iina\.event\.on\('iina\.file-started',[\s\S]*!controller[\s\S]*startLocalFallback\(\)/);
});

test('controller defers sidebar loading until IINA reports the player window is available', () => {
  const events = {};
  let loads = 0;
  let bindings = 0;
  let windowReady = false;
  const iina = {
    sidebar: {
      loadFile() {
        if (!windowReady) throw new Error('window unavailable');
        loads += 1;
      },
      onMessage() { bindings += 1; },
      postMessage() {},
    },
    event: { on(name, handler) { events[name] = handler; } },
    menu: {
      items() { return []; },
      item(title, action, options) { return { title, action, options }; },
      addItem() {},
      removeAt() {},
      forceUpdate() {},
    },
    core: { status: { paused: true } },
  };
  const controller = createController(iina, {
    readOnly: true,
    initialState: { schemaVersion: 1, nextGroupId: 1, nextItemId: 1, groups: [] },
  });

  controller.start();
  assert.equal(loads, 0);
  assert.equal(bindings, 0);
  windowReady = true;
  events['iina.window-loaded']();

  assert.equal(loads, 1);
  assert.equal(bindings, 11);
});

test('manual EOF identifies the completed item from its verified loaded token', () => {
  const group = {
    id: 'group-a',
    items: [{ id: 'item-1' }, { id: 'item-2' }],
  };
  const token = {
    loaded: true,
    groupId: 'group-a',
    itemId: 'item-1',
    index: 0,
    playlistGeneration: 7,
  };
  assert.equal(manualEndItemIndex(group, 'item-1', token, 7), 0);
  assert.equal(manualEndItemIndex(group, 'item-2', token, 7), -1);
  assert.equal(manualEndItemIndex(group, 'item-1', { ...token, loaded: false }, 7), -1);
});

test('manual EOF certifies an unloaded controller request from the live mpv identity', () => {
  const group = {
    id: 'group-a',
    items: [{ id: 'item-1' }, { id: 'item-2' }],
  };
  const token = {
    loaded: false,
    controllerRequested: true,
    groupId: 'group-a',
    itemId: 'item-1',
    index: 0,
    url: '/videos/one.mp4',
    playlistGeneration: 7,
  };
  const liveIdentity = {
    group,
    item: group.items[0],
    index: 0,
    url: '/videos/one.mp4',
  };
  assert.equal(manualEndItemIndex(group, 'item-1', token, 7, liveIdentity), 0);
  assert.equal(manualEndItemIndex(group, 'item-1', token, 7, { ...liveIdentity, index: 1 }), -1);
});

test('manual EOF retains its controller certificate after mpv clears live identity', () => {
  const group = {
    id: 'group-a',
    items: [{ id: 'item-1' }, { id: 'item-2' }],
  };
  const token = {
    loaded: false,
    controllerRequested: true,
    groupId: 'group-a',
    itemId: 'item-1',
    index: 0,
    url: '/videos/one.mp4',
    playlistGeneration: 7,
  };
  assert.equal(manualEndItemIndex(group, 'item-1', token, 7, null), 0);
});

test('eof falling edge retains manual waiting state for the Space handler', () => {
  assert.equal(waitingAfterEofChange(false, true), true);
  assert.equal(waitingAfterEofChange(false, false), false);
});

test('manual next uses Shift+Space without conflicting with native Space', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controller.js'), 'utf8');
  assert.match(source, /iina\.input\.onKeyDown\('Shift\+SPACE',\s*onSpaceKey,\s*iina\.input\.PRIORITY_HIGH\)/);
  assert.doesNotMatch(source, /keyBinding:\s*'Shift\+SPACE'/);
  assert.doesNotMatch(source, /keyBinding:\s*'Ctrl\+SPACE'/);
  assert.doesNotMatch(source, /keyBinding:\s*'Meta\+SPACE'/);
  assert.doesNotMatch(source, /keyBinding:\s*'SPACE'/);
  assert.doesNotMatch(source, /iina\.input\.onKeyDown\('SPACE'/);
  assert.doesNotMatch(source, /iina\.menu\.forceUpdate\(\)/);
});

test('Playback Groups opens directly with conflict-free Control+P and a menu action', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controller.js'), 'utf8');
  assert.match(source, /function showPlaybackGroups\(data\)[\s\S]*iina\.sidebar\.show\(\)/);
  assert.match(source, /iina\.input\.onKeyDown\('Ctrl\+p',\s*showPlaybackGroups,\s*iina\.input\.PRIORITY_HIGH\)/);
  assert.match(source, /iina\.menu\.item\(\s*'显示播放分组',\s*showPlaybackGroups/);
  assert.doesNotMatch(source, /onKeyDown\('Shift\+P'/);
  assert.match(source, /function dispose\(\)[\s\S]*openSidebarMenuItemIndex[\s\S]*iina\.menu\.removeAt/);
});

test('Shift+Space resolves the next manual item without depending on EOF state', () => {
  const group = {
    mode: 'manual',
    items: [{ id: 'item-1' }, { id: 'item-2' }],
  };
  assert.equal(commandNextItemIndex(group, 'item-1'), 1);
  assert.equal(commandNextItemIndex(group, 'item-2'), -1);
  assert.equal(commandNextItemIndex({ ...group, mode: 'loop' }, 'item-1'), -1);
});

test('plugin OSD messages are suppressed while the player is fullscreen', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controller.js'), 'utf8');
  assert.match(source, /function showMessage\(message\)[\s\S]*iina\.core\.window\.fullscreen[\s\S]*iina\.core\.osd\(message\)/);
  assert.equal((source.match(/iina\.core\.osd\(/g) || []).length, 1);
});

test('progress sampling recovers a missed manual EOF property callback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/controller.js'), 'utf8');
  assert.match(source, /function sampleProgress\(\)[\s\S]*group\.mode === 'manual'[\s\S]*getFlag\('eof-reached'\)[\s\S]*handleNaturalEndEvent\(\)/);
});

test('row arrows create previous and next playback payloads without moving items', () => {
  const group = {
    id: 'group-a',
    items: [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }],
  };
  assert.deepEqual(adjacentPlaybackPayload(group, 1, -1), {
    groupId: 'group-a', itemId: 'item-1',
  });
  assert.deepEqual(adjacentPlaybackPayload(group, 1, 1), {
    groupId: 'group-a', itemId: 'item-3',
  });
  assert.equal(adjacentPlaybackPayload(group, 0, -1), null);
  assert.equal(adjacentPlaybackPayload(group, 2, 1), null);
});
