# GitHub Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish IINA Playlist Groups as a polished public GitHub repository with Chinese-first bilingual documentation and a verified `v0.1.10` release.

**Architecture:** Keep the existing plugin directory as the repository root, add only publication metadata and documentation, and use GitHub CLI for authenticated repository and release operations. Treat local tests and archive validation as hard gates before any push or release upload, then read GitHub state back after publication.

**Tech Stack:** IINA JavaScript plugin API, Node.js built-in test runner, Git, GitHub CLI, ZIP (`.iinaplgz`).

## Global Constraints

- Repository name: `iina-playlist-groups`; display name: `IINA Playlist Groups`.
- Visibility: public; default branch: `main`; license: MIT.
- `README.md` is Chinese-first and `README_EN.md` is English; each links to the other.
- Release tag/title: `v0.1.10`; asset: `IINA-Playback-Groups-0.1.10.iinaplgz`.
- Do not publish user media, playback state, credentials, diagnostics, or unsupported feature claims.

---

### Task 1: Publication Documentation and Metadata

**Files:**
- Create: `README.md`
- Create: `README_EN.md`
- Create: `LICENSE`
- Create: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: current behavior in `Info.json`, `src/`, `ui/`, and regression tests.
- Produces: Chinese-first project landing page, English translation, MIT grant, safe ignore rules, and accurate package metadata.

- [ ] **Step 1: Inventory only verified features and commands**

Run: `rg -n "MODE_|Shift\\+SPACE|remember|progress|playlist|npm test" Info.json src ui tests package.json`

Expected: evidence for the three playback modes, per-group progress behavior, playlist grouping, `Shift+Space`, and the test command.

- [ ] **Step 2: Write both README files**

Create `README.md` with the title, `[English](README_EN.md)` link, feature list, requirements, Release installation instructions, group creation and file addition instructions, playback-mode table, progress-memory explanation, shortcut table, development/test commands, packaging command, and MIT license notice. Create `README_EN.md` with equivalent content and a `[简体中文](README.md)` link. Link downloads to `../../releases/latest` so the link remains valid under the final repository owner.

- [ ] **Step 3: Add MIT and safe repository metadata**

Create `LICENSE` using the standard MIT text with year `2026` and the authenticated GitHub account name as copyright holder. Create `.gitignore` containing:

```gitignore
.DS_Store
node_modules/
*.log
outputs/
```

Update `package.json` to use `iina-playlist-groups` as its private package name while preserving the existing test script.

- [ ] **Step 4: Validate documentation content**

Run: `rg -n "README_EN.md|releases/latest|Shift \+ Space|自动循环列表|播放一次|手动逐项|MIT" README.md README_EN.md LICENSE`

Expected: both language links and all current user-facing behaviors are present, with no placeholder text.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md README_EN.md LICENSE .gitignore package.json
git commit -m "docs: add bilingual project documentation"
```

Expected: one documentation commit on `main`.

### Task 2: Local Release Gate

**Files:**
- Verify: `Info.json`
- Verify: `global.js`
- Verify: `main.js`
- Verify: `src/*.js`
- Verify: `ui/sidebar.js`
- Verify: `tests/*.test.js`
- Verify: `../outputs/IINA-Playback-Groups-0.1.10.iinaplgz`

**Interfaces:**
- Consumes: complete plugin source and release package.
- Produces: test, syntax, version, archive-integrity, and checksum evidence required for publication.

- [ ] **Step 1: Run all regression tests**

Run: `npm test`

Expected: 18 tests pass, 0 fail.

- [ ] **Step 2: Check production JavaScript syntax**

Run: `for file in global.js main.js src/*.js ui/sidebar.js; do node --check "$file" || exit 1; done`

Expected: exit code 0 with no syntax errors.

- [ ] **Step 3: Verify source and packaged versions**

Run: `node -e "const x=require('./Info.json'); if(x.version!=='0.1.10')process.exit(1); console.log(x.identifier,x.version)"`

Expected: `com.iina.playback-groups 0.1.10`.

Run: `unzip -p ../outputs/IINA-Playback-Groups-0.1.10.iinaplgz Info.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);if(x.version!=='0.1.10')process.exit(1);console.log(x.identifier,x.version)})"`

Expected: `com.iina.playback-groups 0.1.10`.

- [ ] **Step 4: Verify archive and record checksum**

Run: `unzip -t ../outputs/IINA-Playback-Groups-0.1.10.iinaplgz`

Expected: `No errors detected in compressed data`.

Run: `shasum -a 256 ../outputs/IINA-Playback-Groups-0.1.10.iinaplgz`

Expected: one SHA-256 value used in the Release notes.

- [ ] **Step 5: Commit the plugin source**

Run:

```bash
git add Info.json global.js main.js src ui tests
git commit -m "feat: add IINA playlist groups plugin"
```

Expected: clean tracked plugin source with no user data.

### Task 3: GitHub Repository and Release

**Files:**
- Create locally through Git: remote `origin` and tag `v0.1.10`
- Upload: `../outputs/IINA-Playback-Groups-0.1.10.iinaplgz`

**Interfaces:**
- Consumes: verified `main` branch, authenticated GitHub account, release checksum.
- Produces: public GitHub repository and downloadable `v0.1.10` Release.

- [ ] **Step 1: Confirm authentication and repository availability**

Run: `gh auth status`

Expected: an active GitHub account with repository scope.

Run: `gh repo view <account>/iina-playlist-groups`

Expected: not found. If it exists, stop instead of overwriting it.

- [ ] **Step 2: Create and push the public repository**

Run: `gh repo create iina-playlist-groups --public --source=. --remote=origin --push --description "为 IINA 提供播放列表分组、独立循环模式和分组播放进度记忆。"`

Expected: repository URL and successful push of `main`.

- [ ] **Step 3: Create the bilingual release**

Create a temporary release-notes file containing a Chinese summary first, an English summary second, installation steps, and the SHA-256 from Task 2. Then run:

```bash
gh release create v0.1.10 ../outputs/IINA-Playback-Groups-0.1.10.iinaplgz --repo <account>/iina-playlist-groups --title "v0.1.10" --notes-file <release-notes-file>
```

Expected: a published release URL with one `.iinaplgz` asset.

- [ ] **Step 4: Verify public repository state**

Run: `gh repo view <account>/iina-playlist-groups --json nameWithOwner,url,visibility,description,defaultBranchRef`

Expected: correct owner/name, public visibility, exact Chinese description, and default branch `main`.

Run: `gh release view v0.1.10 --repo <account>/iina-playlist-groups --json url,tagName,name,isDraft,isPrerelease,assets`

Expected: tag/name `v0.1.10`, not draft or prerelease, and asset `IINA-Playback-Groups-0.1.10.iinaplgz`.

- [ ] **Step 5: Final clean-state check**

Run: `git status --short --branch`

Expected: `main` tracks `origin/main` with no uncommitted files.
