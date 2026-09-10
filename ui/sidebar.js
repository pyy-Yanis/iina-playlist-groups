(function initSidebarModule(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.PlaybackGroupsSidebar = api;
    if (root.document) {
      const start = () => api.mount(root.document, root.iina);
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    }
  }
}(typeof window === 'undefined' ? undefined : window, function sidebarFactory() {
  'use strict';

  const INBOUND_MESSAGES = ['stateChanged', 'playbackChanged', 'error'];
  const OUTBOUND_MESSAGES = [
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
  const MODE_LABELS = {
    loop: '循环播放',
    once: '播放一次',
    manual: '手动逐项',
  };
  const DRAG_TYPE = 'application/x-iina-playback-item';

  function validateGroupName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return { valid: name.length > 0, name };
  }

  function makeTransferPayload(itemId, fromId, toId, copy) {
    return { itemId, fromId, toId, copy: copy === true };
  }

  function adjacentPlaybackPayload(group, index, direction) {
    if (!group || !Array.isArray(group.items) || !Number.isInteger(index)
      || (direction !== -1 && direction !== 1)) return null;
    const item = group.items[index + direction];
    return item ? { groupId: group.id, itemId: item.id } : null;
  }

  function focusRenderedTab(tabList, groupId) {
    const target = [...tabList.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.dataset.groupId === groupId) || null;
    if (target) target.focus();
    return target;
  }

  function makeReorderPayload(groupId, itemId, sourceIndex, targetIndex, placement, itemCount) {
    const lastIndex = Math.max(0, itemCount - 1);
    let toIndex = lastIndex;
    if (sourceIndex === targetIndex) {
      toIndex = sourceIndex;
    } else if (placement !== 'end') {
      const targetAfterRemoval = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
      toIndex = targetAfterRemoval + (placement === 'after' ? 1 : 0);
    }
    return {
      groupId,
      itemId,
      toIndex: Math.max(0, Math.min(lastIndex, toIndex)),
    };
  }

  function dropPlacement(clientY, rect) {
    return clientY < rect.top + (rect.height / 2) ? 'before' : 'after';
  }

  function menuKeyAction(key, currentIndex, itemCount) {
    if (key === 'Escape') return { close: true };
    if (!itemCount || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return null;
    if (key === 'Home') return { focusIndex: 0 };
    if (key === 'End') return { focusIndex: itemCount - 1 };
    const direction = key === 'ArrowDown' ? 1 : -1;
    return { focusIndex: (currentIndex + direction + itemCount) % itemCount };
  }

  function closeMenuUi(menu, trigger, restoreFocus) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function confirmAfterClosingMenu(menu, getTrigger, confirmAction, message) {
    const trigger = getTrigger();
    closeMenuUi(menu, trigger, true);
    return confirmAction(message);
  }

  function closeMenuForRender(menu, getTrigger, activeElement) {
    const restoreFocus = menu.contains(activeElement);
    const trigger = getTrigger();
    closeMenuUi(menu, trigger, restoreFocus);
    return restoreFocus ? trigger : null;
  }

  function itemAriaLabel(name, state) {
    if (state.missing) return `${name}，文件缺失`;
    if (state.damaged) return `${name}，无法播放，可重试`;
    if (state.playing) return state.paused ? `${name}，已暂停` : `${name}，正在播放`;
    return `播放 ${name}`;
  }

  function createBridge(iina, handlers) {
    const callbacks = handlers || {};
    const messages = [];
    const isConnected = iina && typeof iina.onMessage === 'function' && typeof iina.postMessage === 'function';
    const connector = isConnected ? iina : {
      onMessage() {},
      postMessage(name, payload) {
        messages.push({ name, payload });
      },
    };

    INBOUND_MESSAGES.forEach((name) => {
      connector.onMessage(name, (payload) => {
        if (typeof callbacks[name] === 'function') {
          callbacks[name](payload);
        }
      });
    });

    return {
      messages,
      send(name, payload) {
        if (!OUTBOUND_MESSAGES.includes(name)) {
          throw new Error(`Unsupported sidebar message: ${name}`);
        }
        connector.postMessage(name, payload);
      },
    };
  }

  function basename(filePath) {
    const parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || '未命名项目';
  }

  function itemMetaText(item) {
    if (item.missing === true) return '文件缺失';
    if (item.damaged === true) return '无法播放，可点击重试';
    return '';
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const rounded = Math.floor(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainder = rounded % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function patchDurationText(row, item, playbackState) {
    const durations = playbackState && playbackState.durations;
    const seconds = durations && Object.prototype.hasOwnProperty.call(durations, item.id)
      ? durations[item.id]
      : item.duration;
    row.querySelector('.item-duration').textContent = formatDuration(seconds);
  }

  function patchPlaybackRow(row, item, groupId, playbackState) {
    const current = playbackState || {};
    const playing = current.itemId === item.id
      && (!current.groupId || current.groupId === groupId);
    const missing = item.missing === true;
    const damaged = item.damaged === true;
    row.classList.toggle('is-playing', playing);
    const main = row.querySelector('.item-main');
    main.setAttribute('aria-label', itemAriaLabel(basename(item.path), {
      missing, damaged, playing, paused: current.paused === true,
    }));
    row.querySelector('.item-indicator').textContent = missing ? '!'
      : damaged ? '⚠︎' : playing ? (current.paused ? 'Ⅱ' : '▶︎') : '≡';
    patchDurationText(row, item, current);
    return row;
  }

  function fixtureState() {
    return {
      state: {
        schemaVersion: 1,
        groups: [
          {
            id: 'group-a', name: 'A', mode: 'loop', resume: true,
            items: [
              { id: 'item-1', path: '/影片/清晨散步.mp4', duration: 248 },
              { id: 'item-2', path: '/影片/海边日落.mov', duration: 391 },
              { id: 'item-3', path: '/影片/已移动的文件.mkv', missing: true },
            ],
          },
          { id: 'group-b', name: 'B', mode: 'once', resume: false, items: [{ id: 'item-4', path: '/课程/第一讲.mp4', duration: 1850 }] },
          { id: 'group-c', name: 'C', mode: 'manual', resume: false, items: [] },
        ],
      },
      selectedGroupId: 'group-a',
    };
  }

  function mount(document, iina) {
    const elements = {
      tabs: document.getElementById('group-tab-list'),
      create: document.getElementById('create-group-button'),
      emptyCreate: document.getElementById('empty-create-button'),
      empty: document.getElementById('empty-state'),
      panel: document.getElementById('group-panel'),
      title: document.getElementById('group-title'),
      summary: document.getElementById('group-summary'),
      menuButton: document.getElementById('group-menu-button'),
      menu: document.getElementById('group-menu'),
      resume: document.getElementById('resume-menu-item'),
      rename: document.getElementById('rename-group-button'),
      deleteGroup: document.getElementById('delete-group-button'),
      list: document.getElementById('item-list'),
      groupEmpty: document.getElementById('group-empty-state'),
      addFiles: document.getElementById('add-files-button'),
      dialog: document.getElementById('group-name-dialog'),
      dialogTitle: document.getElementById('dialog-title'),
      input: document.getElementById('group-name-input'),
      dialogError: document.getElementById('dialog-error'),
      deleteDialog: document.getElementById('delete-group-dialog'),
      deleteDialogMessage: document.getElementById('delete-dialog-message'),
      toast: document.getElementById('error-toast'),
      fixtureLog: document.getElementById('fixture-message-log'),
      readOnlyNotice: document.getElementById('read-only-notice'),
    };

    if (Object.values(elements).some((element) => !element)) {
      throw new Error('Sidebar markup is incomplete');
    }

    let appState = { groups: [] };
    let selectedGroupId = null;
    let playback = {};
    let draggedItem = null;
    let dialogPurpose = 'create';
    let pendingDeleteGroupId = null;
    let toastTimer = null;
    let readOnly = false;

    const bridge = createBridge(iina, {
      stateChanged(payload) {
        const nextState = payload && payload.state ? payload.state : payload;
        appState = nextState && Array.isArray(nextState.groups) ? nextState : { groups: [] };
        const requestedId = payload && (payload.selectedGroupId || payload.currentGroupId);
        readOnly = Boolean(payload && payload.readOnly);
        elements.readOnlyNotice.hidden = !readOnly;
        elements.readOnlyNotice.textContent = readOnly
          ? (payload.readOnlyReason || '本窗口为只读') : '';
        if (requestedId) selectedGroupId = requestedId;
        if (!appState.groups.some((group) => group.id === selectedGroupId)) {
          selectedGroupId = appState.groups[0] ? appState.groups[0].id : null;
        }
        render();
      },
      playbackChanged(payload) {
        playback = payload || {};
        patchPlaybackRows();
      },
      error(payload) {
        showError(payload);
      },
    });
    if (!iina && document.defaultView) {
      document.defaultView.sidebarFixtureMessages = bridge.messages;
    }

    function send(name, payload) {
      if (readOnly && name !== 'ready' && name !== 'selectGroup') return;
      bridge.send(name, payload);
      if (!iina) {
        elements.fixtureLog.textContent = `${name} ${JSON.stringify(payload)}`;
        elements.fixtureLog.hidden = false;
      }
    }

    function selectedGroup() {
      return appState.groups.find((group) => group.id === selectedGroupId) || null;
    }

    function render() {
      renderTabs();
      renderGroup();
    }

    function renderTabs() {
      const restoreTabFocus = elements.tabs.contains(document.activeElement);
      const existing = new Map([...elements.tabs.children].map((tab) => [tab.dataset.groupId, tab]));
      appState.groups.forEach((group, index) => {
        let tab = existing.get(group.id);
        if (!tab) {
          tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 'group-tab';
          tab.role = 'tab';
          tab.dataset.groupId = group.id;
          tab.id = `group-tab-${group.id}`;
          tab.setAttribute('aria-controls', 'group-panel');
          tab.addEventListener('click', () => selectGroup(group.id, true, true));
          tab.addEventListener('keydown', onTabKeydown);
          tab.addEventListener('dragover', onTabDragOver);
          tab.addEventListener('dragleave', () => tab.classList.remove('is-drop-target'));
          tab.addEventListener('drop', (event) => onTabDrop(event, group.id, tab));
        }
        existing.delete(group.id);
        tab.setAttribute('aria-selected', String(group.id === selectedGroupId));
        tab.tabIndex = group.id === selectedGroupId || (!selectedGroupId && index === 0) ? 0 : -1;
        tab.textContent = group.name;
        tab.title = group.name;
        if (elements.tabs.children[index] !== tab) {
          elements.tabs.insertBefore(tab, elements.tabs.children[index] || null);
        }
      });
      existing.forEach((tab) => tab.remove());
      if (restoreTabFocus) focusRenderedTab(elements.tabs, selectedGroupId);
    }

    function renderGroup() {
      const group = selectedGroup();
      elements.empty.hidden = Boolean(group);
      elements.panel.hidden = !group;
      closeMenuForRender(
        elements.menu,
        () => document.getElementById('group-menu-button'),
        document.activeElement,
      );
      [elements.create, elements.emptyCreate, elements.menuButton, elements.addFiles]
        .forEach((control) => { control.disabled = readOnly; });
      if (!group) return;

      elements.panel.setAttribute('aria-labelledby', `group-tab-${group.id}`);
      elements.title.textContent = group.name;
      elements.summary.textContent = `${group.items.length} 个项目 · ${MODE_LABELS[group.mode] || group.mode}`;
      elements.menu.querySelectorAll('[data-mode]').forEach((button) => {
        button.setAttribute('aria-checked', String(button.dataset.mode === group.mode));
      });
      elements.resume.setAttribute('aria-checked', String(group.resume === true));
      renderItems();
    }

    function renderItems() {
      const group = selectedGroup();
      if (!group) return;
      const existing = new Map([...elements.list.children].map((row) => [row.dataset.itemId, row]));
      group.items.forEach((item, index) => {
        let row = existing.get(item.id);
        if (!row) {
          row = document.createElement('li');
          row.className = 'item-row';
          row.dataset.itemId = item.id;
          const main = document.createElement('button');
          main.type = 'button';
          main.className = 'item-main';
          main.draggable = true;
          main.addEventListener('click', () => send('playItem', {
            groupId: row.dataset.groupId, itemId: row.dataset.itemId,
          }));
          main.addEventListener('dragstart', (event) => onItemDragStart(
            event, row.dataset.groupId, row.dataset.itemId, row,
          ));
          main.addEventListener('dragend', () => onItemDragEnd(row));
          const indicator = document.createElement('span');
          indicator.className = 'item-indicator';
          indicator.setAttribute('aria-hidden', 'true');
          const copy = document.createElement('span');
          copy.className = 'item-copy';
          const name = document.createElement('span');
          name.className = 'item-name';
          const meta = document.createElement('span');
          meta.className = 'item-meta';
          copy.append(name, meta);
          const duration = document.createElement('span');
          duration.className = 'item-duration';
          main.append(indicator, copy, duration);
          function playbackNavigationButton(className, direction) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `playback-navigation ${className}`;
            button.addEventListener('click', () => {
              const currentGroup = appState.groups.find((candidate) => candidate.id === row.dataset.groupId);
              const payload = adjacentPlaybackPayload(currentGroup, Number(row.dataset.index), direction);
              if (payload) send('playItem', payload);
            });
            return button;
          }
          function reorderButton(className, direction) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `reorder-key ${className}`;
            button.addEventListener('click', () => {
              const index = Number(row.dataset.index);
              send('reorderItem', {
                groupId: row.dataset.groupId, itemId: row.dataset.itemId, toIndex: index + direction,
              });
            });
            return button;
          }
          const previousItem = playbackNavigationButton('play-previous-item', -1);
          const nextItem = playbackNavigationButton('play-next-item', 1);
          const moveUp = reorderButton('move-up', -1);
          const moveDown = reorderButton('move-down', 1);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove-item';
          remove.textContent = '×';
          remove.addEventListener('click', () => send('removeItem', {
            groupId: row.dataset.groupId, itemId: row.dataset.itemId,
          }));
          const toolbar = document.createElement('div');
          toolbar.className = 'item-toolbar';
          toolbar.append(moveUp, moveDown, previousItem, nextItem, remove);
          row.addEventListener('dragover', (event) => onRowDragOver(event, row));
          row.addEventListener('dragleave', () => row.classList.remove('is-drop-before', 'is-drop-after'));
          row.addEventListener('drop', (event) => onRowDrop(
            event, row.dataset.groupId, row.dataset.itemId, Number(row.dataset.index), row,
          ));
          row.append(main, toolbar);
        }
        existing.delete(item.id);
        row.dataset.groupId = group.id;
        row.dataset.index = String(index);
        const playing = playback.itemId === item.id && (!playback.groupId || playback.groupId === group.id);
        const missing = item.missing === true;
        const damaged = item.damaged === true;
        row.classList.toggle('is-playing', playing);
        row.classList.toggle('is-missing', missing);
        row.classList.toggle('is-damaged', damaged);
        const main = row.querySelector('.item-main');
        main.disabled = readOnly;
        main.setAttribute('aria-label', itemAriaLabel(basename(item.path), {
          missing, damaged,
          playing,
          paused: playback.paused === true,
        }));
        const indicator = row.querySelector('.item-indicator');
        indicator.textContent = missing ? '!' : damaged ? '⚠︎' : playing ? (playback.paused ? 'Ⅱ' : '▶︎') : '≡';
        const name = row.querySelector('.item-name');
        name.textContent = basename(item.path);
        const meta = row.querySelector('.item-meta');
        meta.textContent = itemMetaText(item);
        patchDurationText(row, item, playback);
        const previousItem = row.querySelector('.play-previous-item');
        const nextItem = row.querySelector('.play-next-item');
        previousItem.disabled = readOnly || index === 0;
        nextItem.disabled = readOnly || index === group.items.length - 1;
        previousItem.textContent = '⇤';
        nextItem.textContent = '⇥';
        previousItem.setAttribute('aria-label', '播放上一条');
        nextItem.setAttribute('aria-label', '播放下一条');
        const moveUp = row.querySelector('.move-up');
        const moveDown = row.querySelector('.move-down');
        moveUp.disabled = readOnly || index === 0;
        moveDown.disabled = readOnly || index === group.items.length - 1;
        moveUp.textContent = '↑';
        moveDown.textContent = '↓';
        moveUp.setAttribute('aria-label', `上移 ${basename(item.path)}`);
        moveDown.setAttribute('aria-label', `下移 ${basename(item.path)}`);
        const remove = row.querySelector('.remove-item');
        remove.disabled = readOnly;
        remove.setAttribute('aria-label', `移除 ${basename(item.path)}`);
        if (elements.list.children[index] !== row) {
          elements.list.insertBefore(row, elements.list.children[index] || null);
        }
      });
      existing.forEach((row) => row.remove());

      elements.groupEmpty.hidden = group.items.length > 0;
    }

    function patchPlaybackRows() {
      const group = selectedGroup();
      if (!group) return;
      [...elements.list.children].forEach((row) => {
        const item = group.items.find((candidate) => candidate.id === row.dataset.itemId);
        if (!item) return;
        patchPlaybackRow(row, item, group.id, playback);
      });
    }

    function selectGroup(groupId, notify, restoreFocus) {
      if (!appState.groups.some((group) => group.id === groupId)) return;
      const shouldRestoreFocus = restoreFocus === true
        || elements.tabs.contains(document.activeElement);
      selectedGroupId = groupId;
      render();
      if (shouldRestoreFocus) focusRenderedTab(elements.tabs, groupId);
      if (notify) send('selectGroup', { groupId });
    }

    function onTabKeydown(event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...elements.tabs.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(event.currentTarget);
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      const target = tabs[next];
      if (target) {
        const groupId = target.dataset.groupId;
        selectGroup(groupId, true, true);
      }
    }

    function onItemDragStart(event, groupId, itemId, row) {
      draggedItem = { itemId, fromId: groupId };
      row.classList.add('is-dragging');
      if (event.dataTransfer) {
        const payload = JSON.stringify(draggedItem);
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(DRAG_TYPE, payload);
        event.dataTransfer.setData('text/plain', payload);
      }
    }

    function onItemDragEnd(row) {
      row.classList.remove('is-dragging');
      draggedItem = null;
      clearDropStyles();
    }

    function dragData(event) {
      if (draggedItem) return draggedItem;
      if (!event.dataTransfer) return null;
      const raw = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData('text/plain');
      try {
        const parsed = JSON.parse(raw);
        return parsed && parsed.itemId && parsed.fromId ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function onRowDragOver(event, row) {
      if (!draggedItem || draggedItem.fromId !== selectedGroupId) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const placement = dropPlacement(event.clientY, row.getBoundingClientRect());
      row.classList.remove('is-drop-before', 'is-drop-after');
      row.classList.add(`is-drop-${placement}`);
    }

    function onRowDrop(event, groupId, targetItemId, index, row) {
      const data = dragData(event);
      const placement = row.classList.contains('is-drop-after') ? 'after' : 'before';
      row.classList.remove('is-drop-before', 'is-drop-after');
      event.preventDefault();
      event.stopPropagation();
      if (!data || data.fromId !== groupId || data.itemId === targetItemId) return;
      const group = selectedGroup();
      const sourceIndex = group.items.findIndex((item) => item.id === data.itemId);
      const payload = makeReorderPayload(groupId, data.itemId, sourceIndex, index, placement, group.items.length);
      if (payload.toIndex !== sourceIndex) send('reorderItem', payload);
    }

    function onListDragOver(event) {
      if (!draggedItem || draggedItem.fromId !== selectedGroupId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      elements.list.classList.add('is-drop-end');
    }

    function onListDrop(event) {
      const data = dragData(event);
      elements.list.classList.remove('is-drop-end');
      const group = selectedGroup();
      if (!data || !group || data.fromId !== group.id) return;
      event.preventDefault();
      const sourceIndex = group.items.findIndex((item) => item.id === data.itemId);
      const payload = makeReorderPayload(group.id, data.itemId, sourceIndex, null, 'end', group.items.length);
      if (payload.toIndex !== sourceIndex) send('reorderItem', payload);
    }

    function onTabDragOver(event) {
      if (!draggedItem || draggedItem.fromId === event.currentTarget.dataset.groupId) return;
      event.preventDefault();
      event.currentTarget.classList.add('is-drop-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = event.metaKey ? 'copy' : 'move';
    }

    function onTabDrop(event, toId, tab) {
      const data = dragData(event);
      tab.classList.remove('is-drop-target');
      if (!data || data.fromId === toId) return;
      event.preventDefault();
      send('transferItem', makeTransferPayload(data.itemId, data.fromId, toId, event.metaKey));
    }

    function clearDropStyles() {
      document.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-end, .is-drop-target').forEach((element) => {
        element.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-end', 'is-drop-target');
      });
    }

    function openNameDialog(purpose) {
      const group = selectedGroup();
      dialogPurpose = purpose;
      elements.dialogTitle.textContent = purpose === 'rename' ? '重命名分组' : '新建分组';
      elements.input.value = purpose === 'rename' && group ? group.name : '新分组';
      elements.input.setCustomValidity('');
      elements.dialogError.textContent = '';
      if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
      else elements.dialog.setAttribute('open', '');
      elements.input.select();
    }

    function closeDialog() {
      if (typeof elements.dialog.close === 'function') elements.dialog.close();
      else elements.dialog.removeAttribute('open');
    }

    function openDeleteDialog(group) {
      pendingDeleteGroupId = group.id;
      elements.deleteDialogMessage.textContent = `确定删除“${group.name}”吗？分组中的项目也会从插件列表移除，但不会删除磁盘上的媒体文件。`;
      if (typeof elements.deleteDialog.showModal === 'function') elements.deleteDialog.showModal();
      else elements.deleteDialog.setAttribute('open', '');
    }

    function closeDeleteDialog() {
      pendingDeleteGroupId = null;
      if (typeof elements.deleteDialog.close === 'function') elements.deleteDialog.close();
      else elements.deleteDialog.removeAttribute('open');
    }

    function submitDeleteDialog(event) {
      event.preventDefault();
      if (pendingDeleteGroupId) send('deleteGroup', { groupId: pendingDeleteGroupId });
      closeDeleteDialog();
    }

    function submitNameDialog(event) {
      event.preventDefault();
      const result = validateGroupName(elements.input.value);
      if (!result.valid) {
        elements.input.setCustomValidity('请输入分组名称');
        elements.dialogError.textContent = '请输入分组名称';
        elements.input.focus();
        return;
      }
      if (dialogPurpose === 'rename') {
        const group = selectedGroup();
        if (group) send('renameGroup', { groupId: group.id, name: result.name });
      } else {
        send('createGroup', { name: result.name });
      }
      closeDialog();
    }

    function toggleMenu() {
      const opening = elements.menu.hidden;
      elements.menu.hidden = !opening;
      elements.menuButton.setAttribute('aria-expanded', String(opening));
      if (opening) {
        const checked = elements.menu.querySelector('[aria-checked="true"]');
        (checked || elements.menu.querySelector('button')).focus();
      }
    }

    function closeMenu(restoreFocus) {
      closeMenuUi(elements.menu, elements.menuButton, restoreFocus === true);
    }

    function onMenuKeydown(event) {
      const items = [...elements.menu.querySelectorAll('[role^="menuitem"]')];
      const action = menuKeyAction(event.key, items.indexOf(event.target), items.length);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.close) {
        closeMenu(true);
      } else {
        items[action.focusIndex].focus();
      }
    }

    function showError(payload) {
      const message = typeof payload === 'string' ? payload : payload && (payload.message || payload.error);
      if (!message) return;
      elements.toast.textContent = message;
      elements.toast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 5000);
    }

    elements.create.addEventListener('click', () => openNameDialog('create'));
    elements.emptyCreate.addEventListener('click', () => openNameDialog('create'));
    elements.dialog.querySelector('[data-dialog-action="cancel"]').addEventListener('click', closeDialog);
    elements.dialog.querySelector('form').addEventListener('submit', submitNameDialog);
    elements.deleteDialog.querySelector('[data-delete-action="cancel"]').addEventListener('click', closeDeleteDialog);
    elements.deleteDialog.querySelector('form').addEventListener('submit', submitDeleteDialog);
    elements.input.addEventListener('input', () => {
      elements.input.setCustomValidity('');
      elements.dialogError.textContent = '';
    });
    elements.menuButton.addEventListener('click', toggleMenu);
    elements.menu.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const group = selectedGroup();
        if (group) send('setGroupOptions', { groupId: group.id, patch: { mode: button.dataset.mode } });
        closeMenu(true);
      });
    });
    elements.resume.addEventListener('click', () => {
      const group = selectedGroup();
      if (group) send('setGroupOptions', { groupId: group.id, patch: { resume: group.resume !== true } });
      closeMenu(true);
    });
    elements.rename.addEventListener('click', () => { closeMenu(); openNameDialog('rename'); });
    elements.deleteGroup.addEventListener('click', () => {
      const group = selectedGroup();
      closeMenu();
      if (group) openDeleteDialog(group);
    });
    elements.addFiles.addEventListener('click', () => {
      const group = selectedGroup();
      if (group) send('addFiles', { groupId: group.id });
    });
    elements.list.addEventListener('dragover', onListDragOver);
    elements.list.addEventListener('dragleave', () => elements.list.classList.remove('is-drop-end'));
    elements.list.addEventListener('drop', onListDrop);
    // Capture external files before the existing internal row-reordering handlers.
    const importArea = document.getElementById('sidebar-main');
    function externalFiles(event) {
      return !draggedItem && event.dataTransfer
        && Array.from(event.dataTransfer.types).includes('Files');
    }
    importArea.addEventListener('dragover', (event) => {
      if (!externalFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = readOnly ? 'none' : 'copy';
      if (!readOnly) elements.list.classList.add('is-drop-end');
    }, true);
    importArea.addEventListener('drop', (event) => {
      if (!externalFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clearDropStyles();
      const group = selectedGroup();
      const droppedFiles = Array.from(event.dataTransfer.files).map((file) => ({ name: file.name }));
      if (!readOnly && group && droppedFiles.length) {
        send('addFiles', { groupId: group.id, droppedFiles });
      }
    }, true);
    elements.menu.addEventListener('keydown', onMenuKeydown);
    document.addEventListener('click', (event) => {
      if (!elements.menu.hidden && !elements.menu.contains(event.target) && !elements.menuButton.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.menu.hidden) {
        closeMenu(true);
      }
    });

    if (!iina) {
      const demo = fixtureState();
      appState = demo.state;
      selectedGroupId = demo.selectedGroupId;
      playback = { groupId: 'group-a', itemId: 'item-1', paused: false };
      render();
    } else {
      render();
      // IINA 1.4's WebKit bridge serializes the second array element. An
      // omitted payload becomes `undefined`, which WKScriptMessage rejects.
      send('ready', {});
    }

    return { bridge, render };
  }

  return {
    INBOUND_MESSAGES,
    OUTBOUND_MESSAGES,
    adjacentPlaybackPayload,
    createBridge,
    focusRenderedTab,
    makeReorderPayload,
    dropPlacement,
    menuKeyAction,
    closeMenuUi,
    confirmAfterClosingMenu,
    closeMenuForRender,
    itemAriaLabel,
    itemMetaText,
    patchDurationText,
    patchPlaybackRow,
    makeTransferPayload,
    validateGroupName,
    mount,
  };
}));
