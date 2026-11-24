# Project Instructions for AI Agents

This repository holds public Spoons for Hammerspoon 2. Other people install and run them, so
nothing in a Spoon may depend on one user's configuration: no personal paths, no private
commands, no other Spoons that are not published here.

## Approval before closing a bead

Do not close a bead until a human has approved the work. When the work is done, report what
changed and how it was checked, leave the bead open, and ask for approval. Close it only after
the human says it is accepted.

The only exception is a bead whose description or acceptance criteria say explicitly that
approval is not required. A bead without that statement always needs approval.

Approving a bead also authorizes committing the changes made while working on it. Commit
them first, and close the bead after the commit. The beads export in `.beads/issues.jsonl`
changes when the bead is closed, so that change goes into the next commit.

This rule takes precedence over the session close protocol below, which tells agents to close
finished work.

This repository is a submodule of the user's configuration repository. When a bead needs it,
such as a Spoon moving out of that repository, commits may also be made there. The same rule
applies: commit once the bead is approved, then close it.

## Keeping the user's configuration working

The user's configuration loads the Spoons in this repository and runs every day. No change
may break it. This applies to a change here, to a change in the configuration repository, and
to moving a Spoon from one to the other.

The configuration loads its Spoons through `hs_interactive-gt`'s `use()`, which records what
happened to each one. Check it before and after a change, through the `hs2` command-line tool:

```sh
printf '%s\n' 'JSON.stringify(hs.spoons["hs_interactive-gt"].use.status().map(r => [r.name, r.state, r.error]))' | hs2 --no-prompt
```

1. Before the change, record the result. Every Spoon should be `loaded`.
2. Make the change, tell the user that the configuration is about to be reloaded, and reload
   it.
3. Run the check again. The same Spoons must be `loaded`, and none may be `failed`.
4. If anything differs, undo the change before doing anything else, and report what happened.

A Spoon that loads can still fail when it is used. When a change touches a Spoon's behaviour,
also try what it does, or ask the user to.

## Publishing Spoons

Users install these Spoons with `hs.spoons.install()` or `hs.spoons.use()`, straight from this
repository. `ai/hs2-spoon-install.org` explains how Hammerspoon 2 does that. The rules below
follow from it.

### Nothing local to one machine

A published Spoon contains nothing local to the machine it was written on. That excludes paths,
user names, host names, device names, accounts, personal domains and identifiers (such as a
launchd label), personal data, and any dependency on files or Spoons that are not published.
Anything a user has to supply comes from the Spoon's configuration.

If something local cannot be removed from a Spoon, the Spoon is not published.

### Where a Spoon lives

Each Spoon is a directory `Spoons/<name>.spoon2/`. `hs.spoons.install()` finds a Spoon only in
a directory whose name ends in `.spoon2`, and takes the Spoon's name from that directory. The
directory is installed as `Spoons/<name>` in the user's configuration, without the extension.

`<name>` must be the same as the `name` in the Spoon's `spoon.json`. Nothing checks this, so
check it by hand.

### What a Spoon contains

| File            | Holds                                                               |
|-----------------|---------------------------------------------------------------------|
| `spoon.json`    | `name`, `author`, `version` and `description`, none of them empty   |
| `init.js`       | The Spoon, which sets `module.exports` to an object                 |
| `readme.org`    | The documentation for users, in Org mode                            |
| `images/`       | The screenshots the readme shows                                    |

A Spoon may also hold the files it reads while it runs, such as elisp files, a server it
starts, or sounds. It holds nothing else. A Spoon may not contain a symbolic link, because
`hs.spoons.install()` refuses one.

An installed Spoon has only its own directory. It cannot `require()` a file outside it, such as
a shared `lib/` directory. Code it needs is either inside it or in another published Spoon that
it loads.

### When one Spoon uses another

Hammerspoon 2 has no dependencies between Spoons, so each Spoon handles them itself.
`ai/spoon-dependencies.org` lists them and explains the reasons.

1. An optional dependency makes a Spoon better when the other Spoon is loaded. The Spoon reads
   `hs.spoons["<name>"]` when it needs it, and works without it. It never loads or installs the
   other Spoon; that is the user's choice.
2. A required dependency is one the Spoon cannot work without. The Spoon checks for it in
   `start()`. When it is missing, `start()` throws an `Error` that names the missing Spoon and
   gives the address of its documentation:
   `https://github.com/dmgerman/hammer2spoons/tree/main/Spoons/<name>.spoon2`. The Spoon never
   offers to install it.

`hs.spoons.load()` throws `ENOTINSTALLED` for a Spoon that is not installed. It does not return
`null`.

Every readme lists the Spoons it uses, says whether each is optional or required, and says to
load them first.

Most Spoons that do things for the user will provide a menu of those things, and so require
`hs_menu-gt`. Such a Spoon exports its menu as `menu` and opens it with `menuShow()`, its options
call the Spoon's functions with `fn:`, and its `bindHotkeys()` accepts `menuShow`, so that a user
can open the menu through the `hotkeys` option of `hs.spoons.use()`. `hs_window-gt` and
`hs_appleMusic-gt` were the first.

A Spoon that asks the user for input, such as a window, a screen, a number or a line of text,
requires `hs_interactive-gt` and obtains the input through its readers, such as
`readers.window.prompted`. It does not build its own `hs.chooser` or dialog. Input is then
handled in one place, and every prompt is visible to `promptIsOpen()`, on which other Spoons
such as `hs_menu-gt` rely. `hs_window-gt` was the first. Defining named commands for a Spoon's
functions remains the user's choice: a Spoon does not define commands itself, and its readme may
suggest command definitions.

### What users download

Installing any one Spoon downloads the whole repository as a zip file, and then copies only that
Spoon. Two rules keep the download small:

1. Files that only developers need are marked `export-ignore` in `.gitattributes`. That keeps
   them in the repository and out of the zip. Tests, makefiles, and the planning files at the
   top level (`ai/`, `.beads/` and the agent files) are marked this way. `export-ignore` only
   shortens the download: the files stay public on GitHub.
2. Images are stored at the size they are shown at. A screenshot or an image the Spoon displays
   should be tens of kilobytes, not megabytes.

Generated files, such as `__pycache__`, are never committed.

### Screenshots

A readme shows a screenshot wherever the Spoon has something to see. Screenshots are taken one
Spoon at a time, in that Spoon's own bead.

1. Capture with Hammerspoon 2, through `hs2`. `HSWindow.snapshot()` captures a window,
   `HSScreen.snapshot()` followed by `croppedCopy()` captures an overlay such as an alert, and
   `imageFromCanvas()` captures a Spoon's canvas. Something that closes when the focus moves,
   such as an open menu, is captured by the user with `screencapture -i`. All of these need the
   Screen Recording permission.
2. Crop each image to the part that shows the feature, not the whole screen.
3. Shrink it to at most 1200 pixels wide and 256 colours, as PNG, without dithering:
   `magick in.png -resize '1200x>' +dither -colors 256 -strip out.png`. An image should be
   under 200 KB. Without `+dither`, ImageMagick approximates the dropped colours with a dot
   pattern, which shows on gradients such as a translucent chooser; 256 colours without it
   looks the same as the full image, at about a third of the size.
4. Store it as `Spoons/<name>.spoon2/images/<what-it-shows>.png`. Images stay in the download,
   so that an installed Spoon's readme shows them too.
5. Give every image in a readme alt text that says what it shows, as an Org export snippet:
   `@@html:<img src="./images/<what-it-shows>.png" alt="What it shows">@@`. GitHub renders Org
   with org-ruby, which ignores `#+ATTR_HTML` and gives an image linked as `[[./images/x.png]]`
   its path as alt text; it passes an `@@html:` snippet through as HTML. Emacs then shows the
   snippet as text instead of the image.

Before capturing, set up neutral content: sample text, generic window titles, and no real file
names, messages, accounts or clipboard contents.

**The user approves the contents of every screenshot before it is committed.** Show each image
to the user, and commit it only once the user has said it may be published.

The user can help take a screenshot when that is needed, for example when the Spoon has to be
used by hand to show something, or when a capture from `hs2` does not show it properly. Ask
rather than settle for a screenshot that does not show the feature.

### Versions

`hs.spoons.update()` reinstalls a Spoon only when the `version` in its `spoon.json` has changed.
Every change to a Spoon therefore raises its version, or users who update will not receive it.

A release of the collection is a tag of the repository, `v<major>.<minor>.<patch>`, made by the
user. Each release has a section in `CHANGELOG.org` that lists every Spoon's version and what
changed in it since the previous release. Changes made between releases are listed under an
`Unreleased` section at the top, as each one is committed.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var


## Overview

Hammerspoon2 is a replacement for Hammerspoon that uses **JavaScript instead of Lua**. It provides automation and window management capabilities for macOS.

## Documentation

**Main Documentation:** https://cmsj.github.io/Hammerspoon2/index.html

### Key API Pages

- **Module Index:** https://cmsj.github.io/Hammerspoon2/index.html
- **Window API:** https://cmsj.github.io/Hammerspoon2/hs.window.html
- **HSWindow Type:** https://cmsj.github.io/Hammerspoon2/HSWindow.html
- **Application API:** https://cmsj.github.io/Hammerspoon2/hs.application.html
- **HSApplication Type:** https://cmsj.github.io/Hammerspoon2/HSApplication.html
- **Hotkey API:** https://cmsj.github.io/Hammerspoon2/hs.hotkey.html
- **Accessibility API:** https://cmsj.github.io/Hammerspoon2/hs.ax.html

## Key Differences from Hammerspoon

1. **Language:** JavaScript (ES6+) instead of Lua
2. **Syntax:** Use modern JavaScript features (arrow functions, const/let, template literals)
3. **API Structure:** Similar to original Hammerspoon but adapted for JavaScript

## API changes to remember

Upstream renames do not throw: an old property name reads as `undefined`, so code that
uses one keeps running and quietly does the wrong thing. Use the current names:

| Old                          | Current                                        | Since      |
|------------------------------|------------------------------------------------|------------|
| `hs.loadSpoon(name)`         | `hs.spoons.load(name)`, which refuses a `/`    | 2026-11-02 |
| `HSApplication.title`        | `HSApplication.name`                           | 2026-10-23 |
| `HSFont.customSize(name, n)` | `HSFont.custom(name, n)`                       | 2026-10-21 |
| `HSImage.copyImage()`        | `HSImage.duplicate()`                          | 2026-10-17 |

Behaviour that changed:

- `setAttributeValue()` and `performAction()` on an `hs.ax` element throw an `Error` when
  the Accessibility API refuses, with the AX error name in `err.code`. They used to return
  `false`. A value of the wrong type (a plain `{x, y}` for `AXPosition` instead of
  `new HSPoint(x, y)`) throws too.
- `hs.window.allWindows()`, `windowsForApp()` and `app.allWindows` include windows in native
  fullscreen and on other Spaces. Reading `AXMainWindow` directly is no longer needed.
- `hs.eventtap.keyStroke(mods, key, app)` sends a keystroke, modifiers included, to one
  application without activating it. Prefer it to activating the app and sending a global
  keystroke.
- Functions that return nothing give `null`, not `undefined`.
- `JSON.stringify()` shows the values of windows, applications, screens, colours and
  geometry objects, where it used to give `{}`.
- `hs.osascript` async scripts run in parallel and resolve in completion order; chain them
  when the order matters.

Newer capabilities worth knowing: `hs.canvas` with `imageFromCanvas()` for drawing images
offscreen, `HSWindow.snapshot()`, `hs.eventtap.systemKeyStroke()` for media keys,
`require('node:sqlite')`, `hs.dockicon.setMenu()` and `hs.onOpenFile`.

## Naming

Two conventions, and they do not mix. Ported Hammerspoon 1 code is renamed to match these
rather than keeping its Lua spelling.

| What | Style | Examples |
|------|-------|----------|
| Functions and variables | `camelCase` | `keyToWindowAttach`, `mouseScreenCenterNext`, `closedWindowsForget` |
| Spoon `config` keys | `camelCase` | `attachModifiers`, `screenshotDir`, `historySize` |
| Module-level constants | `UPPER_SNAKE` | `CANCEL`, `MUSIC_BUNDLE_ID`, `DELTA_PRESETS` |
| Command names | `hyphenated`, Emacs Lisp style | `window-attach-to-key`, `mouse-screen-center-next` |
| Spoon directories | `hs_<name>-gt` | `hs_window-gt` |

No underscores in function names, with one exception. A Spoon that exports a function in a form
that reads its omitted arguments through `hs_interactive-gt` keeps the function as written under
the name `_<name>`, and exports the reading form as `<name>`. In `hs_window-gt`, `_leftHalf`
never prompts, while `module.exports.leftHalf` does. The leading underscore marks the form the
Spoon calls internally, so that the two cannot be confused in its code. Readmes document only
`<name>`. The user decided this on 2026-11-15.

### Subject first, action last

This governs every identifier, not just commands. The subject leads and the action follows:
`windowPrevious`, not `previousWindow`; `applicationWindowSelect`, not
`selectApplicationWindow`. Related names then sort together wherever they are listed — in the
chooser, in an editor's symbol list, in a file.

| Wrong                      | Right                      |
|----------------------------|----------------------------|
| `previousWindow()`         | `windowPrevious()`         |
| `selectApplicationWindow()`| `applicationWindowSelect()`|
| `attachKeyToWindow()`      | `keyToWindowAttach()`      |
| `forgetClosedWindows()`    | `closedWindowsForget()`    |
| `toggleOnScreen()`         | `onScreenToggle()`         |
| `newTab()`                 | `tabNew()`                 |

A preposition stays with the subject it belongs to rather than being moved to the end:
`keyToWindowAttach`, not `keyWindowToAttach` or `windowKeyAttach`. The whole subject phrase
comes first and the action closes the name.

### A command is named after the function it calls

Because both follow the same order, a command name is just its function's name in hyphenated
words, prefixed with the subject when the function name does not already carry it — the
Spoon's own name usually supplies it.

| Function          | Command                    |
|-------------------|----------------------------|
| `peek()`          | `menubar-peek`             |
| `peekHide()`      | `menubar-peek-hide`        |
| `windowPrevious()`| `window-previous`          |
| `historyShow()`   | `clipboard-show`           |

Dropping a word the Spoon's name already supplies is fine: `historyShow()` in
`hs_clipboard-gt` is `clipboard-show`, not `clipboard-history-show`.

**What may not change is the action.** A command may not claim to do something its function
does not, and a name may not claim behaviour the code does not have. Both of these were
wrong, for the same reason:

| Wrong                 | Was bound to    | Actually did                  |
|-----------------------|-----------------|-------------------------------|
| `menubar-peek`        | `peekToggle()`  | toggled, while the name said show |
| `menubar-peek-toggle` | `peekToggle()`  | hid itself after 4s, so not a toggle at all |

Rename the function and the command together when either changes.

## Writing

Comments, docstrings, readmes, issue drafts and conversation are all held to this.

**No metaphor or figurative framing.** Describe what the code or the system actually does.

**Plain is not the same as abstract.** The failure to watch for is removing a metaphor and
leaving vagueness behind. An abstraction reads as evasive in a way the metaphor did not, so
the text gets worse rather than better:

| Figurative                     | Abstract, and worse                                     | Right                                    |
|--------------------------------|---------------------------------------------------------|------------------------------------------|
| only one click gets through     | `can be clicked in one way that reaches JavaScript`     | `only a left click reaches the Spoon`    |
| the chunk that most wants showing | `the chunk whose display is most warranted`           | `the chunk that most needs to be shown`  |
| every audio application hiccups | `audio clients experience discontinuity`                | `every application using audio is interrupted briefly` |

**One thing per sentence.** Convoluted text is usually a single sentence in which every
clause qualifies the one before it, often ending in a counterfactual inside a counterfactual
(`there would be no menu to show if it were`). Split it. When there is more than one reason
for something, number them:

> A left click to start dictating, with a right click for everything else, would be better.
> It cannot be built in Hammerspoon 2, for three reasons:
>
> 1. A right click on a menu bar item never reaches the Spoon.
> 2. A left click cannot say which button it was.
> 3. Attaching a menu replaces the click action instead of adding to it.

**Lead with the fact, then the qualification.** Not the other way round, and not both woven
together.

**Write full sentences, not notes.** Brevity is not the goal; a human is going to read this.
Give each sentence its subject and verb rather than compressing it into a label and a colon,
and spell out what was done rather than leaving the reader to reconstruct it:

| Too compressed | Right |
|----------------|-------|
| `Clicked by hand: two left clicks, then one right click. Three clicks produced two callbacks:` | `I then clicked that menu bar item by hand three times: two left clicks, followed by one right click. Those three clicks produced only two callbacks, and both recorded exactly the same thing:` |
| `Not a defect, but it rules out keeping the callback and adding a menu.` | `This is simply how NSStatusItem works, so I am not reporting it as a defect. It does, however, rule out the obvious alternative, which would have been to keep the click callback and attach a menu alongside it.` |

This matters most in issue drafts and readmes, where the reader has none of the context that
made the short version legible to whoever wrote it.

## Common Patterns

### Hotkey Binding

```javascript
// Define modifier key combination
const hyper = ["⌘", "⌥", "⌃", "⇧"];

// Simple hotkey (press only)
hs.hotkey.bind(hyper, "4", () => {
    console.log("Key pressed");
}, null);

// Hotkey with press and release handlers
hs.hotkey.bind(hyper, "5",
    () => { console.log("Key down"); },
    () => { console.log("Key up"); });
```

### Window Management

```javascript
// Get all windows
const windows = hs.window.allWindows();

// Window properties
windows.forEach(win => {
    const title = win.title;                    // Window title
    const app = win.application.name;           // Application name
    const frame = win.frame;                    // {x, y, w, h}
    const position = win.position;              // {x, y}
    const size = win.size;                      // {w, h}
});

// Window methods
win.focus();
win.minimize();
win.centerOnScreen();
win.close();
```

### Application Watchers

```javascript
// One handler receives every application event; select the ones of interest in it.
// addWatcher takes the handler alone — passing an event name as a first argument throws
// "The provided handler must be a function".
function eventHandler(eventName, appObject) {
    if (eventName !== "didLaunch") return;
    console.log(`App ${appObject.name}: ${eventName}`);
}

hs.application.addWatcher(eventHandler);
hs.application.removeWatcher(eventHandler);
```

### Accessibility (AX) Watchers

```javascript
// Get application by bundle ID
const app = hs.application.matchingBundleID("com.apple.Safari");

// Add accessibility watcher
if (app != null) {
    function handler(notification, element) {
        console.log(`AX event: ${notification} on: ${element.title}`);
    }

    hs.ax.addWatcher(app, hs.ax.notificationTypes["windowCreated"], handler);
}
```

### Alerts

```javascript
// Show on-screen alert
hs.alert.show("Configuration loaded!");
```

## Available Modules

From the API index, key modules include:

- `hs.window` - Window management
- `hs.application` - Application control
- `hs.hotkey` - Keyboard shortcuts
- `hs.ax` - Accessibility API
- `hs.alert` - On-screen notifications
- `hs.screen` - Screen/display management
- `hs.timer` - Timers and scheduling
- `hs.eventtap` - Low-level event monitoring
- `hs.fs` - File system operations
- `hs.http` - HTTP requests
- `hs.json` - JSON parsing
- `hs.geometry` - Geometric operations

## Permissions

Several APIs return nothing rather than failing when macOS has not authorized Hammerspoon 2.
A silent `null` reads like "there is none of that" and sends you looking for a bug in the
wrong place, so check the permission before concluding the API is broken.

`hs.permissions` has a `check` and a `request` for each:

| Permission      | Check                 | Needed for                                           |
|-----------------|-----------------------|------------------------------------------------------|
| Accessibility   | `checkAccessibility()`| `hs.ax`, `hs.window`, menu bar items, window control |
| Location        | `checkLocation()`     | `ssid`, `bssid`, `countryCode`, `wlanChannel` in `hs.wifi` |
| Screen Recording| `checkScreenRecording()` | `hs.screen.snapshot()`, window snapshots          |
| Microphone      | `checkMicrophone()`   | audio input                                          |
| Camera          | `checkCamera()`       | `hs.camera`                                          |
| Notifications   | `checkNotifications()`| `hs.notify`                                          |

macOS prompts only once per application. When a `request…()` shows nothing, the answer was
given before and has to be changed by hand in **System Settings → Privacy & Security**.

Two worth knowing:

**Location.** macOS treats an SSID as location data. Without it `hs.wifi.currentNetwork()`
returns `null`, which looks exactly like not being on a network. There are two ways round
this: grant the permission, or run a Shortcut instead.

**Prefer the permission to a workaround that runs a Shortcut.** macOS shows the Shortcuts
icon in the menu bar for as long as any Shortcut runs, so polling one makes that icon flash
all day, and each run spawns a process. Measured: an SSID read once a minute put the
indicator in 4 of 60 two-second scans.

A Spoon depending on a permission should say so in its readme, next to the setting that needs
it, and should still do something sensible without it. For example, a Spoon that shows the
SSID can fall back to naming the network interface.

## Memory

Two rules prevent most leaks in a Spoon:

1. Every `hs.timer.doEvery()` needs a place where it is stopped, on every path that ends
   what it serves: a user closing something, a device going away, and the Spoon's `stop()`.
   A timer that is never stopped keeps alive everything its callback refers to.
2. Code that runs during teardown must not open, show or start anything. A deferred
   callback must check that its object is still registered before acting.

`hs.reload()` frees the previous JavaScript context only in builds that include upstream
PR #366. In a build without it, each reload keeps about 15 MB alive, so restart Hammerspoon 2
instead when memory matters.

## Cost at realistic size

Before writing a design, estimate what it costs at the sizes and rates it will meet in
daily use, not in the test that first made it work. A design tried with ten items, or run
once by hand, can look cheap and still not be.

Work out three numbers:

1. How many objects it holds at once: callbacks, timers, watchers, canvases, AX elements.
2. How often it does its work: per keystroke, per timer tick, per event, per open.
3. What each piece of work costs. A walk over every window takes about 0.1 s, and a
   shell command or a Shortcut starts a process. These are far more than a JavaScript call.

Then check two things:

1. The cost should follow what the user does, not the size of the data or the passing of
   time. A menu that is opened on one row at a time should not need an object for every
   row. A value that changes only when a device changes should not be polled every second.
2. Nothing should be rebuilt or re-read when nothing has changed.

When a design fails either check, look for one with a fixed cost: build on demand, share
one handler across items, or react to an event instead of polling. If the API leaves no
such design, say so in a comment, and treat the limitation as a candidate for an upstream
issue (see the next section).

For example, the clipboard history attached seven context-menu callbacks to each of up to
110 entries, about 770 in all, and rebuilt them every time its chooser closed. Releasing
them in bulk made the JavaScriptCore deadlock in upstream issue #375 likely. A second
chooser listing the seven actions, with a single `onSelect`, would have needed one
callback.

## Workarounds, and when to ask upstream

When something cannot be done the obvious way, say so in the code rather than quietly routing
around it, and then decide where the limitation actually lives. That decision is the useful
one, because only one kind of limitation can be fixed by someone else.

**Ask first: is this macOS or is this Hammerspoon 2?**

| The limitation is in | Then | Example |
|----------------------|------|---------|
| macOS | No upstream fix exists. Document the workaround and why it is needed. | An SSID needs Location Services; `AXPress` on your own process deadlocks |
| Hammerspoon 2's API | Candidate for an upstream issue. Work around it locally *and* raise it. | `hs.canvas` reports no right-click, because mouse delivery is a SwiftUI `DragGesture` |

A macOS limitation is permanent and the workaround is the answer. A Hammerspoon 2 limitation
is someone's backlog item, and the workaround is a cost being paid until it is fixed — worth
raising even if the local workaround is fine, because the next person pays it too.

Signs the thing you just wrote is a workaround worth recording:

- it reimplements something the API looks like it should already do
- it reaches outside the process — a shell command, a Shortcut, a screen capture — for
  information the process could hold
- it depends on a coordinate, a title, or a delay, instead of an identifier
- its comment begins by explaining why the obvious call does not work

**Before filing anything upstream, read `AI_POLICY.md` in the Hammerspoon 2 repository.** It
is strict and it binds outside contributors:

- all AI usage must be disclosed, naming the tool and the extent
- the human must fully understand the code, unaided, before contributing
- AI-drafted issues must be reviewed *and edited* by a human; the policy calls out verbosity
  and noise specifically

So an issue may be drafted here, but it is not ready to file until it has been cut down and
understood. Check for an existing issue first, and state only what has been verified — do not
claim a behaviour is a regression from Hammerspoon 1 without having checked Hammerspoon 1.

**Every draft ends with an `## AI disclosure` section.** It is the first requirement in the
policy, and a draft without one is not ready to file. Name the tool and the model, say what
the AI actually did, and say that a human reviewed and edited it. The extent has to be
accurate: if a measurement needed a hand on the mouse or the keyboard, say so, and do not
claim work that was not done. Use this format:

```markdown
## AI disclosure

Drafted with Claude Code (Claude Opus 5), which read the `hs.menubar` source for the file and
line references cited above, set up the click test, and read its results back over `hs.ipc`.
The three clicks themselves were made by hand. I reviewed and edited this before filing, as
`AI_POLICY.md` requires.
```

The body of a draft is written in the voice of whoever files it, so "I" there is the human,
not the AI. The disclosure is where the AI's part is stated.

## Development Tips

1. **Console Logging:** Use `console.log()` for debugging
2. **Null Checks:** Always check if applications/windows exist before accessing properties
3. **Error Handling:** The API may return `null` for missing resources
4. **Configuration File:** `init.js` in the Hammerspoon 2 configuration directory is the main
   entry point. A Spoon must not assume where that directory is or what else the user keeps in it.
5. **Reload Config:** Reload configuration after making changes to see updates

## Example: Complete Window Listing Function

```javascript
function windowsList() {
    const windows = hs.window.allWindows();
    console.log(`\n=== Window List (${windows.length} windows) ===`);

    windows.forEach((win, index) => {
        const title = win.title || "(no title)";
        const appName = win.application ? win.application.name : "(unknown app)";
        const frame = win.frame;

        console.log(`\n[${index}] ${appName}: ${title}`);
        console.log(`    Position: (${frame.x}, ${frame.y})`);
        console.log(`    Size: ${frame.w} x ${frame.h}`);
    });

    console.log("\n=================================\n");
}

// Bind to hotkey
hs.hotkey.bind(hyper, "w", windowsList, null);
```

## Finding More Information

1. Start at the main index: https://cmsj.github.io/Hammerspoon2/index.html
2. Navigate to specific module documentation (e.g., hs.window.html)
3. Check type documentation for object properties (e.g., HSWindow.html)
4. The API is similar to original Hammerspoon - Lua examples can be adapted to JavaScript
