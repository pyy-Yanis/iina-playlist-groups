# Command+Space Next Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Command+Space` play the next item while a manual group is waiting at EOF.

**Architecture:** Retain the existing dynamic IINA menu shortcut and manual-next handler. Replace only the conflicting key binding and verify it through automated and real IINA playback tests.

**Tech Stack:** IINA JavaScript plugin API, Node.js test runner

## Global Constraints

- Plain Space remains IINA's native play/pause shortcut.
- The shortcut exists only while `waitingForNext` is true.
- Existing group state and media files must not be changed.

---

### Task 1: Replace the waiting shortcut

**Files:**
- Modify: `src/controller.js`
- Modify: `tests/reopen-manual-navigation.test.js`

**Interfaces:**
- Consumes: `setWaitingForNext(waiting: boolean)` and `onSpaceKey(data)`
- Produces: an IINA menu item whose `keyBinding` is `Meta+SPACE`

- [ ] **Step 1: Change the source assertion to require `Meta+SPACE` and reject bare `SPACE`.**
- [ ] **Step 2: Run `node --test tests/reopen-manual-navigation.test.js` and verify the shortcut test fails.**
- [ ] **Step 3: Change the menu key binding in `src/controller.js` from `SPACE` to `Meta+SPACE`.**
- [ ] **Step 4: Run `npm test` and verify every test passes.**
- [ ] **Step 5: Install the updated files and reload IINA.**
- [ ] **Step 6: Play the first manual item to EOF, press `Command+Space`, and verify the title and active row move to the second item.**
- [ ] **Step 7: Bump the plugin patch version, package it, and verify the archive.**
