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

How a published Spoon is laid out, what it may contain, how it uses other Spoons, what users
download, how screenshots are made, and how versions and releases work (including
`minimumHSVersion`) are in `doc/publishing.md`. Read it before adding or changing a Spoon's files,
its `spoon.json`, its readme's images, or before a release.

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

## Naming and writing

The naming conventions (camelCase, subject first and action last, commands named after their
functions, the `_<name>` exception) and the writing rules for comments, readmes, issue drafts and
conversation are in `doc/style.md`. Read it before writing or reviewing code or any text.

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
