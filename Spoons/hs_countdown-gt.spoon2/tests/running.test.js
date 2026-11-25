// Tests of a running countdown and its end, as the readme describes them under "While a countdown
// runs", "When the time is up" and "Following a countdown from code".
//
// Countdowns are made short with progressSet(), which moves a countdown to a point in its length.
// The copy creates its menu bar item and its progress bars in start(), so a test that looks at them
// restarts the copy with hs.menubar.create and hs.canvas.create recorded.
//
// At the end of a countdown, the sound and the notification are recorded instead of being played
// and sent: hs.sound.named() and hs.notify.create() are answered for the countdown's own calls and
// passed on for every other. The dialog is recorded too, and closed by the test.

function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

// Quiets the end of a countdown, keeps the default length, and cancels a countdown left running.
function quiet(t) {
    settingsSet(t, { alertSound: null, notify: false, alertLen: 0, defaultLenMinutes: t.spoon.config.defaultLenMinutes })
    t.cleanup(() => { if (t.spoon.countdownIsRunning()) t.spoon.countdownCancel() })
}

function recorder() {
    const calls = []
    return { calls, callback: (event, minutes) => calls.push([event, Math.round(minutes * 100) / 100]) }
}

// Replaces obj[name] until the test ends. A call `ours` accepts is answered by `answer`; any
// other is passed on to the real function.
function replace(t, obj, name, ours, answer) {
    const original = obj[name]
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) {
        if (!ours(...args)) return original.apply(obj, args)
        calls.push(args)
        return answer(...args)
    }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

// Restarts the copy with its menu bar item recorded, and returns the item.
function menuBarCapture(t) {
    const original = hs.menubar.create
    const own = Object.prototype.hasOwnProperty.call(hs.menubar, "create")
    let item = null
    hs.menubar.create = function () {
        item = original.apply(hs.menubar, arguments)
        return item
    }
    t.cleanup(() => { if (own) hs.menubar.create = original; else delete hs.menubar.create })
    t.spoon.stop()
    t.spoon.start()
    t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
    return () => item
}

// Restarts the copy with its progress bars recorded, and returns the list they go into.
function barsCapture(t) {
    const canvases = t.canvasesCapture()
    t.spoon.stop()
    const before = canvases.length
    t.spoon.start()
    t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
    return canvases.slice(before).map((c) => c.canvas)
}

// Resolves once `test()` is true, or fails after `seconds`.
async function until(t, test, seconds, message) {
    const started = Date.now()
    while (!test()) {
        if (Date.now() - started > seconds * 1000) t.assert.fail(message)
        await t.wait(0.1)
    }
}

const near = (a, b, within = 1.5) => Math.abs(a - b) <= within

module.exports = [
    // --- while a countdown runs ---
    {
        name: "the menu bar item shows the time left as mm:ss, and as h:mm:ss for more than an hour",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            const item = menuBarCapture(t)
            const icon = t.spoon.config.menuBarIconActive
            t.spoon.countdownStart(5)
            await t.wait(1.5)
            t.assert.ok(/^.+ 0[45]:[0-5]\d$/.test(item().title) && item().title.startsWith(icon), `the title: ${item().title}`)
            t.spoon.countdownCancel()
            t.spoon.countdownStart(90)
            await t.wait(1.5)
            t.assert.ok(/ 1:[23]\d:[0-5]\d$/.test(item().title), `the title of a 90 minute countdown: ${item().title}`)
        }
    },
    {
        name: "the progress bar runs along the bottom of every screen, green for the part passed and red for the rest",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            const bars = barsCapture(t)
            const screens = hs.screen.all()
            t.assert.equal(bars.length, screens.length, "bars")
            // A canvas is placed in screen coordinates, with y = 0 at the top of the primary
            // screen, so a bar along the bottom edge starts its height above the screen's bottom.
            for (const screen of screens) {
                const area = screen.fullFrame
                const y = area.y + area.h - t.spoon.config.barHeight
                const bar = bars.find((c) => Math.abs(c.frame().x - area.x) < 1 && Math.abs(c.frame().y - y) < 1)
                t.assert.ok(bar, `no bar along the bottom of ${screen.name}`)
                t.assert.equal(bar.frame().w, area.w, `the width of the bar on ${screen.name}`)
            }
            t.spoon.countdownStart(4)
            t.spoon.progressSet(0.5)
            await t.wait(1.5)
            const color = (index) => bars[0].elementAttribute(index, "fillColor")
            const count = t.spoon.config.barSegments
            t.assert.ok(color(0).green > 0.5 && color(0).red < 0.5, `the first segment: ${JSON.stringify(color(0))}`)
            t.assert.ok(color(count - 1).red > 0.9 && color(count - 1).green < 0.5, `the last segment: ${JSON.stringify(color(count - 1))}`)
        }
    },
    {
        name: "a warning appears when the time left reaches a power of two minutes shorter than the countdown",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            // A 5 minute countdown at 58% leaves exactly 126 seconds, so the 2 minute warning is due
            // within 7 s. (Most fractions leave a fraction of a second; see the next test.)
            t.spoon.countdownStart(5)
            t.spoon.progressSet(0.58)
            await until(t, () => alerts.includes("Time left 00:02"), 10, `no warning at 2 minutes; alerts: ${alerts.join(" | ")}`)
        }
    },
    {
        name: "a warning also appears after progressSet() leaves a fraction of a second",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            // A 3 minute countdown at 31% leaves 124.2 seconds.
            t.spoon.countdownStart(3)
            t.spoon.progressSet(0.31)
            await until(t, () => alerts.includes("Time left 00:02"), 8, `no warning at 2 minutes; alerts: ${alerts.join(" | ")}`)
        }
    },
    {
        name: "pausing stops the countdown, the time paused does not count, and the menu bar item shows it",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            const item = menuBarCapture(t)
            const events = recorder()
            t.spoon.countdownStart(3, events.callback)
            await t.wait(1.2)
            t.spoon.pauseToggle()
            const left = t.spoon.timeLeft()
            t.assert.ok(item().title.startsWith(t.spoon.config.menuBarIconPause), `the title while paused: ${item().title}`)
            t.assert.equal(t.spoon.countdownIsRunning(), true, "countdownIsRunning() while paused")
            await t.wait(2.5)
            t.assert.equal(t.spoon.timeLeft(), left, "timeLeft() after 2.5 s paused")
            t.spoon.pauseToggle()
            await t.wait(1.2)
            t.assert.ok(near(t.spoon.timeLeft(), left - 1), `timeLeft() 1.2 s after resuming: ${t.spoon.timeLeft()}, against ${left - 1}`)
            const names = events.calls.map((c) => c[0]).join(",")
            t.assert.equal(names, "started,paused,resumed", "the events")
        }
    },
    {
        name: "countdownCancel() stops the countdown, sends cancelled and not ended, and resets the menu bar item",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            const item = menuBarCapture(t)
            const events = recorder()
            t.spoon.countdownStart(3, events.callback)
            t.spoon.countdownCancel()
            await t.wait(1.5)
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning()")
            t.assert.equal(t.spoon.timeLeft(), 0, "timeLeft()")
            t.assert.equal(JSON.stringify(events.calls), JSON.stringify([["started", 0], ["cancelled", 3]]), "the events")
            t.assert.equal(item().title, t.spoon.config.menuBarIconIdle, "the title")
        }
    },
    {
        name: "progressSet() moves the countdown, and sends progressSet with the minutes left",
        run: (t) => {
            quiet(t)
            const events = recorder()
            t.spoon.countdownStart(10, events.callback)
            t.spoon.progressSet(0.9)
            t.assert.equal(t.spoon.timeLeft(), 60, "timeLeft()")
            t.assert.equal(JSON.stringify(events.calls[1]), JSON.stringify(["progressSet", 1]), "the event")
        }
    },
    {
        name: "a callback that throws is reported in the console, and the countdown goes on",
        run: (t) => {
            quiet(t)
            const errors = []
            const original = console.error
            console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
            t.cleanup(() => { console.error = original })
            t.spoon.countdownStart(3, () => { throw new Error("test failure") })
            t.assert.equal(t.spoon.countdownIsRunning(), true, "countdownIsRunning()")
            t.assert.ok(errors.some((e) => e.includes("test failure")), `errors: ${errors.join(" | ") || "none"}`)
        }
    },
    // --- the end ---
    {
        name: "when the time is up: the ended event, the sound, the notification, the alert and the dialog",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { alertSound: "Sonar", notify: true, alertLen: 1 })
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            const played = []
            replace(t, hs.sound, "named", (name) => name === "Sonar", () => ({ play() { played.push("Sonar") } }))
            const notifications = replace(t, hs.notify, "create", (options) => options && String(options.title).startsWith("Time is up"),
                () => ({ send() {} }))
            const dialogs = []
            replace(t, hs.ui, "dialog", (message) => String(message).startsWith("Time is up"), (message) => {
                const dialog = { message, onButtonCallback: null }
                const chain = {
                    informativeText: () => chain, buttons: () => chain, style: () => chain,
                    onButton: (fn) => { dialog.onButtonCallback = fn; return chain },
                    show: () => { dialogs.push(dialog); return chain }, close: () => {}
                }
                return chain
            })
            const alerts = t.alertsCapture()
            const events = recorder()
            t.spoon.countdownStart(1, events.callback)
            t.spoon.progressSet(0.95)
            await until(t, () => !t.spoon.countdownIsRunning(), 8, "the countdown did not end")
            t.assert.equal(JSON.stringify(events.calls.map((c) => c[0])), JSON.stringify(["started", "progressSet", "ended"]), "the events")
            t.assert.equal(events.calls[2][1], 1, "the minutes of the ended event")
            t.assert.equal(played.join(","), "Sonar", "the sounds played")
            t.assert.equal(notifications.length, 1, "notifications")
            t.assert.ok(alerts.includes("Time is up: 1 minutes"), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(dialogs.length, 1, "dialogs")
            // The dialog's OK gives the focus back to the window that had it.
            const other = await t.windowsOpen(1)
            other[0].focus()
            await t.wait(0.4)
            dialogs[0].onButtonCallback(0)
            await t.wait(0.5)
            t.assert.equal(hs.window.focusedWindow().id, window.id, "the focused window after OK")
        }
    },
    {
        name: "with alertSound null, the time up plays no sound and sends no notification",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            // Only the countdown's own calls are answered: a sound named as alertSound was, and a
            // notification of the time being up.
            const named = replace(t, hs.sound, "named", (name) => name === "Sonar" || name === null, () => ({ play() {} }))
            const notifications = replace(t, hs.notify, "create", (options) => options && String(options.title).startsWith("Time is up"),
                () => ({ send() {} }))
            t.spoon.countdownStart(1)
            t.spoon.progressSet(0.95)
            await until(t, () => !t.spoon.countdownIsRunning(), 8, "the countdown did not end")
            t.assert.equal(named.length + notifications.length, 0, "sounds and notifications")
        }
    }
]
