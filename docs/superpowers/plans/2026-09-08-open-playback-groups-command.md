# Open Playback Groups Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conflict-free `Control+P` command and clickable plugin menu item that directly display Playback Groups.

**Architecture:** Route keyboard and menu entry points to one controller function using the public `iina.sidebar.show()` API. Keep lifecycle registration and cleanup beside the existing manual-next command.

**Tech Stack:** IINA Plugin API, JavaScript, Node.js test runner.

- [ ] Add failing assertions for `Ctrl+P`, the shared action, menu item, and cleanup.
- [ ] Implement both entry points in one controller patch.
- [ ] Update version `0.1.11`, GitHub metadata, and bilingual README files.
- [ ] Run the complete tests, syntax checks, archive verification, and checksum.
- [ ] Deploy once and verify keyboard plus menu behavior in IINA.
- [ ] Publish the verified source and `v0.1.11` Release to GitHub.
