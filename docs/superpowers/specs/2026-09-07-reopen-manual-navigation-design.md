# Reopen, Manual Playback, and Navigation Design

## Goal

Fix sidebar restoration after opening media from IINA's initial window, make manual-mode Space advance reliably after EOF, and replace the confusing cross-group arrow controls with previous/next playback controls.

## Design

Sidebar loading and message registration become one idempotent operation invoked both at controller start and every `iina.window-loaded` event. A reopened player therefore receives a fresh document and a fresh message hub even when the controller did not previously observe `window-will-close`.

Manual EOF completion trusts only a previously loaded token whose group, item, index, and playlist generation still match controller state. It does not require mpv's path after `end-file`, because IINA clears that property before the callback. The falling edge of `eof-reached` retains `waitingForNext`; a new load or seek remains responsible for clearing it. Space is therefore intercepted and advances to the next item instead of reaching IINA's default replay command.

The two row controls become previous/next playback actions within the current group. At the first and last item the unavailable direction is disabled. Cross-group move/copy remains available by dragging to a group tab, with Command selecting copy.

## Verification

Automated tests cover sidebar reload/rebinding, token-certified manual EOF, retained waiting state, and adjacent playback payloads. Real IINA verification covers initial-window reopening, manual `1 → Space → 2`, arrow navigation, and persistence of all existing group data.
