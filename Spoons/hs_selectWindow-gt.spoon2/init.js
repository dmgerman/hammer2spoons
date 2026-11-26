// hs_selectWindow-gt — switch windows by typing part of a title, with a preview.
//
// A port of the Hammerspoon 1 hs_select_window Spoon. The chooser lists windows in
// most-recently-used order, searches title and application name together, and shows a
// picture of the selected window while you move through the list.
//
//     const sw = hs.spoons["hs_selectWindow-gt"]
//     sw.windowSelect()                    // every window
//     sw.applicationWindowSelect()         // the focused application's windows
//     sw.applicationSelect()               // one window per application
//     sw.windowPreviousSelect()            // straight to the last used, no chooser
//
// No keys are bound. bindHotkeys() is available for a caller that wants them.
//
// The Spoon needs Hammerspoon 2's hs.windowfilter, and hs_window-gt, which it does not load
// itself: the user's configuration loads it first. start() checks for both.
//
// Both the list of windows and their order come from hs.windowfilter, which tracks every window
// and the order in which they were focused, so this Spoon never enumerates windows itself. The
// title, application, screen and flags of each window are read from its HSWindow when a chooser
// opens: about 27 ms for 31 windows, measured on 2026-11-26. hs.windowfilter holds these values
// too, but does not return them (ai/compare-hs.windowfilter.org, hammer2spoons-rr1.8).
//
// Asking hs.window instead is what made this slow. allWindows(), orderedWindows() and
// visibleWindows() each took about 1.5 s when this was written. They took about 0.1 s for
// 35 windows on 2026-10-24, which is still a visible pause when the switcher opens. Asking
// hs.windowfilter for its windows takes 0.4 ms.
//
// Their front-to-back order also leaves out minimized windows and windows of a hidden
// application, which a switcher is precisely for.
//
// The Hammerspoon 1 Spoon's bindings that narrow by workspace, or move a window between
// workspaces, are ported with Hammerspoon 2's Spaces functions (HSScreen.spaces,
// HSWindow.spaces): windowSelect(), applicationWindowSelect() and windowPreviousSelect() take
// { currentSpace: true }, and windowToCurrentSpaceSelect() brings a window to the current
// Space. The readme lists them under "Coming from Hammerspoon 1".

// MARK: - User-configurable settings

const config = {
    // Rows visible in the chooser at once.
    rowsToDisplay: 14,

    // Width of the chooser, as a fraction of the screen's width, which is what
    // hs.chooser.width takes. Its own default is 0.5.
    //
    // Wide displays get a narrower fraction: on an ultrawide monitor half the screen puts
    // the title and the line under it so far apart that neither is easy to read.
    width: 0.4,
    wideWidth: 0.22,
    wideScreenPoints: 3000,

    // Text sizes in the chooser, in points: a row's title, the line beneath it, and the search
    // field. hs.chooser's own are 14, 12 and 20; these are about 20% larger, rounded to whole
    // points. null keeps the chooser's own size.
    textSize: 17,
    subTextSize: 14,
    querySize: 24,

    // Whether a chooser that would list a single window, or a single application, switches to
    // it at once without being shown, as the Hammerspoon 1 Spoon did. Off by default, so that
    // the chooser shows where it would go and can be cancelled.
    singleRowSwitch: false,

    // A picture of the selected window, drawn above the chooser. One snapshot costs around
    // 120ms, so it is taken when a window is first selected rather than for the whole list,
    // and kept while the chooser is open. Tab turns it off and on.
    showThumbnail: false,
    // Largest the picture may be, as a fraction of the usable screen height. A maximum, not
    // a target: a snapshot smaller than this is drawn at its own size rather than enlarged.
    thumbnailHeightRatio: 0.4,
    // How far down the screen the top of the picture sits, as a fraction of screen height, when
    // the chooser's own frame cannot be read: before it is shown, chooser.frame is null.
    thumbnailTopRatio: 0.12,
    // Gap between the picture and the chooser, in points.
    thumbnailGap: 12,
    // Snapshots are kept while the chooser is open. Keeping them afterwards makes the next
    // invocation faster and the pictures older; Shift+Tab redraws the selected one.
    persistentThumbnailCache: false,

    // Keys bound only while the chooser is open.
    thumbnailToggleKey: "tab",
    thumbnailRefreshKey: "tab",       // with shift

    // Windows never offered.
    skipApplications: ["Hammerspoon", "Hammerspoon 2"],

    // What happens when the chosen window is on a screen that is showing a fullscreen
    // window. When false, macOS leaves the fullscreen window's Space and shows the chosen
    // window in its place. When true, the chosen window is first moved to the next screen
    // that is not showing a fullscreen window, so the fullscreen window stays where it is.
    // When every other screen is showing one as well, the window is focused where it is,
    // as with false.
    fullscreenScreenSkip: false
}

// MARK: - State

let filter = null                  // the hs.windowfilter filter of the windows offered
let chooser = null
let promptHeld = false             // whether the open chooser is reported to hs_interactive-gt
let overlay = null                 // the canvas showing the thumbnail
let thumbnails = new Map()         // window id -> HSImage
let showingThumbnail = config.showThumbnail
let sessionKeys = []               // hotkeys bound only while the chooser is open
// The key that opened the chooser, as {mods, key}, or null when it was not opened by a key.
// Pressed again while the chooser is open, it moves the selection down; with Shift, up.
let sessionOpeningKey = null
// The key of this Spoon's own bindHotkeys() whose function is running, for keyNow().
let ownKeyRunning = null
let lastDrawnId = null
let pendingSnapshots = new Set()   // window ids whose snapshot has been asked for
// Window id -> window, for the chooser that is open. Enumerating windows is the most
// expensive thing this Spoon does, so it is done once and the result kept until the
// chooser closes.
let sessionWindows = new Map()

function log(message) {
    console.error(`[hs_selectWindow-gt] ${message}`)
}

// For the message given when a Spoon this one needs is not loaded.
const SPOON_NAME = "hs_selectWindow-gt"
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

// MARK: - Which windows to offer, most recently used first

/**
 * hs.windowfilter, which this Spoon cannot work without. Throws when the running Hammerspoon 2
 * does not have the module, or is older than inaccessibleApplications(), which upstream added in
 * PR #480.
 */
function windowfilterRequired() {
    const windowfilter = hs.windowfilter
    if (windowfilter && typeof windowfilter.create === "function" &&
        typeof windowfilter.inaccessibleApplications === "function") return windowfilter
    throw new Error(`${SPOON_NAME} needs hs.windowfilter with inaccessibleApplications(), which this ` +
        "build of Hammerspoon 2 does not have. It was added on 2026-11-26 " +
        "(Hammerspoon/Hammerspoon2#470 and #480).")
}

/**
 * Creates the filter of the windows offered, once.
 *
 * It accepts every standard window that has a title, including minimized ones and those of
 * hidden applications: a minimized window is exactly what a switcher is for. The title leaves
 * out the untitled windows of menu bar applications, such as NordVPN's. Hammerspoon 2's own
 * windows are never included.
 *
 * AXDialog is allowed as well as AXStandardWindow, because macOS reports a minimized window's
 * subrole as AXDialog, and hs.windowfilter reads the subrole each time (measured on 2026-11-26).
 * With AXStandardWindow alone, every minimized window would be left out. The cost is that a
 * dialog with a title is offered too.
 *
 * Its windowDestroyed listener drops the window's thumbnail. It also keeps hs.windowfilter
 * observing windows, so that windows() and inaccessibleApplications() read what it holds rather
 * than asking every application.
 */
function filterStart() {
    if (filter) return
    const windowfilter = windowfilterRequired()
    filter = windowfilter.create({ default: { allowRoles: ["AXStandardWindow", "AXDialog"], allowTitles: 1 } })
    for (const application of config.skipApplications) filter.rejectApp(application)
    filter.on("windowDestroyed", windowDestroyed)
}

function windowDestroyed(window) {
    if (window) thumbnails.delete(window.id)
}

/**
 * The record of one window: the window, and the values the chooser and the functions below
 * read from it, read once.
 *
 * `focused` is whether the window is the first in the order of use, which hs.windowfilter
 * updates on every windowFocused event. It is not read from the window: a window of another
 * application can report that it is focused after the focus has left it.
 */
function recordOf(window, focusedId) {
    const application = window.application
    const screen = window.screen
    return {
        window,
        state: {
            id: window.id,
            title: window.title || "",
            application: application ? (application.name || "") : "",
            bundleID: application ? application.bundleID : null,
            screenName: screen ? screen.name : null,
            minimized: Boolean(window.isMinimized),
            fullscreen: Boolean(window.isFullscreen),
            hidden: application ? Boolean(application.isHidden) : false,
            focused: window.id === focusedId
        }
    }
}

/**
 * The windows to offer, most recently used first, from hs.windowfilter. Windows that existed
 * before hs.windowfilter started observing, and have not been focused since, follow in their
 * order on screen, front to back.
 */
function switchable() {
    filterStart()
    return filter ? filter.windows("focusedLast") : []
}

/**
 * Every switchable window, most recently used first, as `{window, state}` records. The values in
 * `state` are read from each window, so this is called once each time a chooser opens.
 */
function allRecords() {
    const windows = switchable()
    const focusedId = windows.length ? windows[0].id : null
    return windows.map((window) => recordOf(window, focusedId))
}

/**
 * The records without the focused window's. A chooser leaves the focused window out, because
 * choosing it would change nothing, so the window used before it is the first row, which the
 * chooser selects when it opens.
 */
function withoutFocused(records) {
    return records.filter((record) => !record.state.focused)
}

/**
 * Records for one application, most recently used first. Defaults to the focused one.
 *
 * Which application that is comes from hs.windowfilter's order of use, whose first window is
 * the focused one, not from hs.window.focusedWindow(), which waits on the frontmost application.
 */
function applicationRecords(application) {
    const ordered = allRecords()
    let wanted = application
    if (!wanted) {
        const current = ordered.find((record) => record.state.focused) || ordered[0]
        wanted = current ? current.state.application : null
    }
    if (!wanted) return []
    return ordered.filter((record) => record.state.application === wanted)
}

/**
 * The most recently used window of each application.
 *
 * The list is already in use order, so the first record seen for an application is the one
 * to offer for it.
 */
function firstRecordPerApplication() {
    const seen = new Set()
    return allRecords().filter((record) => {
        if (seen.has(record.state.application)) return false
        seen.add(record.state.application)
        return true
    })
}

// MARK: - The thumbnail
//
// Drawn on a canvas beside the chooser. The chooser's onSelectionChange redraws it whenever the
// selection moves to another row (Hammerspoon 2 issue #390).

/**
 * Where to draw the preview: to the left of the chooser, at most a fraction of the screen
 * high, and never enlarged beyond the snapshot's own size.
 *
 * The height ratio is a maximum rather than a target, which is what Hammerspoon 1 does.
 * Scaling a snapshot up to a fixed fraction of the screen makes a small window's picture
 * both blurry and larger than the window it stands for, and makes a wide window's picture
 * wider than the space beside the chooser.
 *
 * Hammerspoon 1 read the chooser's own y by searching hs.window.allWindows() for
 * Hammerspoon's "Chooser" window, which costs about 0.1 s. chooserGeometry() reads the
 * chooser's frame instead, which hs.chooser reports while it is visible (Hammerspoon 2 issue
 * #449). Before it is shown, the position is computed from the screen and the chooser's width
 * fraction, and config.thumbnailTopRatio sets the height it sits at.
 */
function thumbnailFrame(image) {
    const screen = hs.screen.main() || hs.screen.primary()
    if (!screen) return null

    // frame rather than fullFrame: the menu bar and the dock are not usable space, and
    // Hammerspoon 1 sizes against the usable area.
    const area = screen.frame
    const size = image.size
    if (!size || !size.w || !size.h) return null

    let height = Math.min(area.h * config.thumbnailHeightRatio, size.h)
    let width = size.w * (height / size.h)

    // The chooser is centred, so the space beside it is what is left on one side. A wide
    // snapshot is narrowed to fit rather than sliding under the chooser or off the screen.
    const chooser = chooserGeometry(area)
    const available = (chooser.left - area.x) - config.thumbnailGap * 2
    if (available > 0 && width > available) {
        height = height * (available / width)
        width = available
    }

    // Top aligned with the chooser, right edge just short of its left edge, as in
    // Hammerspoon 1.
    const left = chooser.left - config.thumbnailGap - width
    const top = chooser.top

    // A canvas is placed in screen coordinates, as hs.screen and hs.window are.
    return { x: left, y: top, w: width, h: height }
}

function hideThumbnail() {
    if (!overlay) return
    overlay.destroy()
    overlay = null
    lastDrawnId = null
}

function drawThumbnail(image) {
    hideThumbnail()
    if (!image) return

    const frame = thumbnailFrame(image)
    if (!frame) return

    overlay = hs.canvas.create(frame)
        .level("popUpMenu")
        .ignoreMouseEvents(true)
        .behaviorList(["canJoinAllSpaces", "stationary"])

    overlay.appendElements([
        {
            type: "rectangle",
            action: "fill",
            fillColor: { red: 0, green: 0, blue: 0, alpha: 0.55 },
            frame: { x: 0, y: 0, w: frame.w, h: frame.h },
            roundedRectRadii: { xRadius: 10, yRadius: 10 }
        },
        {
            type: "image",
            image: image,
            frame: { x: 4, y: 4, w: frame.w - 8, h: frame.h - 8 },
            imageScaling: "scaleProportionally",
            imageAlignment: "center"
        }
    ])
    overlay.show()
}

/**
 * Show the picture for a window, taking it if it has not been taken already.
 *
 * A snapshot costs on the order of 150ms, so one is taken per window and kept for as long
 * as the chooser is open. Passing `force` retakes it.
 */
function showThumbnailFor(id, force) {
    if (!showingThumbnail) return
    if (id === null || id === undefined) {
        hideThumbnail()
        return
    }

    if (!force && thumbnails.has(id)) {
        if (id !== lastDrawnId) {
            drawThumbnail(thumbnails.get(id))
            lastDrawnId = id
        }
        return
    }

    const window = sessionWindows.get(id)
    if (!window) {
        hideThumbnail()
        return
    }

    // One request per window at a time. lastDrawnId is not set until the snapshot arrives, so
    // without this, moving the selection away from a window and back before its snapshot
    // arrives would ask for the same window again, and holding down an arrow key would pile
    // requests on a window that is slow to capture.
    if (pendingSnapshots.has(id) && !force) return
    pendingSnapshots.add(id)

    window.snapshot().then((image) => {
        pendingSnapshots.delete(id)
        if (!image) return
        thumbnails.set(id, image)
        // The selection may have moved on while the snapshot was being taken.
        if (showingThumbnail && selectedWindowId() === id) {
            drawThumbnail(image)
            lastDrawnId = id
        }
    }, () => {
        // A window that cannot be captured simply has no picture.
        pendingSnapshots.delete(id)
    })
}

function selectedWindowId() {
    if (!chooser || !chooser.isVisible) return null
    const row = chooser.selectedRow
    const contents = chooser.selectedRowContents(row)
    return contents && contents.id !== undefined ? contents.id : null
}

// MARK: - Keys bound while the chooser is open

function takeSessionKeys() {
    releaseSessionKeys()

    const toggle = hs.hotkey.bind([], config.thumbnailToggleKey, () => {
        showingThumbnail = !showingThumbnail
        if (showingThumbnail) showThumbnailFor(selectedWindowId())
        else hideThumbnail()
    }, null)

    const refresh = hs.hotkey.bind(["shift"], config.thumbnailRefreshKey, () => {
        lastDrawnId = null
        showThumbnailFor(selectedWindowId(), true)
    }, null)

    // The opening key with Shift moves the selection up. When that chord is bound to something
    // else, such as another command of the user's, hs.hotkey.bind() refuses it, and that other
    // command runs instead; when it is one of this Spoon's choosers, chooseFrom() moves up.
    // The opening key itself is always bound already, so it is not bound here: its function
    // runs again, and chooseFrom() moves the selection down.
    let up = null
    if (sessionOpeningKey && !sessionOpeningKey.mods.includes("shift")) {
        up = hs.hotkey.bind(sessionOpeningKey.mods.concat(["shift"]), sessionOpeningKey.key, () => selectionMove(-1), null)
    }

    sessionKeys = [toggle, refresh, up].filter(Boolean)
}

// MARK: - Moving the selection with the opening key

/** The key whose function is running, from this Spoon's bindHotkeys() or hs_interactive-gt. */
function keyNow() {
    if (ownKeyRunning) return ownKeyRunning
    const interactive = hs.spoons["hs_interactive-gt"]
    return interactive && typeof interactive.keyRunning === "function" ? interactive.keyRunning() : null
}

const modifiersOf = (key) => key.mods.map((m) => String(m).toLowerCase()).sort().join("+")

/** Whether two keys are the same chord, `b` with Shift added when `shifted` is true. */
function sameKey(a, b, shifted) {
    if (!a || !b || String(a.key).toLowerCase() !== String(b.key).toLowerCase()) return false
    const wanted = shifted ? { mods: b.mods.concat(["shift"]) } : b
    return modifiersOf(a) === modifiersOf(wanted)
}

/**
 * Move the open chooser's selection by one row, down for 1 and up for -1, wrapping round at
 * either end. The chooser keeps selectedRow within the rows that match what was typed.
 */
function selectionMove(delta) {
    if (!chooser || !chooser.isVisible) return
    const row = chooser.selectedRow
    const next = row + delta
    if (delta > 0) chooser.selectedRow = chooser.selectedRowContents(next) ? next : 0
    else if (next < 0) chooser.selectedRow = Number.MAX_SAFE_INTEGER
    else chooser.selectedRow = next
}

function releaseSessionKeys() {
    for (const key of sessionKeys) {
        if (key) key.destroy()
    }
    sessionKeys = []
}

// MARK: - The chooser

// Built from the tracker's state rather than by reading the window again, except for `space`,
// which spaceLabel() reads.
function subTextFor(state, space) {
    const parts = [state.application || "?"]
    if (state.screenName) parts.push(state.screenName)
    if (space) parts.push(space)
    if (state.minimized) parts.push("minimized")
    if (state.hidden) parts.push("hidden")
    return parts.join("  ·  ")
}

function choicesFor(records, windowless = []) {
    // One icon per application rather than one per row.
    const icons = new Map()
    const iconFor = (bundleID) => {
        if (!bundleID) return null
        if (!icons.has(bundleID)) icons.set(bundleID, HSImage.fromAppBundle(bundleID))
        return icons.get(bundleID)
    }

    const current = currentSpaceIds()
    const windowRows = records.map(({ window, state }) => ({
        text: state.title || state.application || "window",
        subText: subTextFor(state, spaceLabel(window, current)),
        image: iconFor(state.bundleID),
        id: state.id
    }))
    const applicationRows = windowless.map(({ application, inaccessible }) => ({
        text: `${application.name} ${inaccessible ? "(windows are not accessible)" : "(no windows)"}`,
        // A copy whose windows are not accessible usually shares its bundle with one that is listed, so
        // its pid tells the two apart.
        subText: inaccessible ? `${application.bundleID}  ·  pid ${application.pid}` : application.bundleID,
        image: iconFor(application.bundleID),
        pid: application.pid
    }))
    return windowRows.concat(applicationRows)
}

/** The ids of the Spaces the screens are showing. */
function currentSpaceIds() {
    const current = new Set()
    for (const screen of hs.screen.all()) {
        try {
            for (const space of screen.spaces || []) if (space.isCurrent) current.add(space.id)
        } catch (e) {
            // A screen whose Spaces cannot be read adds none.
        }
    }
    return current
}

/**
 * Where a window is when its screen is not showing it: "Desktop 2" for a window on another
 * desktop, or "fullscreen" for a window in fullscreen on a Space that is not being shown, which
 * holds that one window. Null for a window on a Space being shown, and when the window's Spaces
 * cannot be read.
 *
 * window.spaces is answered by the window server (SLSCopySpacesForWindows), not by the
 * application, so an application that does not answer cannot slow it down. It took about 1 ms
 * per window on 2026-11-24, so it is read for every row when a chooser opens. isVisible cannot be
 * used instead: a window on another desktop reported it true.
 *
 * @param {object} window The window.
 * @param {Set} current The ids of the Spaces being shown, from currentSpaceIds().
 * @returns {?string} The label, or null.
 */
function spaceLabel(window, current) {
    let spaces
    try {
        spaces = window.spaces
    } catch (e) {
        return null
    }
    if (!spaces || spaces.length === 0 || spaces.some((space) => current.has(space.id))) return null
    const space = spaces[0]
    if (space.type === "fullscreen") return "fullscreen"
    const number = space.desktopNumber
    return number ? `Desktop ${number}` : null
}

/**
 * The running applications that have no window among `records`, so that they can be switched
 * to as well. Hammerspoon 1's Spoon listed them the same way.
 *
 * Only standard applications, those with a Dock icon, are listed, one per bundle, and not the
 * frontmost one. An application counts as having windows when any window of its bundle is in
 * `records`: a second copy of an application, such as Firefox started in kiosk mode, is not
 * listed beside the first. Listing them costs about 20 ms for 130 processes, measured on
 * 2026-11-24, paid once each time a chooser opens.
 *
 * The applications that have turned the Accessibility API off, such as Firefox in kiosk mode,
 * follow. hs.windowfilter cannot read their windows, so they never have a window row, but they
 * exist and can be activated. They are listed even when another copy of the application has
 * windows, as a second Firefox in kiosk mode beside a normal one does. hs.windowfilter holds
 * this list while this Spoon's filter has a listener, so reading it calls no application.
 *
 * @param {Array} records The window records the chooser lists.
 * @returns {Array} `{application, inaccessible}` objects: those without windows by name, then
 *          those whose windows are not accessible, by name.
 */
function windowlessApplications(records) {
    const frontmost = hs.application.frontmost()
    const frontmostPid = frontmost ? frontmost.pid : null
    filterStart()
    const inaccessible = windowfilterRequired().inaccessibleApplications()
        .filter((application) => application.name && application.pid !== frontmostPid)
    const inaccessiblePids = new Set(inaccessible.map((application) => application.pid))

    const listed = new Set(records.map(({ state }) => state.bundleID || state.application))
    if (frontmost && frontmost.bundleID) listed.add(frontmost.bundleID)
    const found = new Map()
    for (const application of hs.application.runningApplications()) {
        const bundleID = application.bundleID
        if (!bundleID || !application.name || application.kind !== "standard") continue
        // An application whose windows are not accessible has a row of its own, below.
        if (listed.has(bundleID) || found.has(bundleID) || inaccessiblePids.has(application.pid)) continue
        found.set(bundleID, application)
    }
    const byName = (a, b) => a.name.localeCompare(b.name)
    return [...found.values()].sort(byName).map((application) => ({ application, inaccessible: false }))
        .concat(inaccessible.sort(byName).map((application) => ({ application, inaccessible: true })))
}

/**
 * Bring an application without windows to the front, by its pid. activate() can be refused
 * by macOS, and setFrontmost() is tried then, as Hammerspoon 1's Spoon did.
 *
 * @returns {boolean} Whether the application came to the front.
 */
function applicationActivate(pid) {
    const application = hs.application.runningApplications().find((a) => a.pid === pid)
    if (!application) return false
    return application.activate(true) || application.setFrontmost(true)
}

function chooserWidth() {
    const screen = hs.screen.main() || hs.screen.primary()
    if (!screen) return config.width
    return screen.fullFrame.w > config.wideScreenPoints ? config.wideWidth : config.width
}

/**
 * Where the chooser is on screen.
 *
 * An open chooser gives its frame, in screen coordinates. Before it is shown there is no
 * frame, and the position is computed instead: hs.chooser centres a window of config.width,
 * and config.thumbnailTopRatio stands for its height on the screen.
 */
function chooserGeometry(area) {
    const frame = chooser && chooser.isVisible ? chooser.frame : null
    if (frame) return { left: frame.x, width: frame.w, top: frame.y }

    const width = area.w * chooserWidth()
    const left = area.x + (area.w - width) / 2
    const top = area.y + area.h * config.thumbnailTopRatio
    return { left, width, top }
}

/**
 * Show a chooser over a list of windows, and focus whichever is chosen.
 *
 * @param {Array} windows The windows to offer, in the order to offer them.
 * @param {string} placeholder Prompt text.
 */
function chooseFrom(all, placeholder, windowless = [], choose = focusWindowById) {
    // The key that opened the open chooser, pressed again, moves its selection instead of
    // opening another chooser: down, or up with Shift. Hammerspoon 1's Spoon did the same.
    const key = keyNow()
    if (chooser && chooser.isVisible && sessionOpeningKey && key) {
        if (sameKey(key, sessionOpeningKey, false)) {
            selectionMove(1)
            return chooser
        }
        if (sameKey(key, sessionOpeningKey, true)) {
            selectionMove(-1)
            return chooser
        }
    }

    const records = withoutFocused(all)
    if (!records.length && !windowless.length) {
        hs.ui.alert("No windows to choose from").duration(2).show()
        return null
    }

    // With one row, config.singleRowSwitch switches to it without showing a chooser.
    if (config.singleRowSwitch && records.length + windowless.length === 1) {
        if (records.length) choose(records[0].state.id)
        else applicationActivate(windowless[0].application.pid)
        return null
    }

    filterStart()

    // A chooser already open is closed first. Its own callbacks then find that it is no longer
    // the current chooser, and do not report the new one's prompt as closed.
    chooserClose()
    sessionOpeningKey = key

    sessionWindows = new Map(records.map((r) => [r.state.id, r.window]))
    if (!config.persistentThumbnailCache) thumbnails = new Map()
    pendingSnapshots = new Set()
    showingThumbnail = config.showThumbnail
    lastDrawnId = null

    const own = hs.chooser.create()
    chooser = own
    own.placeholder = placeholder || "Window"
    own.searchSubText = true
    own.visibleRows = config.rowsToDisplay
    own.width = chooserWidth()
    for (const name of ["textSize", "subTextSize", "querySize"]) {
        if (config[name] !== null && config[name] !== undefined) own[name] = config[name]
    }

    own.setChoices(choicesFor(records, windowless))

    // onShow and onHide act only while their chooser is the current one, so that a chooser
    // closed by a newer one does not end the newer one's session.
    //
    // onSelect is not checked in that way. hs.chooser calls onHide before onSelect, so by the
    // time onSelect runs, onHide has already ended this chooser's session. onSelect runs only
    // when the user chooses or dismisses in the visible chooser, never when code hides it.
    own.onSelect = (item) => {
        if (chooser === own) finishChoosing()
        if (!item) return
        if (item.pid !== undefined) applicationActivate(item.pid)
        else if (item.id !== undefined) choose(item.id)
    }

    own.onShow = () => {
        if (chooser !== own) return
        takeSessionKeys()
    }

    // Called once when the chooser is shown, right after onShow, and then each time the
    // selection moves to another row. A row of an application without windows has no id, and
    // no thumbnail.
    own.onSelectionChange = (row, item) => {
        if (chooser !== own) return
        showThumbnailFor(item && item.id !== undefined ? item.id : null)
    }

    own.onHide = () => {
        if (chooser === own) finishChoosing()
    }

    // Reported as a prompt of hs_interactive-gt, so that promptIsOpen() is true while it is
    // open and hs_menu-gt gives up its letter keys. finishChoosing() reports the close.
    spoonRequired("hs_interactive-gt").promptOpened()
    promptHeld = true
    own.show()
    return own
}

/** Close the open chooser, if there is one, ending its session first. */
function chooserClose() {
    const open = chooser
    if (!open) return
    finishChoosing()
    open.hide()
}

function finishChoosing() {
    // onSelect and onHide both call this, so the close is reported once only.
    if (promptHeld) {
        promptHeld = false
        const interactive = hs.spoons["hs_interactive-gt"]
        if (interactive) interactive.promptClosed()
    }
    releaseSessionKeys()
    sessionOpeningKey = null
    hideThumbnail()
    if (!config.persistentThumbnailCache) thumbnails = new Map()
    pendingSnapshots = new Set()
    sessionWindows = new Map()
    chooser = null
}

/**
 * Move a window off a screen showing a fullscreen window, when config.fullscreenScreenSkip
 * asks for it.
 *
 * Focusing a window on such a screen makes macOS leave the fullscreen window's Space to show
 * it. Moving the window first to a screen that is not showing a fullscreen window leaves the
 * fullscreen window in place. The screens are tried in order, starting with the one after the
 * window's own.
 *
 * Nothing is moved when the window is itself fullscreen or minimized, when there is only one
 * screen, or when every other screen is showing a fullscreen window too.
 *
 * @returns {boolean} Whether the window was moved.
 */
function fullscreenScreenLeave(window) {
    if (!config.fullscreenScreenSkip) return false
    if (window.isFullscreen || window.isMinimized) return false

    const screens = hs.screen.all()
    if (screens.length < 2) return false
    const current = window.screen
    if (!current) return false

    const occupied = spoonRequired("hs_window-gt").fullscreenScreenIds()
    if (!occupied.has(current.id)) return false

    const index = screens.findIndex((s) => s.id === current.id)
    let target = null
    for (let n = 1; n < screens.length; n++) {
        const candidate = screens[(index + n) % screens.length]
        if (!occupied.has(candidate.id)) {
            target = candidate
            break
        }
    }
    if (!target) return false

    // hs_window-gt steps over the same screens in the same order, so it arrives at the same
    // target. It also remembers where the window was on each screen, which brings it back
    // to the same place when it is moved back.
    return spoonRequired("hs_window-gt").windowToScreenMove("next", window)
}

/**
 * Focus a window by id, bringing its application forward.
 *
 * Through hs_window-gt, so that both Spoons focus windows the same way.
 * See fullscreenScreenLeave() for what happens when the window is on a screen showing a
 * fullscreen window.
 */
function focusWindowById(id) {
    // From the chooser's own list when one is open, so that choosing a window does not pay
    // to enumerate them all over again.
    const window = sessionWindows.get(id) || switchable().find((w) => w.id === id)
    if (!window) return false

    fullscreenScreenLeave(window)

    // hs_window-gt focuses a window more reliably than window.focus() alone; see its
    // windowFocus().
    return spoonRequired("hs_window-gt").windowFocus(window)
}

// MARK: - Public API

// MARK: - The current Space
//
// The current Space is the one shown on the screen that has the focus, as in the Hammerspoon 1
// Spoon's _ws bindings. A window is on it when any of its Spaces is that one, so a window shown on
// every Space counts. window.spaces is answered by the window server, about 1 ms per window.

/** The Space shown on the screen that has the focus, or null when it cannot be read. */
function currentSpace() {
    try {
        return hs.screen.focusedSpace()
    } catch (e) {
        return null
    }
}

/** Whether a window is on a Space, by the Space's id. */
function onSpace(window, spaceId) {
    try {
        return window.spaces.some((space) => space.id === spaceId)
    } catch (e) {
        return false
    }
}

/**
 * The records whose windows are on the current Space, or every record when `options.currentSpace`
 * is not true. Every record is kept, too, when the current Space cannot be read.
 */
function recordsForSpace(records, options) {
    if (!options || !options.currentSpace) return records
    const space = currentSpace()
    if (!space) return records
    return records.filter(({ window }) => onSpace(window, space.id))
}

/**
 * Choose from every switchable window, most recently used first, followed by the running
 * applications that have no windows.
 *
 * @param {object} [options] `{ currentSpace: true }` lists only the windows on the current Space,
 *        and no applications, since an application without windows is on no Space.
 */
function windowSelect(options) {
    const records = recordsForSpace(allRecords(), options)
    const windowless = options && options.currentSpace ? [] : windowlessApplications(records)
    return chooseFrom(records, "Window", windowless)
}

/**
 * Choose from the focused application's windows.
 *
 * @param {string} [application] The application's name. Defaults to the focused one.
 * @param {object} [options] `{ currentSpace: true }` lists only its windows on the current Space.
 */
function applicationWindowSelect(application, options) {
    const records = recordsForSpace(applicationRecords(application), options)
    const name = records.length ? records[0].state.application : "Application"
    return chooseFrom(records, name)
}

/**
 * Choose a window, bring it to the current Space and to the screen that has the focus, and focus
 * it. The chooser lists every window, as windowSelect() does, without the applications.
 */
function windowToCurrentSpaceSelect() {
    const here = hs.window.focusedWindow()
    const screen = here && here.screen ? here.screen : hs.screen.main()
    const space = currentSpace()
    return chooseFrom(allRecords(), "Window to bring here", [], (id) => {
        windowToCurrentSpaceBring(id, screen, space)
    })
}

/**
 * Bring a window to a Space and a screen, and focus it, as the Hammerspoon 1 Spoon's
 * all_windows_move_to_current_workspace did. A minimized window is restored. hs_window-gt moves
 * the window between screens, keeping its place within the screen.
 *
 * A window in fullscreen is refused, with an alert: it has a Space of its own, and Hammerspoon 1
 * took it out of fullscreen first. The user decided on 2026-11-24 to refuse it for the time being.
 *
 * @returns {Promise<boolean>} Whether the window was brought and focused.
 */
async function windowToCurrentSpaceBring(id, screen, space) {
    const window = sessionWindows.get(id) || switchable().find((w) => w.id === id)
    // A window that closed while the chooser was open can still be in hs.windowfilter's list
    // for a moment, so it is looked up again: hs.window.forID() returns null for a window that
    // has closed.
    if (!window || !hs.window.forID(window.id)) {
        hs.ui.alert("The window is no longer open").duration(3).show()
        return false
    }
    if (window.isFullscreen) {
        hs.ui.alert("The window is in fullscreen, and cannot be brought here").duration(3).show()
        return false
    }
    try {
        if (window.isMinimized) window.unminimize()
        if (space && !onSpace(window, space.id)) await window.moveToSpace(space)
        const windowScreen = window.screen
        if (screen && windowScreen && windowScreen.id !== screen.id) {
            await spoonRequired("hs_window-gt").windowToScreenMove(screen, window)
        }
    } catch (e) {
        hs.ui.alert(`Could not bring the window here: ${e && e.message ? e.message : e}`).duration(3).show()
        return false
    }
    return spoonRequired("hs_window-gt").windowFocus(window)
}


/**
 * Choose from the most recently used window of each application, followed by the running
 * applications that have no windows.
 */
function applicationSelect() {
    const records = firstRecordPerApplication()
    return chooseFrom(records, "Application", windowlessApplications(records))
}

/**
 * Go straight to the previously used window, with no chooser.
 *
 * The first entry in the order is the window in front now, so the second is the one before.
 *
 * @param {object} [options] `{ currentSpace: true }` takes the previous window on the current
 *        Space.
 */
function windowPreviousSelect(options) {
    const records = recordsForSpace(allRecords(), options)
    if (records.length < 2) {
        hs.ui.alert("No previous window").duration(2).show()
        return false
    }
    return focusWindowById(records[1].state.id)
}

/**
 * Switch to an application's current window, or back again when already there.
 *
 * Pressing the same key twice returns you to what you were doing, which makes one key per
 * application a way of moving between two of them rather than only of reaching one.
 *
 * Matched on bundle identifier rather than on name: a name can be changed by a localisation
 * or shared by two applications, while the identifier is what the application is.
 *
 * "Back again" is the most recently used window that is *not* this application's, rather
 * than simply the previous window. Otherwise an application with two windows would toggle
 * between its own, which is what applicationWindowPreviousSelect() is for.
 *
 * An application that is not running, or is running with no window yet tracked, is launched
 * or brought forward.
 *
 * With a title pattern, only the application's windows whose title matches it are wanted,
 * and the first of those in most-recently-used order is the one switched to. "Back again"
 * then means the most recently used window that does not match, which may be another window
 * of the same application. When the application has windows but none of them matches, the
 * application's current window is used instead, as if no pattern had been given, and an
 * alert says so. The pattern is looked up each time, so a window that is closed and opened
 * again with a matching title is found without anything being rebound.
 *
 * @param {string} bundleID For example "com.apple.Safari".
 * @param {RegExp|string} [titlePattern] Matched against window titles with
 *        String.prototype.search, so a RegExp with the g or y flag behaves like one without.
 *        A string is compiled with new RegExp(). An empty string or an empty RegExp is the
 *        same as no pattern: the application's windows are switched to as usual.
 * @returns {boolean} Whether anything was switched to.
 */
function applicationByBundleSelect(bundleID, titlePattern) {
    if (!bundleID) {
        hs.ui.alert("No bundle identifier given").duration(2).show()
        return false
    }

    let pattern = null
    if (titlePattern !== undefined && titlePattern !== null && titlePattern !== "") {
        try {
            pattern = titlePattern instanceof RegExp ? titlePattern : new RegExp(titlePattern)
        } catch (e) {
            hs.ui.alert(`Bad title pattern ${titlePattern}\n${e.message}`).duration(3).show()
            return false
        }
        // An empty RegExp matches every title, so it is the same as no pattern at all.
        if (pattern.source === "(?:)") pattern = null
    }

    const ordered = allRecords()
    const theirs = ordered.filter((record) => record.state.bundleID === bundleID)

    if (!theirs.length) {
        // Nothing tracked for it, so it may not be running at all. launchOrFocus starts it
        // or brings it forward; there is no window here to focus.
        hs.application.launchOrFocus(bundleID)
        return true
    }

    // The windows being switched to: those whose title matches, or every window of the
    // application when there is no pattern or nothing matches it.
    let wanted = theirs
    if (pattern) {
        const matching = theirs.filter((record) => (record.state.title || "").search(pattern) !== -1)
        if (matching.length) {
            wanted = matching
        } else {
            const name = theirs[0].state.application || bundleID
            hs.ui.alert(`No ${name} window matches ${pattern}\nusing its current window`)
                .duration(2).show()
        }
    }

    const isWanted = (record) => wanted.includes(record)
    const current = ordered.find((record) => record.state.focused)
    if (current && isWanted(current)) {
        const away = ordered.find((record) => !isWanted(record))
        if (!away) {
            hs.ui.alert(wanted === theirs ? "No window outside this application"
                                          : "No other window to go back to").duration(2).show()
            return false
        }
        return focusWindowById(away.state.id)
    }

    return focusWindowById(wanted[0].state.id)
}

/**
 * Go straight to the previously used window of the focused application.
 *
 * @param {object} [options] `{ currentSpace: true }` takes its previous window on the current
 *        Space.
 */
function applicationWindowPreviousSelect(options) {
    const records = recordsForSpace(applicationRecords(), options)
    if (records.length < 2) {
        hs.ui.alert("No previous window in this application").duration(2).show()
        return false
    }
    return focusWindowById(records[1].state.id)
}

// MARK: - Finding windows for other scripts
//
// Ported from the Hammerspoon 1 Spoon's findByTitle, focusByTitle, focusByApp, focusByAppAndTitle
// and nextFullScreen. Each looks through the windows this Spoon tracks, most recently used first,
// so "the first window that matches" is the most recently used one, and each Select function
// switches to it through hs_window-gt, as the chooser does. Lua's string.find took a pattern; a
// title or name here is a RegExp, or a string compiled with new RegExp().

/**
 * A RegExp from a string or a RegExp, or null with an alert when it is missing or not valid.
 *
 * @param {RegExp|string} pattern The pattern.
 * @param {string} what What it is matched against, for the alert.
 */
function patternCompile(pattern, what) {
    if (pattern === undefined || pattern === null || pattern === "") {
        hs.ui.alert(`No ${what} given`).duration(2).show()
        return null
    }
    try {
        return pattern instanceof RegExp ? pattern : new RegExp(pattern)
    } catch (e) {
        hs.ui.alert(`Bad ${what} pattern ${pattern}\n${e.message}`).duration(3).show()
        return null
    }
}

const matches = (text, regex) => (text || "").search(regex) !== -1

/** Focuses a record's window, and returns the window. */
function recordSelect(record) {
    focusWindowById(record.state.id)
    return record.window
}

/**
 * The most recently used window whose title matches `pattern`, without focusing it.
 *
 * @param {RegExp|string} pattern Matched against the title with String.prototype.search.
 * @returns {?object} The HSWindow, or null when none matches. An alert says why when the
 *          pattern is missing or not valid.
 */
function windowByTitleFind(pattern) {
    const regex = patternCompile(pattern, "title")
    if (!regex) return null
    const record = allRecords().find((r) => matches(r.state.title, regex))
    return record ? record.window : null
}

/**
 * Focus the most recently used window whose title matches `pattern`.
 *
 * @param {RegExp|string} pattern Matched against the title with String.prototype.search.
 * @returns {?object} The window focused, or null, with an alert, when none matches.
 */
function windowByTitleSelect(pattern) {
    const regex = patternCompile(pattern, "title")
    if (!regex) return null
    const record = allRecords().find((r) => matches(r.state.title, regex))
    if (!record) {
        hs.ui.alert(`No window's title matches ${regex}`).duration(2).show()
        return null
    }
    return recordSelect(record)
}

/**
 * Focus the most recently used window of an application whose name matches `pattern`.
 *
 * @param {RegExp|string} pattern Matched against the application's name.
 * @returns {?object} The window focused, or null, with an alert, when no application matches.
 */
function applicationByNameSelect(pattern) {
    const regex = patternCompile(pattern, "application name")
    if (!regex) return null
    const record = allRecords().find((r) => matches(r.state.application, regex))
    if (!record) {
        hs.ui.alert(`No application's name matches ${regex}`).duration(2).show()
        return null
    }
    return recordSelect(record)
}

/**
 * Focus the most recently used window of the application named exactly `name` whose title
 * matches `pattern`.
 *
 * @param {string} name The application's name, as it appears beneath a row's title.
 * @param {RegExp|string} pattern Matched against the title.
 * @returns {?object} The window focused, or null, with an alert, when none matches.
 */
function applicationWindowByTitleSelect(name, pattern) {
    if (!name) {
        hs.ui.alert("No application name given").duration(2).show()
        return null
    }
    const regex = patternCompile(pattern, "title")
    if (!regex) return null
    const record = allRecords().find((r) => r.state.application === name && matches(r.state.title, regex))
    if (!record) {
        hs.ui.alert(`No ${name} window's title matches ${regex}`).duration(2).show()
        return null
    }
    return recordSelect(record)
}

/**
 * Focus the most recently used window in fullscreen, other than the focused one.
 *
 * @returns {?object} The window focused, or null, with an alert, when there is none.
 */
function fullscreenWindowNextSelect() {
    const record = withoutFocused(allRecords()).find((r) => r.state.fullscreen)
    if (!record) {
        hs.ui.alert("No other window is in fullscreen").duration(2).show()
        return null
    }
    return recordSelect(record)
}

/** The windows windowSelect() offers, in its order, as titles. For looking at the ordering. */
function order() {
    return withoutFocused(allRecords()).map(({ state }) => `${state.application}: ${state.title}`)
}

let hotkeys = []

// The functions a key can run, as hs_window-gt does it: the names are the functions' own.
// MARK: - The menu
//
// The menu hs_menu-gt displays for this Spoon. Every option opens a chooser, which needs the
// keyboard, or switches at once, so the menu closes after each.

/**
 * The window-switching menu, for hs_menu-gt: menuShow() displays it, and a menu of your own can
 * include it as a submenu with `children: hs.spoons["hs_selectWindow-gt"].menu`.
 */
const menu = {
    keepOpen: false,
    buttons: [
        { label: "All windows", icon: "symbol:macwindow.on.rectangle", key: "b", fn: () => module.exports.windowSelect() },
        { label: "Windows here", icon: "symbol:rectangle.stack", key: "s", fn: () => module.exports.windowSelect({ currentSpace: true }) },
        { label: "App windows", icon: "symbol:square.stack", key: "a", fn: () => module.exports.applicationWindowSelect() },
        { label: "App windows here", icon: "symbol:square.stack.fill", key: "h",
          fn: () => module.exports.applicationWindowSelect(undefined, { currentSpace: true }) },
        { label: "Applications", icon: "symbol:square.grid.2x2", key: "t", fn: () => module.exports.applicationSelect() },
        { label: "Previous", icon: "symbol:arrow.uturn.backward", key: "p", fn: () => module.exports.windowPreviousSelect() },
        { label: "Previous here", icon: "symbol:arrow.uturn.backward.circle", key: "o",
          fn: () => module.exports.windowPreviousSelect({ currentSpace: true }) },
        { label: "App previous", icon: "symbol:arrow.left.arrow.right", key: "n", fn: () => module.exports.applicationWindowPreviousSelect() },
        { label: "Bring here", icon: "symbol:arrow.down.to.line", key: "m", fn: () => module.exports.windowToCurrentSpaceSelect() },
        { label: "Fullscreen", icon: "symbol:arrow.up.left.and.arrow.down.right", key: "f", fn: () => module.exports.fullscreenWindowNextSelect() },
        { label: "Bindings", icon: "symbol:keyboard", key: "k", fn: () => module.exports.bindingsShow() }
    ]
}

/** Display the window-switching menu on screen, with hs_menu-gt. */
function menuShow() {
    spoonRequired("hs_menu-gt").onScreenShow(menu, { name: "Switch window" })
    return module.exports
}

// The keys bound with bindHotkeys(), as {name, mods, key}, for bindingsShow().
let ownBindings = []

// The canvas bindingsShow() draws, and the timer that removes it.
let bindingsCanvas = null
let bindingsTimer = null
const BINDINGS_SECONDS = 8
const BINDINGS_TEXT = { textFont: "Menlo", textSize: 15, textColor: { red: 1, green: 1, blue: 1, alpha: 1 } }
const BINDINGS_PADDING = 18

/**
 * Show the keys that run this Spoon's functions, in a rectangle in the middle of the screen
 * that has the focus, for BINDINGS_SECONDS: those bound with bindHotkeys(), and those bound to
 * the commands defined for this Spoon in the configuration through hs_interactive-gt's use().
 * Commands without a key are left out.
 *
 * It is drawn on a canvas, not with hs.ui.alert, whose shape is a rounded pill that cannot be
 * changed; the user asked for a rectangle on 2026-11-24.
 *
 * @returns {string[]} The lines shown.
 */
function bindingsShow() {
    const interactive = hs.spoons["hs_interactive-gt"]
    const label = (binding) => interactive ? interactive.keyLabel(binding) : `${binding.mods.join("-")}-${binding.key}`
    const lines = ownBindings.map((binding) => `${label(binding)}  ${binding.name}`)
    if (interactive && typeof interactive.commandsOfSpoon === "function") {
        for (const command of interactive.commandsOfSpoon(SPOON_NAME)) {
            if (command.keys.length) lines.push(`${command.keys.join(", ")}  ${command.name}`)
        }
    }
    const text = lines.length ? lines.join("\n") : "No keys run this Spoon's functions"

    bindingsHide()
    const screen = hs.screen.main() || hs.screen.primary()
    const area = screen.frame
    const canvas = hs.canvas.create({ x: area.x, y: 0, w: 10, h: 10 })
    const size = canvas.minimumTextSize(BINDINGS_TEXT, text)
    const w = Math.ceil(size.w) + BINDINGS_PADDING * 2
    const h = Math.ceil(size.h) + BINDINGS_PADDING * 2
    // A canvas is placed in screen coordinates, as hs.screen is.
    canvas.setFrame({ x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h })
    canvas.level("popUpMenu").ignoreMouseEvents(true).behaviorList(["canJoinAllSpaces", "stationary"])
    canvas.appendElements([
        { type: "rectangle", action: "fill", fillColor: { red: 0.1, green: 0.1, blue: 0.1, alpha: 0.9 }, frame: { x: 0, y: 0, w, h } },
        Object.assign({ type: "text", text, frame: { x: BINDINGS_PADDING, y: BINDINGS_PADDING, w: w - BINDINGS_PADDING * 2, h: h - BINDINGS_PADDING * 2 } }, BINDINGS_TEXT)
    ])
    canvas.show()
    bindingsCanvas = canvas
    bindingsTimer = hs.timer.doAfter(BINDINGS_SECONDS, bindingsHide)
    return lines
}

/** Remove what bindingsShow() drew, and stop its timer. */
function bindingsHide() {
    if (bindingsTimer) {
        bindingsTimer.stop()
        bindingsTimer = null
    }
    if (bindingsCanvas) {
        bindingsCanvas.destroy()
        bindingsCanvas = null
    }
}

// What each name bindHotkeys() accepts runs. The names ending in CurrentSpace run a function
// with { currentSpace: true }.
const HOTKEY_FUNCTIONS = {
    windowSelect: () => module.exports.windowSelect(),
    applicationWindowSelect: () => module.exports.applicationWindowSelect(),
    applicationSelect: () => module.exports.applicationSelect(),
    windowPreviousSelect: () => module.exports.windowPreviousSelect(),
    applicationWindowPreviousSelect: () => module.exports.applicationWindowPreviousSelect(),
    windowToCurrentSpaceSelect: () => module.exports.windowToCurrentSpaceSelect(),
    windowSelectCurrentSpace: () => module.exports.windowSelect({ currentSpace: true }),
    applicationWindowSelectCurrentSpace: () => module.exports.applicationWindowSelect(undefined, { currentSpace: true }),
    windowPreviousSelectCurrentSpace: () => module.exports.windowPreviousSelect({ currentSpace: true }),
    applicationWindowPreviousSelectCurrentSpace: () => module.exports.applicationWindowPreviousSelect({ currentSpace: true }),
    menuShow: () => module.exports.menuShow()
}

function hotkeysRelease() {
    for (const key of hotkeys) {
        if (key) key.destroy()
    }
    hotkeys = []
    ownBindings = []
}

/**
 * Bind keys to the Spoon's functions. `hs.spoons.use()` calls this with its `hotkeys` option.
 * A second call releases the keys of the first.
 *
 * @param {object} mapping Keyed by function name, each holding `[[modifiers], key]`, such as
 *        `{ windowSelect: [["alt"], "b"] }`.
 * @throws For a name that is not in HOTKEY_FUNCTIONS, or a malformed binding. Nothing is bound
 *         in that case.
 */
function bindHotkeys(mapping) {
    const entries = Object.entries(mapping || {})
    for (const [name, binding] of entries) {
        if (!Object.prototype.hasOwnProperty.call(HOTKEY_FUNCTIONS, name)) {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): ${name} is not a function a key can run`)
        }
        if (!Array.isArray(binding) || !Array.isArray(binding[0]) || typeof binding[1] !== "string") {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): ${name} needs [modifiers, key], such as [["alt"], "b"]`)
        }
    }

    hotkeysRelease()
    ownBindings = []
    for (const [name, [mods, key]] of entries) {
        const binding = { mods: mods.slice(), key }
        const hotkey = hs.hotkey.bind(mods, key, () => {
            // keyNow() reports this key while the function runs, as hs_interactive-gt's
            // keyRunning() does for its keys.
            ownKeyRunning = binding
            try {
                HOTKEY_FUNCTIONS[name]()
            } finally {
                ownKeyRunning = null
            }
        }, null)
        if (hotkey) {
            hotkeys.push(hotkey)
            ownBindings.push({ name, mods: mods.slice(), key })
        }
        else console.error(`[${SPOON_NAME}] could not bind ${mods.join("-")} ${key} to ${name}`)
    }
    return module.exports
}

function start() {
    // All four are required. Checked here, so that a missing one is reported when the Spoon
    // starts rather than the first time it is needed.
    spoonRequired("hs_interactive-gt")
    spoonRequired("hs_window-gt")
    spoonRequired("hs_menu-gt")
    filterStart()
    return module.exports
}

function stop() {
    chooserClose()

    if (filter) {
        // A filter with a listener stays active after its last reference is dropped, so the
        // listener is removed.
        filter.off("windowDestroyed", windowDestroyed)
        filter = null
    }
    thumbnails = new Map()
    pendingSnapshots = new Set()

    hotkeysRelease()
    bindingsHide()
    return module.exports
}

module.exports = {
    config,
    windowSelect,
    applicationWindowSelect,
    applicationSelect,
    windowPreviousSelect,
    applicationWindowPreviousSelect,
    windowToCurrentSpaceSelect,
    windowByTitleFind,
    windowByTitleSelect,
    applicationByNameSelect,
    applicationWindowByTitleSelect,
    fullscreenWindowNextSelect,
    menu,
    menuShow,
    bindingsShow,
    applicationByBundleSelect,
    order,
    bindHotkeys,
    start,
    stop
}

// hs.spoons.use()'s config option copies each of its properties onto this Spoon's object, as the
// Hammerspoon 2 Spoons guide describes. The settings live in config, so each one is also a
// property of the object that reads and writes config: both hs.spoons.use(name, { config: {...} })
// and spoon.config.name = value then set it. No setting has the name of an exported function.
for (const name of Object.keys(config)) {
    Object.defineProperty(module.exports, name, {
        get: () => config[name],
        set: (value) => { config[name] = value },
        enumerable: true,
        configurable: true
    })
}
