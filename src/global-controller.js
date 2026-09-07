const { loadState, saveState, sanitizeState } = require('./storage.js');
const DATA_PATH = '@data/playback-groups.json';
const PLAYER_TTL_MS = 15000;
const SWEEP_MS = 5000;

function createGlobalController(iina, options) {
  const settings = options || {};
  const timers = settings.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const now = settings.now || (() => Date.now());
  const coordinatorBootId = settings.coordinatorBootId
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let state = loadState(() => iina.file.read(DATA_PATH));
  const order = [];
  const records = Object.create(null);
  const candidates = Object.create(null);
  const retiredSessions = Object.create(null);
  const replyTimers = new Set();
  let challengeSequence = 0;
  let ownerSessionId = null;
  let revision = 0;
  let contentVersion = 0;
  let acceptedSaveVersion = 0;
  let acceptedSaveSessionId = null;
  let acceptedSaveRequestId = null;
  let sweepTimer = null;
  const live = (record) => Boolean(record && now() - record.lastSeen < PLAYER_TTL_MS);
  const eligible = (record) => Boolean(
    record && record.active === true && record.confirmed === true && live(record),
  );
  const ownerRecord = () => order.map((id) => records[id]).find((record) => (
    eligible(record) && record.sessionId === ownerSessionId
  )) || null;
  function statePayload() {
    return {
      state, ownerSessionId, coordinatorBootId, revision,
      contentVersion,
      acceptedSaveVersion,
      acceptedSaveSessionId,
      acceptedSaveRequestId,
      readOnlyReason: '另一个 IINA 窗口正在管理播放分组，本窗口为只读',
    };
  }
  function broadcast() {
    revision += 1;
    sendStateToPlayers(statePayload());
  }
  function sendStateToPlayers(snapshot) {
    // IINA's null target reaches only createPlayerInstance children, not the
    // ordinary PlayerCores whose native labels register with this coordinator.
    order.forEach((playerID) => iina.global.postMessage(playerID, 'playback-groups.state', snapshot));
  }
  function chooseOwner() {
    // Registering another participant cannot revoke a healthy owner's dirty state.
    if (ownerRecord()) return;
    const next = order.map((id) => records[id]).find(eligible) || null;
    const nextSession = next ? next.sessionId : null;
    if (nextSession === ownerSessionId) return;
    ownerSessionId = nextSession;
    if (next) next.ownerContentFloor = contentVersion;
  }
  function delayedAck(playerID, record, requestId) {
    const timer = timers.setTimeout(() => {
      replyTimers.delete(timer);
      const current = records[playerID];
      if (current !== record || !eligible(current) || current.requestId !== requestId) return;
      chooseOwner();
      revision += 1;
      const snapshot = statePayload();
      iina.global.postMessage(playerID, 'playback-groups.ack', {
        ...snapshot, sessionId: record.sessionId, requestId, challenge: record.challenge,
      });
      sendStateToPlayers(snapshot);
    }, 0);
    replyTimers.add(timer);
  }
  function delayedChallenge(playerID, candidate) {
    const timer = timers.setTimeout(() => {
      replyTimers.delete(timer);
      if (!candidates[playerID] || candidates[playerID][candidate.sessionId] !== candidate
        || !candidate.active || !live(candidate)) return;
      iina.global.postMessage(playerID, 'playback-groups.challenge', {
        coordinatorBootId, sessionId: candidate.sessionId,
        requestId: candidate.requestId, challenge: candidate.challenge,
      });
    }, 0);
    replyTimers.add(timer);
  }
  function requestRegistration(payload, playerID) {
    if (!playerID || !payload || typeof payload.sessionId !== 'string'
      || !payload.sessionId || !Number.isInteger(payload.requestId)) return;
    const timer = timers.setTimeout(() => {
      replyTimers.delete(timer);
      iina.global.postMessage(playerID, 'playback-groups.reregister', {
        coordinatorBootId,
        sessionId: payload.sessionId,
        requestId: payload.requestId,
      });
    }, 0);
    replyTimers.add(timer);
  }
  function register(payload, playerID) {
    if (!playerID || !payload || typeof payload.sessionId !== 'string'
      || !payload.sessionId || !Number.isInteger(payload.requestId)) return;
    if (payload.coordinatorBootId !== coordinatorBootId) {
      requestRegistration(payload, playerID);
      return;
    }
    if (!order.includes(playerID)) order.push(playerID);
    if (retiredSessions[playerID] && retiredSessions[playerID].has(payload.sessionId)) return;
    const previous = records[playerID];
    if (previous && previous.sessionId === payload.sessionId) {
      if (payload.requestId < previous.requestId || (payload.requestId === previous.requestId
        && previous.active !== true)) return;
      if (payload.requestId === previous.requestId && eligible(previous)) {
        // Idempotent ACK retry does not refresh liveness or reset the save barrier.
        delayedAck(playerID, previous, payload.requestId);
        return;
      }
    } else if (previous && previous.confirmed === true && previous.active === true
      && live(previous)) {
      return;
    }
    if (!candidates[playerID]) candidates[playerID] = Object.create(null);
    const pending = candidates[playerID][payload.sessionId];
    if (pending && (payload.requestId < pending.requestId
      || (payload.requestId === pending.requestId && !pending.active))) return;
    if (pending && pending.requestId === payload.requestId && live(pending)) {
      delayedChallenge(playerID, pending);
      return;
    }
    // Candidates for different sessions coexist: a stale register cannot erase
    // the current client's outstanding challenge or alter the confirmed record.
    const candidate = {
      sessionId: payload.sessionId,
      requestId: payload.requestId,
      lastSeen: now(),
      active: true,
      confirmed: false,
      lastSaveVersion: 0,
      challenge: `${coordinatorBootId}:${++challengeSequence}:${Math.random().toString(36).slice(2)}`,
    };
    candidates[playerID][payload.sessionId] = candidate;
    delayedChallenge(playerID, candidate);
  }
  function confirm(payload, playerID) {
    if (!payload || payload.coordinatorBootId !== coordinatorBootId
      || typeof payload.challenge !== 'string' || !payload.challenge) return;
    const previous = records[playerID];
    if (eligible(previous) && previous.sessionId === payload.sessionId
      && previous.requestId === payload.requestId && previous.challenge === payload.challenge) {
      delayedAck(playerID, previous, previous.requestId);
      return;
    }
    const pending = candidates[playerID] && candidates[playerID][payload.sessionId];
    if (!pending || !pending.active || !live(pending)
      || pending.requestId !== payload.requestId || pending.challenge !== payload.challenge
      || (eligible(previous) && (previous.sessionId !== pending.sessionId
        || previous.requestId !== pending.requestId))) return;
    if (previous && previous.sessionId !== pending.sessionId) {
      if (!retiredSessions[playerID]) retiredSessions[playerID] = new Set();
      retiredSessions[playerID].add(previous.sessionId);
    }
    // Consuming one proof invalidates every competing proof for this player.
    // A delayed obsolete proof cannot take over after the current session closes.
    candidates[playerID] = Object.create(null);
    const sameRequest = previous && previous.sessionId === pending.sessionId
      && previous.requestId === pending.requestId;
    records[playerID] = {
      ...pending, confirmed: true, lastSeen: now(),
      lastSaveVersion: sameRequest ? previous.lastSaveVersion : 0,
      ownerContentFloor: sameRequest ? previous.ownerContentFloor : contentVersion,
    };
    chooseOwner();
    delayedAck(playerID, records[playerID], pending.requestId);
  }
  function heartbeat(payload, playerID) {
    const record = records[playerID];
    if (!payload) return;
    if (payload.coordinatorBootId !== coordinatorBootId || !record
      || record.sessionId !== payload.sessionId || record.requestId !== payload.requestId
      || record.active !== true || record.confirmed !== true || !live(record)) {
      requestRegistration(payload, playerID);
      return;
    }
    record.lastSeen = now();
  }
  function inactive(payload, playerID) {
    const record = records[playerID];
    if (!payload || payload.coordinatorBootId !== coordinatorBootId) return;
    const pending = candidates[playerID] && candidates[playerID][payload.sessionId];
    if (pending && pending.requestId === payload.requestId) pending.active = false;
    if (!record
      || record.sessionId !== payload.sessionId
      || record.requestId !== payload.requestId) return;
    if (payload.pendingSave && eligible(record) && record.sessionId === ownerSessionId) {
      const finalSave = payload.pendingSave;
      // The final snapshot and relinquish are one ordered operation. Its base
      // may lag only this same owner's writes (for example a lost save ACK).
      if (finalSave.coordinatorBootId !== coordinatorBootId
        || finalSave.sessionId !== record.sessionId || finalSave.requestId !== record.requestId
        || !Number.isInteger(finalSave.baseContentVersion)
        || finalSave.baseContentVersion < record.ownerContentFloor
        || finalSave.baseContentVersion > contentVersion
        || !Number.isInteger(finalSave.saveVersion)) return;
      save({ ...finalSave, baseContentVersion: contentVersion }, playerID);
      if (record.lastSaveVersion < finalSave.saveVersion) return;
    }
    record.active = false;
    record.lastSeen = now();
    chooseOwner();
    broadcast();
  }
  function save(payload, playerID) {
    const record = records[playerID];
    if (!eligible(record) || !payload || payload.coordinatorBootId !== coordinatorBootId
      || payload.sessionId !== ownerSessionId || record.sessionId !== ownerSessionId
      || payload.requestId !== record.requestId || !payload.state
      || payload.baseContentVersion !== contentVersion
      || !Number.isInteger(payload.saveVersion) || payload.saveVersion <= record.lastSaveVersion) return;
    state = sanitizeState(payload.state);
    saveState(state, (text) => iina.file.write(DATA_PATH, text));
    contentVersion += 1;
    record.lastSaveVersion = payload.saveVersion;
    acceptedSaveVersion = payload.saveVersion;
    acceptedSaveSessionId = payload.sessionId;
    acceptedSaveRequestId = payload.requestId;
    broadcast();
  }
  function sweep() {
    if (!ownerRecord()) chooseOwner();
    broadcast();
  }
  function start() {
    iina.global.onMessage('playback-groups.register', register);
    iina.global.onMessage('playback-groups.confirm', confirm);
    iina.global.onMessage('playback-groups.heartbeat', heartbeat);
    iina.global.onMessage('playback-groups.inactive', inactive);
    iina.global.onMessage('playback-groups.save', save);
    sweepTimer = timers.setInterval(sweep, SWEEP_MS);
  }
  function close() {
    if (sweepTimer !== null) timers.clearInterval(sweepTimer);
    replyTimers.forEach((timer) => timers.clearTimeout(timer));
    replyTimers.clear();
    sweepTimer = null;
  }
  return { start, close };
}
module.exports = { DATA_PATH, PLAYER_TTL_MS, SWEEP_MS, createGlobalController };
