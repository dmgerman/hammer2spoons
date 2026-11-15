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
// The Spoon needs hs_windowfilter-gt and hs_window-gt, and loads neither itself: the user's
// configuration loads them first. start() checks for both.
//
// Both the list of windows and their order come from hs_windowfilter-gt. That Spoon already
// tracks every window and holds its title, application, screen and flags, kept current by
// the notifications it subscribes to, so this Spoon never enumerates windows itself and
// never reads a property off one. It subscribes to windowFocused and keeps the ids in the
// order they were last focused.
//
// Asking hs.window instead is what made this slow. allWindows(), orderedWindows() and
// visibleWindows() each took about 1.5 s when this was written. They took about 0.1 s for
// 35 windows on 2026-10-24, which is still a visible pause when the switcher opens. Asking
// the tracker takes 1 ms.
//
// Their front-to-back order also leaves out minimized windows and windows of a hidden
// application, which a switcher is precisely for.
//
// Five of the Hammerspoon 1 Spoon's bindings are not ported: all_windows_ws,
// app_windows_ws, previous_window_ws, previous_app_window_ws and
// all_windows_move_to_current_workspace. Every one of them narrows by workspace or moves a
// window between workspaces, and Hammerspoon 2 has no spaces module. The workspace column
// in the chooser subtext is absent for the same reason.

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

    // A picture of the selected window, drawn above the chooser. One snapshot costs around
    // 120ms, so it is taken when a window is first selected rather than for the whole list,
    // and kept while the chooser is open. Tab turns it off and on.
    showThumbnail: false,
    // Largest the picture may be, as a fraction of the usable screen height. A maximum, not
    // a target: a snapshot smaller than this is drawn at its own size rather than enlarged.
    thumbnailHeightRatio: 0.4,
    // How far down the screen the top of the picture sits, as a fraction of screen height.
    // hs.chooser does not report its own frame, so this is set rather than read from it.
    thumbnailTopRatio: 0.12,
    // Gap between the picture and the chooser, in points.
    thumbnailGap: 12,
    // How often the selected row is read while the chooser is open. There is no callback
    // for the selection changing, so it is polled.
    selectionPollSeconds: 0.15,
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

let filter = null                  // the hs_windowfilter-gt instance used for focus order
let focusOrder = []                // window ids, most recently focused first
let chooser = null
let promptHeld = false             // whether the open chooser is reported to hs_interactive-gt
let pollTimer = null
let overlay = null                 // the canvas showing the thumbnail
let thumbnails = new Map()         // window id -> HSImage
let showingThumbnail = config.showThumbnail
let sessionKeys = []               // hotkeys bound only while the chooser is open
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

// MARK: - Most-recently-used order

/**
 * Record that a window was focused, moving it to the front of the order.
 *
 * Called from the window filter rather than polled, so the order is right even for windows
 * that were focused and then minimized.
 */
function noteFocused(id) {
    if (id === null || id === undefined) return
    const at = focusOrder.indexOf(id)
    if (at !== -1) focusOrder.splice(at, 1)
    focusOrder.unshift(id)
}

function startTrackingFocus() {
    if (filter) return

    const windowfilter = spoonRequired("hs_windowfilter-gt")

    // Every window, including minimized ones: a minimized window is exactly what a switcher
    // is for, and its place in the order has to be remembered while it is out of sight.
    filter = windowfilter.create({ rejectApplications: config.skipApplications })
    filter.on("windowFocused", (event, window, state) => noteFocused(state.id))
    filter.on("windowDestroyed", (event, window, state) => {
        const at = focusOrder.indexOf(state.id)
        if (at !== -1) focusOrder.splice(at, 1)
        thumbnails.delete(state.id)
    })

    // Seed with what is open now, so the order is useful before anything has been focused.
    // Beyond the focused window below, the seeding order is arbitrary: the tracker holds
    // its windows by id rather than front to back. One focus change corrects it.
    // hs.window.orderedWindows() would not give a front-to-back order either, because it
    // keeps each application's windows together. See switchableRecords().
    for (const record of filter.records()) noteFocused(record.state.id)

    // The focused window belongs at the front. Taken from the tracker, which knows which
    // window that is; asking hs.window.focusedWindow() would query the frontmost
    // application through accessibility and wait for however long it takes to answer.
    const current = filter.records().find((record) => record.state.focused)
    if (current) noteFocused(current.state.id)
}

/** Records in most-recently-used order. Those never focused come last. */
function recordsByUse(records) {
    const rank = new Map()
    focusOrder.forEach((id, index) => rank.set(id, index))

    return records.slice().sort((a, b) => {
        const one = rank.has(a.state.id) ? rank.get(a.state.id) : Number.MAX_SAFE_INTEGER
        const two = rank.has(b.state.id) ? rank.get(b.state.id) : Number.MAX_SAFE_INTEGER
        return one - two
    })
}

// MARK: - Which windows to offer

/**
 * The windows to offer, with the state the tracker holds for each.
 *
 * Taken from hs_windowfilter-gt rather than enumerated. The tracker already holds every
 * window it watches, along with its title, application, screen and flags, kept current by
 * the notifications it subscribes to. Asking it costs nothing.
 *
 * Enumerating instead is what made this Spoon slow. hs.window.allWindows(),
 * orderedWindows() and visibleWindows() took about 0.1 s for 35 windows on 2026-10-24,
 * against 1 ms for asking the tracker.
 *
 * @returns {Array} `{window, state}` objects, in no particular order.
 */
function switchableRecords() {
    startTrackingFocus()
    if (!filter) return []
    return filter.records().filter((record) => record.state.standard)
}

function switchable() {
    return switchableRecords().map((record) => record.window)
}

/** Every switchable window, most recently used first. */
function allRecords() {
    return recordsByUse(switchableRecords())
}

/**
 * Records for one application, most recently used first. Defaults to the focused one.
 *
 * Which application that is comes from the tracker's own record of which window has focus,
 * not from hs.window.focusedWindow(), which waits on the frontmost application. The first
 * record in use order is a fallback for the moment after a reload, before any focus change
 * has been seen.
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
// Drawn on a canvas beside the chooser. The chooser reports no callback when the selection
// moves, so the selected row is read on a timer while the chooser is open.

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
 * Hammerspoon's "Chooser" window. hs.chooser exposes no frame here, and that search costs
 * about 0.1 s while the chooser is opening, so the position is computed from the screen and the
 * chooser's width fraction instead. config.thumbnailTopRatio sets the height it sits at.
 */
function thumbnailFrame(image) {
    const screen = hs.screen.main() || hs.screen.primary()
    const reference = hs.screen.primary() || screen
    if (!screen || !reference) return null

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

    // hs.screen measures y downwards from the top of the primary display and a canvas
    // upwards from its bottom.
    return {
        x: left,
        y: (reference.fullFrame.y + reference.fullFrame.h) - (top + height),
        w: width,
        h: height
    }
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

    // One request per window at a time. The selected row is polled every
    // config.selectionPollSeconds and lastDrawnId is not set until the snapshot arrives, so
    // without this a window slower to capture than the poll interval is asked again on
    // every tick, and the requests pile up on the window that is already struggling.
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

function startPolling() {
    stopPolling()
    pollTimer = hs.timer.doEvery(config.selectionPollSeconds, () => {
        if (!chooser || !chooser.isVisible) return
        const id = selectedWindowId()
        if (id !== lastDrawnId) showThumbnailFor(id)
    })
}

function stopPolling() {
    if (!pollTimer) return
    pollTimer.stop()
    pollTimer = null
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

    sessionKeys = [toggle, refresh].filter(Boolean)
}

function releaseSessionKeys() {
    for (const key of sessionKeys) {
        if (key) key.destroy()
    }
    sessionKeys = []
}

// MARK: - The chooser

// Built from the tracker's state rather than by reading the window again.
function subTextFor(state) {
    const parts = [state.application || "?"]
    if (state.screenName) parts.push(state.screenName)
    if (state.minimized) parts.push("minimized")
    if (state.hidden) parts.push("hidden")
    return parts.join("  ·  ")
}

function choicesFor(records) {
    // One icon per application rather than one per row.
    const icons = new Map()
    const iconFor = (bundleID) => {
        if (!bundleID) return null
        if (!icons.has(bundleID)) icons.set(bundleID, HSImage.fromAppBundle(bundleID))
        return icons.get(bundleID)
    }

    return records.map(({ state }) => ({
        text: state.title || state.application || "window",
        subText: subTextFor(state),
        image: iconFor(state.bundleID),
        id: state.id
    }))
}

function chooserWidth() {
    const screen = hs.screen.main() || hs.screen.primary()
    if (!screen) return config.width
    return screen.fullFrame.w > config.wideScreenPoints ? config.wideWidth : config.width
}

// Hammerspoon's own bundle, asked for its windows to locate the open chooser.
const HAMMERSPOON_BUNDLE_ID = "net.tenshu.Hammerspoon-2"

/**
 * Where the chooser is on screen.
 *
 * Its width and left edge follow from hs.chooser centring a window of config.width, and
 * measuring confirms both to the point. Its vertical position does not follow from anything
 * this Spoon sets, so it is read from Hammerspoon's own window list: the chooser is the
 * window whose left edge and width match the computed ones, which separates it from the
 * console and from this Spoon's own preview canvas.
 *
 * Asking one application for its windows costs about 10ms. Hammerspoon 1 found the same
 * window with hs.window.allWindows(), which walks every process and costs a second and a
 * half here.
 *
 * config.thumbnailTopRatio is the fallback for when the chooser cannot be found, which is
 * the case in the moment before it is shown.
 */
function chooserGeometry(area) {
    const width = area.w * chooserWidth()
    const left = area.x + (area.w - width) / 2
    let top = area.y + area.h * config.thumbnailTopRatio

    try {
        const app = hs.application.matchingBundleID(HAMMERSPOON_BUNDLE_ID)
        for (const window of (app ? app.allWindows || [] : [])) {
            const frame = window.frame
            if (!frame) continue
            if (Math.abs(frame.x - left) <= 2 && Math.abs(frame.w - width) <= 2) {
                top = frame.y
                break
            }
        }
    } catch (e) {
        // The computed position stands.
    }

    return { left, width, top }
}

/**
 * Show a chooser over a list of windows, and focus whichever is chosen.
 *
 * @param {Array} windows The windows to offer, in the order to offer them.
 * @param {string} placeholder Prompt text.
 */
function chooseFrom(records, placeholder) {
    if (!records.length) {
        hs.ui.alert("No windows to choose from").duration(2).show()
        return null
    }

    startTrackingFocus()

    // A chooser already open is closed first. Its own callbacks then find that it is no longer
    // the current chooser, and do not report the new one's prompt as closed.
    chooserClose()

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

    own.setChoices(choicesFor(records))

    // Each callback acts only while its chooser is the current one, so that a chooser closed by
    // a newer one does not end the newer one's session.
    own.onSelect = (item) => {
        if (chooser !== own) return
        finishChoosing()
        if (!item || item.id === undefined) return
        focusWindowById(item.id)
    }

    own.onShow = () => {
        if (chooser !== own) return
        takeSessionKeys()
        startPolling()
        // The first row is selected when the chooser opens.
        showThumbnailFor(records[0].state.id)
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
    stopPolling()
    releaseSessionKeys()
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

/** Choose from every switchable window, most recently used first. */
function windowSelect() {
    return chooseFrom(allRecords(), "Window")
}

/** Choose from the focused application's windows. */
function applicationWindowSelect(application) {
    const records = applicationRecords(application)
    const name = records.length ? records[0].state.application : "Application"
    return chooseFrom(records, name)
}

/** Choose from the most recently used window of each application. */
function applicationSelect() {
    return chooseFrom(firstRecordPerApplication(), "Application")
}

/**
 * Go straight to the previously used window, with no chooser.
 *
 * The first entry in the order is the window in front now, so the second is the one before.
 */
function windowPreviousSelect() {
    const records = allRecords()
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

/** Go straight to the previously used window of the focused application. */
function applicationWindowPreviousSelect() {
    const records = applicationRecords()
    if (records.length < 2) {
        hs.ui.alert("No previous window in this application").duration(2).show()
        return false
    }
    return focusWindowById(records[1].state.id)
}

/** The order the switcher will offer windows in, as titles. For looking at the ordering. */
function order() {
    return allRecords().map(({ state }) => `${state.application}: ${state.title}`)
}

let hotkeys = []

// The functions a key can run, as hs_window-gt does it: the names are the functions' own.
const HOTKEY_FUNCTIONS = [
    "windowSelect", "applicationWindowSelect", "applicationSelect",
    "windowPreviousSelect", "applicationWindowPreviousSelect"
]

function hotkeysRelease() {
    for (const key of hotkeys) {
        if (key) key.destroy()
    }
    hotkeys = []
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
        if (!HOTKEY_FUNCTIONS.includes(name)) {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): ${name} is not a function a key can run`)
        }
        if (!Array.isArray(binding) || !Array.isArray(binding[0]) || typeof binding[1] !== "string") {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): ${name} needs [modifiers, key], such as [["alt"], "b"]`)
        }
    }

    hotkeysRelease()
    for (const [name, [mods, key]] of entries) {
        const hotkey = hs.hotkey.bind(mods, key, () => module.exports[name](), null)
        if (hotkey) hotkeys.push(hotkey)
        else console.error(`[${SPOON_NAME}] could not bind ${mods.join("-")} ${key} to ${name}`)
    }
    return module.exports
}

function start() {
    // All three are required. Checked here, so that a missing one is reported when the Spoon
    // starts rather than the first time it is needed.
    spoonRequired("hs_interactive-gt")
    spoonRequired("hs_window-gt")
    startTrackingFocus()
    return module.exports
}

function stop() {
    chooserClose()

    if (filter) {
        const windowfilter = hs.spoons["hs_windowfilter-gt"]
        if (windowfilter) windowfilter.destroy(filter)
        filter = null
    }
    focusOrder = []
    thumbnails = new Map()
    pendingSnapshots = new Set()

    hotkeysRelease()
    return module.exports
}

module.exports = {
    config,
    windowSelect,
    applicationWindowSelect,
    applicationSelect,
    windowPreviousSelect,
    applicationWindowPreviousSelect,
    applicationByBundleSelect,
    order,
    bindHotkeys,
    start,
    stop
}
