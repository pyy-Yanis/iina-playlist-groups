# Reopen, Manual Playback, and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore groups on every player load, make manual Space advance after EOF, and turn row arrows into previous/next playback.

**Architecture:** Centralize sidebar document setup, certify manual completion from the loaded token, preserve EOF waiting state, and generate adjacent-item play payloads in the sidebar.

**Tech Stack:** IINA 1.4 JavaScript plugin API, WebKit sidebar JavaScript, Node.js test runner.

## Global Constraints

- Add all regression tests before one production-code patch.
- Do not modify or recreate persisted group data.
- Preserve drag-to-group move and Command-drag copy.

---

### Task 1: Lifecycle, manual EOF, and row navigation

**Files:**
- Create: `tests/reopen-manual-navigation.test.js`
- Modify: `src/controller.js`
- Modify: `ui/sidebar.js`
- Modify: `Info.json`

**Interfaces:**
- Produces: `manualEndItemIndex(group, currentItemId, token, playlistGeneration)`.
- Produces: `waitingAfterEofChange(eofReached, waitingForNext)`.
- Produces: `adjacentPlaybackPayload(group, index, direction)`.

- [ ] Write all failing regression tests.
- [ ] Run `npm test` and confirm lifecycle, manual EOF, and navigation failures.
- [ ] Apply one production patch implementing all three fixes and version `0.1.6`.
- [ ] Run the full test and syntax suite.
- [ ] Deploy once and perform one combined IINA acceptance run.
- [ ] Package, integrity-test, and hash `0.1.6`.

