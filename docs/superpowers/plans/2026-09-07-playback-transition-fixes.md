# Playback Transition Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix once-mode final-frame retention, direct item selection, and automatic sidebar highlight updates.

**Architecture:** Centralize mpv mode options and direct playlist selection in testable helpers. Let `file-loaded` adopt verified native transitions and publish the resulting current item.

**Tech Stack:** IINA 1.4 JavaScript plugin API, mpv commands/properties, Node.js test runner.

## Global Constraints

- Make one production-code modification only after all regression tests fail for the expected reasons.
- Preserve group-local resume behavior, manual space-to-next behavior, and loop playback.
- Do not add dependencies.

---

### Task 1: Playback transition policy

**Files:**
- Modify: `tests/playback-transitions.test.js`
- Modify: `src/controller.js`
- Modify: `Info.json`

**Interfaces:**
- Produces: `mpvOptionsForMode(mode)`, `playNativePlaylistIndex(mpv, index)`, and `transitionAutoplay(mode, wasPaused)`.

- [ ] Write regression tests asserting `once → keep-open=yes`, direct `playlist-play-index`, and automatic transition autoplay/highlight policy.
- [ ] Run `npm test` and confirm the new tests fail because the interfaces are absent.
- [ ] Add the three helpers and use them in the controller's option application, item-selection, and native-load adoption paths.
- [ ] Run the complete automated suite and syntax checks.
- [ ] Deploy once to the installed plugin, restart IINA once, and verify all three reported scenarios plus loop regression.
- [ ] Set version `0.1.5`, package the runtime files, test the archive, and compute SHA-256.

