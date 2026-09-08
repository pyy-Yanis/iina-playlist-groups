const {
  addItems,
  createGroup,
  deleteGroup,
  removeItem,
  renameGroup,
  reorderItem,
  setGroupOptions,
  transferItem,
} = require('./model.js');
const {
  onNaturalEnd,
  recordProgress,
  resolveStartPosition,
} = require('./playback.js');
const { loadState, saveState, sanitizeState } = require('./storage.js');

const DATA_PATH = '@data/playback-groups.json';
const SIDEBAR_PATH = 'ui/sidebar.html';
const LOAD_WATCHDOG_MS = 30000;
const SIDEBAR_MESSAGES = [
  'createGroup',
  'renameGroup',
  'deleteGroup',
  'setGroupOptions',
  'selectGroup',
  'playItem',
  'addFiles',
  'removeItem',
  'reorderItem',
  'transferItem',
  'ready',
];

function replaceNativePlaylist(mpv, paths) {
  paths.forEach((path, index) => {
    mpv.command('loadfile', [path, index === 0 ? 'replace' : 'append']);
  });
}

function synchronizedCurrentIndex(expected, currentPath, playingPosition) {
  if (!Number.isInteger(playingPosition) || playingPosition < 0
    || playingPosition >= expected.length) return -1;
  return expected[playingPosition] === currentPath ? playingPosition : -1;
}

function mpvOptionsForMode(mode) {
  if (mode === 'loop') return { keepOpen: 'no', loopPlaylist: 'inf' };
  if (mode === 'manual') return { keepOpen: 'always', loopPlaylist: 'no' };
  return { keepOpen: 'yes', loopPlaylist: 'no' };
}

function playNativePlaylistIndex(mpv, index) {
  mpv.command('playlist-play-index', [String(index)]);
}

function transitionAutoplay(mode, wasPaused) {
  return mode !== 'manual' || wasPaused !== true;
}

function commandNextItemIndex(group, currentItemId) {
  if (!group || group.mode !== 'manual') return -1;
  const currentIndex = group.items.findIndex((item) => item.id === currentItemId);
  return currentIndex >= 0 && currentIndex + 1 < group.items.length
    ? currentIndex + 1 : -1;
}

function manualEndItemIndex(group, currentItemId, token, playlistGeneration, liveIdentity) {
  if (!group || !token || token.groupId !== group.id
    || token.playlistGeneration !== playlistGeneration
    || token.itemId !== currentItemId || !Number.isInteger(token.index)
    || token.index < 0 || token.index >= group.items.length) return -1;
  if (group.items[token.index].id !== token.itemId) return -1;
  if (token.loaded === true) return token.index;
  if (token.controllerRequested !== true) return -1;
  // mpv may clear path and playlist-playing-pos before either EOF callback
  // reaches JavaScript. The controller token, current item, and playlist
  // generation still form a complete certificate; a live identity is only
  // an additional check when mpv still exposes one.
  if (!liveIdentity) return token.index;
  return liveIdentity.group === group && liveIdentity.item === group.items[token.index]
    && liveIdentity.index === token.index && liveIdentity.url === token.url
    ? token.index : -1;
}

function waitingAfterEofChange(_eofReached, waitingForNext) {
  return waitingForNext === true;
}

function createController(iina, options) {
  const settings = options || {};
  const timers = settings.timers || {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  let state;
  let selectedGroupId = null;
  let currentItemId = null;
  let waitingForNext = false;
  let spaceMenuItemIndex = null;
  let openSidebarMenuItemIndex = null;
  let playbackPosition = 0;
  let playbackDuration = 0;
  let loadGeneration = 0;
  let loadToken = null;
  let handledEndGeneration = null;
  let ignoredReplacementEndGeneration = null;
  let loadWatchdogTimer = null;
  let saveTimer = null;
  let progressSaveTimer = null;
  let synchronizing = false;
  let playlistGeneration = 0;
  let syncRetryTimer = null;
  let syncTransaction = null;
  let ownerActive = false;
  let lifecycleRegistered = false;
  let windowInactive = false;
  const failureTimers = new Set();
  let sampleInterval = null;
  let readOnly = settings.readOnly === true;
  let readOnlyReason = '';
  let closed = false;
  let authorityEpoch = 0;
  let windowEpoch = 0;
  let seekEofSuppression = null;
  let controllerPausePending = false;
  let mpvOptionSnapshot = null;
  let coordinatorBootId = typeof settings.coordinatorBootId === 'string'
    ? settings.coordinatorBootId : null;
  let coordinatorRequestId = Number.isInteger(settings.coordinatorRequestId)
    ? settings.coordinatorRequestId : null;
  let coordinatorRevision = Number.isInteger(settings.coordinatorRevision)
    ? settings.coordinatorRevision : -1;
  let coordinatorContentVersion = Number.isInteger(settings.contentVersion)
    ? settings.contentVersion : 0;
  let localSaveVersion = 0;
  let dirty = false;

  function selectedGroup() {
    return state && state.groups.find((group) => group.id === selectedGroupId);
  }

  function postState() {
    iina.sidebar.postMessage('stateChanged', {
      state,
      selectedGroupId,
      readOnly,
      readOnlyReason,
    });
  }

  function stateStructureFingerprint(value) {
    return JSON.stringify({
      selectedGroupId: value && value.selectedGroupId,
      groups: value && value.groups ? value.groups.map((group) => ({
        id: group.id, name: group.name, mode: group.mode, resume: group.resume,
        items: group.items.map((item) => ({
          id: item.id, path: item.path, missing: item.missing, damaged: item.damaged,
        })),
      })) : [],
    });
  }

  function canWrite() {
    return !closed && !windowInactive && !readOnly;
  }

  function postPlayback() {
    const group = selectedGroup();
    const durations = {};
    if (group) group.items.forEach((item) => {
      if (Number.isFinite(item.duration) && item.duration >= 0) durations[item.id] = item.duration;
    });
    iina.sidebar.postMessage('playbackChanged', {
      groupId: selectedGroupId,
      itemId: currentItemId,
      paused: iina.core.status ? iina.core.status.paused === true : true,
      waitingForNext,
      position: playbackPosition,
      duration: playbackDuration,
      durations,
    });
  }

  function controllerPause() {
    const wasPaused = iina.core.status && typeof iina.core.status.paused === 'boolean'
      ? iina.core.status.paused
      : iina.mpv.getFlag('pause') === true;
    if (!wasPaused) controllerPausePending = true;
    iina.mpv.set('pause', true);
    iina.core.pause();
  }

  function controllerResume() {
    controllerPausePending = false;
    iina.core.resume();
  }

  function applyOwnedMpvOptions() {
    if (mpvOptionSnapshot === null) {
      mpvOptionSnapshot = {
        keepOpen: iina.mpv.getString('keep-open'),
        loopPlaylist: iina.mpv.getString('loop-playlist'),
      };
    }
    applySelectedGroupMpvOptions();
  }

  function applySelectedGroupMpvOptions() {
    const group = selectedGroup();
    const options = mpvOptionsForMode(group ? group.mode : 'once');
    iina.mpv.set('keep-open', options.keepOpen);
    iina.mpv.set('loop-playlist', options.loopPlaylist);
  }

  function restoreOwnedMpvOptions() {
    if (mpvOptionSnapshot === null) return;
    iina.mpv.set('keep-open', mpvOptionSnapshot.keepOpen);
    iina.mpv.set('loop-playlist', mpvOptionSnapshot.loopPlaylist);
    mpvOptionSnapshot = null;
    controllerPausePending = false;
  }

  function flushSave() {
    if (saveTimer !== null) {
      timers.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (progressSaveTimer !== null) {
      timers.clearTimeout(progressSaveTimer);
      progressSaveTimer = null;
    }
    if (state && canWrite()) {
      if (typeof settings.save === 'function') {
        if (!dirty) return;
        settings.save(state, {
          baseContentVersion: coordinatorContentVersion,
          saveVersion: localSaveVersion,
        });
      } else {
        saveState(state, (text) => iina.file.write(DATA_PATH, text));
        dirty = false;
      }
    }
  }

  function markDirty() {
    dirty = true;
    localSaveVersion += 1;
  }

  function scheduleDirtyRetry() {
    if (!canWrite() || !dirty || saveTimer !== null) return;
    saveTimer = timers.setTimeout(() => {
      saveTimer = null;
      flushSave();
    }, 0);
  }

  function scheduleSave() {
    if (!canWrite()) return;
    markDirty();
    if (saveTimer !== null) timers.clearTimeout(saveTimer);
    saveTimer = timers.setTimeout(() => {
      saveTimer = null;
      flushSave();
    }, 250);
  }

  function scheduleProgressSave() {
    if (!canWrite() || progressSaveTimer !== null) return;
    markDirty();
    progressSaveTimer = timers.setTimeout(() => {
      progressSaveTimer = null;
      flushSave();
    }, 15000);
  }

  function synchronizePlaylist(targetIntent) {
    const group = selectedGroup();
    if (!group || group.items.length === 0) {
      const hadManagedMedia = currentItemId !== null || loadToken !== null;
      if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
      syncRetryTimer = null;
      syncTransaction = null;
      synchronizing = false;
      if (hadManagedMedia) controllerPause();
      invalidateLoadToken();
      currentItemId = null;
      setWaitingForNext(false);
      playbackPosition = 0;
      playbackDuration = 0;
      return;
    }
    applySelectedGroupMpvOptions();
    controllerPause();
    invalidateLoadToken();
    currentItemId = null;
    setWaitingForNext(false);
    playbackPosition = 0;
    playbackDuration = 0;
    synchronizing = true;
    playlistGeneration += 1;
    const generation = playlistGeneration;
    const expected = group.items.map((item) => normalizedMediaPath(item.path));
    syncTransaction = {
      generation,
      expected,
      targetIntent: targetIntent || null,
      attempts: 0,
    };
    // IINA 1.4's public playlist add/remove API reads an asynchronously
    // refreshed cache, so index-based replacement can delete an appended
    // item instead of the old playing entry. mpv's loadfile replace+append
    // commands rebuild a non-empty playlist without depending on that cache.
    replaceNativePlaylist(iina.mpv, expected);
    // `loadfile replace` deterministically selects index 0 and the following
    // append commands preserve that index. IINA's playlist cache and timers
    // can both lag behind these mpv commands, so waiting for the public cache
    // leaves the controller permanently "synchronizing" on some windows.
    // Adopt the command result directly; later file events still validate
    // explicitly requested item loads.
    synchronizing = false;
    syncTransaction = null;
    if (targetIntent) {
      const item = group.items[targetIntent.index];
      if (item && item.id === targetIntent.itemId) {
        createLoadToken(group, targetIntent.index, false, true,
          targetIntent.explicitRetry === true, true);
        currentItemId = item.id;
        playbackDuration = Number.isFinite(item.duration) ? item.duration : 0;
        controllerPause();
        playNativePlaylistIndex(iina.mpv, targetIntent.index);
        postPlayback();
      }
      return;
    }
    const firstItem = group.items[0];
    const adoptedToken = createLoadToken(group, 0, true, false, false, false);
    currentItemId = firstItem.id;
    playbackPosition = Math.max(0, iina.mpv.getNumber('time-pos') || 0);
    playbackDuration = Math.max(0, iina.mpv.getNumber('duration') || firstItem.duration || 0);
    ignoredReplacementEndGeneration = adoptedToken.generation;
    const suppressionTimer = timers.setTimeout(() => {
      failureTimers.delete(suppressionTimer);
      if (ignoredReplacementEndGeneration === adoptedToken.generation) {
        ignoredReplacementEndGeneration = null;
      }
    }, 1500);
    failureTimers.add(suppressionTimer);
    controllerPause();
    postPlayback();
  }

  function scheduleSyncVerification() {
    if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
    syncRetryTimer = timers.setTimeout(verifySyncTransaction, 25);
  }

  function verifySyncTransaction(consumeAttempt) {
    if (consumeAttempt !== false) {
      if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
      syncRetryTimer = null;
    }
    const transaction = syncTransaction;
    if (!transaction || transaction.generation !== playlistGeneration || !canWrite()) return;
    const actual = nativePlaylistEntries().map((entry) => normalizedMediaPath(entry.filename));
    const stable = actual.length === transaction.expected.length
      && actual.every((url, index) => url === transaction.expected[index]);
    if (!stable) {
      if (consumeAttempt === false) return;
      transaction.attempts += 1;
      if (transaction.attempts < 20) scheduleSyncVerification();
      else {
        abortSyncTransaction();
        notifyProblem('播放列表同步失败，本窗口已暂停');
      }
      return;
    }
    const intent = transaction.targetIntent;
    if (!intent) {
      const group = selectedGroup();
      const currentPath = normalizedMediaPath(iina.mpv.getString('path'));
      const itemIndex = synchronizedCurrentIndex(
        transaction.expected,
        currentPath,
        iina.mpv.getNumber('playlist-playing-pos'),
      );
      const item = group && group.items[itemIndex];
      // The playlist node becomes stable before mpv publishes the new path
      // and playing index. Keep the transaction alive until both identify
      // the entry loaded by `loadfile replace`; otherwise EOF has no owner.
      if (!item) {
        transaction.attempts += 1;
        if (transaction.attempts < 40) scheduleSyncVerification();
        else {
          abortSyncTransaction();
          notifyProblem('无法确认同步后的当前视频，本窗口已暂停');
        }
        return;
      }
      if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
      syncRetryTimer = null;
      synchronizing = false;
      syncTransaction = null;
      const adoptedToken = createLoadToken(group, itemIndex, true, false, false, false);
      // `loadfile replace` also emits end-file for the entry it displaced.
      // That event can arrive after the replacement has already been adopted;
      // suppress it briefly so it cannot consume the new item's completion.
      ignoredReplacementEndGeneration = adoptedToken.generation;
      const suppressionTimer = timers.setTimeout(() => {
        failureTimers.delete(suppressionTimer);
        if (ignoredReplacementEndGeneration === adoptedToken.generation) {
          ignoredReplacementEndGeneration = null;
        }
      }, 1500);
      failureTimers.add(suppressionTimer);
      currentItemId = item.id;
      playbackPosition = Math.max(0, iina.mpv.getNumber('time-pos') || 0);
      playbackDuration = Math.max(0, iina.mpv.getNumber('duration') || item.duration || 0);
      controllerPause();
      postPlayback();
      return;
    }
    if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
    synchronizing = false;
    syncTransaction = null;
    const group = state.groups.find((candidate) => candidate.id === intent.groupId);
    const item = group && group.items[intent.index];
    if (item && item.id === intent.itemId && normalizedMediaPath(item.path) === intent.url) {
      startPlaybackAt(group, intent.index, intent.explicitRetry);
    }
  }

  function abortSyncTransaction() {
    synchronizing = false;
    syncTransaction = null;
    controllerPause();
    invalidateLoadToken();
    currentItemId = null;
    setWaitingForNext(false);
    playbackPosition = 0;
    playbackDuration = 0;
    postPlayback();
  }

  function pauseAndSynchronize() {
    synchronizePlaylist();
    postPlayback();
  }

  function applyMutation(nextState, synchronize) {
    if (nextState === state) return false;
    state = nextState;
    scheduleSave();
    if (synchronize) pauseAndSynchronize();
    postState();
    return true;
  }

  function updateItem(groupId, itemId, update, progressOnly) {
    let changed = false;
    const groups = state.groups.map((group) => {
      if (group.id !== groupId) return group;
      let groupChanged = false;
      const items = group.items.map((item) => {
        if (item.id !== itemId) return item;
        const updated = update(item, group);
        if (updated !== item) {
          changed = true;
          groupChanged = true;
        }
        return updated;
      });
      return groupChanged ? { ...group, items } : group;
    });
    if (!changed) return false;
    state = { ...state, groups };
    if (progressOnly === true) scheduleProgressSave();
    else {
      scheduleSave();
      if (progressOnly !== 'playback') postState();
    }
    return true;
  }

  function onCreateGroup(payload) {
    const rawName = payload && payload.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) return;
    let nextState = createGroup(state, name);
    if (nextState === state) return;
    sampleProgress();
    nextState = createGroup(state, name);
    selectedGroupId = nextState.groups[nextState.groups.length - 1].id;
    applyMutation({ ...nextState, selectedGroupId }, true);
  }

  function onRenameGroup(payload) {
    const rawName = payload && payload.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!payload || !name) return;
    applyMutation(renameGroup(state, payload.groupId, name), false);
  }

  function onDeleteGroup(payload) {
    if (!payload) return;
    const index = state.groups.findIndex((group) => group.id === payload.groupId);
    if (index < 0) return;
    const deletingSelected = selectedGroupId === payload.groupId;
    if (deletingSelected) sampleProgress();
    const nextState = deleteGroup(state, payload.groupId);
    if (deletingSelected) {
      const nextIndex = Math.min(index, nextState.groups.length - 1);
      selectedGroupId = nextIndex >= 0 ? nextState.groups[nextIndex].id : null;
    }
    applyMutation({ ...nextState, selectedGroupId }, deletingSelected);
  }

  function onSetGroupOptions(payload) {
    if (!payload) return;
    const group = state.groups.find((candidate) => candidate.id === payload.groupId);
    if (!group) return;
    const nextState = setGroupOptions(state, payload.groupId, payload.patch);
    const nextGroup = nextState.groups.find((candidate) => candidate.id === payload.groupId);
    const changed = group.mode !== nextGroup.mode || group.resume !== nextGroup.resume;
    applyMutation(nextState, false);
    if (changed && payload.groupId === selectedGroupId) {
      applySelectedGroupMpvOptions();
      if (waitingForNext && nextGroup.mode !== 'manual') setWaitingForNext(false);
      postPlayback();
    }
  }

  function onSelectGroup(payload) {
    if (!payload || !state.groups.some((group) => group.id === payload.groupId)) return;
    if (selectedGroupId === payload.groupId) return;
    if (readOnly) {
      if (closed || windowInactive) return;
      selectedGroupId = payload.groupId;
      postState();
      postPlayback();
      return;
    }
    sampleProgress();
    selectedGroupId = payload.groupId;
    state = { ...state, selectedGroupId };
    markDirty();
    flushSave();
    pauseAndSynchronize();
    postState();
  }

  function onPlayItem(payload) {
    if (!payload) return;
    const group = state.groups.find((candidate) => candidate.id === payload.groupId);
    const index = group && group.items.findIndex((item) => item.id === payload.itemId);
    if (!group || index < 0) return;
    if (selectedGroupId !== group.id) {
      onSelectGroup({ groupId: group.id });
    }
    if (isMissing(group.items[index])) {
      playAvailableFrom(group, index, group.mode === 'loop');
      return;
    }
    startPlaybackAt(group, index, true);
  }

  function startPlaybackAt(group, index, explicitRetry) {
    const item = group.items[index];
    if (!item) return false;
    if (synchronizing) {
      if (syncTransaction) syncTransaction.targetIntent = {
        groupId: group.id,
        itemId: item.id,
        index,
        url: normalizedMediaPath(item.path),
        explicitRetry: explicitRetry === true,
      };
      verifySyncTransaction(false);
      return true;
    }
    if (!playlistMatchesGroup(group)) {
      synchronizePlaylist({
        groupId: group.id,
        itemId: item.id,
        index,
        url: normalizedMediaPath(item.path),
        explicitRetry: explicitRetry === true,
      });
      postPlayback();
      verifySyncTransaction();
      return true;
    }
    if (loadToken && loadToken.loaded !== true && loadToken.groupId === group.id
      && loadToken.itemId === item.id && loadToken.index === index
      && loadToken.url === normalizedMediaPath(item.path)
      && loadToken.playlistGeneration === playlistGeneration) return true;
    synchronizing = false;
    seekEofSuppression = null;
    createLoadToken(group, index, false, true, explicitRetry === true, true);
    currentItemId = item.id;
    setWaitingForNext(false);
    playbackPosition = 0;
    playbackDuration = Number.isFinite(item.duration) ? item.duration : 0;
    controllerPause();
    playNativePlaylistIndex(iina.mpv, index);
    postPlayback();
    return true;
  }

  function notifyProblem(message) {
    iina.core.osd(message);
    iina.sidebar.postMessage('error', { message });
  }

  function decodedPath(path) {
    try {
      return decodeURIComponent(path);
    } catch (_) {
      return path;
    }
  }

  function localFilesystemPath(value) {
    if (typeof value !== 'string') return null;
    const fileURL = value.match(/^file:\/\/(.*)$/i);
    if (!fileURL) {
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? null : value;
    }
    let path = fileURL[1];
    if (/^localhost(?:\/|$)/i.test(path)) path = path.slice('localhost'.length);
    return decodedPath(path);
  }

  function isMissing(item) {
    const path = item && localFilesystemPath(item.path);
    if (path === null) return false;
    try {
      return iina.file.exists(path) !== true;
    } catch (_) {
      return true;
    }
  }

  function playAvailableFrom(group, firstIndex, allowWrap) {
    const count = group.items.length;
    let index = firstIndex;
    let checked = 0;
    while (checked < count && count > 0) {
      if (index >= count) {
        if (!allowWrap) break;
        index = 0;
      }
      const item = group.items[index];
      if (isMissing(item)) {
        updateItem(group.id, item.id, (candidate) => (
          candidate.missing === true ? candidate : { ...candidate, missing: true }
        ));
        notifyProblem('文件不存在，已跳过');
      } else if (item.damaged !== true) {
        if (item.missing === true) {
          updateItem(group.id, item.id, (candidate) => ({ ...candidate, missing: false }));
        }
        return startPlaybackAt(group, index, false);
      }
      checked += 1;
      index += 1;
    }
    finishOnLastFrame('没有可播放的项目');
    return false;
  }

  async function onAddFiles(payload) {
    if (!payload || !state.groups.some((group) => group.id === payload.groupId)) return;
    const operationEpoch = { authority: authorityEpoch, window: windowEpoch };
    let selected;
    try {
      selected = await Promise.resolve(iina.utils.chooseFile('添加媒体文件', {}));
    } catch (_) {
      return;
    }
    if (!canWrite() || operationEpoch.authority !== authorityEpoch
      || operationEpoch.window !== windowEpoch
      || !state.groups.some((group) => group.id === payload.groupId)) return;
    const candidates = Array.isArray(selected) ? selected : [selected];
    const paths = candidates.filter((path) => (
      typeof path === 'string' && path.trim().length > 0
    ));
    if (paths.length === 0) return;
    let nextState = addItems(state, payload.groupId, paths);
    if (nextState === state) return;
    if (payload.groupId === selectedGroupId) sampleProgress();
    nextState = addItems(state, payload.groupId, paths);
    applyMutation(nextState, payload.groupId === selectedGroupId);
  }

  function onRemoveItem(payload) {
    if (!payload) return;
    if (payload.groupId === selectedGroupId) sampleProgress();
    applyMutation(
      removeItem(state, payload.groupId, payload.itemId),
      payload.groupId === selectedGroupId,
    );
  }

  function onReorderItem(payload) {
    if (!payload) return;
    if (payload.groupId === selectedGroupId) sampleProgress();
    applyMutation(
      reorderItem(state, payload.groupId, payload.itemId, payload.toIndex),
      payload.groupId === selectedGroupId,
    );
  }

  function onTransferItem(payload) {
    if (!payload) return;
    let nextState = transferItem(
      state, payload.itemId, payload.fromId, payload.toId, payload.copy,
    );
    if (nextState === state) return;
    const selectedStructureChanged = payload.toId === selectedGroupId
      || (payload.copy !== true && payload.fromId === selectedGroupId);
    if (selectedStructureChanged) {
      sampleProgress();
      nextState = transferItem(
        state, payload.itemId, payload.fromId, payload.toId, payload.copy,
      );
    }
    applyMutation(nextState, selectedStructureChanged);
  }

  const messageHandlers = {
    createGroup: onCreateGroup,
    renameGroup: onRenameGroup,
    deleteGroup: onDeleteGroup,
    setGroupOptions: onSetGroupOptions,
    selectGroup: onSelectGroup,
    playItem: onPlayItem,
    addFiles: onAddFiles,
    removeItem: onRemoveItem,
    reorderItem: onReorderItem,
    transferItem: onTransferItem,
    ready() {
      postState();
      postPlayback();
    },
  };

  function loadSidebarDocument() {
    // loadFile replaces IINA 1.4's sidebar message hub, so the handlers must
    // be rebound after every document load rather than only at plugin start.
    iina.sidebar.loadFile(SIDEBAR_PATH);
    SIDEBAR_MESSAGES.forEach((name) => iina.sidebar.onMessage(name, (payload) => {
      if (name !== 'ready' && name !== 'selectGroup' && !canWrite()) return undefined;
      return messageHandlers[name](payload);
    }));
  }

  function activateOwner() {
    if (ownerActive || closed || readOnly) return;
    ownerActive = true;
    windowInactive = false;
    applyOwnedMpvOptions();
    // Register before `loadfile replace`: mpv can emit file-started/file-loaded
    // synchronously enough that registering afterwards loses the only event
    // which certifies ownership of the replacement entry.
    if (!lifecycleRegistered) {
      lifecycleRegistered = true;
      iina.event.on('iina.file-started', onFileStarted);
      iina.event.on('iina.file-loaded', onFileLoaded);
      iina.event.on('mpv.eof-reached.changed', onEofReachedChanged);
      iina.event.on('mpv.seeking.changed', onSeekingChanged);
      iina.event.on('mpv.pause.changed', onPauseChanged);
      iina.event.on('mpv.end-file', onEndFile);
      iina.input.onKeyDown('Shift+SPACE', onSpaceKey, iina.input.PRIORITY_HIGH);
      iina.input.onKeyDown('Ctrl+p', showPlaybackGroups, iina.input.PRIORITY_HIGH);
      iina.mpv.addHook('on_load_fail', 50, onLoadFail);
    }
    synchronizePlaylist();
    sampleInterval = timers.setInterval(sampleProgress, 1000);
  }

  function start() {
    readOnlyReason = readOnly ? (settings.readOnlyReason || '全局协调器不可用，本窗口为只读') : '';
    state = settings.initialState
      ? sanitizeState(settings.initialState)
      : loadState(() => iina.file.read(DATA_PATH));
    selectedGroupId = state.selectedGroupId
      || (state.groups[0] ? state.groups[0].id : null);
    ensureNextMenuItem();
    iina.event.on('iina.window-will-close', onWindowWillClose);
    iina.event.on('iina.window-loaded', onWindowLoaded);
  }

  function normalizedMediaPath(value) {
    let path = typeof value === 'string' ? value : '';
    const fileURL = path.match(/^file:\/\/(.*)$/i);
    if (fileURL) {
      path = fileURL[1];
      if (/^localhost(?:\/|$)/i.test(path)) path = path.slice('localhost'.length);
    }
    return decodedPath(path);
  }

  function nativePlaylistEntries() {
    try {
      const live = iina.mpv.getNative('playlist');
      if (Array.isArray(live)) return live;
    } catch (_) {
      // Older API shims may not expose native nodes; retain the public fallback.
    }
    return iina.playlist.list();
  }

  function createLoadToken(group, index, loaded, autoplay, retryDamaged, controllerRequested) {
    const item = group.items[index];
    clearLoadWatchdog();
    loadGeneration += 1;
    seekEofSuppression = null;
    loadToken = {
      generation: loadGeneration,
      groupId: group.id,
      itemId: item.id,
      index,
      url: normalizedMediaPath(item.path),
      loaded: loaded === true,
      autoplay: autoplay === true,
      retryDamaged: retryDamaged === true,
      playlistGeneration,
      controllerRequested: controllerRequested === true,
    };
    handledEndGeneration = null;
    if (loadToken.loaded !== true) armLoadWatchdog(loadToken);
    return loadToken;
  }

  function invalidateLoadToken() {
    clearLoadWatchdog();
    loadGeneration += 1;
    loadToken = null;
  }

  function clearLoadWatchdog() {
    if (loadWatchdogTimer === null) return;
    timers.clearTimeout(loadWatchdogTimer);
    loadWatchdogTimer = null;
  }

  function armLoadWatchdog(token) {
    loadWatchdogTimer = timers.setTimeout(() => {
      loadWatchdogTimer = null;
      if (!canWrite() || synchronizing || !loadToken || loadToken.loaded === true
        || loadToken.generation !== token.generation) return;
      controllerPause();
      invalidateLoadToken();
      currentItemId = null;
      playbackPosition = 0;
      playbackDuration = 0;
      notifyProblem('媒体加载超时，可重试');
      postPlayback();
    }, LOAD_WATCHDOG_MS);
  }

  function playlistMatchesGroup(group) {
    const entries = nativePlaylistEntries();
    return Boolean(group && entries.length === group.items.length && group.items.every((item, index) => (
      entries[index] && normalizedMediaPath(entries[index].filename)
        === normalizedMediaPath(item.path)
    )));
  }

  function playlistIdentityAt(group, playlistPosition) {
    if (!group || !Number.isInteger(playlistPosition) || playlistPosition < 0
      || playlistPosition >= group.items.length) return null;
    const item = group.items[playlistPosition];
    const playlistEntry = nativePlaylistEntries()[playlistPosition];
    if (!playlistEntry) return null;
    const itemURL = normalizedMediaPath(item.path);
    const entryURL = normalizedMediaPath(playlistEntry.filename);
    if (entryURL !== itemURL) return null;
    return { group, item, index: playlistPosition, url: itemURL };
  }

  function currentMediaIdentity(group, url, requireCurrentURL) {
    const eventURL = normalizedMediaPath(url);
    const currentURL = normalizedMediaPath(iina.mpv.getString('path'));
    if (requireCurrentURL === true && !currentURL) return null;
    if (eventURL && currentURL && eventURL !== currentURL) return null;

    const playingPosition = iina.mpv.getNumber('playlist-playing-pos');
    if (Number.isInteger(playingPosition) && playingPosition >= 0) {
      const playingIdentity = playlistIdentityAt(group, playingPosition);
      if (!playingIdentity || (eventURL && eventURL !== playingIdentity.url)
        || (currentURL && currentURL !== playingIdentity.url)) return null;
      return playingIdentity;
    }

    const targetURL = eventURL || currentURL;
    if (!group || !targetURL) return null;
    const matches = [];
    group.items.forEach((item, index) => {
      if (normalizedMediaPath(item.path) !== targetURL) return;
      const identity = playlistIdentityAt(group, index);
      if (identity) matches.push(identity);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function selectedMediaIdentity(group) {
    const identity = playlistIdentityAt(group, iina.mpv.getNumber('playlist-pos'));
    if (!identity) return null;
    const currentURL = normalizedMediaPath(iina.mpv.getString('path'));
    if (!currentURL || currentURL !== identity.url) return null;
    return identity;
  }

  function duplicateIdentity(group, identity) {
    return Boolean(group && identity && group.items.filter((item) => (
      normalizedMediaPath(item.path) === identity.url
    )).length > 1);
  }

  function ambiguousDuplicateMedia(group) {
    return (loadToken && loadToken.loaded !== true && duplicateIdentity(group, loadToken))
      || duplicateIdentity(group, { url: normalizedMediaPath(iina.mpv.getString('path')) })
      || duplicateIdentity(group, playlistIdentityAt(group, iina.mpv.getNumber('playlist-playing-pos')))
      || duplicateIdentity(group, playlistIdentityAt(group, iina.mpv.getNumber('playlist-pos')))
      || (loadToken && loadToken.ambiguous === true && !currentMediaIdentity(group, undefined, true));
  }

  function pauseAmbiguousDuplicateMedia(group) {
    if (!ambiguousDuplicateMedia(group)) return false;
    controllerPause();
    if (!loadToken || loadToken.loaded === true) {
      invalidateLoadToken();
      // This watchdog token intentionally has no item, URL, or playlist index.
      // Native observations expose ambiguity but cannot certify an item load.
      loadToken = { generation: loadGeneration, groupId: group.id,
        playlistGeneration, loaded: false, ambiguous: true };
      currentItemId = null;
      setWaitingForNext(false);
      playbackPosition = 0;
      playbackDuration = 0;
      armLoadWatchdog(loadToken);
      postPlayback();
    }
    return true;
  }

  function failureMediaIdentity(group) {
    const currentURL = normalizedMediaPath(iina.mpv.getString('path'));
    const playingIdentity = playlistIdentityAt(
      group,
      iina.mpv.getNumber('playlist-playing-pos'),
    );
    if (playingIdentity) {
      return currentURL && currentURL !== playingIdentity.url ? null : playingIdentity;
    }

    if (!group || !currentURL) return null;
    const matches = [];
    group.items.forEach((item, index) => {
      if (normalizedMediaPath(item.path) !== currentURL) return;
      const identity = playlistIdentityAt(group, index);
      if (identity && identity.url === currentURL) matches.push(identity);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function tokenMatchesIdentity(token, identity) {
    return token && identity && token.groupId === identity.group.id
      && token.itemId === identity.item.id && token.index === identity.index
      && token.url === identity.url && token.playlistGeneration === playlistGeneration;
  }

  function holdSynchronizationPause() {
    controllerPause();
    const generation = playlistGeneration;
    const keepPausedAfterReplacement = Boolean(syncTransaction && !syncTransaction.targetIntent);
    const timer = timers.setTimeout(() => {
      failureTimers.delete(timer);
      if (synchronizing && playlistGeneration === generation) controllerPause();
    }, 0);
    failureTimers.add(timer);
    if (keepPausedAfterReplacement) {
      const settledTimer = timers.setTimeout(() => {
        failureTimers.delete(settledTimer);
        if (playlistGeneration === generation && !loadToken) controllerPause();
      }, 250);
      failureTimers.add(settledTimer);
    }
  }

  function onFileStarted() {
    if (!canWrite()) return;
    // mpv may resume while activating the appended replacement entry. Keep
    // the transaction paused until the rebuilt native playlist is stable.
    if (synchronizing) {
      holdSynchronizationPause();
      return;
    }
    const group = selectedGroup();
    // IINA's started callback carries no event identity. Observing the latest
    // native position cannot prove which duplicate request emitted it.
    if (pauseAmbiguousDuplicateMedia(group)) return;
    const identity = currentMediaIdentity(group, undefined, true);
    if (loadToken && loadToken.loaded !== true) {
      if (!identity || !tokenMatchesIdentity(loadToken, identity)) {
        if (!identity || loadToken.controllerRequested) controllerPause();
        if (loadToken.controllerRequested) return;
      } else {
        currentItemId = identity.item.id;
        setWaitingForNext(false);
        playbackPosition = 0;
        playbackDuration = Number.isFinite(identity.item.duration) ? identity.item.duration : 0;
        postPlayback();
        return;
      }
    }
    invalidateLoadToken();
    currentItemId = null;
    setWaitingForNext(false);
    playbackPosition = 0;
    playbackDuration = 0;
    if (identity) {
      // Native playlist transitions briefly report paused while the next file
      // is loading. Loop/once groups must still resume that next item; only a
      // manual group preserves the paused state between entries.
      const autoplay = transitionAutoplay(group.mode, iina.core.status.paused === true);
      createLoadToken(group, identity.index, false, autoplay, false, false);
      currentItemId = identity.item.id;
      playbackDuration = Number.isFinite(identity.item.duration) ? identity.item.duration : 0;
    }
    postPlayback();
  }

  function onFileLoaded(url) {
    if (!canWrite()) return;
    if (synchronizing) {
      holdSynchronizationPause();
      verifySyncTransaction(false);
      return;
    }
    const group = selectedGroup();
    if (pauseAmbiguousDuplicateMedia(group)) return;
    const identity = currentMediaIdentity(group, url);
    if (!identity) return;
    if (!tokenMatchesIdentity(loadToken, identity)) {
      // Native loop/once transitions are not initiated by startPlaybackAt(),
      // so they may arrive without a token when IINA publishes the new path
      // after file-started. Adopt only a verified live playlist identity;
      // never replace a mismatching explicit user request or manual state.
      if (group.mode === 'manual' || (loadToken && loadToken.controllerRequested === true)) return;
      createLoadToken(group, identity.index, false, true, false, false);
      currentItemId = identity.item.id;
      playbackPosition = 0;
      playbackDuration = Number.isFinite(identity.item.duration) ? identity.item.duration : 0;
    }
    if (duplicateIdentity(group, identity)) {
      controllerPause();
      return;
    }
    const { item, index: itemIndex } = identity;
    currentItemId = item.id;
    clearLoadWatchdog();
    loadToken = { ...loadToken, loaded: true };
    setWaitingForNext(false);
    const duration = iina.mpv.getNumber('duration');
    if (Number.isFinite(duration) && duration >= 0) {
      playbackDuration = duration;
      updateItem(group.id, item.id, (candidate) => (
        candidate.duration === duration ? candidate : { ...candidate, duration }
      ), 'playback');
    }
    if (item.damaged === true || item.missing === true) {
      updateItem(group.id, item.id, (candidate) => ({
        ...candidate, damaged: false, missing: false,
      }));
    }
    const position = resolveStartPosition(group, item, playbackDuration);
    playbackPosition = position;
    controllerPause();
    iina.core.seekTo(position);
    if (loadToken.autoplay) controllerResume();
    postPlayback();
  }

  function sampleProgress() {
    if (!canWrite()) return;
    const token = loadToken;
    const group = selectedGroup();
    // IINA 1.4 can miss the eof-reached change notification while keep-open
    // holds the last frame. The existing one-second sampler is an independent
    // recovery path and the token generation keeps this idempotent.
    if (group && group.mode === 'manual' && iina.mpv.getFlag('eof-reached') === true) {
      handleNaturalEndEvent();
      return;
    }
    const identity = currentMediaIdentity(group, undefined, true);
    const item = token && token.loaded === true && group && token.groupId === group.id
      ? group.items[token.index]
      : null;
    if (!item || item.id !== token.itemId || currentItemId !== token.itemId
      || !tokenMatchesIdentity(token, identity)) return;
    const seconds = iina.mpv.getNumber('time-pos');
    const duration = iina.mpv.getNumber('duration');
    const previousPosition = playbackPosition;
    const previousDuration = playbackDuration;
    if (Number.isFinite(seconds) && seconds >= 0) playbackPosition = seconds;
    if (Number.isFinite(duration) && duration >= 0) playbackDuration = duration;
    updateItem(group.id, item.id, (candidate) => {
      let updated = recordProgress(group, candidate, seconds, duration);
      if (Number.isFinite(duration) && duration >= 0 && updated.duration !== duration) {
        updated = { ...updated, duration };
      }
      const samePosition = updated.position === candidate.position;
      const sameDuration = updated.duration === candidate.duration;
      return samePosition && sameDuration ? candidate : updated;
    }, true);
    if (previousPosition !== playbackPosition || previousDuration !== playbackDuration) postPlayback();
  }

  function clearOwnedTimers() {
    if (saveTimer !== null) timers.clearTimeout(saveTimer);
    if (progressSaveTimer !== null) timers.clearTimeout(progressSaveTimer);
    if (sampleInterval !== null) timers.clearInterval(sampleInterval);
    failureTimers.forEach((timer) => timers.clearTimeout(timer));
    if (syncRetryTimer !== null) timers.clearTimeout(syncRetryTimer);
    if (loadWatchdogTimer !== null) timers.clearTimeout(loadWatchdogTimer);
    failureTimers.clear();
    saveTimer = null;
    progressSaveTimer = null;
    sampleInterval = null;
    syncRetryTimer = null;
    loadWatchdogTimer = null;
    syncTransaction = null;
    synchronizing = false;
  }

  function onWindowWillClose() {
    if (closed || windowInactive) return;
    if (canWrite()) {
      sampleProgress();
      flushSave();
    }
    controllerPause();
    clearOwnedTimers();
    setWaitingForNext(false);
    restoreOwnedMpvOptions();
    ownerActive = false;
    windowInactive = true;
    windowEpoch += 1;
    if (typeof settings.setActive === 'function') {
      if (!readOnly) authorityEpoch += 1;
      readOnly = true;
      readOnlyReason = '窗口已关闭，等待重新取得管理权限';
      settings.setActive(false);
    }
  }

  function onWindowLoaded() {
    if (closed) return;
    const wasInactive = windowInactive;
    if (wasInactive) {
      windowInactive = false;
      windowEpoch += 1;
      if (typeof settings.setActive === 'function') settings.setActive(true);
    }
    // A PlayerCore may start on IINA's initial window, where the first sidebar
    // load is forbidden. Create it only after IINA certifies the player window.
    loadSidebarDocument();
    activateOwner();
    postState();
    postPlayback();
  }

  function finishOnLastFrame(message) {
    setWaitingForNext(false);
    controllerPause();
    if (message) iina.core.osd(message);
    postPlayback();
  }

  function onEndFile() {
    if (!canWrite() || !loadToken) return;
    const group = selectedGroup();
    if (!group || group.mode !== 'manual') return;
    if (ignoredReplacementEndGeneration === loadToken.generation) {
      ignoredReplacementEndGeneration = null;
      return;
    }
    // IINA's JavaScript bridge does not expose MPV_END_FILE_REASON and clears
    // eof-reached/time-pos before this callback. A loaded, identity-checked
    // token is the only stable completion certificate available here. During
    // controller-initiated replacement the new token is still unloaded, so
    // the outgoing entry cannot be mistaken for a natural completion.
    handleNaturalEndEvent();
  }

  function onLoadFail() {
    if (!canWrite() || synchronizing) return;
    const identity = failureMediaIdentity(selectedGroup());
    if (!identity) {
      if (loadToken && loadToken.loaded !== true) {
        controllerPause();
        invalidateLoadToken();
        currentItemId = null;
        playbackPosition = 0;
        playbackDuration = 0;
        postPlayback();
      }
      notifyProblem('无法确认失败媒体，未自动跳过');
      return;
    }
    const matchingToken = tokenMatchesIdentity(loadToken, identity) && loadToken.loaded !== true
      ? loadToken
      : null;
    const snapshot = Object.freeze({
      groupId: identity.group.id,
      itemId: identity.item.id,
      index: identity.index,
      url: identity.url,
      generation: matchingToken ? matchingToken.generation : null,
      authorityEpoch,
      windowEpoch,
      playlistGeneration,
    });
    const timer = timers.setTimeout(() => {
      failureTimers.delete(timer);
      if (!canWrite()) return;
      handleFailureSnapshot(snapshot);
    }, 0);
    failureTimers.add(timer);
  }

  function handleFailureSnapshot(snapshot) {
    if (snapshot.authorityEpoch !== authorityEpoch || snapshot.windowEpoch !== windowEpoch
      || snapshot.playlistGeneration !== playlistGeneration) return;
    const group = state.groups.find((candidate) => candidate.id === snapshot.groupId);
    const item = group && group.items.find((candidate) => (
      candidate.id === snapshot.itemId && normalizedMediaPath(candidate.path) === snapshot.url
    ));
    if (!group || !item) return;
    updateItem(snapshot.groupId, snapshot.itemId, (candidate) => (
      candidate.damaged === true && candidate.missing !== true
        ? candidate
        : { ...candidate, damaged: true, missing: false }
    ));

    const token = loadToken;
    const identity = selectedMediaIdentity(selectedGroup());
    const generationStillCurrent = snapshot.generation !== null && token && token.loaded !== true
      && token.generation === snapshot.generation && token.groupId === snapshot.groupId
      && token.itemId === snapshot.itemId && token.index === snapshot.index
      && token.url === snapshot.url;
    const playingPosition = iina.mpv.getNumber('playlist-playing-pos');
    const playingPositionAvailable = Number.isFinite(playingPosition) && playingPosition >= 0;
    const playingIdentity = playingPositionAvailable
      ? playlistIdentityAt(selectedGroup(), playingPosition) : null;
    const canSkip = generationStillCurrent && tokenMatchesIdentity(token, identity)
      && (!playingPositionAvailable || tokenMatchesIdentity(token, playingIdentity))
      && !duplicateIdentity(group, identity);
    if (!canSkip) {
      if (generationStillCurrent) {
        controllerPause();
        invalidateLoadToken();
        currentItemId = null;
        setWaitingForNext(false);
        playbackPosition = 0;
        playbackDuration = 0;
        postPlayback();
      }
      notifyProblem('无法播放');
      return;
    }
    invalidateLoadToken();
    const freshGroup = selectedGroup();
    const skipped = playAvailableFrom(freshGroup, snapshot.index + 1, group.mode === 'loop');
    notifyProblem(skipped ? '无法播放，已跳过' : '无法播放');
  }

  function onEofReachedChanged() {
    if (!canWrite()) return;
    if (iina.mpv.getFlag('eof-reached') !== true) {
      seekEofSuppression = null;
      const retainedWaiting = waitingAfterEofChange(false, waitingForNext);
      if (retainedWaiting !== waitingForNext) {
        setWaitingForNext(retainedWaiting);
        postPlayback();
      }
      return;
    }
    const group = selectedGroup();
    if (!group || group.mode !== 'manual') return;
    if (seekEofSuppression && loadToken
      && seekEofSuppression.loadGeneration === loadToken.generation) return;
    handleNaturalEndEvent();
  }

  function handleNaturalEndEvent() {
    const token = loadToken;
    if (!token || handledEndGeneration === token.generation) return;
    const group = selectedGroup();
    // IINA clears path/time-pos before mpv.end-file. The loaded token was
    // already certified by file-loaded and remains valid for this playlist
    // generation, so it is the stable identity at EOF.
    const liveIdentity = currentMediaIdentity(group, undefined, true);
    const itemIndex = manualEndItemIndex(
      group, currentItemId, token, playlistGeneration, liveIdentity,
    );
    const item = itemIndex >= 0 ? group.items[itemIndex] : null;
    if (!item) return;
    handledEndGeneration = token.generation;

    const completedItem = group.items[itemIndex];
    updateItem(group.id, completedItem.id, (item) => {
      let updated = item;
      if (item.position !== 0) updated = { ...updated, position: 0 };
      if (Number.isFinite(playbackDuration) && playbackDuration >= 0
        && updated.duration !== playbackDuration) {
        updated = { ...updated, duration: playbackDuration };
      }
      return updated;
    });
    flushSave();

    const decision = onNaturalEnd(group, itemIndex);
    if (decision.action === 'play') {
      playAvailableFrom(group, decision.itemIndex, group.mode === 'loop');
      return;
    }
    if (decision.action === 'skip') {
      playAvailableFrom(group, itemIndex + 1, group.mode === 'loop');
      return;
    }
    if (decision.action === 'wait') {
      setWaitingForNext(true);
      controllerPause();
      iina.core.osd('按空格播放下一项');
      postPlayback();
      return;
    }
    finishOnLastFrame('本组播放完毕');
  }

  function onSeekingChanged() {
    if (!canWrite()) return;
    if (iina.mpv.getFlag('seeking') === true) {
      seekEofSuppression = {
        loadGeneration: loadToken ? loadToken.generation : null,
      };
      const wasWaiting = waitingForNext;
      setWaitingForNext(false);
      if (wasWaiting) postPlayback();
    } else if (iina.mpv.getFlag('eof-reached') !== true) {
      seekEofSuppression = null;
    }
  }

  function onPauseChanged() {
    if (!canWrite()) return;
    if (iina.mpv.getFlag('pause') !== true) {
      controllerPausePending = false;
      pauseAmbiguousDuplicateMedia(selectedGroup());
      return;
    }
    if (controllerPausePending) {
      controllerPausePending = false;
      return;
    }
    if (loadToken && loadToken.loaded !== true && loadToken.autoplay === true) {
      loadToken = { ...loadToken, autoplay: false };
      postPlayback();
    }
  }

  function onSpaceKey(data) {
    if (data && data.isRepeat === true) return true;
    const group = selectedGroup();
    const nextIndex = commandNextItemIndex(group, currentItemId);
    if (nextIndex >= 0) {
      setWaitingForNext(false);
      playAvailableFrom(group, nextIndex, false);
      return true;
    }
    if (group && group.mode === 'manual') {
      finishOnLastFrame('已到分组末尾');
      return true;
    }
    return false;
  }

  function showPlaybackGroups(data) {
    if (data && data.isRepeat === true) return true;
    iina.sidebar.show();
    return true;
  }

  function ensureNextMenuItem() {
    if (openSidebarMenuItemIndex === null) {
      openSidebarMenuItemIndex = iina.menu.items().length;
      iina.menu.addItem(iina.menu.item(
        '显示播放分组',
        showPlaybackGroups,
      ));
    }
    if (spaceMenuItemIndex === null) {
      spaceMenuItemIndex = iina.menu.items().length;
      iina.menu.addItem(iina.menu.item(
        '播放下一项',
        () => onSpaceKey({ isRepeat: false }),
      ));
    }
  }

  function setWaitingForNext(waiting) {
    waitingForNext = waiting === true;
  }

  function setCoordinatorState(payload) {
    if (closed || !payload) return;
    const wasReadOnly = readOnly;
    const previousFingerprint = stateStructureFingerprint(state);
    const hasBarrier = typeof payload.coordinatorBootId === 'string'
      && Number.isInteger(payload.coordinatorRequestId)
      && Number.isInteger(payload.coordinatorRevision)
      && Number.isInteger(payload.contentVersion);
    const authorityChanged = hasBarrier && (
      coordinatorBootId !== payload.coordinatorBootId
        || coordinatorRequestId !== payload.coordinatorRequestId
    );
    const nextReadOnly = windowInactive || payload.isOwner !== true;
    const acceptedSaveVersion = Number.isInteger(payload.acceptedSaveVersion)
      ? payload.acceptedSaveVersion : 0;
    const incomingContentVersion = hasBarrier
      ? payload.contentVersion : coordinatorContentVersion;
    const contentAdvanced = incomingContentVersion > coordinatorContentVersion;
    let preserveDirtyState = hasBarrier && !authorityChanged && !nextReadOnly && dirty
      && acceptedSaveVersion < localSaveVersion;
    if (wasReadOnly !== nextReadOnly) preserveDirtyState = false;

    if (authorityChanged) {
      authorityEpoch += 1;
      setWaitingForNext(false);
      clearOwnedTimers();
      controllerPause();
      invalidateLoadToken();
      currentItemId = null;
      playbackPosition = 0;
      playbackDuration = 0;
      ownerActive = false;
      dirty = false;
    }

    const shouldAdoptState = !preserveDirtyState && (
      !hasBarrier || authorityChanged || wasReadOnly !== nextReadOnly || nextReadOnly
        || contentAdvanced
        || acceptedSaveVersion >= localSaveVersion
    );
    if (shouldAdoptState) {
      state = sanitizeState(payload.state || state);
      if (authorityChanged && state.groups.some((group) => group.id === state.selectedGroupId)) {
        selectedGroupId = state.selectedGroupId;
      } else if (!state.groups.some((group) => group.id === selectedGroupId)) {
        selectedGroupId = state.groups.some((group) => group.id === state.selectedGroupId)
          ? state.selectedGroupId
          : (state.groups[0] ? state.groups[0].id : null);
      }
      if (hasBarrier && acceptedSaveVersion >= localSaveVersion) dirty = false;
    }
    if (hasBarrier) {
      coordinatorBootId = payload.coordinatorBootId;
      coordinatorRequestId = payload.coordinatorRequestId;
      coordinatorRevision = payload.coordinatorRevision;
      if (authorityChanged || incomingContentVersion >= coordinatorContentVersion) {
        coordinatorContentVersion = incomingContentVersion;
      }
      if (preserveDirtyState && contentAdvanced) {
        scheduleDirtyRetry();
      }
    }

    readOnly = nextReadOnly;
    readOnlyReason = readOnly
      ? (windowInactive ? '窗口已关闭，等待重新取得管理权限' : (payload.readOnlyReason || '本窗口为只读'))
      : '';
    if (!authorityChanged && wasReadOnly !== readOnly) authorityEpoch += 1;
    if (!wasReadOnly && readOnly) {
      dirty = false;
      setWaitingForNext(false);
      clearOwnedTimers();
      controllerPause();
      invalidateLoadToken();
      currentItemId = null;
      playbackPosition = 0;
      playbackDuration = 0;
      restoreOwnedMpvOptions();
      ownerActive = false;
    }
    if (wasReadOnly && !readOnly && !windowInactive) {
      if (state.selectedGroupId !== selectedGroupId) {
        state = { ...state, selectedGroupId };
        scheduleSave();
      }
      activateOwner();
    } else if (authorityChanged && !readOnly && !windowInactive) {
      activateOwner();
    } else if (!readOnly && shouldAdoptState
      && previousFingerprint !== stateStructureFingerprint(state)) {
      synchronizePlaylist();
    }
    if (previousFingerprint !== stateStructureFingerprint(state)
      || wasReadOnly !== readOnly || authorityChanged) postState();
    postPlayback();
  }

  function dispose() {
    if (closed) return;
    onWindowWillClose();
    closed = true;
    clearOwnedTimers();
    setWaitingForNext(false);
    if (spaceMenuItemIndex !== null) {
      iina.menu.removeAt(spaceMenuItemIndex);
      spaceMenuItemIndex = null;
    }
    if (openSidebarMenuItemIndex !== null) {
      iina.menu.removeAt(openSidebarMenuItemIndex);
      openSidebarMenuItemIndex = null;
    }
  }

  return { start, setCoordinatorState, dispose };
}

module.exports = {
  DATA_PATH,
  LOAD_WATCHDOG_MS,
  SIDEBAR_MESSAGES,
  createController,
  commandNextItemIndex,
  manualEndItemIndex,
  mpvOptionsForMode,
  playNativePlaylistIndex,
  replaceNativePlaylist,
  synchronizedCurrentIndex,
  transitionAutoplay,
  waitingAfterEofChange,
};
