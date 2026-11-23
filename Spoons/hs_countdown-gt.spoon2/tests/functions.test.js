// Tests of the countdown menu and of the functions, as the readme describes them under "The countdown
// menu" and "Functions".
//
// menuShow() shows the menu through the user's hs_menu-gt, and showing it there would change where
// the user's on-screen menu reopens. The tests therefore record that call instead of making it, and
// press the menu's options through a session of the user's hs_menu-gt with a presenter that shows
// nothing. Start for… is recorded instead of opening its prompt, which start.test.js tests.
//
// The copy creates its menu bar item and its progress bars in start(), so a test that looks at them
// restarts the copy with hs.menubar.create and hs.canvas.create recorded.

const MODIFIERS = ["ctrl", "alt", "shift"]

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

// Replaces obj[name] with `ours` until the test ends, recording each call.
function replace(t, obj, name, ours) {
    const original = obj[name]
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) {
        calls.push(args)
        return ours(...args)
    }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

// Records the user's hs_menu-gt's onScreenShow() instead of showing a menu.
const onScreenShowRecord = (t) => replace(t, hs.spoons["hs_menu-gt"], "onScreenShow", () => {})

// A session of the user's hs_menu-gt on a presenter that shows nothing.
function menuSession(t) {
    const presenter = { progressive: false, canHide: true, present() {}, close() {} }
    const session = hs.spoons["hs_menu-gt"].sessionOpen(t.spoon.menu, presenter, { name: "Countdown" })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

// Presses the option of `letter` in a new session, and returns whether the menu closed.
function optionPress(t, letter) {
    const session = menuSession(t)
    session.activate(session.letters().indexOf(letter))
    return session.isClosed()
}

// Restarts the copy with its menu bar item recorded. Returns a function giving the item, as
// {real, menu}, where menu is the last list given to setMenu().
function menuBarCapture(t) {
    const original = hs.menubar.create
    const own = Object.prototype.hasOwnProperty.call(hs.menubar, "create")
    const items = []
    hs.menubar.create = function () {
        const real = original.apply(hs.menubar, arguments)
        const item = { real, menu: null, destroyed: false }
        items.push(item)
        return new Proxy(real, {
            get(target, property) {
                const value = target[property]
                if (typeof value !== "function") return value
                return (...args) => {
                    if (property === "setMenu") item.menu = args[0]
                    if (property === "destroy") item.destroyed = true
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

const titles = (item) => item.menu.map((entry) => entry.title).join(" | ")
const entryChoose = (item, word) => item.menu.find((entry) => entry.title.includes(word)).fn()

module.exports = [
    // --- the countdown menu ---
    {
        name: "the menu has Start, Start for…, Pause/Resume and Cancel, lettered t, f, p and c",
        run: (t) => {
            const session = menuSession(t)
            t.assert.equal(session.buttons().map((b) => b.label).join(", "), "Start, Start for…, Pause/Resume, Cancel", "the options")
            t.assert.equal(session.letters().join(","), "t,f,p,c", "the letters")
        }
    },
    {
        name: "menuShow() shows the menu with hs_menu-gt, and returns the Spoon",
        run: (t) => {
            const calls = onScreenShowRecord(t)
            t.assert.equal(t.spoon.menuShow(), t.spoon, "menuShow() returned")
            t.assert.equal(calls.length, 1, "onScreenShow() calls")
            t.assert.equal(calls[0][0], t.spoon.menu, "the menu shown")
        }
    },
    {
        name: "Start starts a countdown of the default length, Pause/Resume pauses and resumes it, and Cancel cancels it; each closes the menu",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            settingsSet(t, { defaultLenMinutes: 7 })
            t.assert.ok(optionPress(t, "t"), "the menu stayed open after Start")
            t.assert.equal(t.spoon.countdownIsRunning(), true, "countdownIsRunning() after Start")
            t.assert.equal(t.spoon.timeLeft(), 7 * 60, "timeLeft() after Start")
            t.assert.ok(optionPress(t, "p"), "the menu stayed open after Pause/Resume")
            const left = t.spoon.timeLeft()
            await t.wait(2.2)
            t.assert.equal(t.spoon.timeLeft(), left, "timeLeft() 2.2 s after Pause/Resume paused")
            t.assert.ok(optionPress(t, "p"), "the menu stayed open after the second Pause/Resume")
            await t.wait(2.2)
            t.assert.ok(t.spoon.timeLeft() < left, `timeLeft() 2.2 s after Pause/Resume resumed: ${t.spoon.timeLeft()}, against ${left}`)
            t.assert.ok(optionPress(t, "c"), "the menu stayed open after Cancel")
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning() after Cancel")
        }
    },
    {
        name: "Start for… asks for the length with countdownPromptedStart(), and closes the menu",
        run: (t) => {
            const calls = replace(t, t.spoon, "countdownPromptedStart", () => Promise.resolve(t.spoon))
            t.assert.ok(optionPress(t, "f"), "the menu stayed open after Start for…")
            t.assert.equal(calls.length, 1, "countdownPromptedStart() calls")
        }
    },
    {
        name: "the menu bar item offers Start and Start for… while no countdown runs, and Pause or Resume and Stop while one runs",
        run: (t) => {
            quiet(t)
            settingsSet(t, { defaultLenMinutes: 6 })
            const item = menuBarCapture(t)
            t.assert.ok(/Start 6 min \| .*Start for/.test(titles(item())), `the menu while idle: ${titles(item())}`)
            entryChoose(item(), "Start 6 min")
            t.assert.equal(t.spoon.timeLeft(), 6 * 60, "timeLeft() after Start")
            t.assert.ok(/Stop \| .*Pause/.test(titles(item())), `the menu while running: ${titles(item())}`)
            entryChoose(item(), "Pause")
            t.assert.ok(/Stop \| .*Resume/.test(titles(item())), `the menu while paused: ${titles(item())}`)
            entryChoose(item(), "Resume")
            t.assert.ok(/Pause/.test(titles(item())), `the menu after Resume: ${titles(item())}`)
            entryChoose(item(), "Stop")
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning() after Stop")
            t.assert.ok(/Start 6 min/.test(titles(item())), `the menu after Stop: ${titles(item())}`)
        }
    },
    // --- the functions ---
    {
        name: "countdownStart() without a length uses defaultLenMinutes",
        run: (t) => {
            quiet(t)
            settingsSet(t, { defaultLenMinutes: 9 })
            t.spoon.countdownStart()
            t.assert.equal(t.spoon.timeLeft(), 9 * 60, "timeLeft()")
        }
    },
    {
        name: "countdownIsRunning() is false and timeLeft() is 0 while no countdown runs",
        run: (t) => {
            quiet(t)
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning()")
            t.assert.equal(t.spoon.timeLeft(), 0, "timeLeft()")
            t.spoon.countdownStart(2)
            t.spoon.countdownCancel()
            t.assert.equal(t.spoon.timeLeft(), 0, "timeLeft() after a countdown is cancelled")
        }
    },
    {
        name: "the functions that act on the countdown return the Spoon",
        run: (t) => {
            quiet(t)
            const results = {
                countdownStart: t.spoon.countdownStart(3),
                pauseToggle: t.spoon.pauseToggle(),
                progressSet: t.spoon.progressSet(0.5),
                countdownCancel: t.spoon.countdownCancel(),
                countdownUntilStart: t.spoon.countdownUntilStart("23:59"),
                bindHotkeys: t.spoon.bindHotkeys({})
            }
            for (const [name, result] of Object.entries(results)) t.assert.equal(result, t.spoon, `${name}() returned`)
        }
    },
    {
        name: "the event names are the values of events",
        run: (t) => {
            const expected = { start: "started", pause: "paused", resume: "resumed", cancel: "cancelled", end: "ended", progressSet: "progressSet" }
            t.assert.equal(JSON.stringify(t.spoon.events), JSON.stringify(expected), "events")
        }
    },
    {
        name: "bindHotkeys() binds menuShow, releases the key of a first call, and refuses another name or a malformed binding",
        run: async (t) => {
            const calls = onScreenShowRecord(t)
            t.cleanup(() => t.spoon.bindHotkeys({}))
            t.spoon.bindHotkeys({ menuShow: [MODIFIERS, "7"] })
            hs.eventtap.keyStroke(MODIFIERS, "7", null)
            await t.wait(0.6)
            t.assert.equal(calls.length, 1, "menus shown after the key of the first call")
            t.spoon.bindHotkeys({ menuShow: [MODIFIERS, "8"] })
            hs.eventtap.keyStroke(MODIFIERS, "7", null)
            await t.wait(0.6)
            t.assert.equal(calls.length, 1, "menus shown after the key of the first call, released")
            hs.eventtap.keyStroke(MODIFIERS, "8", null)
            await t.wait(0.6)
            t.assert.equal(calls.length, 2, "menus shown after the key of the second call")
            for (const mapping of [{ countdownStart: [MODIFIERS, "9"] }, { menuShow: "9" }]) {
                let error = null
                try { t.spoon.bindHotkeys(mapping) } catch (e) { error = e }
                t.assert.ok(error, `no error for ${JSON.stringify(mapping)}`)
            }
            hs.eventtap.keyStroke(MODIFIERS, "8", null)
            await t.wait(0.6)
            t.assert.equal(calls.length, 3, "a refused call released the key bound before it")
        }
    },
    // --- start and stop ---
    {
        name: "stop() cancels the countdown, and removes the menu bar item, the progress bars and the key",
        run: async (t) => {
            quiet(t)
            const calls = onScreenShowRecord(t)
            const item = menuBarCapture(t)
            const canvases = t.canvasesCapture()
            t.spoon.stop()
            const before = canvases.length
            t.spoon.start()
            const bars = canvases.slice(before).map((c) => c.canvas)
            const destroyed = []
            for (const bar of bars) {
                const original = bar.destroy
                bar.destroy = function () { destroyed.push(bar); return original.apply(bar, arguments) }
            }
            const events = []
            t.spoon.bindHotkeys({ menuShow: [MODIFIERS, "7"] })
            t.spoon.countdownStart(3, (event) => events.push(event))
            t.assert.ok(bars.length > 0 && bars.every((bar) => bar.isShowing()), "the bars are not shown during the countdown")
            t.spoon.stop()
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning() after stop()")
            t.assert.equal(item().destroyed, true, "the menu bar item was not removed")
            t.assert.equal(destroyed.length, bars.length, "bars removed")
            hs.eventtap.keyStroke(MODIFIERS, "7", null)
            await t.wait(0.6)
            t.assert.equal(calls.length, 0, "menus shown after stop()")
        }
    },
    {
        name: "start() throws, naming the Spoon, when hs_interactive-gt or hs_menu-gt is not loaded",
        run: (t) => {
            t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
            for (const name of ["hs_interactive-gt", "hs_menu-gt"]) {
                t.spoon.stop()
                // Taken away and put back within this one synchronous call, so nothing else runs
                // while the user's Spoon is missing.
                const descriptor = Object.getOwnPropertyDescriptor(hs.spoons, name)
                let error = null
                try {
                    hs.spoons[name] = undefined
                    t.spoon.start()
                } catch (e) {
                    error = e
                } finally {
                    Object.defineProperty(hs.spoons, name, descriptor)
                }
                t.assert.ok(error && error.message.includes(name), `${name}: ${error ? error.message : "no error"}`)
            }
        }
    }
]
