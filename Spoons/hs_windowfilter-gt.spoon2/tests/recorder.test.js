// Tests of the event recorder and of the changes the test windows can make, on a filter of the
// copy under test. They check that each change produces the events the later tests rely on.
// Each event is tested on its own in events.test.js.

const recorders = require("./recorder.js")

// A filter of the copy under test that allows only this run's test windows, and a recorder of
// its events. Both are removed when the test ends.
function filterRecorded(t) {
    const filter = t.spoon.create({ allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
    t.cleanup(() => t.spoon.destroy(filter))
    return { filter, recorder: recorders.create(t, filter) }
}

module.exports = [
    {
        name: "opening a window gives windowCreated and windowAllowed",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            await recorder.waitFor("windowAllowed", window)
        }
    },
    {
        name: "moving and resizing a window give windowMoved and windowResized",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            const screen = t.screenFrame(window)
            await recorder.waitFor("windowCreated", window)
            recorder.clear()
            await t.frameSet(window, { x: screen.x + 150, y: screen.y + 100, w: 400, h: 300 })
            await recorder.waitFor("windowMoved", window)
            recorder.clear()
            await t.frameSet(window, { x: screen.x + 150, y: screen.y + 100, w: 500, h: 350 })
            await recorder.waitFor("windowResized", window)
        }
    },
    {
        name: "changing a window's title gives windowTitleChanged",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            recorder.clear()
            await t.windowTitleSet(window, `${t.titlePrefix}renamed`)
            const event = await recorder.waitFor("windowTitleChanged", window)
            t.assert.equal(event.state.title, `${t.titlePrefix}renamed`, "the title in the event's state")
        }
    },
    {
        name: "focusing another window gives windowFocused and windowUnfocused",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [first, second] = await t.windowsOpen(2)
            first.focus()
            await recorder.waitFor("windowFocused", first)
            recorder.clear()
            second.focus()
            await recorder.waitFor("windowFocused", second)
            await recorder.waitFor("windowUnfocused", first)
        }
    },
    {
        name: "minimizing and unminimizing a window give their events",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            recorder.clear()
            window.minimize()
            await recorder.waitFor("windowMinimized", window)
            await recorder.waitFor("windowNotVisible", window)
            recorder.clear()
            window.unminimize()
            await recorder.waitFor("windowUnminimized", window)
            await recorder.waitFor("windowVisible", window)
        }
    },
    {
        name: "hiding and unhiding a window's application give their events",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            recorder.clear()
            window.application.hide()
            await recorder.waitFor("windowHidden", window)
            await recorder.waitFor("windowNotOnScreen", window)
            recorder.clear()
            window.application.unhide()
            await recorder.waitFor("windowUnhidden", window)
            await recorder.waitFor("windowOnScreen", window)
        }
    },
    {
        name: "closing a window gives windowDestroyed",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            const id = window.id
            await t.windowClose(window)
            await recorder.waitFor("windowDestroyed", { id, title: "the closed window" })
        }
    },
    {
        name: "waitFor fails, naming the events that did arrive, when the event does not come",
        timeout: 5,
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            let error = null
            try {
                await recorder.waitFor("windowFullscreened", window, 1)
            } catch (e) {
                error = e
            }
            t.assert.ok(error, "waitFor did not fail")
            t.assert.ok(/no windowFullscreened .* within 1 s; received: .*windowCreated/.test(error.message),
                `the message: ${error.message}`)
        }
    }
]
