const { createController } = require('./controller.js');

function startMain(iina, options) {
  const settings = options || {};
  const timers = settings.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const sessionId = settings.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let requestId = 1;
  let acknowledged = false;
  let coordinatorBootId = null;
  const retiredBootIds = new Set();
  const receiptChallenges = new Set();
  let revision = -1;
  let active = true;
  let retryCount = 0;
  let retryTimer = null;
  let heartbeatTimer = null;
  let controller = null;
  let disposed = false;
  let pendingSave = null;
  let localFallback = false;
  function saveThroughGlobal(state, metadata) {
    if (!acknowledged || disposed || !active) return;
    const saveMetadata = metadata || {};
    pendingSave = {
      coordinatorBootId, sessionId, requestId, state,
      baseContentVersion: saveMetadata.baseContentVersion,
      saveVersion: saveMetadata.saveVersion,
    };
    iina.global.postMessage('playback-groups.save', pendingSave);
  }
  function controllerOptions(statePayload, isOwner, reason) {
    return {
      initialState: statePayload.state,
      readOnly: isOwner !== true,
      readOnlyReason: reason,
      timers,
      coordinatorBootId: statePayload.coordinatorBootId,
      coordinatorRequestId: requestId,
      coordinatorRevision: statePayload.revision,
      contentVersion: statePayload.contentVersion,
      acceptedSaveVersion: acceptedSaveVersion(statePayload),
      save: saveThroughGlobal,
      setActive,
    };
  }
  function startLocalFallback() {
    if (controller) return;
    // IINA 1.4 can expose global messaging while dropping directed replies to
    // ordinary player instances. Fall back to the controller's direct @data
    // persistence, and never upgrade this session later: doing so would create
    // two writers with different revision authorities.
    localFallback = true;
    acknowledged = false;
    receiptChallenges.clear();
    pendingSave = null;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer);
    retryTimer = null;
    heartbeatTimer = null;
    controller = createController(iina, { timers });
    controller.start();
  }

  function coordinatorPayload(statePayload) {
    return {
      state: statePayload.state,
      isOwner: statePayload.ownerSessionId === sessionId,
      readOnlyReason: statePayload.readOnlyReason,
      coordinatorBootId: statePayload.coordinatorBootId,
      coordinatorRequestId: requestId,
      coordinatorRevision: statePayload.revision,
      contentVersion: statePayload.contentVersion,
      acceptedSaveVersion: acceptedSaveVersion(statePayload),
    };
  }
  function acceptedSaveVersion(statePayload) {
    return statePayload.acceptedSaveSessionId === sessionId
      && statePayload.acceptedSaveRequestId === requestId
      && Number.isInteger(statePayload.acceptedSaveVersion)
      ? statePayload.acceptedSaveVersion
      : 0;
  }
  function validStatePayload(payload) {
    return Boolean(payload && payload.state && Number.isInteger(payload.revision)
      && Number.isInteger(payload.contentVersion) && payload.contentVersion >= 0);
  }
  function applyCoordinatorState(payload) {
    if (pendingSave && acceptedSaveVersion(payload) >= pendingSave.saveVersion) pendingSave = null;
    const next = coordinatorPayload(payload);
    if (!controller) {
      controller = createController(iina, controllerOptions(
        payload, next.isOwner, next.readOnlyReason,
      ));
      controller.start();
    } else controller.setCoordinatorState(next);
  }
  function receiveState(payload) {
    if (localFallback || disposed || !active || !acknowledged || !validStatePayload(payload)
      || payload.coordinatorBootId !== coordinatorBootId
      || !Number.isInteger(payload.revision) || payload.revision <= revision) return;
    revision = payload.revision;
    applyCoordinatorState(payload);
  }
  function receiveAck(payload) {
    if (localFallback || !validStatePayload(payload) || typeof payload.coordinatorBootId !== 'string'
      || !payload.coordinatorBootId || payload.coordinatorBootId !== coordinatorBootId
      || payload.sessionId !== sessionId || payload.requestId !== requestId) return;
    if (retiredBootIds.has(payload.coordinatorBootId)) return;
    if (!receiptChallenges.has(payload.challenge)) return;
    if (acknowledged && payload.revision <= revision) return;
    if (!active || disposed) {
      iina.global.postMessage('playback-groups.inactive', {
        coordinatorBootId, sessionId, requestId,
      });
      return;
    }
    acknowledged = true;
    revision = payload.revision;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
    if (heartbeatTimer === null) heartbeatTimer = timers.setInterval(() => {
      iina.global.postMessage('playback-groups.heartbeat', {
        coordinatorBootId, sessionId, requestId,
      });
    }, 5000);
    applyCoordinatorState(payload);
  }
  function receiveChallenge(payload) {
    if (localFallback || disposed || !active || !payload || payload.coordinatorBootId !== coordinatorBootId
      || payload.sessionId !== sessionId || payload.requestId !== requestId
      || typeof payload.challenge !== 'string' || !payload.challenge) return;
    receiptChallenges.add(payload.challenge);
    iina.global.postMessage('playback-groups.confirm', {
      coordinatorBootId, sessionId, requestId, challenge: payload.challenge,
    });
  }
  function receiveReregister(payload) {
    if (localFallback || disposed || !active || !payload || typeof payload.coordinatorBootId !== 'string'
      || !payload.coordinatorBootId || payload.sessionId !== sessionId
      || payload.requestId !== requestId || retiredBootIds.has(payload.coordinatorBootId)) return;
    if (acknowledged && coordinatorBootId === payload.coordinatorBootId) {
      if (active) {
        iina.global.postMessage('playback-groups.register', {
          coordinatorBootId, sessionId, requestId,
        });
      }
      return;
    }
    const authorityChanged = coordinatorBootId !== null
      && coordinatorBootId !== payload.coordinatorBootId;
    if (authorityChanged) {
      retiredBootIds.add(coordinatorBootId);
      if (controller) controller.setCoordinatorState({
        isOwner: false,
        readOnlyReason: '全局协调器已重启，正在重新确认管理权限',
        coordinatorBootId: payload.coordinatorBootId,
        coordinatorRequestId: requestId,
        coordinatorRevision: -1,
        contentVersion: 0,
        acceptedSaveVersion: 0,
      });
    }
    if (coordinatorBootId !== payload.coordinatorBootId) {
      receiptChallenges.clear();
      pendingSave = null;
    }
    coordinatorBootId = payload.coordinatorBootId;
    revision = -1;
    acknowledged = false;
    retryCount = 0;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer);
    retryTimer = null;
    heartbeatTimer = null;
    sendRegister();
  }
  function sendRegister() {
    retryTimer = null;
    if (localFallback || disposed || !active || acknowledged) return;
    if (retryCount >= 5) {
      startLocalFallback();
      return;
    }
    retryCount += 1;
    retryTimer = timers.setTimeout(sendRegister, 1000);
    iina.global.postMessage('playback-groups.register', {
      coordinatorBootId, sessionId, requestId,
    });
  }
  function setActive(nextActive) {
    const shouldBeActive = nextActive === true;
    if (disposed && shouldBeActive) return;
    if (shouldBeActive === active) return;
    active = shouldBeActive;
    if (!active) {
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer);
      retryTimer = null;
      heartbeatTimer = null;
      if (!localFallback && coordinatorBootId !== null) {
        iina.global.postMessage('playback-groups.inactive', {
          coordinatorBootId, sessionId, requestId,
          ...(pendingSave ? { pendingSave } : {}),
        });
      }
      return;
    }
    if (localFallback) return;
    requestId += 1;
    pendingSave = null;
    receiptChallenges.clear();
    acknowledged = false;
    revision = -1;
    retryCount = 0;
    sendRegister();
  }
  if (!iina.global || typeof iina.global.onMessage !== 'function') {
    startLocalFallback();
    return { dispose() { disposed = true; controller.dispose(); } };
  }
  if (iina.event && typeof iina.event.on === 'function') {
    // The entry's return value is not an IINA cleanup hook. Own pre-ACK window
    // activity here; once mounted, controller close owns flush-before-release.
    iina.event.on('iina.window-will-close', () => {
      if (!controller) setActive(false);
    });
    iina.event.on('iina.window-loaded', () => {
      if (!controller && !disposed) {
        active = true;
        startLocalFallback();
      }
    });
    // When a file is opened from IINA's initial window, the normal global
    // coordinator acknowledgement may arrive after the file-started event.
    // Mount immediately so the sidebar and playback hooks are not lost.
    iina.event.on('iina.file-started', () => {
      if (!controller && !acknowledged && !disposed && active) startLocalFallback();
    });
  }
  iina.global.onMessage('playback-groups.reregister', receiveReregister);
  iina.global.onMessage('playback-groups.challenge', receiveChallenge);
  iina.global.onMessage('playback-groups.ack', receiveAck);
  iina.global.onMessage('playback-groups.state', receiveState);
  retryTimer = timers.setTimeout(sendRegister, 0);
  return {
    dispose() {
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer);
      retryTimer = null;
      heartbeatTimer = null;
      if (controller && typeof controller.dispose === 'function') controller.dispose();
      if (active) setActive(false);
      disposed = true;
    },
  };
}
module.exports = { startMain };
