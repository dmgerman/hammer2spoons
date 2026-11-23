// Tests of each setting with a value other than its default, as the readme describes them under
// "Configuration". defaultLenMinutes is tested in functions.test.js, and useLastTimerAsDefault in
// start.test.js.
//
// The copy reads the menu bar and progress bar settings when start() builds the menu bar item and
// the bars, so those tests set them and then restart the copy with hs.menubar.create and
// hs.canvas.create recorded. At the end of a countdown, the sound, the notification and the dialog
// are recorded instead of being played, sent and shown.

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

// Records the sound, the notification and the dialog of the time being up. Returns the names of
// the sounds played, the notifications and the dialogs.
function endRecord(t) {
    const played = []
    replace(t, hs.sound, "named", (name) => name === t.spoon.config.alertSound, (name) => ({ play() { played.push(name) } }))
    const notifications = replace(t, hs.notify, "create", (options) => options && String(options.title).startsWith("Time is up"),
        () => ({ send() {} }))
    const dialogs = replace(t, hs.ui, "dialog", (message) => String(message).startsWith("Time is up"), () => {
        const chain = {
            informativeText: () => chain, buttons: () => chain, style: () => chain,
            onButton: () => chain, show: () => chain, close: () => {}
        }
        return chain
    })
    return { played, notifications, dialogs }
}

// Starts a one minute countdown that ends within 3 seconds, and waits for its end.
async function countdownEnd(t) {
    t.spoon.countdownStart(1)
    t.spoon.progressSet(0.95)
    await until(t, () => !t.spoon.countdownIsRunning(), 8, "the countdown did not end")
}

// Restarts the copy with its menu bar item recorded. Returns a function giving the item, as
// {real, menu}, where menu is the last list given to setMenu().
function menuBarCapture(t) {
    const original = hs.menubar.create
    const own = Object.prototype.hasOwnProperty.call(hs.menubar, "create")
    const items = []
    hs.menubar.create = function () {
        const real = original.apply(hs.menubar, arguments)
        const item = { real, menu: null }
        items.push(item)
        return new Proxy(real, {
            get(target, property) {
                const value = target[property]
                if (typeof value !== "function") return value
                return (...args) => {
                    if (property === "setMenu") item.menu = args[0]
                    return value.apply(target, args)
                }
            },
            set(target, property, value) { target[property] = value; return true }
        })
    }
    t.cleanup(() => { if (own) hs.menubar.create = original; else delete hs.menubar.create })
    t.spoon.stop()
    t.spoon.start()
    t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
    return () => items[items.length - 1]
}

// Restarts the copy with its progress bars recorded, and returns them.
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

const near = (a, b) => Math.abs(a - b) < 0.01
const titles = (item) => item.menu.map((entry) => entry.title).join(" | ")

module.exports = [
    // --- messages and warnings ---
    {
        name: "messageDuration sets how long a message is displayed",
        run: (t) => {
            quiet(t)
            settingsSet(t, { messageDuration: 4 })
            const alerts = t.alertsCapture()
            t.spoon.countdownStart(3)
            const index = alerts.indexOf("Timer started for 3 minutes")
            t.assert.ok(index >= 0, `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(alerts.durations[index], 4, "the duration of the message")
        }
    },
    {
        name: "warningDuration sets how long a warning is displayed",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { warningDuration: 1 })
            const alerts = t.alertsCapture()
            // A 5 minute countdown at 58% leaves 126 seconds, so the 2 minute warning is due within 7 s.
            t.spoon.countdownStart(5)
            t.spoon.progressSet(0.58)
            await until(t, () => alerts.includes("Time left 00:02"), 10, `no warning at 2 minutes; alerts: ${alerts.join(" | ")}`)
            t.assert.equal(alerts.durations[alerts.indexOf("Time left 00:02")], 1, "the duration of the warning")
        }
    },
    {
        name: "with warningShow false, no warning appears",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { warningShow: false })
            const alerts = t.alertsCapture()
            t.spoon.countdownStart(5)
            t.spoon.progressSet(0.58)
            await t.wait(8)
            t.assert.ok(t.spoon.timeLeft() < 120, `timeLeft() did not pass 2 minutes: ${t.spoon.timeLeft()}`)
            t.assert.ok(!alerts.some((a) => a.startsWith("Time left")), `alerts: ${alerts.join(" | ")}`)
        }
    },
    // --- the end ---
    {
        name: "alertSound names the sound played, and alertLen sets how long the alert is displayed",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { alertSound: "Glass", alertLen: 3 })
            const end = endRecord(t)
            const alerts = t.alertsCapture()
            await countdownEnd(t)
            t.assert.equal(end.played.join(","), "Glass", "the sounds played")
            t.assert.equal(end.notifications.length, 1, "notifications")
            const index = alerts.indexOf("Time is up: 1 minutes")
            t.assert.ok(index >= 0, `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(alerts.durations[index], 3, "the duration of the alert")
        }
    },
    {
        name: "with notify false no dialog appears, and with alertLen 0 no alert appears, when the time is up",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { alertSound: "Sonar", notify: false, alertLen: 0 })
            const end = endRecord(t)
            const alerts = t.alertsCapture()
            await countdownEnd(t)
            t.assert.equal(end.dialogs.length, 0, "dialogs")
            t.assert.ok(!alerts.some((a) => a.startsWith("Time is up")), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(end.played.join(","), "Sonar", "the sounds played")
        }
    },
    // --- the progress bar ---
    {
        name: "barHeight, barSegments, barTransparency, barColorPassed and barColorToPass set the bar's height, steps, opacity and colours",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { barHeight: 9, barSegments: 10, barTransparency: 0.5, barColorPassed: "#0000FF", barColorToPass: "#FFFF00" })
            const bars = barsCapture(t)
            t.assert.ok(bars.length > 0, "no bars")
            for (const bar of bars) {
                t.assert.equal(bar.frame().h, 9, "the height of a bar")
                t.assert.equal(bar.elementCount(), 10, "the segments of a bar")
            }
            t.spoon.countdownStart(4)
            t.spoon.progressSet(0.5)
            await t.wait(1.5)
            const passed = bars[0].elementAttribute(0, "fillColor")
            const toPass = bars[0].elementAttribute(9, "fillColor")
            t.assert.ok(near(passed.red, 0) && near(passed.green, 0) && near(passed.blue, 1) && near(passed.alpha, 0.5),
                `the first segment: ${JSON.stringify(passed)}`)
            t.assert.ok(near(toPass.red, 1) && near(toPass.green, 1) && near(toPass.blue, 0) && near(toPass.alpha, 0.5),
                `the last segment: ${JSON.stringify(toPass)}`)
        }
    },
    // --- the menu bar item ---
    {
        name: "with menuBarAlwaysShow false, the menu bar item is shown only while a countdown runs",
        run: (t) => {
            quiet(t)
            settingsSet(t, { menuBarAlwaysShow: false })
            const item = menuBarCapture(t)
            t.assert.equal(item().real.isVisible(), false, "isVisible() while no countdown runs")
            t.spoon.countdownStart(3)
            t.assert.equal(item().real.isVisible(), true, "isVisible() while a countdown runs")
            t.spoon.countdownCancel()
            t.assert.equal(item().real.isVisible(), false, "isVisible() after the countdown is cancelled")
        }
    },
    {
        name: "the menuBarIcon settings set the menu bar item's symbols while idle, running and paused, and on its entries",
        run: (t) => {
            quiet(t)
            settingsSet(t, { menuBarIconIdle: "I", menuBarIconActive: "A", menuBarIconPause: "P", menuBarIconPlay: "Y", menuBarIconStop: "S" })
            const item = menuBarCapture(t)
            t.assert.equal(item().real.title, "I", "the title while idle")
            t.assert.ok(titles(item()).startsWith("A Start"), `the menu while idle: ${titles(item())}`)
            t.spoon.countdownStart(3)
            t.assert.ok(/^A \d\d:\d\d$/.test(item().real.title), `the title while running: ${item().real.title}`)
            t.assert.equal(titles(item()), "S Stop | P Pause", "the menu while running")
            t.spoon.pauseToggle()
            t.assert.ok(/^P \d\d:\d\d$/.test(item().real.title), `the title while paused: ${item().real.title}`)
            t.assert.equal(titles(item()), "S Stop | Y Resume", "the menu while paused")
        }
    }
]
