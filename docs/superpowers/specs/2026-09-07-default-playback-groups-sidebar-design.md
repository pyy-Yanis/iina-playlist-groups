# Default Playback Groups Sidebar Design

## Goal

When the user clicks IINA's native plugin-sidebar toolbar button while the sidebar is closed, open the sidebar directly on the Playback Groups tab. Once the sidebar is open, the user must remain free to switch to OpenSubtitles or another plugin tab.

## Constraints

- IINA does not expose interception of the native plugin-sidebar toolbar button.
- The plugin can read `iina.core.window.sidebar` and can call `iina.sidebar.show()` to select its own tab.
- The behavior must not open the sidebar automatically during plugin startup.
- The behavior must not force the user back to Playback Groups after they manually select OpenSubtitles while the sidebar is already open.

## State Model

The controller maintains the last observed sidebar value and a short-lived redirect guard.

1. On startup, record the current sidebar value without changing it.
2. Poll the current sidebar value at a modest interval using the controller's existing timer lifecycle.
3. Detect only a transition from `null` (closed) to a plugin sidebar value (opened).
4. If the newly opened plugin sidebar is not Playback Groups, call `iina.sidebar.show()` once and mark the transition as redirected.
5. Update the observation state after the redirect so the plugin does not create a loop.
6. While any sidebar remains open, later tab-to-tab transitions are observed but never redirected.
7. After the sidebar returns to `null`, arm the behavior for the next closed-to-open transition.

This means clicking the native button from a closed state defaults to Playback Groups, while clicking OpenSubtitles after the sidebar is open continues to work normally.

## Lifecycle and Failure Handling

- Register the watcher only after the player window is available, alongside existing controller lifecycle registration.
- Reuse the controller timer abstraction so tests can control the behavior.
- Clear the watcher during controller shutdown.
- Treat unavailable or unexpected sidebar values as observations only; do not call `show()` unless a valid closed-to-plugin transition is detected.
- Catch a failed `show()` call and leave the current sidebar untouched rather than repeatedly retrying.

## Testing

Add focused tests for a pure transition decision helper and source-level lifecycle wiring:

- startup observation does not open the sidebar;
- `null` to another plugin tab requests one redirect;
- Playback Groups opening does not redirect itself;
- tab-to-tab switching while open does not redirect;
- closing rearms the next opening;
- watcher registration and shutdown cleanup both exist.

After the implementation passes the full automated suite and syntax checks, deploy it once, restart IINA once, and perform one combined acceptance sequence: closed → toolbar button → Playback Groups; Playback Groups → OpenSubtitles remains allowed; close → toolbar button → Playback Groups again.

## Delivery

Increment the plugin patch version, update Chinese and English documentation, rebuild the `.iinaplgz` archive, verify its embedded version and checksum, deploy the verified files to the installed plugin, and publish the matching source and Release to GitHub only after local and real-IINA verification succeeds.
