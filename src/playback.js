function itemsFor(group) {
  return group && Array.isArray(group.items) ? group.items : [];
}

function isDamaged(item) {
  return item && item.damaged === true;
}

function onNaturalEnd(group, itemIndex) {
  const items = itemsFor(group);
  const currentItem = items[itemIndex];

  if (!currentItem) {
    return { action: 'stop', itemIndex };
  }
  if (isDamaged(currentItem)) {
    return { action: 'skip', itemIndex };
  }
  if (group.mode === 'manual') {
    return { action: 'wait', itemIndex, waitingForNext: true };
  }

  const nextIndex = itemIndex + 1;
  if (nextIndex < items.length) {
    return { action: 'play', itemIndex: nextIndex };
  }
  if (group.mode === 'loop') {
    return { action: 'play', itemIndex: 0 };
  }
  return { action: 'stop', itemIndex };
}

function onSpace(state) {
  if (!state || state.waitingForNext !== true) {
    return { action: 'passthrough' };
  }

  const { group, itemIndex } = state;
  const items = itemsFor(group);
  const nextIndex = itemIndex + 1;

  if (nextIndex < items.length) {
    if (isDamaged(items[nextIndex])) {
      return { action: 'skip', itemIndex: nextIndex, waitingForNext: false };
    }
    return { action: 'play', itemIndex: nextIndex, waitingForNext: false };
  }

  return { action: 'osd', itemIndex, stop: true, waitingForNext: false };
}

function resolveStartPosition(group, item, duration) {
  if (!group || group.resume !== true || !item || !Number.isFinite(item.position) || item.position < 0) {
    return 0;
  }
  return Number.isFinite(duration) && duration >= 0 && item.position >= duration ? 0 : item.position;
}

function recordProgress(group, item, seconds, duration) {
  const updatedItem = { ...item };

  if (!group || group.resume !== true || !Number.isFinite(seconds) || seconds < 0) {
    return updatedItem;
  }

  updatedItem.position = Number.isFinite(duration) && duration >= 0 && seconds >= duration
    ? 0
    : seconds;
  return updatedItem;
}

module.exports = {
  onNaturalEnd,
  onSpace,
  resolveStartPosition,
  recordProgress,
};
