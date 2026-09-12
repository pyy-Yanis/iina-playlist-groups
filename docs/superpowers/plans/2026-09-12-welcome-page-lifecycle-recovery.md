# Welcome-page lifecycle recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every Playback Groups action operational when IINA reuses its welcome-page player core to open the first video.

**Architecture:** Centralize player reactivation in the controller and call it from every positive player-window/media lifecycle signal. Add a generation-scoped sidebar readiness watchdog so a silently failed WebView/message bridge is reloaded without allowing stale handlers to execute actions twice.

**Tech Stack:** IINA JavaScript Plugin API, CommonJS, Node.js built-in test runner.

## Global Constraints

- Preserve all existing groups, modes, progress, shortcuts, and layout.
- Keep the existing v0.1.12 release and archive unchanged; package the fix as the next version only after verification.
- Recovery must be idempotent and must not create duplicate effective message actions.
- All production changes require a failing regression test first.

---

### Task 1: Recover a reused welcome-page controller

**Files:**
- Modify: `tests/reopen-manual-navigation.test.js`
- Modify: `src/controller.js`

**Interfaces:**
- Consumes: existing `createController(iina, options)` and IINA lifecycle callbacks.
- Produces: idempotent active-window recovery used by `iina.window-loaded`, `iina.file-started`, and `iina.file-loaded`.

- [ ] **Step 1: Write the failing lifecycle test**

Create a fake IINA instance whose event handlers can be invoked in the welcome-page failure order. Load the player window, emit a stale close signal, then emit media-start/media-loaded evidence. Send each name in `SIDEBAR_MESSAGES` through the current binding and assert it is not rejected by an inactive controller.

- [ ] **Step 2: Verify the test fails for the current controller**

Run: `node --test --test-name-pattern="welcome-page" tests/reopen-manual-navigation.test.js`

Expected: FAIL because the close event leaves `windowInactive` true and shared write handling rejects actions.

- [ ] **Step 3: Implement one idempotent recovery path**

In `src/controller.js`, introduce an active-window recovery function that clears stale inactivity, advances `windowEpoch`, reloads the sidebar only when needed, and reactivates owner resources only when they are not already active. Route window-loaded and the existing file-start/file-loaded callbacks through wrappers which recover first and then retain the existing playback logic. Register `iina.window-did-close` where available so final cleanup is separated from the pre-close save signal.

- [ ] **Step 4: Verify lifecycle tests pass**

Run: `node --test --test-name-pattern="welcome-page|controller defers" tests/reopen-manual-navigation.test.js`

Expected: PASS with no duplicate activation intervals or actions.

- [ ] **Step 5: Commit lifecycle recovery**

```bash
git add src/controller.js tests/reopen-manual-navigation.test.js
git commit -m "fix: recover controller after welcome page playback"
```

### Task 2: Recover a silent sidebar bridge failure

**Files:**
- Modify: `tests/reopen-manual-navigation.test.js`
- Modify: `src/controller.js`

**Interfaces:**
- Consumes: `loadSidebarDocument()` and the sidebar `ready` message.
- Produces: generation-scoped message handlers and a bounded readiness watchdog.

- [ ] **Step 1: Write the failing bridge test**

Use deterministic fake timers and a sidebar fake that retains old handlers. Verify a missing first `ready` triggers one reload; verify handlers from the older generation cannot execute; deliver `ready` through the newest generation and verify retries stop and every supported message remains connected.

- [ ] **Step 2: Verify the bridge test fails**

Run: `node --test --test-name-pattern="sidebar bridge" tests/reopen-manual-navigation.test.js`

Expected: FAIL because the current implementation has no readiness timeout or stale-handler guard.

- [ ] **Step 3: Add bounded readiness recovery**

In `src/controller.js`, track `sidebarBindingGeneration`, `sidebarReady`, `sidebarRetryCount`, and `sidebarReadyTimer`. Each load increments the generation and handlers return without action unless their captured generation is current. The current `ready` handler clears the watchdog and resets retry state. A missing handshake reloads up to three times; window deactivation/disposal cancels the watchdog.

- [ ] **Step 4: Verify focused and full tests**

Run: `node --test --test-name-pattern="sidebar bridge|welcome-page|controller defers" tests/reopen-manual-navigation.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit bridge recovery**

```bash
git add src/controller.js tests/reopen-manual-navigation.test.js
git commit -m "fix: reconnect stalled sidebar bridge"
```

### Task 3: Version, package, install, and verify

**Files:**
- Modify: `Info.json`
- Modify: `README.md`
- Modify: `README_EN.md`
- Create: `../outputs/IINA-Playback-Groups-0.1.13.iinaplgz`

**Interfaces:**
- Consumes: verified source tree.
- Produces: locally installed plugin and versioned v0.1.13 archive.

- [ ] **Step 1: Update version references to 0.1.13**

Change the manifest, Chinese README, and English README from 0.1.12 to 0.1.13 without changing unrelated documentation.

- [ ] **Step 2: Run complete verification**

Run: `npm test`, syntax checks for all JavaScript files, `git diff --check`, and archive integrity checks.

Expected: zero failures, zero syntax errors, and a valid archive.

- [ ] **Step 3: Install without touching the old release archive**

Copy the verified plugin files to the existing local IINA plugin directory, create `IINA-Playback-Groups-0.1.13.iinaplgz`, and compare installed/archive files byte-for-byte with source.

- [ ] **Step 4: Commit the release metadata**

```bash
git add Info.json README.md README_EN.md
git commit -m "chore: prepare IINA Playlist Groups v0.1.13"
```

- [ ] **Step 5: Report local delivery only**

Do not push to GitHub or create a Release unless the user explicitly requests publication after testing the installed build.
