const { MAX_NEXT_ID, createState } = require('./model.js');

const SCHEMA_VERSION = 1;
const PLAYBACK_MODES = new Set(['loop', 'once', 'manual']);
const MAX_RETAINED_ID = MAX_NEXT_ID;
const MAX_COUNTER = MAX_NEXT_ID + 1;

function idNumber(value, prefix) {
  if (typeof value !== 'string') return null;
  const match = value.match(new RegExp(`^${prefix}-([1-9]\\d*)$`));
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number <= MAX_RETAINED_ID ? number : null;
}

function optionalNonNegativeNumber(target, source, key) {
  if (Number.isFinite(source[key]) && source[key] >= 0) target[key] = source[key];
}

function optionalBoolean(target, source, key) {
  if (typeof source[key] === 'boolean') target[key] = source[key];
}

function sanitizeGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  const groupIds = new Set();
  const itemIds = new Set();
  const groups = [];

  rawGroups.forEach((rawGroup) => {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) return;
    const groupNumber = idNumber(rawGroup.id, 'group');
    const name = typeof rawGroup.name === 'string' ? rawGroup.name.trim() : '';
    if (groupNumber === null || groupIds.has(rawGroup.id) || !name
      || !PLAYBACK_MODES.has(rawGroup.mode) || typeof rawGroup.resume !== 'boolean'
      || !Array.isArray(rawGroup.items)) return;

    groupIds.add(rawGroup.id);
    const items = [];
    rawGroup.items.forEach((rawItem) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return;
      const itemNumber = idNumber(rawItem.id, 'item');
      const path = typeof rawItem.path === 'string' ? rawItem.path : '';
      if (itemNumber === null || itemIds.has(rawItem.id) || !path.trim()) return;
      itemIds.add(rawItem.id);
      const item = { id: rawItem.id, path };
      optionalNonNegativeNumber(item, rawItem, 'position');
      optionalNonNegativeNumber(item, rawItem, 'duration');
      optionalBoolean(item, rawItem, 'missing');
      optionalBoolean(item, rawItem, 'damaged');
      items.push(item);
    });
    groups.push({
      id: rawGroup.id,
      name,
      mode: rawGroup.mode,
      resume: rawGroup.resume,
      items,
    });
  });

  return groups;
}

function sanitizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SCHEMA_VERSION) {
    return createState();
  }

  const groups = sanitizeGroups(value.groups);
  let highestGroupId = 0;
  let highestItemId = 0;
  groups.forEach((group) => {
    highestGroupId = Math.max(highestGroupId, idNumber(group.id, 'group'));
    group.items.forEach((item) => {
      highestItemId = Math.max(highestItemId, idNumber(item.id, 'item'));
    });
  });
  const selectedGroupId = groups.some((group) => group.id === value.selectedGroupId)
    ? value.selectedGroupId
    : groups[0] ? groups[0].id : null;
  const derivedGroupId = highestGroupId + 1;
  const derivedItemId = highestItemId + 1;
  const nextGroupId = Number.isSafeInteger(value.nextGroupId)
    && value.nextGroupId >= derivedGroupId && value.nextGroupId <= MAX_COUNTER
    ? value.nextGroupId : derivedGroupId;
  const nextItemId = Number.isSafeInteger(value.nextItemId)
    && value.nextItemId >= derivedItemId && value.nextItemId <= MAX_COUNTER
    ? value.nextItemId : derivedItemId;
  return {
    schemaVersion: SCHEMA_VERSION,
    nextGroupId,
    nextItemId,
    selectedGroupId,
    groups,
  };
}

function loadState(readText) {
  try {
    const text = readText();
    if (typeof text !== 'string' || text.length === 0) {
      return createState();
    }
    return sanitizeState(JSON.parse(text));
  } catch {
    return createState();
  }
}

function saveState(state, writeText) {
  const text = `${JSON.stringify(sanitizeState(state), null, 2)}\n`;
  writeText(text);
  return text;
}

module.exports = {
  loadState,
  saveState,
  sanitizeState,
};
