// Tests of a filter's functions, as the readme describes them under "Functions of a filter":
// on(), off(), once(), windows(), records(), isWindowAllowed(), isWatched() and the three
// functions that set rules.

const recorders = require("./recorder.js")

const SETTLE = 0.6

function noop() {}

function testRules(t) {
    return { allowTitles: (title) => (title || "").startsWith(t.titlePrefix) }
}

// A filter of the copy under test, removed when the test ends. It is not watched.
function filterMake(t, rules) {
    const filter = t.spoon.create(rules || testRules(t))
    t.cleanup(() => t.spoon.destroy(filter))
    return filter
}

// Records what console.error writes until the test ends.
function consoleErrorsCapture(t) {
    const original = console.error
    const errors = []
    console.error = (...args) => {
        errors.push(args.join(" "))
        original.apply(console, args)
    }
    t.cleanup(() => { console.error = original })
    return errors
}

// Opens test windows, and waits until a watched filter that accepts them all has seen each one.
// Returns the windows and that filter's recorder.
async function windowsTracked(t, count = 1) {
    const recorder = recorders.create(t, filterMake(t))
    const windows = await t.windowsOpen(count)
    for (const window of windows) await recorder.waitFor("windowCreated", window)
    const screen = t.screenFrame(windows[0])
    for (let i = 0; i < windows.length; i++) {
        await t.frameSet(windows[i], { x: screen.x + 100 + 500 * i, y: screen.y + 80, w: 450, h: 350 })
    }
    await t.wait(SETTLE)
    recorder.clear()
    return { windows, recorder }
}

// A handler that records the events it was called with.
function calls() {
    const received = []
    const handler = (event, window, state) => received.push(event)
    return { received, handler }
}

module.exports = [
    {
        name: "on() registers a handler for one event, and returns the filter",
        run: async (t) => {
            const filter = filterMake(t)
            const { received, handler } = calls()
            t.assert.equal(filter.on("windowMinimized", handler), filter, "on() returned")
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            t.assert.equal(received.join(", "), "windowMinimized")
        }
    },
    {
        name: "on() registers a handler for each event of an array",
        run: async (t) => {
            const filter = filterMake(t)
            const { received, handler } = calls()
            filter.on(["windowMinimized", "windowUnminimized"], handler)
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            window.unminimize()
            await t.wait(1)
            t.assert.equal(received.join(", "), "windowMinimized, windowUnminimized")
        }
    },
    {
        name: "on() writes an unknown event name to the console, skips it, and registers the others",
        run: async (t) => {
            const errors = consoleErrorsCapture(t)
            const filter = filterMake(t)
            const { received, handler } = calls()
            filter.on(["windowNoSuchEvent", "windowMinimized"], handler)
            t.assert.ok(errors.some((e) => e.includes("windowNoSuchEvent")), `console errors: ${errors.join(" | ") || "none"}`)
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            t.assert.equal(received.join(", "), "windowMinimized")
        }
    },
    {
        name: "on() without a function registers nothing",
        run: (t) => {
            consoleErrorsCapture(t)
            const filter = filterMake(t)
            filter.on("windowMinimized", "not a function")
            t.assert.equal(filter.isWatched(), false)
        }
    },
    {
        name: "off() with an event and a handler removes only that handler",
        run: async (t) => {
            const filter = filterMake(t)
            const first = calls(), second = calls()
            filter.on("windowMinimized", first.handler)
            filter.on("windowMinimized", second.handler)
            t.assert.equal(filter.off("windowMinimized", first.handler), filter, "off() returned")
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            t.assert.equal(first.received.length, 0, "the removed handler was called")
            t.assert.equal(second.received.length, 1, "the other handler was called this many times")
        }
    },
    {
        name: "off() with only an event removes every handler of that event",
        run: async (t) => {
            const filter = filterMake(t)
            const first = calls(), second = calls(), other = calls()
            filter.on("windowMinimized", first.handler)
            filter.on("windowMinimized", second.handler)
            filter.on("windowUnminimized", other.handler)
            filter.off("windowMinimized")
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            window.unminimize()
            await t.wait(1)
            t.assert.equal(first.received.length + second.received.length, 0, "a removed handler was called")
            t.assert.equal(other.received.join(", "), "windowUnminimized", "the handler of the other event")
        }
    },
    {
        name: "off() with no argument removes every handler",
        run: (t) => {
            const filter = filterMake(t)
            filter.on("windowMinimized", noop)
            filter.on(["windowCreated", "windowDestroyed"], noop)
            filter.off()
            t.assert.equal(filter.isWatched(), false)
        }
    },
    {
        name: "once() calls its handler exactly once, even with several events, and then removes it",
        run: async (t) => {
            const filter = filterMake(t)
            const { received, handler } = calls()
            t.assert.equal(filter.once(["windowMinimized", "windowNotVisible", "windowUnminimized"], handler), filter, "once() returned")
            const { windows: [window] } = await windowsTracked(t)
            window.minimize()
            await t.wait(1)
            window.unminimize()
            await t.wait(1)
            t.assert.equal(received.length, 1, `calls: ${received.join(", ")}`)
            t.assert.equal(filter.isWatched(), false, "the handler is still registered")
        }
    },
    {
        name: "isWatched() is true while a filter has a handler",
        run: (t) => {
            const filter = filterMake(t)
            t.assert.equal(filter.isWatched(), false, "before on()")
            filter.on("windowFocused", noop)
            t.assert.equal(filter.isWatched(), true, "after on()")
            filter.off("windowFocused", noop)
            t.assert.equal(filter.isWatched(), false, "after off()")
        }
    },
    {
        name: "windows() and records() list exactly the windows the filter accepts, while observing",
        run: async (t) => {
            const { windows: [first, second] } = await windowsTracked(t, 2)
            const filter = filterMake(t, { allowTitles: first.title })
            t.assert.equal(filter.windows().map((w) => w.id).join(","), String(first.id), "windows()")
            const records = filter.records()
            t.assert.equal(records.length, 1, "records()")
            t.assert.equal(records[0].window.id, first.id, "the record's window")
            t.assert.equal(records[0].state.title, first.title, "the record's state")
        }
    },
    {
        name: "windows() lists the accepted windows when nothing is being observed",
        run: async (t) => {
            // No filter of the copy is watched in this test, so windows() reads the windows itself.
            const [first, second] = await t.windowsOpen(2)
            await t.wait(0.3)
            t.assert.equal(t.spoon.status().tracking, false, "the copy is observing windows")
            const filter = filterMake(t, { allowTitles: first.title })
            t.assert.equal(filter.windows().map((w) => w.id).join(","), String(first.id))
        }
    },
    {
        name: "isWindowAllowed() answers for one window and registers no handler",
        run: async (t) => {
            const { windows: [first, second] } = await windowsTracked(t, 2)
            const filter = filterMake(t, { allowTitles: first.title })
            t.assert.equal(filter.isWindowAllowed(first), true, "the accepted window")
            t.assert.equal(filter.isWindowAllowed(second), false, "the other window")
            t.assert.equal(filter.isWatched(), false, "isWatched()")
        }
    },
    {
        name: "the functions that set rules return the filter",
        run: (t) => {
            const filter = filterMake(t)
            t.assert.equal(filter.setDefaultFilter({}), filter, "setDefaultFilter")
            t.assert.equal(filter.setApplicationFilter("osascript", true), filter, "setApplicationFilter")
            t.assert.equal(filter.setOverrideFilter(null), filter, "setOverrideFilter")
        }
    },
    {
        name: "changing the rules so that a window stops matching emits windowRejected",
        run: async (t) => {
            const { windows: [window] } = await windowsTracked(t)
            const filter = filterMake(t)
            const recorder = recorders.create(t, filter)
            await t.wait(SETTLE)
            filter.setOverrideFilter({ allowTitles: "no such title" })
            await recorder.waitFor("windowRejected", window)
        }
    },
    {
        name: "changing the rules so that a window starts matching emits windowAllowed",
        run: async (t) => {
            const { windows: [window] } = await windowsTracked(t)
            const filter = filterMake(t, { allowTitles: "no such title" })
            const recorder = recorders.create(t, filter)
            await t.wait(SETTLE)
            filter.setDefaultFilter(testRules(t))
            await recorder.waitFor("windowAllowed", window)
        }
    }
]
