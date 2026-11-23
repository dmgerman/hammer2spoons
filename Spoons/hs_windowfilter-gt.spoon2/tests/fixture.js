// The windows and screens that a Spoon's tests act on. The harness creates one fixture for
// each test and closes it afterwards, also when the test fails or times out, so a test never
// has to close its own windows. See tests-common/readme.org.
//
// Shared by every Spoon's tests, like harness.js: edit tests-common/fixture.js, not a copy.

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

function create(titlePrefix, skip, dir) {
    const tasks = []
    // Every window opened, so that close() can close each one with its close button.
    const windows = []
    // Window id -> {file, index}: the command file of its process, and its number in that
    // process, for windowTitleSet().
    const commandsOf = new Map()
    // Functions a test registered with cleanup(), run by close() in reverse order.
    const cleanups = []
    let opened = 0
    let processes = 0

    // Opens count windows in a new process and resolves to their HSWindow objects, in order.
    // Their titles are unique to this run, so no other window can be mistaken for them.
    async function windowsOpen(count = 1) {
        const titles = []
        for (let i = 0; i < count; i++) titles.push(`${titlePrefix}${++opened}`)
        const commands = `${dir}/window-commands-${++processes}`
        const task = hs.task.create("/usr/bin/osascript",
            ["-l", "JavaScript", WINDOWS_SCRIPT, `--commands=${commands}`, ...titles], null, null, null)
        tasks.push(task)
        task.start()

        const started = Date.now()
        while (Date.now() - started < OPEN_TIMEOUT * 1000) {
            const all = hs.window.allWindows()
            const found = titles.map((title) => all.find((w) => w.title === title))
            if (found.every(Boolean)) {
                windows.push(...found)
                found.forEach((window, i) => commandsOf.set(window.id, { file: commands, index: i + 1 }))
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

    // Changes a test window's title, through its process's command file, and resolves when the
    // window shows the new title. The process reads the file every 0.1 s.
    async function windowTitleSet(window, title) {
        const commands = commandsOf.get(window.id)
        if (!commands) throw new Error(`window "${window.title}" was not opened by this test`)
        const started = Date.now()
        // A command the process has not read yet is still in the file; wait for it to go.
        while (hs.fs.exists(commands.file)) {
            if (Date.now() - started > OPEN_TIMEOUT * 1000) throw new Error("the window process does not read its commands")
            await wait(0.05)
        }
        // Written under another name and then moved, so that the process never reads half a line.
        hs.fs.write(`${commands.file}.partial`, `title ${commands.index} ${title}\n`, false)
        hs.fs.move(`${commands.file}.partial`, commands.file)
        while (window.title !== title) {
            if (Date.now() - started > OPEN_TIMEOUT * 1000) throw new Error(`the title did not change to "${title}"`)
            await wait(0.05)
        }
    }

    // Registers a function that close() runs after the test, also when it fails or times out.
    // Functions run in the reverse order of registration. An error in one is logged and does
    // not stop the others.
    function cleanup(fn) {
        cleanups.push(fn)
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
        if (connected < count) skip(`needs ${count} screens, and ${connected} ${connected === 1 ? "is" : "are"} connected`)
    }

    function frameEqual(actual, expected, message) {
        if (!frameClose(actual, expected)) {
            throw new Error(`${message ? message + ": " : ""}expected ${frameText(expected)}, got ${frameText(actual)}`)
        }
    }

    // Records the message of every alert shown through hs.ui.alert() until the test ends, and
    // returns the list it records into. The alerts are still shown. hs.ui.alert is restored by
    // close().
    //
    // The list also has a property `durations`, which holds the seconds given to each alert's
    // duration(), at the same index as its message, or undefined when duration() was not called.
    // Each alert is returned inside a Proxy that records duration() and passes every call on to
    // the real alert, so that an alert another Spoon shows during the test works as usual.
    let alertOriginal = null
    const alerts = []
    alerts.durations = []
    function alertsCapture() {
        if (alertOriginal) return alerts
        alertOriginal = hs.ui.alert
        const original = alertOriginal
        hs.ui.alert = function (message) {
            const index = alerts.push(String(message)) - 1
            const real = original.apply(hs.ui, arguments)
            if (!real) return real
            const proxy = new Proxy(real, {
                get(target, property) {
                    const value = target[property]
                    if (typeof value !== "function") return value
                    return (...args) => {
                        if (property === "duration") alerts.durations[index] = args[0]
                        const result = value.apply(target, args)
                        return result === target ? proxy : result
                    }
                }
            })
            return proxy
        }
        return alerts
    }

    // Records every canvas created through hs.canvas.create() until the test ends, and returns
    // the list it records into. Each entry holds the frame the canvas was created with and the
    // canvas itself. hs.canvas.create is restored by close().
    let canvasOriginal = null
    const canvases = []
    function canvasesCapture() {
        if (canvasOriginal) return canvases
        canvasOriginal = hs.canvas.create
        const original = canvasOriginal
        hs.canvas.create = function (frame) {
            const canvas = original.apply(hs.canvas, arguments)
            canvases.push({ frame: Object.assign({}, frame), canvas })
            return canvas
        }
        return canvases
    }

    // Where the pointer was when the test started. close() puts it back.
    const pointer = hs.mouse.absolutePosition()

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

    // Closes every window this fixture opened, then ends their processes, restores hs.ui.alert
    // and hs.canvas.create, and puts the pointer back. Each window still open is closed with its
    // close button first, for the reason given at windowClose(); ending the process is for a
    // window that did not close. A window left in fullscreen is taken out of it first, because
    // closing it would leave its Space on screen.
    async function close() {
        for (const fn of cleanups.splice(0).reverse()) {
            try {
                await fn()
            } catch (e) {
                console.error(`[tests] a cleanup failed: ${e && e.message ? e.message : e}`)
            }
        }
        if (alertOriginal) {
            hs.ui.alert = alertOriginal
            alertOriginal = null
        }
        if (canvasOriginal) {
            hs.canvas.create = canvasOriginal
            canvasOriginal = null
        }
        hs.mouse.setAbsolutePosition(pointer.x, pointer.y)
        // A window must be on screen for its close button to work, and a window left minimized
        // or hidden after a test that fails would otherwise stay in hs_windowfilter-gt's list.
        for (const window of windows) {
            try {
                if (window.isFullscreen) {
                    window.toggleFullscreen()
                    await wait(1)
                }
                if (window.application && window.application.isHidden) {
                    window.application.unhide()
                    await wait(0.3)
                }
                if (window.isMinimized) {
                    window.unminimize()
                    await wait(0.5)
                }
            } catch (e) {
                // Already closed.
            }
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

    return { windowsOpen, windowClose, windowTitleSet, cleanup, frameSet, screenFrame, screensNeed, frameEqual, alertsCapture, canvasesCapture, promptCancel, close }
}

module.exports = { create, FRAME_TOLERANCE, WINDOW_MINIMUM }
