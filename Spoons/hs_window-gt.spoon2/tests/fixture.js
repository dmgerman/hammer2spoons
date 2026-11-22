// The windows and screens that hs_window-gt's tests act on. The harness creates one fixture
// for each test and closes it afterwards, also when the test fails or times out, so a test
// never has to close its own windows. See tests/readme.org.

const WINDOWS_SCRIPT = `${__dirname}/fixture-windows.jxa`

// Seconds to wait for the windows to appear after their process starts. They appear in about
// 0.3 s.
const OPEN_TIMEOUT = 5

// Points by which a frame read back may differ from the frame that was set. A window rounds
// each value of its frame to a whole point, and a value can move by up to 1 point in doing so:
// on 2026-11-23, y = 200.25 was read back as 201.
const FRAME_TOLERANCE = 1

// The smallest size the fixture windows take: 87 by 33 points, the width of the title bar's
// buttons and the height of the title bar. A test asking for less would get this instead.
const WINDOW_MINIMUM = { w: 87, h: 33 }

function wait(seconds) {
    return new Promise((resolve) => hs.timer.doAfter(seconds, resolve))
}

function frameText(f) {
    return `{x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h}}`
}

// Whether two frames are equal within FRAME_TOLERANCE.
function frameClose(a, b) {
    return ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= FRAME_TOLERANCE)
}

function create(runId, skip) {
    const tasks = []
    // Every window opened, so that close() can close each one with its close button.
    const windows = []
    let opened = 0

    // Opens count windows in a new process and resolves to their HSWindow objects, in order.
    // Their titles are unique to this run, so no other window can be mistaken for them.
    async function windowsOpen(count = 1) {
        const titles = []
        for (let i = 0; i < count; i++) titles.push(`hs_window-gt test ${runId} ${++opened}`)
        const task = hs.task.create("/usr/bin/osascript", ["-l", "JavaScript", WINDOWS_SCRIPT, ...titles],
            null, null, null)
        tasks.push(task)
        task.start()

        const started = Date.now()
        while (Date.now() - started < OPEN_TIMEOUT * 1000) {
            const all = hs.window.allWindows()
            const found = titles.map((title) => all.find((w) => w.title === title))
            if (found.every(Boolean)) {
                windows.push(...found)
                return found
            }
            await wait(0.1)
        }
        throw new Error(`the test windows did not appear within ${OPEN_TIMEOUT} s`)
    }

    // Closes a window during a test, with its close button, and resolves when it is gone.
    //
    // A window is closed this way, not by ending its process, because hs_windowfilter-gt reports
    // windowDestroyed only for the close button. On 2026-11-23, ending the process produced no
    // event within 2 s, and the window stayed in hs_windowfilter-gt's list of windows.
    async function windowClose(window) {
        if (!windows.some((w) => w.id === window.id)) {
            throw new Error(`window "${window.title}" was not opened by this test`)
        }
        window.close()
        const started = Date.now()
        while (hs.window.allWindows().some((w) => w.id === window.id)) {
            if (Date.now() - started > OPEN_TIMEOUT * 1000) throw new Error(`window "${window.title}" did not close`)
            await wait(0.1)
        }
    }

    // Sets a window's frame and waits for it to take effect. A test uses this to put a window
    // where it wants it before calling the Spoon.
    async function frameSet(window, frame) {
        window.frame = new HSRect(frame.x, frame.y, frame.w, frame.h)
        await wait(0.2)
    }

    // The usable frame of the screen a window is on, without the menu bar and the Dock. The
    // Spoon places windows within this frame, so expected frames are computed from it.
    function screenFrame(window) {
        const screen = window.screen
        if (!screen) throw new Error(`window "${window.title}" is on no screen`)
        return screen.frame
    }

    // Ends the test as skipped when fewer than count screens are connected.
    function screensNeed(count) {
        const connected = hs.screen.all().length
        if (connected < count) skip(`needs ${count} screens, and ${connected} is connected`)
    }

    function frameEqual(actual, expected, message) {
        if (!frameClose(actual, expected)) {
            throw new Error(`${message ? message + ": " : ""}expected ${frameText(expected)}, got ${frameText(actual)}`)
        }
    }

    // Records the message of every alert shown through hs.ui.alert() until the test ends, and
    // returns the list it records into. The alerts are still shown. hs.ui.alert is restored by
    // close().
    let alertOriginal = null
    const alerts = []
    function alertsCapture() {
        if (alertOriginal) return alerts
        alertOriginal = hs.ui.alert
        const original = alertOriginal
        hs.ui.alert = function (message) {
            alerts.push(String(message))
            return original.apply(hs.ui, arguments)
        }
        return alerts
    }

    // Waits for a prompt of hs_interactive-gt to open, then cancels it with Escape. A test calls
    // this, without waiting for it, before calling a function that prompts.
    async function promptCancel() {
        const interactive = hs.spoons["hs_interactive-gt"]
        const started = Date.now()
        while (!interactive.promptIsOpen()) {
            if (Date.now() - started > OPEN_TIMEOUT * 1000) throw new Error("no prompt opened")
            await wait(0.1)
        }
        await wait(0.3)
        hs.eventtap.keyStroke([], "escape", null)
    }

    // Closes every window this fixture opened, then ends their processes, and restores
    // hs.ui.alert. Each window still open is closed with its close button first, for the reason
    // given at windowClose(); ending the process is for a window that did not close.
    async function close() {
        if (alertOriginal) {
            hs.ui.alert = alertOriginal
            alertOriginal = null
        }
        if (!tasks.length) return
        const open = new Set(hs.window.allWindows().map((w) => w.id))
        for (const window of windows.splice(0)) {
            if (!open.has(window.id)) continue
            try {
                window.close()
            } catch (e) {
                // Ending the process below closes it.
            }
        }
        await wait(0.5)
        for (const task of tasks.splice(0)) task.terminate()
        await wait(0.3)
    }

    return { windowsOpen, windowClose, frameSet, screenFrame, screensNeed, frameEqual, alertsCapture, promptCancel, close }
}

module.exports = { create, FRAME_TOLERANCE, WINDOW_MINIMUM }
