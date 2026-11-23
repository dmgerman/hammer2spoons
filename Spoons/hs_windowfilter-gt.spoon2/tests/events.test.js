// Tests of the nineteen events, as the readme describes them under "Events" and "When events are
// emitted": each is emitted once for the change it reports, with the window and its state, and
// not when nothing changed; a filter receives the events of the windows it accepted before or
// after the change, and no others.

const recorders = require("./recorder.js")

// Seconds to wait after an event, to see whether it comes a second time. Longer than every
// debounce delay at its default.
const SETTLE = 0.6

function noop() {}

// A watched filter of the copy under test that accepts only this run's test windows, with a
// recorder. Both are removed when the test ends.
function filterRecorded(t, rules) {
    const filter = t.spoon.create(rules || { allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
    t.cleanup(() => t.spoon.destroy(filter))
    return { filter, recorder: recorders.create(t, filter) }
}

// Opens test windows, waits for their windowCreated, places them, and clears the recorder.
async function windowsReady(t, recorder, count = 1) {
    const windows = await t.windowsOpen(count)
    for (const window of windows) await recorder.waitFor("windowCreated", window)
    const screen = t.screenFrame(windows[0])
    for (let i = 0; i < windows.length; i++) {
        await t.frameSet(windows[i], { x: screen.x + 100 + 500 * i, y: screen.y + 80, w: 450, h: 350 })
    }
    await t.wait(SETTLE)
    recorder.clear()
    return windows
}

// Waits for an event on a window, then checks that it came exactly once.
async function once(t, recorder, event, window) {
    const found = await recorder.waitFor(event, window)
    await t.wait(SETTLE)
    t.assert.equal(recorder.of(window, event).length, 1, `${event} came this many times`)
    return found
}

// The position of the first event of that name for the window in the recorder's list.
function indexOf(recorder, event, window) {
    return recorder.events.findIndex((e) => e.event === event && e.id === window.id)
}

module.exports = [
    {
        name: "windowCreated is emitted once for a new window, with the window and its state",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            const event = await once(t, recorder, "windowCreated", window)
            t.assert.equal(event.id, window.id, "the window's id")
            t.assert.equal(event.state.title, window.title, "the title in the state")
            t.assert.equal(event.state.application, "osascript", "the application in the state")
        }
    },
    {
        name: "windowCreated is emitted for windows already open when observing starts",
        run: async (t) => {
            // No filter of the copy is watched yet in this test, so the copy observes nothing.
            const [window] = await t.windowsOpen()
            await t.wait(0.5)
            const { recorder } = filterRecorded(t)
            await recorder.waitFor("windowCreated", window)
        }
    },
    {
        name: "a filter whose first handler comes later does not receive windowCreated for open windows, but lists them",
        run: async (t) => {
            const first = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await first.recorder.waitFor("windowCreated", window)
            const later = filterRecorded(t)
            await later.recorder.waitForNone("windowCreated", window, 1)
            t.assert.ok(later.filter.windows().some((w) => w.id === window.id), "windows() does not list the window")
        }
    },
    {
        name: "windowDestroyed is emitted once, with the state the window had",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            const id = window.id, title = window.title
            await t.windowClose(window)
            const event = await once(t, recorder, "windowDestroyed", { id, title })
            t.assert.equal(event.state.title, title, "the title in the state")
        }
    },
    {
        name: "windowMoved is emitted once after a move made of several steps",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            const f = window.frame
            for (let i = 1; i <= 5; i++) {
                window.frame = new HSRect(f.x + 20 * i, f.y + 10 * i, f.w, f.h)
                await t.wait(0.03)
            }
            await once(t, recorder, "windowMoved", window)
            t.assert.equal(recorder.of(window, "windowResized").length, 0, "windowResized came for a move")
        }
    },
    {
        name: "windowResized is emitted once after a resize made of several steps",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            const f = window.frame
            for (let i = 1; i <= 5; i++) {
                window.frame = new HSRect(f.x, f.y, f.w + 20 * i, f.h + 10 * i)
                await t.wait(0.03)
            }
            await once(t, recorder, "windowResized", window)
            t.assert.equal(recorder.of(window, "windowMoved").length, 0, "windowMoved came for a resize")
        }
    },
    {
        name: "setting a window's frame to the frame it has emits nothing",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            const f = window.frame
            window.frame = new HSRect(f.x, f.y, f.w, f.h)
            await t.wait(1)
            t.assert.equal(recorder.of(window).map((e) => e.event).join(", "), "", "events")
        }
    },
    {
        name: "windowTitleChanged is emitted once, with the new title",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            const title = `${t.titlePrefix}renamed`
            await t.windowTitleSet(window, title)
            const event = await once(t, recorder, "windowTitleChanged", window)
            t.assert.equal(event.state.title, title, "the title in the state")
        }
    },
    {
        name: "windowFocused and windowUnfocused are each emitted once when the focus moves",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [first, second] = await windowsReady(t, recorder, 2)
            first.focus()
            await recorder.waitFor("windowFocused", first)
            await t.wait(SETTLE)
            recorder.clear()
            second.focus()
            await once(t, recorder, "windowFocused", second)
            t.assert.equal(recorder.of(first, "windowUnfocused").length, 1, "windowUnfocused came this many times")
        }
    },
    {
        name: "minimizing emits windowMinimized, windowNotVisible and windowNotOnScreen once each",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            window.minimize()
            await once(t, recorder, "windowMinimized", window)
            t.assert.equal(recorder.of(window, "windowNotVisible").length, 1, "windowNotVisible")
            t.assert.equal(recorder.of(window, "windowNotOnScreen").length, 1, "windowNotOnScreen")
        }
    },
    {
        name: "unminimizing emits windowUnminimized, windowVisible and windowOnScreen once each",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            window.minimize()
            await recorder.waitFor("windowMinimized", window)
            await t.wait(SETTLE)
            recorder.clear()
            window.unminimize()
            await once(t, recorder, "windowUnminimized", window)
            t.assert.equal(recorder.of(window, "windowVisible").length, 1, "windowVisible")
            t.assert.equal(recorder.of(window, "windowOnScreen").length, 1, "windowOnScreen")
        }
    },
    {
        name: "hiding the application emits windowHidden and windowNotOnScreen once each",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            window.application.hide()
            await once(t, recorder, "windowHidden", window)
            t.assert.equal(recorder.of(window, "windowNotOnScreen").length, 1, "windowNotOnScreen")
        }
    },
    {
        name: "unhiding the application emits windowUnhidden and windowOnScreen once each",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            window.application.hide()
            await recorder.waitFor("windowHidden", window)
            await t.wait(SETTLE)
            recorder.clear()
            window.application.unhide()
            await once(t, recorder, "windowUnhidden", window)
            t.assert.equal(recorder.of(window, "windowOnScreen").length, 1, "windowOnScreen")
        }
    },
    {
        name: "entering and leaving fullscreen emit windowFullscreened and windowUnfullscreened once each",
        timeout: 25,
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await windowsReady(t, recorder)
            window.focus()
            await t.wait(0.4)
            window.toggleFullscreen()
            await recorder.waitFor("windowFullscreened", window, 5)
            await t.wait(1.5)
            t.assert.equal(recorder.of(window, "windowFullscreened").length, 1, "windowFullscreened came this many times")
            window.toggleFullscreen()
            await recorder.waitFor("windowUnfullscreened", window, 5)
            await t.wait(1.5)
            t.assert.equal(recorder.of(window, "windowUnfullscreened").length, 1, "windowUnfullscreened came this many times")
        }
    },
    {
        name: "a window that stops matching emits windowRejected before the event of the change",
        run: async (t) => {
            const keep = `${t.titlePrefix}`
            const { recorder } = filterRecorded(t, { allowTitles: (title) => (title || "").startsWith(keep) && !title.endsWith("out") })
            const [window] = await windowsReady(t, recorder)
            await t.windowTitleSet(window, `${keep}out`)
            await once(t, recorder, "windowRejected", window)
            await recorder.waitFor("windowTitleChanged", window)
            t.assert.ok(indexOf(recorder, "windowRejected", window) < indexOf(recorder, "windowTitleChanged", window),
                "windowRejected came after windowTitleChanged")
        }
    },
    {
        name: "a window that starts matching emits windowAllowed before the event of the change",
        run: async (t) => {
            const keep = `${t.titlePrefix}`
            const { recorder } = filterRecorded(t, { allowTitles: (title) => (title || "").startsWith(keep) && !title.endsWith("out") })
            const [window] = await windowsReady(t, recorder)
            const title = window.title
            await t.windowTitleSet(window, `${keep}out`)
            await recorder.waitFor("windowRejected", window)
            await t.wait(SETTLE)
            recorder.clear()
            await t.windowTitleSet(window, title)
            await once(t, recorder, "windowAllowed", window)
            await recorder.waitFor("windowTitleChanged", window)
            t.assert.ok(indexOf(recorder, "windowAllowed", window) < indexOf(recorder, "windowTitleChanged", window),
                "windowAllowed came after windowTitleChanged")
        }
    },
    {
        name: "a filter of visible windows receives windowMinimized, which makes the window stop matching",
        run: async (t) => {
            const all = filterRecorded(t)
            const visible = filterRecorded(t, { visible: true, allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
            const [window] = await windowsReady(t, all.recorder)
            await t.wait(SETTLE)
            visible.recorder.clear()
            window.minimize()
            await visible.recorder.waitFor("windowMinimized", window)
            await visible.recorder.waitFor("windowRejected", window)
        }
    },
    {
        name: "a filter that never accepted a window receives none of its events",
        run: async (t) => {
            const all = filterRecorded(t)
            const none = filterRecorded(t, { allowTitles: "no such title" })
            const [window] = await windowsReady(t, all.recorder)
            window.minimize()
            await all.recorder.waitFor("windowMinimized", window)
            window.unminimize()
            await all.recorder.waitFor("windowUnminimized", window)
            const id = window.id
            await t.windowClose(window)
            await all.recorder.waitFor("windowDestroyed", { id, title: "the closed window" })
            await t.wait(SETTLE)
            t.assert.equal(none.recorder.of({ id }).map((e) => e.event).join(", "), "", "events the other filter received")
        }
    },
    {
        name: "a handler that throws does not stop the other handlers",
        run: async (t) => {
            // The throwing handler is registered first, so that it runs before the recorder's.
            const filter = t.spoon.create({ allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
            t.cleanup(() => t.spoon.destroy(filter))
            const thrower = () => { throw new Error("handler error on purpose") }
            filter.on("windowMinimized", thrower)
            const recorder = recorders.create(t, filter)
            const [window] = await windowsReady(t, recorder)
            window.minimize()
            await recorder.waitFor("windowMinimized", window)
        }
    }
]
