# GitHub Publication Design

## Goal

Publish the completed IINA plugin as a public, installable open-source project with clear Chinese-first documentation and a verified release artifact.

## Repository

- GitHub repository name: `iina-playlist-groups`
- Display name: `IINA Playlist Groups`
- Visibility: public
- Default branch: `main`
- License: MIT
- Repository description: `为 IINA 提供播放列表分组、独立循环模式和分组播放进度记忆。`

The existing local plugin source directory becomes the repository root. Generated dependencies and local operating-system files remain excluded.

## Documentation

- `README.md` is the default Chinese document.
- `README_EN.md` is the English document.
- Each document links to the other language at the top.
- Both documents cover the purpose, major features, requirements, installation, usage, playback modes, progress-memory behavior, shortcut keys, known behavioral boundaries, development tests, packaging, license, and release download.
- The documentation must describe the current `0.1.10` behavior only and must not promise unsupported features.

## Release

- Initial tag and release title: `v0.1.10`
- Asset: `IINA-Playback-Groups-0.1.10.iinaplgz`
- Release notes are Chinese-first with an English section.
- Notes summarize playlist groups, per-group playback modes, per-group progress memory, persistence, row navigation, and `Shift+Space` manual-next behavior.
- The artifact is rebuilt or reverified immediately before upload, and its archive integrity and embedded version are checked.

## Publication Flow

1. Add the bilingual README files, MIT license, and repository metadata files.
2. Run the complete automated test suite and syntax checks.
3. Verify the release archive and version.
4. Initialize the local Git repository, commit the publication-ready project, and create the GitHub repository under the currently authenticated account.
5. Push `main`, configure the repository description, create tag/release `v0.1.10`, and upload the verified package.
6. Read back the repository and release URLs to confirm public availability and the uploaded asset.

## Safety and Error Handling

- Confirm the authenticated GitHub account before creating anything.
- Abort if `iina-playlist-groups` already exists under that account rather than overwriting it.
- Do not upload local playback data, user media, IINA state, credentials, or generated diagnostic files.
- Do not publish a release if tests, syntax checks, archive validation, or embedded-version validation fails.

## Success Criteria

- The public repository opens successfully on GitHub with Chinese as the default README language.
- The English README is linked and complete.
- The repository description and MIT license are visible.
- The `v0.1.10` Release is published with bilingual notes.
- The `.iinaplgz` asset downloads from the Release and matches the locally verified package.
