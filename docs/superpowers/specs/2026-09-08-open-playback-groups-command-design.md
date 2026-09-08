# Open Playback Groups Command Design

## Goal

Provide one reliable action that opens IINA's plugin sidebar directly on Playback Groups without changing OpenSubtitles behavior.

## Interaction

- `Control + P` calls `iina.sidebar.show()` and always selects Playback Groups.
- Plugin → Playback Groups → “显示播放分组” invokes the same action.
- The action does not toggle the sidebar closed when Playback Groups is already visible.
- OpenSubtitles remains available from its tab.
- `Shift + P` is not used because IINA 1.4.4 binds it to `show-progress`.

## Implementation and Verification

Register the user-facing `Control+P` shortcut as mpv key code `Ctrl+p` through `iina.input.onKeyDown` at high priority, matching the proven `Shift+Space` path, and add a static clickable plugin menu item without a menu key binding. The lowercase internal key code is required because uppercase `P` means `Shift+P` to mpv. Remove the menu item during disposal. Add source-level regression coverage, run the full suite and syntax checks once, deploy once, and verify both the shortcut and menu action in IINA before packaging version `0.1.11`.
