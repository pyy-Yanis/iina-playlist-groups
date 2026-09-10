const SCHEMA_VERSION = 1;
const DEFAULT_GROUP_NAME = '新分组';
const PLAYBACK_MODES = new Set(['loop', 'once', 'manual']);
const MAX_NEXT_ID = Number.MAX_SAFE_INTEGER - 2;

function canAllocate(nextId, count) {
  const allocationCount = count === undefined ? 1 : count;
  return Number.isSafeInteger(nextId) && nextId > 0
    && Number.isSafeInteger(allocationCount) && allocationCount > 0
    && allocationCount - 1 <= MAX_NEXT_ID - nextId;
}

function createState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    nextGroupId: 1,
    nextItemId: 1,
    selectedGroupId: null,
    groups: [],
  };
}

function createGroup(state, name) {
  if (!canAllocate(state.nextGroupId)) return state;
  const group = {
    id: `group-${state.nextGroupId}`,
    name: name === undefined ? DEFAULT_GROUP_NAME : name,
    mode: 'loop',
    resume: false,
    items: [],
  };

  return {
    ...state,
    nextGroupId: state.nextGroupId + 1,
    groups: [...state.groups, group],
  };
}

function renameGroup(state, id, name) {
  const group = findGroup(state, id);
  if (!group || group.name === name) return state;
  return updateGroup(state, id, (group) => ({ ...group, name }));
}

function deleteGroup(state, id) {
  if (!state.groups.some((group) => group.id === id)) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.filter((group) => group.id !== id),
  };
}

function addItems(state, groupId, paths) {
  const group = findGroup(state, groupId);
  if (!group || !Array.isArray(paths) || paths.length === 0) {
    return state;
  }
  const knownPaths = new Set(group.items.map((item) => item.path));
  const uniquePaths = paths.filter((path) => {
    if (knownPaths.has(path)) return false;
    knownPaths.add(path);
    return true;
  });
  if (uniquePaths.length === 0 || !canAllocate(state.nextItemId, uniquePaths.length)) return state;

  const items = uniquePaths.map((path, index) => ({
    id: `item-${state.nextItemId + index}`,
    path,
  }));

  return {
    ...state,
    nextItemId: state.nextItemId + items.length,
    groups: state.groups.map((candidate) => (
      candidate.id === groupId
        ? { ...candidate, items: [...candidate.items, ...items] }
        : candidate
    )),
  };
}

function removeItem(state, groupId, itemId) {
  const group = findGroup(state, groupId);
  if (!group || !group.items.some((item) => item.id === itemId)) {
    return state;
  }

  return updateGroup(state, groupId, (candidate) => ({
    ...candidate,
    items: candidate.items.filter((item) => item.id !== itemId),
  }));
}

function reorderItem(state, groupId, itemId, toIndex) {
  const group = findGroup(state, groupId);
  const fromIndex = group && group.items.findIndex((item) => item.id === itemId);
  if (!group || fromIndex < 0 || !Number.isInteger(toIndex)) {
    return state;
  }

  const finalIndex = Math.max(0, Math.min(group.items.length - 1, toIndex));
  if (finalIndex === fromIndex) {
    return state;
  }

  return updateGroup(state, groupId, (candidate) => {
    const items = candidate.items.slice();
    const item = items.splice(fromIndex, 1)[0];
    items.splice(finalIndex, 0, item);
    return { ...candidate, items };
  });
}

function transferItem(state, itemId, fromId, toId, copy) {
  const source = findGroup(state, fromId);
  const destination = findGroup(state, toId);
  const item = source && source.items.find((candidate) => candidate.id === itemId);

  if (!source || !destination || !item || (!copy && fromId === toId)) {
    return state;
  }

  if (copy && !canAllocate(state.nextItemId)) return state;
  const destinationItem = {
    ...item,
    id: copy ? `item-${state.nextItemId}` : item.id,
    position: 0,
  };

  return {
    ...state,
    nextItemId: copy ? state.nextItemId + 1 : state.nextItemId,
    groups: state.groups.map((group) => {
      if (group.id === fromId && group.id === toId) {
        return { ...group, items: [...group.items, destinationItem] };
      }
      if (group.id === fromId) {
        return copy
          ? group
          : { ...group, items: group.items.filter((candidate) => candidate.id !== itemId) };
      }
      if (group.id === toId) {
        return { ...group, items: [...group.items, destinationItem] };
      }
      return group;
    }),
  };
}

function setGroupOptions(state, id, patch) {
  const options = patch || {};
  const group = findGroup(state, id);
  if (!group) return state;
  const mode = PLAYBACK_MODES.has(options.mode) ? options.mode : group.mode;
  const resume = typeof options.resume === 'boolean' ? options.resume : group.resume;
  if (mode === group.mode && resume === group.resume) return state;

  return updateGroup(state, id, (candidate) => ({ ...candidate, mode, resume }));
}

function findGroup(state, id) {
  return state.groups.find((group) => group.id === id);
}

function updateGroup(state, id, update) {
  if (!findGroup(state, id)) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.map((group) => (group.id === id ? update(group) : group)),
  };
}

module.exports = {
  MAX_NEXT_ID,
  createState,
  createGroup,
  renameGroup,
  deleteGroup,
  addItems,
  removeItem,
  reorderItem,
  transferItem,
  setGroupOptions,
};
