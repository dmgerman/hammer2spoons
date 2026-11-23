// hs_window-gt — window placement, movement and resizing, and an undo history.
//
// Every window operation lives here rather than in init.js, because undo needs one place
// through which all of them pass.
//
// The history works like Emacs's winner-mode. It is a ring of past positions, with
// consecutive identical ones stored once. Each undo goes one position further back through
// the ring without removing anything from it, and redo returns the window to where it was
// before the first of those undos. It differs in being per window rather than per layout: an operation
// moving two windows records one entry for each, and undoing it takes two.
//
// Every change this Spoon makes to a window's frame goes through frameSet(), which records
// where the window was before moving it. A window moved by other code, or by hand, is not
// recorded as it moves. Moving by hand is recovered afterwards: before changing a window,
// frameSet() compares where it is with where this Spoon last put it. If they differ, the
// window was moved in between, and both positions go on the ring. Undo then returns to where
// it was left, and undo again to where the last command had put it.
//
// The Spoon needs hs_windowfilter-gt and hs_menu-gt, and loads neither itself: the user's
// configuration loads them first. hs_windowfilter-gt's events report which window was
// focused before the current one, when a window closes, and when the isolation panels have
// to be redrawn. hs_menu-gt displays the window menu.

// MARK: - User-configurable settings

const config = {
    // Positions remembered per window, oldest discarded. winner-ring-size is 200.
    historySize: 200,

    // Isolation dims everything except the focused window. Hammerspoon 1 used
    // hs.window.highlight, which Hammerspoon 2 does not have.
    isolationColor: "#000000",
    isolationOpacity: 0.85,

    // The ring drawn around the pointer after it is moved, so it can be found again. Its
    // size is the diameter, in pixels, and its width the thickness of the line.
    // mouseHighlightSeconds is how long the ring is displayed. The ring ignores mouse events,
    // so a click inside it reaches the window underneath while it is displayed.
    mouseHighlightColor: "#FF0000",
    mouseHighlightSize: 60,
    mouseHighlightWidth: 4,
    mouseHighlightSeconds: 0.5,

    // Where screenshot() writes. The pasteboard copy is usually the one that gets used, so
    // this is somewhere to find the file afterwards rather than somewhere to keep it.
    screenshotDir: "/tmp",
    // Seconds the path stays on screen after a capture.
    screenshotAlertSeconds: 3,

    // Windows attached to number keys. keyToWindowAttach() binds one of attachKeys, with
    // these modifiers, to focus the window it was called on. Modifiers are named as
    // hs.hotkey takes them: "cmd", "alt", "ctrl", "shift".
    //
    // 0 is not among the keys because alt-0 is what invokes the attaching, and attaching a
    // window to it would replace that binding.
    attachModifiers: ["alt"],
    attachKeys: "123456789",
    // Seconds to wait for the number key after keyToWindowAttach() is called without one. The wait
    // ends early on Escape, or on any key that is not a digit.
    attachKeyWait: 5,
    // Where the attachments are kept, so that start() can attach the same windows again
    // after Hammerspoon 2 is reloaded or restarted.
    attachFile: `${hs.appinfo.configDir}/logs/window-keys.json`,

    // Seconds after focusing a window before asserting again that it is its application's
    // main window. See windowFocus() for the measurements. 0 switches the second assertion
    // off, which loses windows on a screen other than the one in use.
    focusReassertDelay: 0.3,

    // Seconds windowToScreenMove() waits for a window to leave fullscreen before
    // giving up. A window measured on 2026-11-21 left it within 0.1 s.
    fullscreenLeaveWait: 3
}

// MARK: - State

// Window id -> { ring, undoSteps, current, applied, unmaximized, unmaximizedV, unmaximizedH, onScreen }
//   ring          earlier positions, oldest first
//   undoSteps     how many positions the current series of undos has gone back, or null
//   current       where the window was before that series began, which redo returns it to
//   applied       where we last put the window, for spotting a move we did not make
//   unmaximized   size to go back to when maximize is pressed a second time
//   unmaximizedV  size to go back to when verticalMaximize is pressed a second time
//   unmaximizedH  size to go back to when horizontalMaximize is pressed a second time
//   onScreen      screen id -> the frame the window had when it last left that screen
//
// Keyed by id, not held on the window: hs.window.focusedWindow() returns a new object
// every call, so a property set on one is gone by the next lookup. The id is what persists.
// A window's record is dropped when hs_windowfilter-gt reports that the window has closed.
const history = new Map()

// Isolation: the dark panels on screen, whether isolation is on (which is not the same as
// there being panels — a window filling its only screen needs none), and a description of
// the panels currently drawn, so that an event which changes nothing draws nothing.
let isolationWindows = []
let isolationActive = false
let isolationLayout = null

// The ring drawn around the pointer, and the timer that takes it away. One at a time: a
// second move removes the first ring before drawing its own.
let highlightWindow = null
let highlightTimer = null

// The position mouseWindowCenterNext() reached in the list of windows, and that list, so that
// a changed list starts again from the beginning. See that function for why it cannot
// just take the second window every time.
let mouseNextIndex = 0
let mouseNextOrder = ""

// The filter created in hs_windowfilter-gt by start(), and removed by stop(). It accepts
// every window the tracker holds. Its events update the focus history, remove the history
// of closed windows, and redraw the isolation panels.
let windowFilter = null

// Window ids, for windowPrevious(): what is focused now, and what was before it. Updated on
// every windowFocused event, so a change between two windows of one application counts.
let currentFocusedId = null
let previousFocusedId = null

// The window windowFocus() will assert as main again when its delay runs out. Replaced by
// each call, so an older assertion cannot undo a newer window choice.
let focusReassertFor = null

// MARK: - Helpers

// For the message given when hs_windowfilter-gt is not loaded.
const SPOON_NAME = "hs_window-gt"
const DOCUMENTATION = "https://github.com/dmgerman/hammer2spoons/tree/main/Spoons"

/**
 * The Spoon `name`, which this Spoon cannot work without. Throws, naming the Spoon and
 * referring to its documentation, when it is not loaded.
 */
function spoonRequired(name) {
    const spoon = hs.spoons[name]
    if (spoon) return spoon
    throw new Error(`${SPOON_NAME} needs ${name}, which is not loaded. ` +
        `See ${DOCUMENTATION}/${name}.spoon2`)
}

function alert(message) {
    hs.ui.alert(message).duration(2).show()
}

/**
 * Every window of every ordinary application.
 *
 * Windows of accessory applications, such as Notification Centre, are left out.
 * hs.window.allWindows() measured 100 to 120 ms for 27 such windows on 2026-10-24. That was
 * faster than asking each application for its windows, which took about 200 ms. Asking
 * hs_windowfilter-gt costs about 1 ms, so anything that runs often uses filterWindows().
 *
 * Ordering is by application rather than front to back, so a caller that needs the order
 * uses hs.window.orderedWindows().
 */
function allApplicationWindows() {
    return hs.window.allWindows().filter((window) => {
        const application = window.application
        return application !== null && application.kind === "standard"
    })
}

/**
 * The windows hs_windowfilter-gt holds, as returned by this Spoon's filter.
 *
 * They come in the order the tracker first saw them, which is stable but means nothing about
 * use or position. It suits going through every window in turn, as mouseWindowCenterNext()
 * does. It does not give "the previous window": that is what currentFocusedId and previousFocusedId
 * are for.
 */
function filterWindows() {
    return windowFilter ? windowFilter.windows() : []
}

function focused() {
    return hs.window.focusedWindow()
}

/**
 * Focus a window and bring its application forward.
 *
 * window.focus() does most of the job since Hammerspoon 2 issue #228 was fixed: it makes the
 * window its application's main window and then brings the application to the front with
 * only that window raised, so the application's other windows keep their place. It also
 * returns whether that worked, where before it returned true even when nothing moved.
 *
 * window.raise() is still needed for the case of two windows of one application in different
 * spaces, one of them full screen. Full screen puts a window in a space of its own, and the
 * only thing that makes macOS leave a space is an application coming forward. When the
 * window being left and the window being asked for belong to the same application, that
 * application is already frontmost, so the activation moves nothing, and setting AXMain on a
 * window in another space does not either: focus() returns true, hs.window.focusedWindow()
 * reports the new window, and the screen still shows the old one. AXRaise does cross the
 * space boundary, which is what raise() performs.
 *
 * The second assertion, after config.focusReassertDelay, is a workaround. The application
 * answers the activation after focus() has returned, and can choose its own main window when
 * it does: the window on the screen in use rather than the one that was asked for. It stays
 * until Hammerspoon 2's focus() handles this for every application. Upstream does the same
 * thing for Finder windows inside focus() itself, on the same 0.3 s, and cancels a pending
 * retry when a newer window is asked for. This does both for every application, because
 * Chrome needs it too.
 *
 * Measured on 2026-10-08, asking for a Chrome window on the external screen while the
 * keyboard focus was on the built-in display, four trials each, reading
 * hs.window.focusedWindow() 1.2s afterwards:
 *
 *   focus() + raise()                                     0/4 and 3/4 in two runs
 *   focus() + raise(), becomeMain() + raise() at 0.3s      4/4 and 4/4
 *   AXFrontmost + focus() + raise(), as before #228        0/4
 *
 * The misses put a different window of the right application in front. The variance between
 * the two runs of the first row is why the second assertion is unconditional rather than
 * applied only when the first is seen to have failed.
 *
 * @param {object} window The window to focus.
 * @returns {boolean} Whether the window accepted focus.
 */
function _windowFocus(window) {
    if (!window) return false

    const before = screenWindowIdsRecord()
    const accepted = window.focus()
    window.raise()

    // Dropped if another window is asked for first, so the assertion cannot undo a newer
    // choice.
    focusReassertFor = window.id
    hs.timer.doAfter(Math.max(config.focusReassertDelay, FOCUS_SETTLE_SECONDS), () => {
        if (focusReassertFor !== window.id) return
        focusReassertFor = null
        const after = screenWindowIdsRecord()
        // A window closed in the meantime is left alone: becomeMain() on it makes Hammerspoon 2
        // log "Failed to make window main" with AXError -25202, an invalid element (seen during
        // the tests on 2026-11-23, where a test closes its window soon after focusing it). The
        // window is looked for in the order just read, which costs nothing more. A window whose
        // screen could not be read counts as open.
        const open = after.size < hs.screen.all().length ||
            [...after.values()].some((ids) => ids.includes(window.id))
        if (!open) return
        if (config.focusReassertDelay > 0) {
            window.becomeMain()
            window.raise()
        }
        coveredFrontWindowsRaise(window, before, after)
    })

    return accepted
}

// How long an application takes to answer its activation, after which the windows it brought
// forward are in place. The same 0.3 s as Hammerspoon 2's own focus() waits.
const FOCUS_SETTLE_SECONDS = 0.3

/**
 * The ids of the windows on each screen, front to back, by screen id, from the space each screen
 * shows. Reading them costs about 0.04 s for three screens, against about 0.1 s for
 * hs.window.allWindows(), so windowFocus() can afford it on every switch.
 */
function screenWindowIdsRecord() {
    const record = new Map()
    for (const screen of hs.screen.all()) {
        try {
            const space = (screen.spaces || []).find((s) => s.isCurrent)
            if (space) record.set(screen.id, space.windowIDs())
        } catch (e) {
            // A screen whose space cannot be read is left out, and is not checked afterwards.
        }
    }
    return record
}

/**
 * Raise again the window that was in front on another screen, when the activation of the focused
 * window's application covered it with another of that application's windows.
 *
 * When an application is activated, it brings forward the window it last had as its main window,
 * even when another of its windows has been asked for. Measured on 2026-11-23 with Google Chrome
 * windows on two screens and a Skim window in front of one of them: focusing the Chrome window
 * on the other screen brought the first Chrome window in front of the Skim window, where it
 * stayed after the focus went to the chosen window (hammer2spoons-ei6.50). raise() brings the
 * covered window forward again without activating its application, so the focus stays where it
 * is.
 *
 * @param {object} window The window that was focused.
 * @param {Map} before The record of screenWindowIdsRecord() taken before focusing it.
 * @param {Map} after The record taken once the application has answered its activation.
 */
function coveredFrontWindowsRaise(window, before, after) {
    const windowScreen = window.screen
    const changed = []
    for (const [screenId, ids] of before) {
        if (windowScreen && screenId === windowScreen.id) continue
        const now = after.get(screenId)
        if (!now || ids.length === 0 || now.length === 0 || now[0] === ids[0]) continue
        changed.push({ previous: ids[0], current: now[0] })
    }
    if (changed.length === 0) return

    // Only now are windows looked up, since nothing else needs them.
    const byId = new Map(hs.window.allWindows().map((w) => [w.id, w]))
    const pid = window.pid
    for (const { previous, current } of changed) {
        const covering = byId.get(current)
        const covered = byId.get(previous)
        if (!covering || !covered || covering.id === window.id || covering.pid !== pid || covered.pid === pid) continue
        try {
            covered.raise()
        } catch (e) {
            // A window that cannot be raised stays where it is.
        }
    }
}

/** Whether two frames describe the same rectangle, within a pixel. */
function sameFrame(a, b) {
    if (!a || !b) return false
    return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 &&
        Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1
}

function copyFrame(f) {
    return new HSRect(f.x, f.y, f.w, f.h)
}

function entryFor(win) {
    let entry = history.get(win.id)
    if (!entry) {
        entry = {
            ring: [], undoSteps: null, applied: null,
            unmaximized: null, unmaximizedV: null, unmaximizedH: null,
            onScreen: new Map()
        }
        history.set(win.id, entry)
    }
    return entry
}

// MARK: - The history

/**
 * Record where a window is, just before this Spoon moves it. Called by frameSet().
 */
function record(win, current) {
    if (!win || current === undefined || current === null) return

    const entry = entryFor(win)

    // A new move ends any series of undos: the ring is being added to again, so there is no
    // series left for redo to cancel.
    entry.undoSteps = null

    // Where we last put it differs from where it is, so it was moved by hand in between.
    // Both positions are worth returning to, so both go on: the one we set, then the one
    // it was actually left at.
    if (entry.applied && !sameFrame(entry.applied, current)) {
        push(entry, entry.applied)
    }
    push(entry, current)
}

function push(entry, frame) {
    const last = entry.ring[entry.ring.length - 1]
    // winner-insert-if-new: an identical position replaces rather than repeats.
    if (last && sameFrame(last, frame)) return
    entry.ring.push(copyFrame(frame))
    if (entry.ring.length > config.historySize) entry.ring.shift()
}

/**
 * Move a window, recording where it was so that undo can return it there.
 *
 * Every operation in this Spoon sets a frame through this, so the history holds exactly the
 * moves this Spoon made, together with any move made in between by hand or by other code,
 * which record() recovers by comparing the window with `applied`.
 */
function frameSet(win, frame) {
    record(win, win.frame)
    win.frame = frame
    entryFor(win).applied = copyFrame(win.frame)
}

/** Set a frame without recording it, for undo and redo putting a window back. */
function restore(win, frame) {
    win.frame = copyFrame(frame)
    entryFor(win).applied = copyFrame(frame)
}

/**
 * Return a window to its previous position.
 *
 * Each further call goes one position further back, as winner-undo does, rather than
 * undoing the call before it.
 */
function _undo(win) {
    const window = win || focused()
    if (!window) return module.exports

    const entry = entryFor(window)
    if (!entry.ring.length) {
        alert("No window history")
        return module.exports
    }

    // The first undo of a series: keep where the window is, so that redo can return it there.
    if (entry.undoSteps === null) {
        entry.undoSteps = 0
        entry.current = copyFrame(window.frame)
        // A hand movement since the last command is itself a position to return to.
        if (entry.applied && !sameFrame(entry.applied, entry.current)) {
            push(entry, entry.applied)
        }
    }

    if (entry.undoSteps >= entry.ring.length) {
        alert("No further window history")
        return module.exports
    }

    entry.undoSteps += 1
    restore(window, entry.ring[entry.ring.length - entry.undoSteps])
    return module.exports
}

/**
 * Return a window to where it was before the first of a series of `undo` calls.
 *
 * It does something only straight after undoing, as winner-redo does.
 */
function _redo(win) {
    const window = win || focused()
    if (!window) return module.exports

    const entry = entryFor(window)
    if (entry.undoSteps === null || !entry.current) {
        alert("Nothing to redo")
        return module.exports
    }

    restore(window, entry.current)
    entry.undoSteps = null
    return module.exports
}

/** How many positions are remembered for a window. */
function _historyDepth(win) {
    const window = win || focused()
    if (!window) return 0
    const entry = history.get(window.id)
    return entry ? entry.ring.length : 0
}

/** Forget every window's history. */
function historyClear() {
    history.clear()
    return module.exports
}

// MARK: - Placing a window in a grid
//
// place() takes a grid and a cell within it, which covers halves, thirds and quadrants:
// place(win, {cols: 3}, {col: 1}) is the middle third.

function place(win, grid, cell) {
    const window = win || focused()
    if (!window) return false

    const screen = screenFrameOf(window)
    if (!screen) return false
    const cols = grid.cols === undefined ? 1 : grid.cols
    const rows = grid.rows === undefined ? 1 : grid.rows
    const col = cell.col === undefined ? 0 : cell.col
    const row = cell.row === undefined ? 0 : cell.row
    const colSpan = cell.colSpan === undefined ? 1 : cell.colSpan
    const rowSpan = cell.rowSpan === undefined ? 1 : cell.rowSpan

    const cellWidth = screen.w / cols
    const cellHeight = screen.h / rows

    frameSet(window, new HSRect(
        screen.x + col * cellWidth,
        screen.y + row * cellHeight,
        colSpan * cellWidth,
        rowSpan * cellHeight
    ))
    return true
}

/** Whether a window already fills its screen. */
function _isMaximized(win) {
    const window = win || focused()
    if (!window) return false
    const screen = screenFrameOf(window)
    return screen ? sameFrame(window.frame, screen) : false
}

/**
 * Fill the screen with a window, or put it back if it already fills it.
 *
 * The size to go back to is the one it had when it was maximized, kept against the window's
 * id. A window maximized by some other means — dragged to fill the screen, or maximized
 * before this Spoon started — has nothing recorded, and an alert says so.
 */
function _maximize(win) {
    const window = win || focused()
    if (!window) return false

    const entry = entryFor(window)

    if (_isMaximized(window)) {
        if (!entry.unmaximized) {
            alert("No earlier size to go back to")
            return false
        }
        frameSet(window, copyFrame(entry.unmaximized))
        entry.unmaximized = null
        return true
    }

    entry.unmaximized = copyFrame(window.frame)
    return place(window, {}, {})
}

const _leftHalf = (win) => place(win, { cols: 2 }, { col: 0 })
const _rightHalf = (win) => place(win, { cols: 2 }, { col: 1 })
const _topHalf = (win) => place(win, { rows: 2 }, { row: 0 })
const _bottomHalf = (win) => place(win, { rows: 2 }, { row: 1 })
const _leftThird = (win) => place(win, { cols: 3 }, { col: 0 })
const _centerThird = (win) => place(win, { cols: 3 }, { col: 1 })
const _rightThird = (win) => place(win, { cols: 3 }, { col: 2 })
const _leftTwoThirds = (win) => place(win, { cols: 3 }, { col: 0, colSpan: 2 })
const _rightTwoThirds = (win) => place(win, { cols: 3 }, { col: 1, colSpan: 2 })
const _topLeft = (win) => place(win, { cols: 2, rows: 2 }, { col: 0, row: 0 })
const _topRight = (win) => place(win, { cols: 2, rows: 2 }, { col: 1, row: 0 })
const _bottomLeft = (win) => place(win, { cols: 2, rows: 2 }, { col: 0, row: 1 })
const _bottomRight = (win) => place(win, { cols: 2, rows: 2 }, { col: 1, row: 1 })

/** Centre a window on its screen, keeping its size. */
function _center(win) {
    const window = win || focused()
    if (!window) return false

    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame
    frameSet(window, new HSRect(
        screen.x + (screen.w - frame.w) / 2,
        screen.y + (screen.h - frame.h) / 2,
        frame.w,
        frame.h
    ))
    return true
}

// MARK: - Resizing in place

/** Whether a window already fills its screen's height. */
function _isVerticallyMaximized(win) {
    const window = win || focused()
    if (!window) return false
    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame
    return Math.abs(frame.y - screen.y) < 1 && Math.abs(frame.h - screen.h) < 1
}

/** Whether a window already fills its screen's width. */
function _isHorizontallyMaximized(win) {
    const window = win || focused()
    if (!window) return false
    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame
    return Math.abs(frame.x - screen.x) < 1 && Math.abs(frame.w - screen.w) < 1
}

/**
 * Fill the screen's height, keeping width and horizontal position, or put the height back
 * if it already fills it.
 *
 * Only the vertical pair is restored, so a horizontal move made while tall is kept. As with
 * maximize(), a window that filled the height by some other means has nothing recorded, and
 * an alert says so.
 */
function _verticalMaximize(win) {
    const window = win || focused()
    if (!window) return false

    const entry = entryFor(window)
    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame

    if (_isVerticallyMaximized(window)) {
        if (!entry.unmaximizedV) {
            alert("No earlier height to go back to")
            return false
        }
        frameSet(window, new HSRect(frame.x, entry.unmaximizedV.y, frame.w, entry.unmaximizedV.h))
        entry.unmaximizedV = null
        return true
    }

    entry.unmaximizedV = copyFrame(frame)
    frameSet(window, new HSRect(frame.x, screen.y, frame.w, screen.h))
    return true
}

/**
 * Fill the screen's width, keeping height and vertical position, or put the width back
 * if it already fills it.
 *
 * Only the horizontal pair is restored, so a vertical move made while wide is kept.
 */
function _horizontalMaximize(win) {
    const window = win || focused()
    if (!window) return false

    const entry = entryFor(window)
    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame

    if (_isHorizontallyMaximized(window)) {
        if (!entry.unmaximizedH) {
            alert("No earlier width to go back to")
            return false
        }
        frameSet(window, new HSRect(entry.unmaximizedH.x, frame.y, entry.unmaximizedH.w, frame.h))
        entry.unmaximizedH = null
        return true
    }

    entry.unmaximizedH = copyFrame(frame)
    frameSet(window, new HSRect(screen.x, frame.y, screen.w, frame.h))
    return true
}

/** Halve the height, keeping the top edge. */
function _halfHeight(win) {
    const window = win || focused()
    if (!window) return false
    const frame = window.frame
    frameSet(window, new HSRect(frame.x, frame.y, frame.w, frame.h / 2))
    return true
}

/** Halve the width, keeping the left edge. */
function _halfWidth(win) {
    const window = win || focused()
    if (!window) return false
    const frame = window.frame
    frameSet(window, new HSRect(frame.x, frame.y, frame.w / 2, frame.h))
    return true
}

/**
 * Set the width to a fraction of the screen, keeping height and position.
 *
 * @param {number} denominator 2 for half the screen's width, 3 for a third, and so on.
 */
function _fractionWidth(denominator, win) {
    const window = win || focused()
    if (!window) return false

    const n = Number(denominator)
    if (!Number.isFinite(n) || n < 1) {
        alert(`Illegal fraction [${denominator}]`)
        return false
    }

    const screen = screenFrameOf(window)
    if (!screen) return false
    const frame = window.frame
    frameSet(window, new HSRect(frame.x, frame.y, screen.w / n, frame.h))
    return true
}

/** Move a window by its own width or height, without resizing it. */
function _moveByOwnSize(direction, win) {
    const window = win || focused()
    if (!window) return false

    const frame = window.frame
    const deltas = {
        left: [-frame.w, 0],
        right: [frame.w, 0],
        up: [0, -frame.h],
        down: [0, frame.h]
    }
    const delta = deltas[direction]
    if (!delta) {
        alert(`Illegal direction [${direction}]`)
        return false
    }

    frameSet(window, new HSRect(frame.x + delta[0], frame.y + delta[1], frame.w, frame.h))
    return true
}

// MARK: - Screens

function screenList() {
    // hs.screen.all(), not allScreens() as in Hammerspoon 1.
    return hs.screen.all()
}

/**
 * The usable frame of the screen a window is on, or null when it cannot be told.
 *
 * window.screen is null for a window in another space, so every operation reads it through
 * screenOfWindow(), which falls back to the screen holding the window's centre, and does
 * nothing when even that is unknown.
 */
function screenFrameOf(window) {
    const screen = screenOfWindow(window)
    return screen ? screen.frame : null
}

// MARK: - Choosing a window or a screen
//
// For the operations that need a second window or a target screen and are not given one.
// The chooser is hs_interactive-gt's, through its readers, so that every Spoon asks for a
// window or a screen in the same way. Each function returns a promise of what was chosen, or
// of null when the chooser was dismissed or offered nothing. The window the operation acts on
// is read before the chooser opens, because the chooser takes the keyboard focus.

/**
 * Choose a window other than `window`.
 *
 * @param {object} window The window the operation acts on, left out of the choices.
 * @param {string} placeholder Shown in the chooser's empty search field.
 * @returns {Promise<object>} The chosen HSWindow, or null.
 */
function windowChoose(window, placeholder) {
    const interactive = spoonRequired("hs_interactive-gt")
    return interactive.readerRun(interactive.readers.window.prompted,
        { includeCurrent: false, placeholder: placeholder },
        { window: window, application: window.application, screen: screenOfWindow(window) })
}

/**
 * Choose a screen for a window to move to: any screen but its own, and none showing a
 * fullscreen window, which would hide it.
 *
 * @param {object} window The window that will move.
 * @returns {Promise<object>} The chosen HSScreen, or null.
 */
function screenChoose(window) {
    const interactive = spoonRequired("hs_interactive-gt")
    return interactive.readerRun(interactive.readers.screen.prompted,
        { includeCurrent: false, includeFullscreen: false, placeholder: "Screen to move to" },
        { window: window, application: window.application, screen: screenOfWindow(window) })
}

/**
 * The ids of the screens showing a fullscreen window.
 *
 * Hammerspoon 1 asked hs.spaces for the type of the space on each screen. Hammerspoon 2
 * has no spaces module, and cannot say which Space a window is on. hs.window.allWindows()
 * includes windows on other Spaces, so a fullscreen window on a Space that is not showing
 * would count as well. Instead, the window at the centre of each screen is asked whether
 * it is fullscreen: the hit test only finds windows that are on the visible Space.
 *
 * @returns {Set<number>}
 */
function fullscreenScreenIds() {
    const ids = new Set()
    for (const screen of screenList()) {
        const f = screen.fullFrame
        const window = hs.window.windowAtPoint(new HSPoint(f.x + f.w / 2, f.y + f.h / 2))
        if (window && window.isFullscreen) ids.add(screen.id)
    }
    return ids
}

/** Whether a screen is showing a fullscreen window. */
function _screenHasFullscreenWindow(screen) {
    return screen ? fullscreenScreenIds().has(screen.id) : false
}

/**
 * Move a window to another screen, keeping its place within the screen. A fullscreen window
 * is fullscreen again on the new screen.
 *
 * Screens showing a fullscreen window are skipped: a window moved there would be behind the
 * fullscreen one and never visible.
 *
 * @param {string|object} [target] "next" or "previous", an HSScreen, or nothing to choose
 *        the screen in a chooser.
 * @param {object} [win] The window. Defaults to the focused one.
 * @returns {boolean|Promise<boolean>} Whether the window moved. A promise when a chooser was
 *          shown, or when the window is fullscreen.
 */
function _windowToScreenMove(target, win) {
    const window = win || focused()
    if (!window) return false

    const current = screenOfWindow(window)
    if (!current) return false

    if (target === undefined || target === null) {
        return screenChoose(window).then((screen) => screen ? windowToScreenPut(window, current, screen) : null)
    }
    if (typeof target === "object") {
        if (target.id === current.id) return false
        if (fullscreenScreenIds().has(target.id)) {
            alert("That screen is showing a fullscreen window")
            return false
        }
        return windowToScreenPut(window, current, target)
    }

    const screen = screenWithoutFullscreenFind(current, target)
    return screen ? windowToScreenPut(window, current, screen) : false
}

/** Put a window on another screen, through fullscreenWindowOnScreenPlace() when it is fullscreen. */
function windowToScreenPut(window, current, target) {
    return window.isFullscreen
        ? fullscreenWindowOnScreenPlace(window, current, target)
        : windowOnScreenPlace(window, current, target)
}

/**
 * The screen after or before `current`, in the order of hs.screen.all(), that is not showing a
 * fullscreen window. An alert gives the reason when there is none.
 *
 * @param {object} current The screen to start from, which is never returned.
 * @param {string} direction "next" or "previous".
 * @returns {object} The HSScreen, or null.
 */
function screenWithoutFullscreenFind(current, direction) {
    const screens = screenList()
    if (screens.length < 2) {
        alert("Only one screen")
        return null
    }
    const index = screens.findIndex((s) => s.id === current.id)
    const step = direction === "previous" ? -1 : 1

    // Go through the screens in order until one without a fullscreen window is found,
    // stopping before coming back to the screen the window is already on.
    const occupied = fullscreenScreenIds()
    for (let n = 1; n < screens.length; n++) {
        const position = (((index + step * n) % screens.length) + screens.length) % screens.length
        const candidate = screens[position]
        if (!occupied.has(candidate.id)) return candidate
    }
    alert("Every other screen has a fullscreen window")
    return null
}

/**
 * Put a window on another screen, where it was the last time it was there, or else at the
 * same relative place and size it has on its current screen.
 */
function windowOnScreenPlace(window, current, target) {
    const from = current.frame
    const to = target.frame
    const frame = window.frame
    const entry = entryFor(window)

    // Where the window sits now is what it should come back to. Scaling one way and back
    // does not return it: an application rounds a size to whole rows and columns, so a few
    // pixels are lost on each crossing.
    entry.onScreen.set(current.id, copyFrame(frame))

    // Where the window was when it last left the target screen, if it has been there and
    // has not been resized by hand since, which would make that stale.
    const remembered = sameFrame(entry.applied, frame) ? entry.onScreen.get(target.id) : null

    // Otherwise keep the window where it sat within its screen, proportionally, so a
    // window on the right of one display arrives on the right of the next.
    frameSet(window, remembered || new HSRect(
        to.x + ((frame.x - from.x) / from.w) * to.w,
        to.y + ((frame.y - from.y) / from.h) * to.h,
        frame.w * (to.w / from.w),
        frame.h * (to.h / from.h)
    ))
    return true
}

/**
 * The move fullscreenWindowOnScreenPlace() is waiting to make, or null. Only one runs at a
 * time, and stop() ends it.
 */
let fullscreenMove = null

/** End the waiting move, resolving its promise with `moved`. */
function fullscreenMoveEnd(moved) {
    if (!fullscreenMove) return
    fullscreenMove.timer.stop()
    const resolve = fullscreenMove.resolve
    fullscreenMove = null
    resolve(moved)
}

/**
 * Put a fullscreen window on another screen, where it is fullscreen again.
 *
 * macOS refuses to move a fullscreen window, so the window leaves fullscreen, is placed by
 * windowOnScreenPlace(), and enters fullscreen on the new screen. Its isFullscreen attribute
 * turns false within about 0.1 s of leaving, before the animation ends, and a move made at
 * that point holds. Measured on 2026-11-21 with a TextEdit window between two displays: the
 * whole move took about 0.25 s, and the window was fullscreen on the new screen every time.
 * No fixed delay is needed, so the attribute is polled until it changes, and the move is
 * given up after config.fullscreenLeaveWait seconds.
 *
 * @returns {boolean|Promise<boolean>} A promise of whether the window moved, or false when
 *          another fullscreen window is still being moved.
 */
function fullscreenWindowOnScreenPlace(window, current, target) {
    if (fullscreenMove) {
        alert("A fullscreen window is already being moved")
        return false
    }

    return new Promise((resolve) => {
        const started = Date.now()
        window.toggleFullscreen()
        fullscreenMove = {
            resolve: resolve,
            timer: hs.timer.doEvery(0.05, () => {
                if (!fullscreenMove) return
                if (window.isFullscreen) {
                    if (Date.now() - started > config.fullscreenLeaveWait * 1000) {
                        alert("The window did not leave fullscreen")
                        fullscreenMoveEnd(false)
                    }
                    return
                }
                windowOnScreenPlace(window, current, target)
                window.toggleFullscreen()
                fullscreenMoveEnd(true)
            })
        }
    })
}

// MARK: - Windows among themselves

/**
 * Whether two windows can be moved around one another.
 *
 * macOS does not treat a fullscreen window as a window with a frame. It refuses to move
 * one, and a window sent to a screen a fullscreen window occupies is taken into that
 * window's space, after which it is not listed by hs.window.allWindows() nor by its own
 * application. Neither is worth working around, so both are refused here.
 *
 * @param {HSWindow[]} windows  The windows taking part.
 * @param {object[]} destinations  The screens windows are arriving on.
 */
function movable(windows, destinations) {
    if (windows.some((w) => w.isFullscreen)) {
        alert("A fullscreen window cannot be moved")
        return false
    }

    // Nothing is arriving on a screen when the windows stay where they are, so there is no
    // need to ask fullscreenScreenIds() in that case.
    if (!destinations.length) return true

    const occupied = fullscreenScreenIds()
    if (destinations.some((s) => s && occupied.has(s.id))) {
        alert("That screen is showing a fullscreen window")
        return false
    }
    return true
}

/**
 * Put two windows side by side on this window's screen: the other one on the left half,
 * this one on the right.
 *
 * Without `other`, a chooser of the other windows is shown, and the window is the one that
 * was focused before it opened. Returns a promise in that case.
 */
function _tileWith(other, win) {
    const window = win || focused()
    if (!window) return false
    if (!other) {
        return windowChoose(window, "Window to tile with").then((chosen) => chosen ? _tileWith(chosen, window) : null)
    }
    if (other.id === window.id) {
        alert("A window cannot be tiled with itself")
        return false
    }
    // The other window arrives on this window's screen, unless it is already there.
    const mine = screenOfWindow(window)
    const theirs = screenOfWindow(other)
    if (!mine) return false
    const crossing = theirs && mine.id !== theirs.id
    if (!movable([window, other], crossing ? [mine] : [])) return false

    // Both halves are of this window's screen, so the other window may be crossing to it.
    const screen = mine.frame
    frameSet(other, new HSRect(screen.x, screen.y, screen.w / 2, screen.h))
    place(window, { cols: 2 }, { col: 1 })

    // Bring both windows forward, the other one first so that this one ends up in front
    // with the keyboard focus. Choosing the other window took focus away from this one.
    _windowFocus(other)
    _windowFocus(window)
    return true
}

/**
 * Exchange two windows' positions and sizes, across screens as well as within one.
 *
 * Without `other`, a chooser of the other windows is shown, and the window is the one that
 * was focused before it opened. Returns a promise in that case.
 */
function _windowWithWindowSwap(other, win) {
    const window = win || focused()
    if (!window) return false
    if (!other) {
        return windowChoose(window, "Window to swap with").then((chosen) => chosen ? _windowWithWindowSwap(chosen, window) : null)
    }
    if (other.id === window.id) {
        alert("A window cannot be swapped with itself")
        return false
    }
    // Each window arrives on the other's screen, unless they share one.
    const myScreen = screenOfWindow(window)
    const theirScreen = screenOfWindow(other)
    const crossing = myScreen && theirScreen && myScreen.id !== theirScreen.id
    if (!movable([window, other], crossing ? [myScreen, theirScreen] : [])) return false

    const mine = copyFrame(window.frame)
    const theirs = copyFrame(other.frame)

    frameSet(window, theirs)
    frameSet(other, mine)

    _windowFocus(window)
    return true
}

/** Swap this window's position and size with the window behind it. */
function _windowWithPreviousSwap(win) {
    const window = win || focused()
    if (!window) return false

    const other = hs.window.orderedWindows().find((w) => w.id !== window.id)
    if (!other) {
        alert("No other window")
        return false
    }
    return _windowWithWindowSwap(other, window)
}

/**
 * Focus the window that had focus before this one.
 *
 * The previous window is the one hs_windowfilter-gt last reported losing the focus, so a
 * change between two windows of one application counts. When none is known yet, or it has
 * closed, the window behind the focused one in hs.window.orderedWindows() is taken instead.
 */
function windowPrevious() {
    if (previousFocusedId !== null) {
        const still = filterWindows().find((w) => w.id === previousFocusedId)
        if (still) return _windowFocus(still)
    }

    const ordered = hs.window.orderedWindows()
    if (ordered.length < 2) {
        alert("No previous window")
        return false
    }
    return _windowFocus(ordered[1])
}

/** Send a window behind the others, by focusing the one under it. */
function _windowToBackSend(win) {
    const window = win || focused()
    if (!window) return false

    const ordered = hs.window.orderedWindows().filter((w) => w.id !== window.id)
    if (!ordered.length) {
        alert("No other window")
        return false
    }
    // Focusing every other window in reverse order leaves this one last.
    for (let i = ordered.length - 1; i >= 0; i--) ordered[i].focus()
    return true
}

// MARK: - The mouse
//
// hs.mouse.setAbsolutePosition takes two numbers, not a point. Its coordinates are the
// ones window frames are in — the origin at the top left of the primary screen, y
// increasing downwards — so a frame's centre can be passed as it stands.

/** Take away the ring around the pointer, if one is displayed. */
function mouseHighlightClear() {
    if (highlightTimer) {
        highlightTimer.stop()
        highlightTimer = null
    }
    if (highlightWindow) {
        highlightWindow.destroy()
        highlightWindow = null
    }
}

/**
 * Draw a ring around a point for `config.mouseHighlightSeconds`.
 *
 * The pointer has just moved a long distance at once, which makes it hard to find. The
 * ring shows where it is.
 *
 * A stroke and no fill: UICircle draws the fill instead of the stroke when both are given,
 * so a filled circle cannot be a ring. The window is a stroke-width larger than the circle,
 * since the line is centred on the circle's edge and half of it would otherwise be clipped.
 *
 * The ring ignores mouse events, so a click inside its square reaches the window
 * underneath rather than landing on the ring.
 *
 * @param {number} x Centre, in screen coordinates.
 * @param {number} y Centre, in screen coordinates.
 */
function mouseHighlight(x, y) {
    mouseHighlightClear()

    const diameter = config.mouseHighlightSize
    const width = config.mouseHighlightWidth
    const box = diameter + width
    const rect = toUIRect({ x: x - box / 2, y: y - box / 2, w: box, h: box })

    highlightWindow = hs.canvas.create({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })
        .level("status")
        // Clicks inside the ring reach whatever is underneath it.
        .ignoreMouseEvents(true)
        .behaviorList(["canJoinAllSpaces", "stationary"])
    highlightWindow.appendElements([{
        type: "circle",
        action: "stroke",
        strokeColor: canvasColor(config.mouseHighlightColor),
        strokeWidth: width,
        center: { x: rect.w / 2, y: rect.h / 2 },
        radius: diameter / 2
    }])
    highlightWindow.show()

    highlightTimer = hs.timer.doAfter(config.mouseHighlightSeconds, () => {
        highlightTimer = null
        mouseHighlightClear()
    })
}

/** Put the pointer at a point in screen coordinates, and ring it. */
function mouseMove(x, y) {
    hs.mouse.setAbsolutePosition(x, y)
    mouseHighlight(x, y)
    return true
}

/** Put the pointer in the middle of a window. */
function _mouseWindowCenter(win) {
    const window = win || focused()
    if (!window) return false
    const frame = window.frame
    return mouseMove(frame.x + frame.w / 2, frame.y + frame.h / 2)
}

/**
 * Put the pointer in the middle of the next window, advancing on each call.
 *
 * The windows are taken in the order hs_windowfilter-gt holds them, which changes only when
 * a window opens or closes. Moving the pointer focuses nothing, so the position in that order
 * is kept between calls. A new series starts at the window after the focused one.
 *
 * The series starts again whenever the set of windows differs from the last call, so it does not
 * carry an index into a list it no longer describes.
 *
 * Only standard windows on screen are included, so the pointer is never put on a
 * Notification Centre widget or the Finder's desktop. Which those are is read from the
 * state the tracker already holds, so no accessibility call is made.
 */
function mouseWindowCenterNext() {
    const records = windowFilter ? windowFilter.records() : []
    const ordered = records
        .filter((r) => r.state.standard && r.state.onScreen)
        .map((r) => r.window)
    if (ordered.length < 2) {
        alert("No other window")
        return false
    }

    const order = ordered.map((w) => w.id).join(",")
    if (order === mouseNextOrder) {
        mouseNextIndex = (mouseNextIndex + 1) % ordered.length
    } else {
        // -1 when nothing in the list is focused, which starts at the first window.
        mouseNextIndex = (ordered.findIndex((w) => w.id === currentFocusedId) + 1) % ordered.length
    }
    mouseNextOrder = order

    return _mouseWindowCenter(ordered[mouseNextIndex])
}

/**
 * Put the pointer in the middle of a screen.
 *
 * The focused window's screen, since that is the one being worked on, and the primary
 * screen when nothing is focused. fullFrame rather than frame: the middle of the display
 * itself, not of the area left over by the menu bar and the Dock.
 */
function _mouseScreenCenter(screen) {
    const window = focused()
    const target = screen || (window && window.screen) || hs.screen.primary()
    if (!target) return false
    const frame = target.fullFrame
    return mouseMove(frame.x + frame.w / 2, frame.y + frame.h / 2)
}

/**
 * Put the pointer in the middle of the next screen.
 *
 * Nothing is remembered between calls, unlike mouseWindowCenterNext: the pointer is moved
 * onto the screen, so the screen it is on is where the next call starts from. hs.screen.all()
 * keeps a stable order, so repeated calls go through the displays in turn and then start again.
 *
 * The screen under the pointer is the starting point rather than the focused window's. The
 * pointer is what is being moved, and after the first call the two are on different screens
 * anyway, since moving the pointer does not change which window has focus.
 */
function mouseScreenCenterNext() {
    const screens = hs.screen.all()
    if (screens.length < 2) {
        alert("Only one screen")
        return false
    }

    const here = hs.mouse.getCurrentScreen()
    const index = here ? screens.findIndex((s) => s.id === here.id) : -1
    // An unknown current screen gives -1, which starts at the first screen.
    return _mouseScreenCenter(screens[(index + 1) % screens.length])
}

// MARK: - Windows attached to number keys
//
// A window is attached to a digit, and that digit with config.attachModifiers focuses it
// from then on. Ported from wkeys_attach_current_window_to_key() in the Hammerspoon 1
// configuration, with two changes: attaching a digit that is already in use releases the
// old binding, which the v1 version left bound and holding its window; and the window is
// remembered by id and looked up when the key is pressed, so a window that has since been
// closed is reported rather than silently doing nothing.

// Digit -> {hotkey, id, title, bundleID}.
const attachedKeys = new Map()

// The number row: key code -> digit. hs.keycodes.map goes from a key's name to its code
// ("1" is 18), so this turns it round for the ten digits. It cannot be looked up by code
// directly: map[0] returns the entry for the name "0", which is the code of the digit 0 (29), not the
// key whose code is 0. Key codes are read rather than event.characters because characters
// are transformed by the modifiers: with Option held, 1 arrives as "\u00a1".
const DIGIT_BY_KEY_CODE = new Map([..."0123456789"].map((digit) => [hs.keycodes.map[digit], digit]))
const ESCAPE_KEY_CODE = hs.keycodes.map["escape"]

// The tap waiting for a number key, and the timer that gives up on it. One at a time.
let captureTap = null
let captureTimer = null

/** Stop waiting for a number key. */
function captureStop() {
    if (captureTap) {
        hs.eventtap.removeWatcher(captureTap)
        captureTap = null
    }
    if (captureTimer) {
        captureTimer.stop()
        captureTimer = null
    }
}

/**
 * Wait for one key press and report which digit it was.
 *
 * A tap rather than a dialog: a text prompt needs a window and a confirmation for one
 * character, and it takes the keyboard focus. This consumes the key it captures, so the digit
 * is not also typed into whatever is in front.
 *
 * The key is expected without a modifier. A modifier chord that is already bound is taken
 * by the hotkey before any tap receives it -- alt-3 would fire the window attached to 3 rather
 * than arriving here -- so the wait would simply time out.
 *
 * @param {function} report Called with the digit, or with null for Escape or a timeout, or
 *        with "" for a key that is not a digit.
 */
function captureDigit(report) {
    captureStop()

    captureTap = hs.eventtap.addWatcher([hs.eventtap.eventTypes.keyDown], (event) => {
        const code = event.keyCode
        captureStop()
        report(code === ESCAPE_KEY_CODE ? null : (DIGIT_BY_KEY_CODE.get(code) || ""))
        return hs.eventtap.consume
    }, false)

    if (!captureTap) {
        console.error("[hs_window-gt] could not watch for a key press")
        report(null)
        return false
    }

    captureTap.start()
    captureTimer = hs.timer.doAfter(config.attachKeyWait, () => {
        captureStop()
        report(null)
    })
    return true
}

/**
 * Release a number key, if a window is attached to it.
 *
 * Both halves of the attachment go: the hotkey, and the watcher that was waiting for the
 * window to close. Removing the watcher takes the same element, notification and listener
 * that added it, which is why the entry keeps all three.
 *
 * @param {string|number} key The digit.
 * @param {boolean} [destroyed] True when the window has gone, in which case the watcher is
 *        left alone: the observer goes with the element, so there is nothing to release.
 *        Calling hs.ax.off() for it would be harmless — it returns without doing anything
 *        when no watcher is registered for that element and notification — but pointless.
 */
function _keyDetach(key, destroyed) {
    if (!keyRelease(String(key), destroyed)) return false
    attachedKeysSave()
    return true
}

/**
 * Release a number key without updating config.attachFile.
 *
 * stop() uses this directly, so that reloading leaves the file as it was and start() can
 * attach the same windows again.
 */
function keyRelease(digit, destroyed) {
    const entry = attachedKeys.get(digit)
    if (!entry) return false

    if (!destroyed && entry.element && entry.onDestroyed) {
        hs.ax.off(entry.element, hs.ax.notificationTypes.uIElementDestroyed,
                  entry.onDestroyed)
    }

    entry.hotkey.destroy()
    attachedKeys.delete(digit)
    return true
}

/** Release every number key. */
function keysAllDetach() {
    for (const digit of [...attachedKeys.keys()]) keyRelease(digit)
    attachedKeysSave()
    return true
}

/** Write the attachments to config.attachFile: digit -> {id, bundleID, title}. */
function attachedKeysSave() {
    const saved = {}
    for (const [digit, entry] of attachedKeys) {
        saved[digit] = {id: entry.id, bundleID: entry.bundleID, title: entry.title}
    }
    hs.fs.mkdir(config.attachFile.replace(/\/[^/]*$/, ""))
    if (!hs.fs.write(config.attachFile, JSON.stringify(saved, null, 2), false)) {
        console.error(`[hs_window-gt] could not write ${config.attachFile}`)
    }
}

/**
 * The window an attachment refers to: by id, or failing that by title.
 *
 * The id is tried first, and is accepted only when the bundle identifier still matches,
 * because window ids are reused. When no window has the id, another window of the same
 * application with the same title is taken instead, provided no other key holds it. That
 * second match is what lets a key outlive its window: ids change when an application is
 * quit and opened again, or after a reboot, while titles often do not.
 *
 * Two windows with the same title cannot be told apart, so the first one found is taken.
 *
 * @param {object} entry `{id, bundleID, title}`.
 * @param {object[]} windows Every window, from allApplicationWindows().
 * @param {Set<number>} taken Ids of windows other keys are attached to.
 * @returns {{window: object, byTitle: boolean}|null}
 */
function attachedWindowFind(entry, windows, taken) {
    const bundleOf = (w) => (w.application ? w.application.bundleID : null)
    const sameApplication = (w) => !entry.bundleID || bundleOf(w) === entry.bundleID

    const byId = windows.find((w) => w.id === entry.id)
    if (byId && sameApplication(byId)) return {window: byId, byTitle: false}

    if (!entry.title) return null
    const byTitle = windows.find((w) => w.title === entry.title && sameApplication(w) &&
                                        !taken.has(w.id))
    return byTitle ? {window: byTitle, byTitle: true} : null
}

/**
 * Attach the windows listed in config.attachFile again.
 *
 * Window ids survive a reload of Hammerspoon 2, so a reload restores every key by id. After
 * an application has been quit and opened again, or after a reboot, the ids have changed and
 * the key goes to a window of the same application with the same title, if there is one.
 * Keys with no such window are reported as gone and dropped from the file.
 *
 * Every key is matched by id before any is matched by title, so that a title match cannot
 * take a window that another key still holds by its id.
 */
function attachedKeysRestore() {
    if (!hs.fs.exists(config.attachFile)) return

    const body = hs.fs.read(config.attachFile, 0, 0)
    if (!body) return

    let saved = null
    try {
        saved = JSON.parse(body)
    } catch (error) {
        console.error(`[hs_window-gt] ${config.attachFile} is unreadable, ignoring it: ${error}`)
        return
    }
    if (!saved || typeof saved !== "object") return

    const digits = Object.keys(saved).filter((d) => config.attachKeys.includes(d))
    if (digits.length === 0) return

    const windows = allApplicationWindows()
    const keys = config.attachModifiers.join("-")
    const restored = []
    const gone = []

    // First pass: every key whose window still has its id. Every window is passed as taken,
    // so that only the id can match.
    const taken = new Set()
    const found = {}
    for (const digit of digits) {
        const entry = saved[digit] || {}
        const match = attachedWindowFind(entry, windows, new Set(windows.map((w) => w.id)))
        if (match) {
            found[digit] = match
            taken.add(match.window.id)
        }
    }
    // Second pass: the rest, by title, among the windows the first pass left free.
    for (const digit of digits) {
        if (found[digit]) continue
        const match = attachedWindowFind(saved[digit] || {}, windows, taken)
        if (match) {
            found[digit] = match
            taken.add(match.window.id)
        }
    }

    for (const digit of digits) {
        const entry = saved[digit] || {}
        const match = found[digit]
        const label = `${keys}-${digit} ${entry.title || ""}`
        if (match && _digitAttach(match.window, digit, true)) {
            // Keep the title it was attached under, which is what attachedWindows() reports
            // and what the next title match will look for.
            if (entry.title) attachedKeys.get(digit).title = entry.title
            restored.push(match.byTitle ? `${label} (by title)` : label)
        } else {
            gone.push(label)
        }
    }
    attachedKeysSave()

    const lines = []
    if (restored.length > 0) lines.push("Window keys restored:", ...restored)
    if (gone.length > 0) lines.push("Windows gone, keys released:", ...gone)
    alert(lines.join("\n"))
}

/**
 * What is attached to what.
 *
 * `title` is what the window was called when it was attached, not what it is called now:
 * the attachment follows the window's id, and a window that has been retitled since is
 * still listed under its old name.
 *
 * @returns {object} Digit -> `{title, id, bundleID, alive, nowTitled}`.
 */
function attachedWindows() {
    const windows = allApplicationWindows()
    const listed = {}
    for (const [digit, entry] of attachedKeys) {
        const window = windows.find((w) => w.id === entry.id)
        listed[digit] = {
            title: entry.title,
            id: entry.id,
            bundleID: entry.bundleID,
            alive: Boolean(window),
            nowTitled: window ? window.title : null,
            nowBundleID: window && window.application ? window.application.bundleID : null
        }
    }
    return listed
}

/**
 * Focus the window attached to a digit, releasing the key if the window has gone.
 *
 * digitAttach() watches the window for closing and releases the key when it closes. That
 * watcher does not fire when an application quits outright rather than closing its windows,
 * so the window is also looked up when the key is pressed. If it has gone, the key is released
 * then, and an alert says which window it was.
 *
 * Releasing the hotkey from inside its own handler is safe. destroy() disables it and
 * detaches its callbacks; the callback running at that moment is held by the interpreter's
 * own stack frame, and the dispatch loop returns as soon as it has fired one hotkey.
 *
 * The application is checked as well as the id. Window ids are reused: a window opened
 * after this one closed can be given the same number, and without this the key would
 * focus a window of another application without any message. Comparing the bundle identifier catches another application
 * inheriting the id; a second window of the same application is not distinguishable this
 * way, and distinguishing it would need more state than it is worth.
 *
 * When no window has the id, a window of the same application with the same title is
 * attached instead, if no other key holds it. See attachedWindowFind.
 */
function _attachedFocus(digit) {
    const entry = attachedKeys.get(digit)
    if (!entry) return false

    const taken = new Set()
    for (const [other, held] of attachedKeys) if (other !== digit) taken.add(held.id)
    const match = attachedWindowFind(entry, allApplicationWindows(), taken)
    if (!match) {
        _keyDetach(digit)
        alert(`${digit} was ${entry.title}\nthat window has gone, key released`)
        return false
    }

    // The window was replaced by one with the same title: attach the key to it, keeping
    // the title the key was first attached under.
    const window = match.window
    if (match.byTitle) {
        const title = entry.title
        if (!_digitAttach(window, digit, true)) return false
        attachedKeys.get(digit).title = title
        attachedKeysSave()
        alert(`${config.attachModifiers.join("-")}-${digit}\nnow ${title}, found by title`)
    }

    // Pressing the key for the window you are already in goes back where you came from, so
    // one key both reaches a window and returns from it. windowPrevious() is what tracks
    // that, and it is updated by focusing here as much as by switching windows by hand.
    const here = focused()
    if (here && here.id === window.id) return windowPrevious()

    return _windowFocus(window)
}

/**
 * Attach a window to a number key, given the digit.
 *
 * @param {object} target The window.
 * @param {string} digit One of config.attachKeys.
 * @param {boolean} [quiet] Attach without an alert. attachedKeysRestore() reports all the
 *        keys it restores in one alert instead.
 * @returns {boolean} Whether it was attached.
 */
function _digitAttach(target, digit, quiet) {
    if (digit.length !== 1 || !config.attachKeys.includes(digit)) {
        alert(`Cannot attach to "${digit}"\nuse one of ${config.attachKeys}`)
        return false
    }

    // Whatever was on this digit is forgotten: its hotkey is destroyed and its entry
    // dropped, so the window it pointed at is no longer reachable through this key and
    // nothing is left holding it.
    _keyDetach(digit)

    const title = target.title || (target.application ? target.application.name : "window")
    const hotkey = hs.hotkey.bind(config.attachModifiers, digit, () => _attachedFocus(digit), null)
    if (!hotkey) {
        alert(`Could not bind ${config.attachModifiers.join("-")}-${digit}`)
        return false
    }

    // Watching the window itself, which became possible when hs.ax watchers stopped being
    // restricted to applications. Without it the key stays bound to a window that no longer
    // exists: Hammerspoon keeps the key combination bound, so other applications do not
    // receive it, until the key is pressed and the window is found to have gone. Nothing would
    // show that the closed window is the reason the key combination does nothing elsewhere.
    //
    // The check made when the key is pressed, in attachedFocus, stays as well. This does not fire when
    // an application quits outright rather than closing its windows, and hs.ax.on can fail
    // to attach at all — it throws when the native registration is refused, which the catch
    // below reports before clearing onDestroyed. The key stays bound either way, so nothing
    // breaks: keyDetach's off() call finds no watcher and is a no-op.
    const element = target.axElement()
    let onDestroyed = null
    if (element) {
        onDestroyed = () => {
            if (!attachedKeys.has(digit)) return
            _keyDetach(digit, true)
            alert(`${config.attachModifiers.join("-")}-${digit} released\n${title} has closed`)
        }
        try {
            hs.ax.on(element, hs.ax.notificationTypes.uIElementDestroyed, onDestroyed)
        } catch (e) {
            console.error(`[hs_window-gt] could not watch ${title} for closing: ${e && e.message ? e.message : e}`)
            onDestroyed = null
        }
    }

    attachedKeys.set(digit, {
        hotkey: hotkey,
        id: target.id,
        title: title,
        bundleID: target.application ? target.application.bundleID : null,
        element: onDestroyed ? element : null,
        onDestroyed: onDestroyed
    })
    attachedKeysSave()
    if (!quiet) alert(`${config.attachModifiers.join("-")}-${digit}\n${title}`)
    return true
}

/**
 * Attach a window to a number key, asking for the key if one is not given.
 *
 * With no digit, the next key press is captured and consumed. The key is asked for on its
 * own, without a modifier: a modifier chord that is already attached would be taken by its
 * hotkey before the tap saw it.
 *
 * Nothing takes the focus, so the window being attached is still the focused one
 * throughout, and there is nothing to give the focus back to afterwards.
 *
 * @param {object} [window] The window to attach. Defaults to the focused one.
 * @param {string|number} [key] The digit. Omit to be asked for it.
 * @returns {boolean} Whether a window was found to attach.
 */
function _keyToWindowAttach(window, key) {
    const target = window || focused()
    if (!target) {
        alert("No window to attach")
        return false
    }

    if (key !== undefined && key !== null && String(key).trim() !== "") {
        return _digitAttach(target, String(key).trim())
    }

    alert(`Press a number key for\n${target.title || (target.application ? target.application.name : "window")}`)
    captureDigit((digit) => {
        // null is Escape or a timeout: nothing was chosen, so nothing is said.
        if (digit === null) return
        _digitAttach(target, digit)
    })
    return true
}

// MARK: - Isolation
//
// Everything except the focused window is dimmed, by covering every screen with dark panels
// that leave the focused window's frame uncovered. While isolation is on, the uncovered area
// moves to whichever window is focused, on whichever screen, and changes shape when that
// window is moved or resized.
//
// The uncovered area is the window's frame, not the display the window is on. A window occupying part of a
// screen leaves the rest of that screen dimmed, and a fullscreen window — whose frame is the
// whole display, menu bar included — leaves its display clear.

/**
 * Convert a rectangle from screen coordinates to hs.ui window coordinates.
 *
 * A screen's frame and a window's frame have their origin at the top left of the primary
 * screen, with y increasing downwards. An hs.ui window is placed with its origin at the
 * bottom left of the primary screen, with y increasing upwards, so a screen below the
 * primary has a negative y. Passing one as the other puts a panel somewhere plausible but
 * wrong, which is what dimmed the left of the screen rather than the right.
 */
function toUIRect(rect) {
    const primary = hs.screen.primary().fullFrame
    const primaryBottom = primary.y + primary.h
    return {
        x: rect.x,
        y: primaryBottom - (rect.y + rect.h),
        w: rect.w,
        h: rect.h
    }
}

// Canvas colours are {red, green, blue, alpha} components in 0..1.
function canvasColor(value, alpha) {
    const text = String(value || "#000000").replace("#", "")
    const hex = text.length === 3 ? text.split("").map((c) => c + c).join("") : text
    const component = (at) => parseInt(hex.slice(at, at + 2), 16) / 255
    const own = hex.length >= 8 ? component(6) : 1
    return {
        red: component(0),
        green: component(2),
        blue: component(4),
        alpha: own * (alpha === undefined ? 1 : alpha)
    }
}

/**
 * One dark panel.
 *
 * The darkness is a filled rectangle inside the window, not the window's own background: a
 * window with nothing in it draws nothing, whatever its background colour is set to, which
 * is why earlier versions of this were invisible. This is the shape hs_countdown-gt's
 * progress bar uses, which is known to render.
 *
 * "status" is above other applications' windows. "normal" is Hammerspoon's own layer,
 * behind whichever application is frontmost.
 *
 * "canJoinAllSpaces" is what puts a panel over a fullscreen window, which lives in a space
 * of its own: without it the dimming would vanish the moment focus moved into one.
 */
function makeOverlay(rect) {
    const overlay = hs.canvas.create({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })
        .level("status")
        // Clicks pass through the dimming to the windows underneath.
        .ignoreMouseEvents(true)
        .behaviorList(["canJoinAllSpaces", "stationary"])
    overlay.appendElements([{
        type: "rectangle",
        action: "fill",
        fillColor: canvasColor(config.isolationColor, config.isolationOpacity),
        frame: { x: 0, y: 0, w: rect.w, h: rect.h }
    }])
    overlay.show()
    return overlay
}

/**
 * The screen a window is on.
 *
 * window.screen is read first. It can be null — a window in another space is one case —
 * and then the screen holding the window's centre is used, so that the dimming still leaves
 * the window uncovered rather than covering every display.
 */
function screenOfWindow(window) {
    if (!window) return null
    if (window.screen) return window.screen

    const frame = window.frame
    if (!frame || frame.w <= 0 || frame.h <= 0) return null
    const x = frame.x + frame.w / 2
    const y = frame.y + frame.h / 2

    for (const screen of screenList()) {
        const f = screen.fullFrame
        if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return screen
    }
    return null
}

/**
 * The panels that dim everything except one window.
 *
 * The window's screen is covered by four panels around it — above, below, left and right —
 * and every other screen by one. The uncovered area is clipped to the screen, so a window
 * extending past an edge, or one whose frame is the whole display because it is fullscreen, gives panels
 * of zero size rather than negative ones.
 *
 * With no window nothing is left uncovered, and every screen is covered.
 *
 * @returns {Array<{x: number, y: number, w: number, h: number}>} in screen coordinates.
 */
function isolationRects(window) {
    const uncovered = window ? window.frame : null
    const uncoveredScreen = screenOfWindow(window)
    const rects = []
    const add = (rect) => {
        if (rect.w > 0 && rect.h > 0) rects.push(rect)
    }

    for (const screen of screenList()) {
        const f = screen.fullFrame

        if (!uncovered || !uncoveredScreen || screen.id !== uncoveredScreen.id) {
            add({ x: f.x, y: f.y, w: f.w, h: f.h })
            continue
        }

        const clamp = (value, low, high) => Math.max(low, Math.min(value, high))
        const left = clamp(uncovered.x, f.x, f.x + f.w)
        const right = clamp(uncovered.x + uncovered.w, left, f.x + f.w)
        const top = clamp(uncovered.y, f.y, f.y + f.h)
        const bottom = clamp(uncovered.y + uncovered.h, top, f.y + f.h)

        add({ x: f.x, y: f.y, w: f.w, h: top - f.y })
        add({ x: f.x, y: bottom, w: f.w, h: (f.y + f.h) - bottom })
        add({ x: f.x, y: top, w: left - f.x, h: bottom - top })
        add({ x: right, y: top, w: (f.x + f.w) - right, h: bottom - top })
    }
    return rects
}

/** What is on screen now, so that a refresh that changes nothing redraws nothing. */
function isolationSignature(rects) {
    return rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(" ")
}

/**
 * Move and resize the panels to the rectangles given.
 *
 * Panels are moved rather than replaced: destroying and recreating them on every focus
 * change flickers, and the pool is at most one panel per screen plus three.
 */
function drawIsolation(rects) {
    rects.forEach((screenRect, index) => {
        const rect = toUIRect(screenRect)
        const overlay = isolationWindows[index]
        if (!overlay) {
            isolationWindows[index] = makeOverlay(rect)
            return
        }
        overlay.setFrame({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })
        overlay.setElementAttribute(0, "frame", { x: 0, y: 0, w: rect.w, h: rect.h })
    })

    for (const overlay of isolationWindows.splice(rects.length)) removeOverlay(overlay)
}

function removeOverlay(overlay) {
    try {
        overlay.destroy()
    } catch (e) {
        console.error(`[hs_window-gt] could not remove an isolation overlay: ${e.message}`)
    }
}

/**
 * Move the dimming to whatever is focused now.
 *
 * Nothing focused leaves the panels where they are rather than covering everything: focus
 * is briefly nowhere while a menu or a chooser is up, and the screen going dark and back
 * each time one opens is worse than the dimming lagging by a window.
 */
function isolationRefresh() {
    if (!isolationActive) return

    const window = focused()
    if (!window && isolationLayout !== null) return

    const rects = isolationRects(window)
    const signature = isolationSignature(rects)
    if (signature === isolationLayout) return

    isolationLayout = signature
    drawIsolation(rects)
}

/**
 * Dim everything except the focused window, and keep doing so as the focus moves.
 *
 * The focused window is left uncovered rather than raised above the dimming: window level
 * beats window order, so an overlay above other applications cannot be got behind.
 *
 * The panels ignore mouse events, so clicks reach the windows beneath the dimming as
 * usual; nothing covers the focused window in any case.
 *
 * The dimming follows events rather than a timer. The windowFocused, windowMoved and
 * windowResized events from hs_windowfilter-gt redraw it when the focus moves or the focused
 * window changes shape, which includes a change between two windows of one application.
 * hs.screen's "change" event redraws it when a screen is added, removed or rearranged. A
 * redraw that would change nothing draws nothing.
 */
function isolationStart() {
    if (isolationActive) return module.exports

    isolationActive = true
    isolationLayout = null
    hs.screen.on("change", isolationRefresh)
    isolationRefresh()
    return module.exports
}

function isolationStop() {
    if (isolationActive) hs.screen.off("change", isolationRefresh)
    isolationActive = false
    isolationLayout = null

    for (const overlay of isolationWindows) removeOverlay(overlay)
    isolationWindows = []
    return module.exports
}

function isolationToggle() {
    return isolationActive ? isolationStop() : isolationStart()
}

/**
 * Whether isolation is on. Not the same as there being panels: a window filling its only
 * screen needs none, and isolation is still on.
 */
function isolationOn() {
    return isolationActive
}

// MARK: - Information

/** Show a window's application, title, screen and frame. */
function _info(win) {
    const window = win || focused()
    if (!window) {
        alert("No window")
        return null
    }

    const app = window.application
    const frame = window.frame
    const text = [
        app ? app.name : "(unknown application)",
        app && app.bundleID ? app.bundleID : "",
        window.title || "(no title)",
        `${window.screen ? window.screen.name : "?"}  ` +
        `${Math.round(frame.x)},${Math.round(frame.y)} ` +
        `${Math.round(frame.w)}×${Math.round(frame.h)}`,
        `history: ${_historyDepth(window)}`
    ].filter(Boolean).join("\n")

    hs.ui.alert(text).duration(4).show()
    console.log(`[hs_window-gt] ${text.replace(/\n/g, " | ")}`)
    return text
}

// MARK: - Screenshots

function twoDigits(n) {
    return String(n).padStart(2, "0")
}

// Sortable, and safe in a filename on any system: 2026-09-09-174530.
function timestamp() {
    const now = new Date()
    return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}` +
        `-${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}${twoDigits(now.getSeconds())}`
}

/**
 * Capture a window to the pasteboard and to a PNG file.
 *
 * Both, because the two are used differently: the pasteboard copy can be pasted straight
 * into a message, and the file remains available afterwards.
 *
 * PNG only, deliberately. A window is flat colour and sharp text, which is what PNG
 * compresses well and JPEG compresses badly: the same capture came to 710KB as a PNG and
 * 1.3MB as a JPEG at quality 80, with visible artefacts around the text. If these files
 * ever need to be smaller, scale the image down; JPEG will not make them smaller.
 *
 * @param {object} [window] The window. Defaults to the focused one.
 * @returns {Promise} Resolves to the path written, or to null if nothing was captured.
 */
function _screenshot(window) {
    const target = window || focused()
    if (!target) {
        console.error("[hs_window-gt] no window to capture")
        return Promise.resolve(null)
    }

    const application = target.application ? target.application.name : "window"
    const directory = hs.fs.pathToAbsolute(config.screenshotDir) || config.screenshotDir
    const name = `${timestamp()}-${application}`.replace(/[^A-Za-z0-9._-]+/g, "_")
    const png = `${directory}/${name}.png`

    return target.snapshot().then((image) => {
        if (!image) return screenshotFailed(application, "nothing was captured")

        hs.pasteboard.writeImage(image)

        if (!image.saveToFile(png)) {
            return screenshotFailed(application, `could not write ${png}`)
        }

        // Said on screen, as info() does: the pasteboard copy is invisible, so without
        // this nothing distinguishes a capture that worked from one that did not.
        hs.ui.alert(`Copied, and saved to\n${png}`).duration(config.screenshotAlertSeconds).show()
        console.log(`[hs_window-gt] captured ${application} to ${png}`)
        return png
    }, (e) => {
        // Rejected rather than thrown: the window may have closed, or Screen Recording
        // permission may not have been granted.
        return screenshotFailed(application, e && e.message ? e.message : String(e))
    })
}

function screenshotFailed(application, reason) {
    console.error(`[hs_window-gt] could not capture ${application}: ${reason}`)
    hs.ui.alert(`Could not capture ${application}`).duration(config.screenshotAlertSeconds).show()
    return null
}

// MARK: - The window menu
//
// The menu hs_menu-gt displays for this Spoon. Every option calls an exported function with
// `fn:`, so it needs no command names, and reads omitted arguments as a key or a command does:
// the focused window, or a window chosen in a chooser when no window is focused. The menu's keys
// do not take the keyboard focus, so the focused window is still the user's when an option is
// selected.

/**
 * Run `action` on the focused window, or on a window chosen in a chooser when no window is
 * focused, for an option that calls a method of the window rather than a function of the Spoon.
 */
function onWindow(action) {
    return () => {
        const interactive = spoonRequired("hs_interactive-gt")
        return interactive.readerRun(interactive.readers.window.auto).then((window) => {
            if (window) action(window)
        })
    }
}

// A press leaves the menu where it is, so reopening it comes back here, and closes it,
// which is the menu's own keepOpen. The submenus are pressed several times in a row, so
// they stay displayed.
const stay = (button) => Object.assign({ navigate: "stay" }, button)
const stayOpen = (button) => Object.assign({ navigate: "stay", keepOpen: true }, button)

const MENU_THIRDS = [
    { label: "Left", icon: "symbol:rectangle.leadinghalf.inset.filled", key: "h", fn: () => module.exports.leftThird() },
    { label: "Centre", icon: "symbol:rectangle.center.inset.filled", key: "j", fn: () => module.exports.centerThird() },
    { label: "Right", icon: "symbol:rectangle.trailinghalf.inset.filled", key: "l", fn: () => module.exports.rightThird() },
    { label: "Left ⅔", key: "u", fn: () => module.exports.leftTwoThirds() },
    { label: "Right ⅔", key: "i", fn: () => module.exports.rightTwoThirds() }
].map(stayOpen)

const MENU_QUADRANTS = [
    { label: "Top left", icon: "symbol:rectangle.inset.topleft.filled", key: "q", fn: () => module.exports.topLeft() },
    { label: "Top right", icon: "symbol:rectangle.inset.topright.filled", key: "w", fn: () => module.exports.topRight() },
    { label: "Bottom left", icon: "symbol:rectangle.inset.bottomleft.filled", key: "a", fn: () => module.exports.bottomLeft() },
    { label: "Bottom right", icon: "symbol:rectangle.inset.bottomright.filled", key: "s", fn: () => module.exports.bottomRight() },
    { label: "Top half", icon: "symbol:rectangle.tophalf.filled", key: "t", fn: () => module.exports.topHalf() },
    { label: "Bottom half", icon: "symbol:rectangle.bottomhalf.filled", key: "b", fn: () => module.exports.bottomHalf() }
].map(stayOpen)

const MENU_WIDTHS = [2, 3, 4, 5, 6, 7, 8].map((n) => stayOpen({
    label: `1/${n} width`,
    key: String(n),
    fn: () => module.exports.fractionWidth(n)
}))

/**
 * The window menu, for hs_menu-gt: `menuShow()` displays it, and a menu of your own can
 * include it as a submenu with `children: hs.spoons["hs_window-gt"].menu`.
 *
 * A window is usually placed once, so a press closes the menu. Undo and Redo, which are
 * pressed several times in a row, keep it open. Swap with, Tile with and To screen show a
 * chooser, which needs the keyboard, so they close it as the others do.
 */
const menu = {
    keepOpen: false,
    buttons: [
        { label: "Undo", icon: "symbol:arrow.uturn.backward", key: "[", fn: () => module.exports.undo(), keepOpen: true },
        { label: "Redo", icon: "symbol:arrow.uturn.forward", key: "]", fn: () => module.exports.redo(), keepOpen: true },
        { label: "Attach key", icon: "symbol:number", key: "a", fn: () => module.exports.keyToWindowAttach() },

        { label: "Maximize", icon: "symbol:arrow.up.left.and.arrow.down.right", key: "m", fn: () => module.exports.maximize() },
        { label: "Left half", icon: "symbol:rectangle.lefthalf.filled", key: "h", fn: () => module.exports.leftHalf() },
        { label: "Right half", icon: "symbol:rectangle.righthalf.filled", key: "l", fn: () => module.exports.rightHalf() },
        { label: "Centre", icon: "symbol:rectangle.center.inset.filled", key: "c", fn: () => module.exports.center() },
        { label: "Fullscreen", icon: "symbol:arrow.up.left.and.down.right.magnifyingglass", key: "f",
          fn: onWindow((window) => window.toggleFullscreen()) },
        { label: "Minimize", icon: "symbol:arrow.down.right.and.arrow.up.left", key: "n",
          fn: onWindow((window) => window.minimize()) },

        { label: "Vert max", icon: "symbol:arrow.up.and.down", key: "V", fn: () => module.exports.verticalMaximize() },
        { label: "Horiz max", icon: "symbol:arrow.left.and.right", key: "H", fn: () => module.exports.horizontalMaximize() },
        { label: "Half height", icon: "symbol:rectangle.tophalf.filled", key: "-", fn: () => module.exports.halfHeight() },
        { label: "Half width", icon: "symbol:rectangle.lefthalf.filled", key: "W", fn: () => module.exports.halfWidth() },

        { label: "Move left", icon: "symbol:arrow.left", key: "left", fn: () => module.exports.moveByOwnSize("left") },
        { label: "Move right", icon: "symbol:arrow.right", key: "right", fn: () => module.exports.moveByOwnSize("right") },
        { label: "Move up", icon: "symbol:arrow.up", key: "up", fn: () => module.exports.moveByOwnSize("up") },
        { label: "Move down", icon: "symbol:arrow.down", key: "down", fn: () => module.exports.moveByOwnSize("down") },

        { label: "To screen", icon: "symbol:display.2", key: "s", fn: () => module.exports.windowToScreenMove() },
        { label: "Next screen", icon: "symbol:rectangle.on.rectangle", key: "space", fn: () => module.exports.windowToScreenMove("next") },
        { label: "Prev screen", icon: "symbol:rectangle.on.rectangle", key: "B", fn: () => module.exports.windowToScreenMove("previous") },

        { label: "Swap behind", icon: "symbol:arrow.left.arrow.right", key: "S", fn: () => module.exports.windowWithPreviousSwap() },
        { label: "Swap with", icon: "symbol:arrow.triangle.swap", key: "x", fn: () => module.exports.windowWithWindowSwap() },
        { label: "Tile with", icon: "symbol:rectangle.split.2x1", key: "t", fn: () => module.exports.tileWith() },
        { label: "To back", icon: "symbol:square.on.square", key: "0", fn: () => module.exports.windowToBackSend() },
        { label: "Prev window", icon: "symbol:arrow.uturn.left", key: "p", fn: () => module.exports.windowPrevious() },

        { label: "Isolate", icon: "symbol:moon.fill", key: "I", fn: () => module.exports.isolationToggle() },
        { label: "Info", icon: "symbol:info.circle", key: "i", fn: () => module.exports.info() },
        { label: "Screenshot", icon: "symbol:camera", key: "P", fn: () => module.exports.screenshot() },
        { label: "Centre mouse", icon: "symbol:cursorarrow", key: "M", fn: () => module.exports.mouseWindowCenter() },
        { label: "Mouse next", icon: "symbol:cursorarrow.motionlines", key: "N", fn: () => module.exports.mouseScreenCenterNext() },
        { label: "Mouse screen", icon: "symbol:cursorarrow.rays", key: "C", fn: () => module.exports.mouseScreenCenter() },

        { label: "Thirds", icon: "symbol:square.split.1x2", key: "3", children: MENU_THIRDS },
        { label: "Quadrants", icon: "symbol:square.split.2x2", key: "4", children: MENU_QUADRANTS },
        { label: "Widths", icon: "symbol:ruler", key: "5", children: MENU_WIDTHS }
    ].map(stay)
}

/** Display the window menu on screen, with hs_menu-gt. */
function menuShow() {
    spoonRequired("hs_menu-gt").onScreenShow(menu, { name: "Windows" })
    return module.exports
}

// MARK: - Hotkeys
//
// hs.spoons.use() binds keys through its `hotkeys` option, which calls bindHotkeys(). The name
// is the one hs.spoons.use() calls, so it keeps that spelling rather than this project's
// subject-first order.

// The hotkeys bindHotkeys() created, so that stop() and the next bindHotkeys() release them.
let hotkeys = []

// Functions a key cannot run, because they need an argument a key press cannot give, or
// because they report something rather than act.
const HOTKEY_EXCLUDED = new Set([
    // Their arguments are not read when omitted.
    "place", "mouseMove", "mouseHighlight",
    // They only return a value, which a key cannot show.
    "historyDepth", "isMaximized", "isVerticallyMaximized", "isHorizontallyMaximized",
    "screenHasFullscreenWindow", "fullscreenScreenIds", "attachedWindows", "isolationOn",
    "start", "stop", "bindHotkeys"
])

function hotkeysRelease() {
    for (const hotkey of hotkeys) hotkey.destroy()
    hotkeys = []
}

/**
 * Bind keys to this Spoon's functions. Each function runs on the focused window. Called by
 * hs.spoons.use() with its `hotkeys` option; a second call replaces the bindings of the first.
 *
 * @param {object} mapping Function name -> `[modifiers, key]`, for example
 *        `{ menuShow: [["alt"], "w"], undo: [["cmd", "ctrl", "alt"], "z"] }`.
 * @returns {object} The Spoon.
 * @throws If a name is not a function a key can run. Nothing is bound in that case.
 */
function bindHotkeys(mapping) {
    const entries = Object.entries(mapping || {})
    for (const [name, binding] of entries) {
        if (HOTKEY_EXCLUDED.has(name) || typeof module.exports[name] !== "function") {
            throw new Error(`hs_window-gt: bindHotkeys(): ${name} is not a function a key can run`)
        }
        if (!Array.isArray(binding) || !Array.isArray(binding[0]) || typeof binding[1] !== "string") {
            throw new Error(`hs_window-gt: bindHotkeys(): ${name} needs [modifiers, key], such as [["alt"], "w"]`)
        }
    }

    hotkeysRelease()
    for (const [name, [mods, key]] of entries) {
        const hotkey = hs.hotkey.bind(mods, key, () => module.exports[name](), null)
        if (hotkey) hotkeys.push(hotkey)
        else console.error(`[hs_window-gt] could not bind ${mods.join("-")} ${key} to ${name}`)
    }
    return module.exports
}

// MARK: - Lifecycle

/**
 * What this Spoon does on hs_windowfilter-gt's events. One handler for every event, so start()
 * subscribes once and stop() unsubscribes once.
 *
 * - windowFocused: what was focused becomes the previous window, for windowPrevious().
 * - windowDestroyed: the window's history is dropped, since its id may be reused.
 * - windowFocused, windowMoved, windowResized: isolation redraws, when it is on and the event
 *   is about the focused window.
 */
function windowEvent(event, window, state) {
    if (event === "windowDestroyed") {
        history.delete(state.id)
        return
    }
    if (event === "windowFocused" && state.id !== currentFocusedId) {
        previousFocusedId = currentFocusedId
        currentFocusedId = state.id
    }
    if (isolationActive && state.focused) isolationRefresh()
}

const WINDOW_EVENTS = ["windowFocused", "windowMoved", "windowResized", "windowDestroyed"]

function start() {
    if (windowFilter) return module.exports

    // All three are required. Checked here, so that a missing one is reported when the Spoon
    // starts rather than the first time it is needed.
    spoonRequired("hs_interactive-gt")
    spoonRequired("hs_menu-gt")
    const windowfilter = spoonRequired("hs_windowfilter-gt")
    windowFilter = windowfilter.create({})
    windowFilter.on(WINDOW_EVENTS, windowEvent)

    const window = focused()
    currentFocusedId = window ? window.id : null

    attachedKeysRestore()
    return module.exports
}

function stop() {
    hotkeysRelease()
    isolationStop()
    mouseHighlightClear()
    // Released without saving, so that config.attachFile still lists them for start().
    for (const digit of [...attachedKeys.keys()]) keyRelease(digit)
    captureStop()
    fullscreenMoveEnd(false)
    if (windowFilter) {
        // destroy() unsubscribes as well. Without hs_windowfilter-gt, unsubscribing is all
        // that is left to do.
        const windowfilter = hs.spoons["hs_windowfilter-gt"]
        if (windowfilter) windowfilter.destroy(windowFilter)
        else windowFilter.off()
        windowFilter = null
    }
    return module.exports
}

// MARK: - Reading omitted arguments
//
// An exported function called without one of its arguments has that argument read through
// hs_interactive-gt: a window omitted is the focused window, or one chosen in a chooser when no
// window is focused, and a direction or a digit omitted is chosen in a chooser. A key can
// therefore be bound to any of these functions. Only the exported functions read arguments;
// calls within this Spoon, the menu's among them, pass their arguments themselves.

const DIRECTIONS = ["left", "right", "up", "down"]
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]

// The parameters in the form of hs_interactive-gt's `interactive` entries, except that each
// reader is named, such as "window.auto", because hs_interactive-gt's readers exist only once
// it is loaded. A parameter without a reader is passed through, so that the function's own
// handling of an omitted value, such as its own chooser, applies.
const WINDOW_PARAMETER = { name: "window", reader: "window.auto" }
const SCREEN_PARAMETER = { name: "screen", reader: "screen.auto" }
const ATTACHED_DIGIT_PARAMETER = {
    name: "digit",
    reader: "choice.prompted",
    placeholder: "Number key",
    empty: "No number key is attached to a window",
    choices: () => [...attachedKeys].map(([digit, entry]) => ({
        text: digit,
        subText: entry.title || "(untitled)",
        value: digit
    }))
}
const ON_WINDOW = [WINDOW_PARAMETER]

const EXPORTED_PARAMETERS = {
    undo: ON_WINDOW, redo: ON_WINDOW, historyDepth: ON_WINDOW,
    isMaximized: ON_WINDOW, isVerticallyMaximized: ON_WINDOW, isHorizontallyMaximized: ON_WINDOW,
    maximize: ON_WINDOW, center: ON_WINDOW,
    leftHalf: ON_WINDOW, rightHalf: ON_WINDOW, topHalf: ON_WINDOW, bottomHalf: ON_WINDOW,
    leftThird: ON_WINDOW, centerThird: ON_WINDOW, rightThird: ON_WINDOW,
    leftTwoThirds: ON_WINDOW, rightTwoThirds: ON_WINDOW,
    topLeft: ON_WINDOW, topRight: ON_WINDOW, bottomLeft: ON_WINDOW, bottomRight: ON_WINDOW,
    verticalMaximize: ON_WINDOW, horizontalMaximize: ON_WINDOW,
    halfHeight: ON_WINDOW, halfWidth: ON_WINDOW,
    fractionWidth: [{
        name: "denominator",
        reader: "choice.prompted",
        placeholder: "Fraction of the screen's width",
        choices: [2, 3, 4, 5, 6, 7, 8].map((n) => ({ text: `1/${n}`, value: n }))
    }, WINDOW_PARAMETER],
    moveByOwnSize: [{
        name: "direction",
        reader: "choice.prompted",
        placeholder: "Direction",
        choices: DIRECTIONS.map((direction) => ({ text: direction, value: direction }))
    }, WINDOW_PARAMETER],
    windowToScreenMove: [{ name: "target" }, WINDOW_PARAMETER],
    screenHasFullscreenWindow: [SCREEN_PARAMETER],
    tileWith: [{ name: "other" }, WINDOW_PARAMETER],
    windowWithWindowSwap: [{ name: "other" }, WINDOW_PARAMETER],
    windowWithPreviousSwap: ON_WINDOW,
    windowToBackSend: ON_WINDOW,
    windowFocus: ON_WINDOW,
    mouseWindowCenter: ON_WINDOW,
    mouseScreenCenter: [SCREEN_PARAMETER],
    keyToWindowAttach: [WINDOW_PARAMETER, { name: "key" }],
    digitAttach: [WINDOW_PARAMETER, {
        name: "digit",
        reader: "choice.prompted",
        placeholder: "Number key",
        choices: DIGITS.map((digit) => ({ text: digit, value: digit }))
    }, { name: "quiet" }],
    attachedFocus: [ATTACHED_DIGIT_PARAMETER],
    keyDetach: [ATTACHED_DIGIT_PARAMETER, { name: "destroyed" }],
    info: ON_WINDOW,
    screenshot: ON_WINDOW
}

/**
 * The exported form of `fn`, which reads its omitted arguments through hs_interactive-gt.
 * Created on the first call rather than when the Spoon loads, because hs_interactive-gt may be
 * loaded after this Spoon's file is read.
 *
 * @param {function} fn The function within this Spoon.
 * @param {object[]} parameters Its entry in `EXPORTED_PARAMETERS`.
 * @returns {function}
 */
function interactiveExportCreate(fn, parameters) {
    let created = null
    return (...args) => {
        if (!created) {
            const interactive = spoonRequired("hs_interactive-gt")
            const resolved = parameters.map((parameter) => {
                if (!parameter.reader) return parameter
                const [kind, variant] = parameter.reader.split(".")
                return Object.assign({}, parameter, { reader: interactive.readers[kind][variant] })
            })
            created = interactive.interactiveFunctionCreate(fn, resolved)
        }
        return created(...args)
    }
}

module.exports = {
    config,
    // History.
    undo: _undo,
    redo: _redo,
    historyDepth: _historyDepth,
    historyClear,
    isMaximized: _isMaximized,
    isVerticallyMaximized: _isVerticallyMaximized,
    isHorizontallyMaximized: _isHorizontallyMaximized,
    // Grid placement.
    place,
    maximize: _maximize,
    leftHalf: _leftHalf,
    rightHalf: _rightHalf,
    topHalf: _topHalf,
    bottomHalf: _bottomHalf,
    leftThird: _leftThird,
    centerThird: _centerThird,
    rightThird: _rightThird,
    leftTwoThirds: _leftTwoThirds,
    rightTwoThirds: _rightTwoThirds,
    topLeft: _topLeft,
    topRight: _topRight,
    bottomLeft: _bottomLeft,
    bottomRight: _bottomRight,
    center: _center,
    // Resizing in place.
    verticalMaximize: _verticalMaximize,
    horizontalMaximize: _horizontalMaximize,
    halfHeight: _halfHeight,
    halfWidth: _halfWidth,
    fractionWidth: _fractionWidth,
    moveByOwnSize: _moveByOwnSize,
    // Screens.
    windowToScreenMove: _windowToScreenMove,
    fullscreenScreenIds,
    screenHasFullscreenWindow: _screenHasFullscreenWindow,
    // Windows among themselves.
    tileWith: _tileWith,
    windowWithWindowSwap: _windowWithWindowSwap,
    windowWithPreviousSwap: _windowWithPreviousSwap,
    windowPrevious,
    windowToBackSend: _windowToBackSend,
    windowFocus: _windowFocus,
    // The mouse.
    mouseWindowCenter: _mouseWindowCenter,
    mouseWindowCenterNext,
    mouseScreenCenter: _mouseScreenCenter,
    mouseScreenCenterNext,
    mouseMove,
    mouseHighlight,
    // Isolation.
    isolationToggle,
    isolationStart,
    isolationStop,
    isolationOn,
    // Windows attached to number keys.
    keyToWindowAttach: _keyToWindowAttach,
    digitAttach: _digitAttach,
    attachedFocus: _attachedFocus,
    keyDetach: _keyDetach,
    keysAllDetach,
    attachedWindows,
    // Information.
    info: _info,
    screenshot: _screenshot,
    // The window menu.
    menu,
    menuShow,
    // Keys, for the hotkeys option of hs.spoons.use().
    bindHotkeys,
    start,
    stop
}

// Each function listed in EXPORTED_PARAMETERS is exported in the form that reads its omitted
// arguments. The function of the same name within this Spoon is unchanged.
for (const [name, parameters] of Object.entries(EXPORTED_PARAMETERS)) {
    module.exports[name] = interactiveExportCreate(module.exports[name], parameters)
}
