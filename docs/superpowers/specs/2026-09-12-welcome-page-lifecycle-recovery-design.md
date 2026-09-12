# Welcome-page lifecycle recovery design

## Problem

When a video is opened from IINA 1.4.4's welcome window, the reused player instance can occasionally leave Playback Groups visible but non-functional. Playback, rename, delete, imports, and every other mutating action fail together. Opening a video directly creates a healthy player instance and normally restores the plugin.

All affected actions share two dependencies: the controller must consider the window writable, and the sidebar WebView must have a live message bridge. The welcome-to-player transition can deliver lifecycle events in an order that leaves the controller inactive, while IINA 1.4.4 can also silently fail to finish a WebView load.

## Design

### Controller lifecycle

- Treat `iina.core.window.loaded` and media-start events as current evidence that the reused player instance is active.
- Make activation idempotent and invoke it from `iina.window-loaded`, `iina.file-started`, and `iina.file-loaded`.
- Ignore a stale close transition when later/current player evidence shows that the same instance is loaded.
- Restore timers, playlist ownership, MPV options, sidebar state, and message handling as one controller-level operation rather than repairing individual actions.

### Sidebar bridge recovery

- Give each sidebar document load a generation number.
- Require a `ready` message for the current generation before considering the bridge connected.
- If readiness does not arrive within a bounded timeout, reload the sidebar document and rebind all supported messages.
- Limit retries and cancel obsolete timers when the window closes, a newer load starts, or the controller is disposed.
- Ensure repeated lifecycle events and repeated `ready` messages cannot register duplicate effective handlers or repeat user actions.

### State and safety

- Preserve the existing persisted groups and playback progress throughout recovery.
- Do not create another writer or modify group data merely because the sidebar reconnects.
- Continue to reject mutating messages while a genuinely closed or read-only window has no current activation evidence.

## Testing

- Reproduce both welcome-page event orders: close-before-load and load-before-stale-close.
- Verify all sidebar message types remain writable after recovery, not only playback.
- Simulate a missing first `ready` handshake and verify a bounded reload restores communication.
- Verify duplicate lifecycle/ready events do not produce duplicate effective actions.
- Run the complete existing test suite, syntax checks, package validation, and installed-plugin/archive comparisons before delivery.

## Scope

This change addresses the shared lifecycle and bridge failure. It does not change group behavior, keyboard shortcuts, persistence semantics, or visual layout.
