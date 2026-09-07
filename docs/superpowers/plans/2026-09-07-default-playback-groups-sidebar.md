# Default Playback Groups Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make IINA's native plugin-sidebar button default to Playback Groups whenever it opens a closed sidebar, while preserving manual tab switching after opening.

**Architecture:** Add a pure sidebar-transition decision helper and a lifecycle-owned watcher in the existing window controller. The watcher samples `iina.core.window.sidebar`, redirects only a closed-to-plugin transition through `iina.sidebar.show()`, and is cleared with the controller's other timers.

**Tech Stack:** IINA Plugin API, JavaScript, Node.js built-in test runner.

## Global Constraints

- Never open the sidebar automatically at plugin startup.
- Redirect only on a `null` to plugin-sidebar transition.
- Allow tab-to-tab switching while the sidebar remains open.
- Clear the watcher during shutdown and never retry a failed redirect continuously.
- Implement once, then run the complete automated and real-IINA verification sequence.

---

### Task 1: Sidebar Transition State Machine

**Files:**
- Modify: `tests/reopen-manual-navigation.test.js`
- Modify: `src/controller.js`

**Interfaces:**
- Produces: `shouldPreferPlaybackGroups(previousSidebar, currentSidebar, ownSidebar)` returning a boolean.
- Consumes: `iina.core.window.sidebar`, `iina.sidebar.show()`, and the controller timer abstraction.

- [ ] Add failing tests covering startup, closed-to-other-plugin, closed-to-own-plugin, open tab-to-tab, close/reopen, watcher registration, and cleanup.
- [ ] Run the focused test and confirm the new assertions fail for the missing helper and wiring.
- [ ] Implement the pure helper, watcher state, guarded one-shot redirect, lifecycle registration, and shutdown cleanup in one production patch.
- [ ] Run the focused test and confirm it passes.
- [ ] Increment `Info.json` to `0.1.11` and add `ghRepo` plus incremented `ghVersion` metadata for future IINA update checks.
- [ ] Update `README.md` and `README_EN.md` with the new default-sidebar behavior.
- [ ] Commit the implementation and documentation.

### Task 2: Combined Verification and Delivery

**Files:**
- Verify: all production JavaScript and tests
- Build: `../outputs/IINA-Playback-Groups-0.1.11.iinaplgz`
- Deploy: installed `com.iina.playback-groups.iinaplugin`

**Interfaces:**
- Consumes: completed `0.1.11` source.
- Produces: installed verified plugin, integrity-checked archive, and public GitHub `v0.1.11` release.

- [ ] Run `npm test`, production syntax checks, manifest validation, and `git diff --check` together.
- [ ] Package only `Info.json`, `global.js`, `main.js`, `src`, and `ui`; test the archive, inspect its embedded version, and compute SHA-256.
- [ ] Copy the verified runtime files to the installed plugin once.
- [ ] Restart IINA once and perform: closed → native plugin button → Playback Groups; Playback Groups → OpenSubtitles remains selected; close → native plugin button → Playback Groups again.
- [ ] Commit any final release metadata only if verification required no production correction.
- [ ] Publish source and `v0.1.11` with bilingual release notes and the verified `.iinaplgz` asset.
- [ ] Read back repository and Release state and rerun the full automated test suite before reporting completion.
