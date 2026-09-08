# IINA Playlist Groups

[简体中文](README.md) · [Download the latest release](../../releases/latest)

Add clear, horizontally arranged playlist groups to [IINA](https://iina.io/). Each group has its own playback mode and resume policy, so you can stay in fullscreen and move through different queues without switching player windows.

## Features

- Display multiple playlist groups horizontally in the IINA sidebar.
- Press `Control + P`, or choose **Plugins → Playback Groups → Show Playback Groups**, to open the groups directly.
- Choose Loop, Play Once, or Manual Step independently for each group.
- Enable or disable progress memory per group; the same video follows the rules of the group that contains it.
- Preserve groups, item order, playback modes, and progress settings across IINA restarts.
- Double-click any list item to play it, with the active row following automatic transitions.
- Use the row controls to play the previous or next item without deleting files.
- In Manual Step mode, press `Shift + Space` for the next item while regular Space keeps IINA's native play/pause behavior.

## Requirements

- macOS
- IINA 1.4 or later

## Installation

1. Open the project's [Releases](../../releases/latest) page.
2. Download `IINA-Playback-Groups-0.1.12.iinaplgz`.
3. Double-click the package, or install it as a local plugin from IINA's plugin settings.
4. If the plugin does not appear immediately, quit IINA completely and reopen it.

## Usage

1. Open a video in IINA and expand the **Playback Groups** tab in the right sidebar.
2. Click the top `+` to create a group. The dialog starts with “新分组” (New Group); confirm it directly or edit the name first.
3. Select a group and click **Add Files**. Use `Command` or `Shift` to select multiple videos, or drag multiple files from Finder into the group's list. Imported files are appended at the end.
4. Open the group menu to choose its playback mode and progress-memory setting.
5. Double-click a video to play it, or use the previous/next controls in its row.

### Playback modes

| Mode | Behavior |
| --- | --- |
| Loop | Plays continuously and returns to the first item after the last one. This is the default for new groups. |
| Play Once | Advances automatically, then remains on the final item without closing the player. |
| Manual Step | Pauses when the current video ends. Press `Shift + Space` to play the next item. |

### Playback progress

Progress memory is configured independently for every group:

- Off (default): reopening a previously played item starts it from the beginning.
- On: reopening it resumes from the last saved position.

Progress is stored per group and per video item, so the same file can have different resume behavior and positions in different groups.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | IINA's native play/pause action |
| `Shift + Space` | Play the next item in a Manual Step group |
| `Control + P` | Open and switch directly to Playback Groups |

## Development and testing

The plugin has no runtime dependencies. Run the regression suite with Node.js:

```bash
npm test
```

Check JavaScript syntax:

```bash
for file in global.js main.js src/*.js ui/sidebar.js; do node --check "$file" || exit 1; done
```

Package the plugin:

```bash
zip -X -q -r IINA-Playback-Groups-0.1.12.iinaplgz Info.json global.js main.js src ui
```

## Notes

Batch import uses macOS's built-in file chooser and dragging pasteboard. Media files are neither copied nor uploaded. Drop files into the Playback Groups list; folders are not supported. Drops onto the video remain handled by IINA. Internal reordering and transfers between groups keep their existing behavior.

Groups are managed by this plugin and are separate from IINA's single native playlist-loop setting. Deleting a group removes only the plugin's group record; it never deletes video files from disk.

## License

This project is licensed under the [MIT License](LICENSE).
