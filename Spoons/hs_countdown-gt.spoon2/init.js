// hs_countdown-gt — a port of the Hammerspoon 1 hs_countdown_timer.spoon (which
// declares itself as CountDown) to Hammerspoon 2.
//
// Three progress indicators:
//   * a horizontal bar along the bottom edge of every screen (always on)
//   * warnings showing the time left, at 1, 2, 4, 8, ... minutes remaining (optional)
//   * a menu bar item showing the time left, with pause/cancel entries (optional)
//
// When the time is up a sound plays, an alert is shown, and a dialog asks for
// acknowledgement.
//
// The progress bar is a row of fixed-width rectangles, re-coloured as the countdown
// advances: hs.ui element geometry is fixed once a window is built, while an HSColor
// passed to fill() is reactive. barSegments sets the bar's resolution.

const SPOON_NAME = "hs_countdown-gt"
const DOCUMENTATION = "https://github.com/dmgerman/hammer2spoons/tree/main/Spoons"

/**
 * The Spoon `name`, which this Spoon cannot work without. Throws, naming the Spoon and referring
 * to its documentation, when it is not loaded.
 */
function spoonRequired(name) {
    const spoon = hs.spoons[name]
    if (spoon) return spoon
    throw new Error(`${SPOON_NAME} needs ${name}, which is not loaded. See ${DOCUMENTATION}/${name}.spoon2`)
}

// MARK: - User-configurable settings

const config = {
    // Timer length used by countdownStart() when no length is given.
    defaultLenMinutes: 25,
    // If true, the last length started becomes defaultLenMinutes.
    useLastTimerAsDefault: true,
    // If true, show a dialog that must be acknowledged when the time is up.
    notify: true,
    // Seconds a progress or error message stays on screen.
    messageDuration: 2,

    // Progress bar.
    barHeight: 5,
    barTransparency: 0.8,
    barColorPassed: "#28CD41",
    barColorToPass: "#FF3B30",
    barSegments: 240,

    // End of timer.
    alertLen: 5,
    alertSound: "Sonar",

    // Warnings, shown at 1, 2, 4, 8, ... minutes remaining.
    warningShow: true,
    warningDuration: 3,

    // Menu bar.
    menuBarAlwaysShow: true,
    menuBarIconIdle: "⏰",
    menuBarIconActive: "☣️",
    menuBarIconPlay: "▶️",
    menuBarIconPause: "⏸️",
    menuBarIconStop: "🛑"
}

// Event names passed to the caller's callback as its first argument.
const events = {
    start: "started",
    pause: "paused",
    resume: "resumed",
    cancel: "cancelled",
    end: "ended",
    progressSet: "progressSet"
}

// MARK: - State

let tickTimer = null
let timerRunning = false
// Wall-clock second at which the timer ends, adjusted forward while paused.
let endingTime = 0
let timeLeft = 0
let timerLenMinutes = 0
let pausedAt = null
let currentIcon = config.menuBarIconIdle
let userCallback = null

let menuBar = null
let hotkeys = []

// One canvas per screen, all showing the same progress.
let bars = []
// How many segments each bar was built with. `config.barSegments` is what is asked for;
// this is what is there, which is what an index is checked against.
let barSegments = 0
// Number of segments currently coloured as elapsed on every bar, so a tick only re-colours
// the segments that have just been crossed.
let barFilled = 0
// Whether the bars are displayed. Canvases do not report it, and a rebuild after a
// display change has to know whether to put the new ones back on screen.
let barShowing = false
// Held so it can be removed again: the watcher is what notices that a screen has been
// added, removed or resized underneath the bars.
let screenWatcher = null

// MARK: - Helpers

function nowSeconds() {
    return Math.floor(hs.timer.secondsSinceEpoch())
}

function isPowerOfTwo(value) {
    if (!Number.isInteger(value) || value < 1) return false
    return (value & (value - 1)) === 0
}

function messageShow(message, duration) {
    hs.ui.alert(message).duration(duration ?? config.messageDuration).show()
}

function callbackFire(event, minutes) {
    if (!userCallback) return
    try {
        userCallback(event, minutes)
    } catch (e) {
        console.error(`[hs_countdown-gt] callback threw: ${e.message}`)
    }
}

// MARK: - Progress bar

// Canvas colours are {red, green, blue, alpha} components in 0..1, so the hex strings the
// settings are written in are converted here. config.barTransparency is folded in as the
// alpha, which is what opacity() used to carry on the hs.ui window.
function barColor(value) {
    const text = String(value || "#000000").replace("#", "")
    const hex = text.length === 3 ? text.split("").map((c) => c + c).join("") : text
    const component = (at) => parseInt(hex.slice(at, at + 2), 16) / 255
    const alpha = hex.length >= 8 ? component(6) : 1
    return {
        red: component(0),
        green: component(2),
        blue: component(4),
        alpha: alpha * (config.barTransparency === undefined ? 1 : config.barTransparency)
    }
}

// The bar's frame along the bottom edge of `screen`, at its full width.
//
// hs.screen measures y downwards from the top of the primary display and a canvas window
// upwards from its bottom, so the screen's bottom edge has to be converted. On the primary
// screen this comes out as 0.
function barFrame(screen, primary) {
    const area = screen.fullFrame
    const reference = primary.fullFrame
    return {
        x: area.x,
        y: (reference.y + reference.h) - (area.y + area.h),
        w: area.w,
        h: config.barHeight
    }
}

// Builds one bar on `screen`. Each segment is a canvas element, recoloured in place by
// index as the countdown passes it, so a tick touches only the segments just crossed.
function barBuild(screen, primary, count) {
    const frame = barFrame(screen, primary)
    const segmentWidth = frame.w / count

    const canvas = hs.canvas.create(frame)
        .level("status")
        // A five point strip along the bottom edge of the screen sits exactly where the
        // Dock does. Without this it would swallow every click along that edge.
        .ignoreMouseEvents(true)
        .behaviorList(["canJoinAllSpaces", "stationary"])

    const elements = []
    for (let i = 0; i < count; i++) {
        elements.push({
            type: "rectangle",
            action: "fill",
            fillColor: barColor(config.barColorToPass),
            frame: { x: i * segmentWidth, y: 0, w: segmentWidth, h: config.barHeight }
        })
    }
    canvas.appendElements(elements)
    return canvas
}

// Builds a bar on every screen. Leaves `bars` empty when there are no displays at all --
// mid-disconnect, or a shut lid with nothing attached.
//
// The new bars are shown at once when a countdown is running. Bars can be built from a
// tick, through barEnsure(), after a moment with no screens, and nothing else would show
// them then.
function barsBuild() {
    const screens = hs.screen.all()
    const primary = hs.screen.primary() || screens[0]
    if (!primary || screens.length === 0) return

    const count = Math.max(1, Math.floor(config.barSegments))
    bars = screens.map((screen) => barBuild(screen, primary, count))
    barSegments = count
    barFilled = 0
    if (barShowing) for (const canvas of bars) canvas.show()
}

function barsDestroy() {
    for (const canvas of bars) canvas.destroy()
    bars = []
    barSegments = 0
    barFilled = 0
}

function barEnsure() {
    if (bars.length === 0) barsBuild()
}

// progress is 0.0 to 1.0.
function barProgressSet(progress) {
    barEnsure()
    if (bars.length === 0) return

    const target = Math.max(0, Math.min(barSegments, Math.round(progress * barSegments)))
    if (target === barFilled) return

    const passed = barColor(config.barColorPassed)
    const toPass = barColor(config.barColorToPass)
    for (const canvas of bars) {
        if (target > barFilled) {
            for (let i = barFilled; i < target; i++) canvas.setElementAttribute(i, "fillColor", passed)
        } else {
            for (let i = target; i < barFilled; i++) canvas.setElementAttribute(i, "fillColor", toPass)
        }
    }
    barFilled = target
}

function barShow() {
    barEnsure()
    barProgressSet(0)
    for (const canvas of bars) canvas.show()
    barShowing = true
}

function barHide() {
    barShowing = false
    if (bars.length === 0) return
    barProgressSet(0)
    for (const canvas of bars) canvas.hide()
}

/**
 * Rebuild the bars for the display arrangement as it now stands.
 *
 * A display may have been added or removed, or changed size, so every bar is thrown away
 * and one is built for each screen there is now. This also runs when there are no bars,
 * because a moment with no screens at all leaves none, and the bars have to come back when
 * a screen does.
 *
 * The progress is taken from the countdown rather than from the old bars, which do not
 * exist after a moment with no screens. A paused countdown sends no ticks, so the new bars
 * have to be set to the right progress here.
 */
function barReposition() {
    const progress = timerRunning && timerLenMinutes > 0
        ? 1 - timeLeft / (timerLenMinutes * 60)
        : 0
    barsDestroy()
    barsBuild()
    barProgressSet(progress)
}

// MARK: - Menu bar

function menuBarEnsure() {
    if (menuBar) return
    menuBar = hs.menubar.create(!config.menuBarAlwaysShow)
    menuBarReset()
}

function menuBarReset() {
    if (!menuBar) return
    currentIcon = config.menuBarIconIdle
    menuBar.title = config.menuBarIconIdle
    menuBar.setMenu([
        {
            title: `${config.menuBarIconActive} Start ${config.defaultLenMinutes} min`,
            fn: () => countdownStart(config.defaultLenMinutes)
        },
        {
            title: `${config.menuBarIconActive} Start for ...`,
            fn: () => countdownPromptedStart()
        }
    ])
    if (config.menuBarAlwaysShow) {
        menuBar.show()
    } else {
        menuBar.hide()
    }
}

function menuBarTitleUpdate() {
    if (!menuBar) return
    const hours = Math.floor(timeLeft / 3600)
    const minutes = Math.floor((timeLeft % 3600) / 60)
    const seconds = Math.floor(timeLeft % 60)
    const pad = (n) => String(n).padStart(2, "0")
    menuBar.title = hours > 0
        ? `${currentIcon} ${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${currentIcon} ${pad(minutes)}:${pad(seconds)}`
}

function menuBarUpdate(isPaused) {
    menuBarEnsure()
    if (!menuBar.isVisible()) menuBar.show()

    currentIcon = isPaused ? config.menuBarIconPause : config.menuBarIconActive
    const resumeLabel = isPaused
        ? `${config.menuBarIconPlay} Resume`
        : `${config.menuBarIconPause} Pause`

    menuBar.setMenu([
        {title: `${config.menuBarIconStop} Stop`, fn: () => countdownCancel()},
        {title: resumeLabel, fn: () => pauseToggle()}
    ])
    menuBarTitleUpdate()
}

// MARK: - Warnings and end of timer

function warningUpdate() {
    if (!config.warningShow || timeLeft <= 0) return
    if (timeLeft % 60 !== 0) return
    const minutesLeft = timeLeft / 60
    if (minutesLeft < timerLenMinutes && isPowerOfTwo(minutesLeft)) {
        const hours = Math.floor(minutesLeft / 60)
        const minutes = minutesLeft % 60
        const pad = (n) => String(n).padStart(2, "0")
        messageShow(`Time left ${pad(hours)}:${pad(minutes)}`, config.warningDuration)
    }
}

function endOfTimerNotify(requestedMinutes) {
    // Kept so focus can be restored once the dialog is acknowledged.
    const previousWindow = hs.window.focusedWindow()

    callbackFire(events.end, requestedMinutes)

    const message = requestedMinutes
        ? `Time is up: ${requestedMinutes} minutes`
        : "Time is up"
    const timeString = `Time is ${new Date().toLocaleTimeString()}`

    if (config.alertSound) {
        const sound = hs.sound.named(config.alertSound)
        if (sound) sound.play()
        hs.notify.create({title: message, body: timeString}).send()
    }

    if (config.alertLen > 0) {
        hs.ui.alert(message).duration(config.alertLen).show()
    }

    if (config.notify) {
        hs.ui.dialog(message)
            .informativeText(timeString)
            .buttons(["OK"])
            .onButton(() => {
                if (previousWindow) previousWindow.focus()
            })
            .show()
    }
}

// MARK: - Timer

function timerReset() {
    timerRunning = false
    if (tickTimer) {
        tickTimer.stop()
        tickTimer = null
    }
    pausedAt = null
    timeLeft = 0
    barHide()
    menuBarReset()
}

function tick() {
    // The timer keeps ticking while paused is not possible — pause stops it — but a
    // tick can still arrive after the countdown ends, between expiry and stop().
    if (!timerRunning) return

    timeLeft = endingTime - nowSeconds()

    if (timeLeft <= 0) {
        timerRunning = false
        // Saved before the reset, which clears it, and needed by the notification.
        const requestedMinutes = timerLenMinutes
        timerReset()
        endOfTimerNotify(requestedMinutes)
        return
    }

    barProgressSet(1 - timeLeft / (timerLenMinutes * 60))
    warningUpdate()
    menuBarTitleUpdate()
}

// MARK: - Public API

/**
 * Start a countdown for `minutes` minutes. Refuses to start while another
 * countdown is running.
 *
 * @param {number} [minutes] Length in whole minutes. Defaults to
 *        `config.defaultLenMinutes`.
 * @param {function} [callback] Called as `(event, minutes)` on each timer event.
 *        Not called for the end event if the timer is cancelled.
 */
function countdownStart(minutes, callback) {
    if (minutes === undefined || minutes === null) minutes = config.defaultLenMinutes

    if (timerRunning) {
        messageShow("Error. Timer is already running. It is not possible to start another one.")
        return module.exports
    }
    if (!Number.isInteger(minutes)) {
        messageShow(`Error. Minutes should be an integer [${minutes}]`)
        return module.exports
    }
    // A countdown of 0 minutes would end at the next tick, with the sound, the notification
    // and the dialog, so it is refused as a negative length is (found by the tests on
    // 2026-11-23).
    if (minutes < 1) {
        messageShow(`Error. A timer must run for at least 1 minute [${minutes}]`)
        return module.exports
    }
    if (callback !== undefined && callback !== null && typeof callback !== "function") {
        messageShow("Error. Second parameter should be a function")
        return module.exports
    }

    timerLenMinutes = minutes
    userCallback = callback ?? null

    barShow()

    endingTime = nowSeconds() + minutes * 60
    timerRunning = true
    timeLeft = minutes * 60
    // The handle is kept because pauseToggle() and timerReset() need it.
    tickTimer = hs.timer.doEvery(1, () => tick())

    menuBarUpdate(false)

    if (config.useLastTimerAsDefault) config.defaultLenMinutes = minutes
    messageShow(`Timer started for ${minutes} minutes`)

    callbackFire(events.start, 0)
    return module.exports
}

/**
 * Convert a time of day to minutes past midnight.
 *
 * @param {string} time `hh:mm` on a 24-hour clock, or `h:mm am` / `h:mm pm`. The
 *        suffix may be upper or lower case, and the space before it is optional.
 * @returns {{minutes: number}|{error: string}} One key or the other, never both.
 */
function timeOfDayParse(time) {
    // Anchored, so trailing text is reported rather than ignored. An ignored suffix would
    // otherwise shift the end time by twelve hours with no error reported.
    const match = /^\s*(\d{1,2}):(\d{2})\s*([ap]m)?\s*$/i.exec(time)
    if (!match) {
        return { error: `Illegal time [${time}]. Must be <hour>:<min>, optionally followed by am or pm` }
    }

    let hour = Number(match[1])
    const minute = Number(match[2])
    const suffix = match[3] ? match[3].toLowerCase() : null

    if (minute > 59) {
        return { error: `Illegal time [${time}]. Minutes must be 00 to 59` }
    }
    if (suffix) {
        if (hour < 1 || hour > 12) {
            return { error: `Illegal time [${time}]. With ${suffix} the hour must be 1 to 12` }
        }
        // 12am is hour 0 and 12pm is hour 12, so reduce 12 to 0 before adding the shift.
        hour = hour % 12 + (suffix === "pm" ? 12 : 0)
    } else if (hour > 23) {
        return { error: `Illegal time [${time}]. Hours must be 00 to 23` }
    }

    return { minutes: hour * 60 + minute }
}

/**
 * Start a countdown that ends at a given time of day. A time earlier than the
 * current time is taken to mean tomorrow.
 *
 * @param {string} time A time of day, in the forms `timeOfDayParse` accepts.
 * @param {function} [callback] Called as `(event, minutes)` on each timer event.
 */
function countdownUntilStart(time, callback) {
    const parsed = timeOfDayParse(time)
    if (parsed.error) {
        messageShow(parsed.error)
        return module.exports
    }

    const now = new Date()
    const current = now.getHours() * 60 + now.getMinutes()
    // Positive remainder, so a target earlier than now lands tomorrow. The current minute
    // itself also means tomorrow, rather than a countdown of 0 minutes.
    const minutes = ((parsed.minutes - current) % (24 * 60) + 24 * 60) % (24 * 60) || 24 * 60
    return countdownStart(minutes, callback)
}

/**
 * Start the countdown described by one answer to the prompt.
 *
 * @param {string} answer A number of minutes, or a time of day.
 * @param {function} [callback] Passed through to the timer.
 * @returns {?string} What was wrong with the answer, or null once the timer runs.
 */
function countdownFromAnswerStart(answer, callback) {
    if (answer.includes(":")) {
        const parsed = timeOfDayParse(answer)
        if (parsed.error) return parsed.error
        countdownUntilStart(answer, callback)
        return null
    }

    // Number("") and Number(" ") are both 0, so an empty answer needs its own test.
    const minutes = Number(answer)
    if (answer.trim() === "" || !Number.isFinite(minutes)) {
        return `Illegal number [${answer}]`
    }
    // Checked after rounding, because a countdown has a length in whole minutes: 0.4 would
    // otherwise pass as more than zero and start a countdown of 0 minutes.
    const rounded = Math.round(minutes)
    if (rounded < 1) {
        return `Illegal number [${answer}]. Must be at least 1 minute`
    }

    countdownStart(rounded, callback)
    return null
}

/**
 * Ask for a duration and start a countdown with it. The answer is either a number of minutes or
 * a time of day (`10:30`, `9:30 pm`). An answer that is neither is reported, and the question is
 * asked again with that answer filled in, to be corrected. Cancelling abandons the countdown.
 *
 * The question is asked through hs_interactive-gt, so that it looks like every other prompt and
 * other Spoons release their keys while it is open.
 *
 * @param {function} [callback] Called as `(event, minutes)` on each timer event.
 * @returns {Promise<object>} A promise of this Spoon, once the countdown starts or the question
 *          is cancelled.
 */
function countdownPromptedStart(callback) {
    const interactive = spoonRequired("hs_interactive-gt")
    const hint = "Minutes, or a time of day such as 10:30 or 9:30 pm"

    const ask = (message, defaultText) =>
        interactive.readerRun(interactive.readers.string.prompted, { name: message, default: defaultText })
            .then((answer) => {
                if (answer === null) return module.exports
                const error = countdownFromAnswerStart(answer, callback)
                return error ? ask(`${error}. ${hint}`, answer) : module.exports
            })

    return ask(hint, String(config.defaultLenMinutes))
}

/**
 * Pause a running countdown, or resume a paused one. Time spent paused does not
 * count against the countdown.
 */
function pauseToggle() {
    if (!tickTimer) return module.exports

    if (tickTimer.running()) {
        pausedAt = nowSeconds()
        tickTimer.stop()
        menuBarUpdate(true)
        callbackFire(events.pause, timeLeft / 60)
        messageShow("Timer paused")
    } else {
        endingTime += nowSeconds() - pausedAt
        pausedAt = null
        tickTimer.start()
        menuBarUpdate(false)
        callbackFire(events.resume, timeLeft / 60)
        messageShow("Timer resumed")
    }
    return module.exports
}

/**
 * Cancel a running countdown. The end event is not fired; the cancel event is.
 */
function countdownCancel() {
    if (!timerRunning) {
        messageShow("Error. Timer not running")
        return module.exports
    }
    const minutesLeft = timeLeft / 60
    callbackFire(events.cancel, minutesLeft)
    timerReset()
    messageShow(`Timer was cancelled (time left ${minutesLeft.toFixed(1)} min).`)
    return module.exports
}

/**
 * Move a running countdown to a given point in its progress.
 *
 * @param {number} progress How far through the countdown to jump to, 0.0 to 1.0.
 */
function progressSet(progress) {
    if (!timerRunning) {
        messageShow("Error. Timer not running")
        return module.exports
    }
    if (typeof progress !== "number" || !(progress >= 0 && progress <= 1)) {
        messageShow(`Error. Progress must be a number from 0.0 to 1.0 [${progress}]`)
        return module.exports
    }
    const minutesLeft = timerLenMinutes * (1 - progress)
    // The end time is kept in whole seconds, as countdownStart() leaves it: a warning is shown
    // only when the seconds left are an exact number of minutes.
    endingTime = nowSeconds() + Math.round(minutesLeft * 60)
    // A paused countdown adds the time spent paused to its end when it resumes. The pause is
    // therefore counted from now, so that the new end time is not moved by the time before.
    if (pausedAt !== null) pausedAt = nowSeconds()
    timeLeft = Math.round(minutesLeft * 60)
    messageShow(`Timer reset to ${(progress * 100).toFixed(1)}% (${minutesLeft.toFixed(1)} minutes left)`)
    callbackFire(events.progressSet, minutesLeft)
    return module.exports
}

// MARK: - The countdown menu
//
// The menu hs_menu-gt displays for this Spoon. Every option calls an exported function with
// `fn:`, so the menu needs no command names. Each option is one action, so the menu closes after
// it.

/**
 * The countdown menu, for hs_menu-gt: `menuShow()` displays it, and a menu in the configuration
 * can include it as a submenu with `children: hs.spoons["hs_countdown-gt"].menu`.
 */
const menu = [
    { label: "Start", icon: "symbol:timer", key: "t", fn: () => module.exports.countdownStart() },
    { label: "Start for…", icon: "symbol:keyboard", key: "f", fn: () => module.exports.countdownPromptedStart() },
    { label: "Pause/Resume", icon: "symbol:playpause", key: "p", fn: () => module.exports.pauseToggle() },
    { label: "Cancel", icon: "symbol:stop.circle", key: "c", fn: () => module.exports.countdownCancel() }
]

/** Display the countdown menu on screen, with hs_menu-gt. */
function menuShow() {
    spoonRequired("hs_menu-gt").onScreenShow(menu, { name: "Countdown" })
    return module.exports
}

function hotkeysRelease() {
    for (const hotkey of hotkeys) hotkey.destroy()
    hotkeys = []
}

/**
 * Bind the key that opens the countdown menu. `hs.spoons.use()` calls this with its `hotkeys`
 * option. A second call releases the key of the first.
 *
 * @param {object} mapping `{ menuShow: [modifiers, key] }`.
 * @throws For any name but menuShow, or a malformed binding. Nothing is bound in that case.
 */
function bindHotkeys(mapping) {
    const entries = Object.entries(mapping || {})
    for (const [name, binding] of entries) {
        if (name !== "menuShow") {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): only menuShow can be bound, not ${name}`)
        }
        if (!Array.isArray(binding) || !Array.isArray(binding[0]) || typeof binding[1] !== "string") {
            throw new Error(`${SPOON_NAME}: bindHotkeys(): menuShow needs [modifiers, key], such as [["cmd", "ctrl", "alt"], "t"]`)
        }
    }
    hotkeysRelease()
    for (const [, [mods, key]] of entries) {
        const hotkey = hs.hotkey.bind(mods, key, () => menuShow(), null)
        if (hotkey) hotkeys.push(hotkey)
        else console.error(`[${SPOON_NAME}] could not bind ${mods.join("-")} ${key} to menuShow`)
    }
    return module.exports
}

/** Create the menu bar item and the progress bar. */
function start() {
    // Both are required. Checked here, so that a missing one is reported when the Spoon
    // starts rather than the first time it is needed.
    spoonRequired("hs_interactive-gt")
    spoonRequired("hs_menu-gt")
    menuBarEnsure()
    barEnsure()

    // Fires when a display is connected or disconnected, when a resolution or the
    // arrangement changes, and when the menu bar moves to another display — every way the
    // set of screens the bars were built for can stop matching the screens there are.
    if (!screenWatcher) {
        screenWatcher = () => barReposition()
        hs.screen.on("change", screenWatcher)
    }
    return module.exports
}

/** Cancel any running countdown and remove the menu bar item, bar and hotkeys. */
function stop() {
    if (timerRunning) timerReset()
    if (screenWatcher) {
        hs.screen.off("change", screenWatcher)
        screenWatcher = null
    }
    barShowing = false
    barsDestroy()
    if (menuBar) {
        menuBar.destroy()
        menuBar = null
    }
    hotkeysRelease()
    return module.exports
}

module.exports = {
    config,
    events,
    countdownStart,
    countdownUntilStart,
    countdownPromptedStart,
    pauseToggle,
    countdownCancel,
    progressSet,
    menu,
    menuShow,
    bindHotkeys,
    start,
    stop,
    countdownIsRunning: () => timerRunning,
    timeLeft: () => timeLeft
}
