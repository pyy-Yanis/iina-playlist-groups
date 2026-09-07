# Playback Transition Fixes Design

## Goal

Correct three related playback-state defects in one implementation round: a `once` group must remain on the final frame, choosing an earlier item must play it, and sidebar highlighting must follow native playlist transitions.

## Architecture

mpv remains the single playback executor. Group mode maps to explicit mpv options: `loop` uses `keep-open=no` plus `loop-playlist=inf`; `once` uses `keep-open=yes` plus `loop-playlist=no`; `manual` uses `keep-open=always` plus `loop-playlist=no`. Item selection uses mpv's live `playlist-play-index` command instead of IINA's asynchronously cached playlist wrapper.

The controller adopts every successfully loaded native playlist item from its path and live playing index. A controller-requested load must match its token; a native automatic transition may create a new token from the observed identity. Every adoption posts `playbackChanged`, so the sidebar changes its highlighted row.

## Error Handling

Unknown paths, invalid indexes, duplicate-path ambiguity, missing files, and stale controller-requested tokens remain non-adoptable. Existing pause/watchdog behavior remains in force rather than guessing an identity.

## Verification

Automated regression tests cover all mode option mappings, direct index selection, and native-transition adoption. Real IINA verification uses two short videos for `once`, direct selection from item 2 to item 1, highlight movement from item 1 to item 2, and loop regression `1 → 2 → 1`.

