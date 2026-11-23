// Tests of windowState(window), which the readme describes as returning "the record of a window
// that a handler receives as state". The fields are listed under "The handler".

const FIELDS = ["id", "title", "application", "bundleID", "pid", "role", "standard", "visible",
    "minimized", "fullscreen", "hidden", "focused", "onScreen", "screenName", "screenID", "frame"]

// Opens a test window inside its screen and focuses it.
async function windowOpen(t) {
    const [window] = await t.windowsOpen()
    const screen = t.screenFrame(window)
    await t.frameSet(window, { x: screen.x + 120, y: screen.y + 90, w: 450, h: 350 })
    window.focus()
    await t.wait(0.4)
    return window
}

module.exports = [
    {
        name: "windowState returns every field the readme lists",
        run: async (t) => {
            const window = await windowOpen(t)
            const state = t.spoon.windowState(window)
            t.assert.ok(state, "windowState returned null")
            const missing = FIELDS.filter((field) => !(field in state))
            t.assert.equal(missing.join(", "), "", "fields missing")
        }
    },
    {
        name: "windowState describes an ordinary window",
        run: async (t) => {
            const window = await windowOpen(t)
            const state = t.spoon.windowState(window)
            t.assert.equal(state.id, window.id, "id")
            t.assert.equal(state.title, window.title, "title")
            t.assert.equal(state.application, "osascript", "application")
            t.assert.equal(state.bundleID, null, "bundleID")
            t.assert.equal(state.pid, window.application.pid, "pid")
            t.assert.equal(state.role, "AXStandardWindow", "role")
            t.assert.equal(state.standard, true, "standard")
            t.assert.equal(state.visible, true, "visible")
            t.assert.equal(state.minimized, false, "minimized")
            t.assert.equal(state.fullscreen, false, "fullscreen")
            t.assert.equal(state.hidden, false, "hidden")
            t.assert.equal(state.onScreen, true, "onScreen")
            t.assert.equal(state.screenName, window.screen.name, "screenName")
            t.assert.equal(state.screenID, window.screen.id, "screenID")
            t.assert.frameEqual(state.frame, window.frame, "frame")
        }
    },
    {
        name: "windowState reports the focused window as focused",
        run: async (t) => {
            const window = await windowOpen(t)
            t.assert.equal(hs.window.focusedWindow().id, window.id, "the window does not have the focus")
            t.assert.equal(t.spoon.windowState(window).focused, true, "focused")
        }
    },
    {
        name: "windowState reports a minimized window as minimized and not on screen",
        run: async (t) => {
            const window = await windowOpen(t)
            window.minimize()
            await t.wait(0.8)
            const state = t.spoon.windowState(window)
            t.assert.equal(state.minimized, true, "minimized")
            t.assert.equal(state.onScreen, false, "onScreen")
            t.assert.equal(state.hidden, false, "hidden")
        }
    },
    {
        name: "windowState reports a window of a hidden application as hidden and not on screen",
        run: async (t) => {
            const window = await windowOpen(t)
            window.application.hide()
            await t.wait(0.5)
            const state = t.spoon.windowState(window)
            t.assert.equal(state.hidden, true, "hidden")
            t.assert.equal(state.onScreen, false, "onScreen")
            t.assert.equal(state.minimized, false, "minimized")
        }
    },
    {
        name: "a window that was standard stays standard in a filter's records while it is minimized and while its application is hidden",
        run: async (t) => {
            // macOS reports some such windows with another subrole, such as AXDialog. The test
            // windows are among them when minimized, so this test fails without the workaround.
            const window = await windowOpen(t)
            const filter = t.spoon.create({ allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
            t.cleanup(() => t.spoon.destroy(filter))
            // A handler starts the tracking, which is what keeps the earlier value. Without one,
            // records() reads each window afresh.
            filter.on("windowCreated", () => {})
            await t.wait(0.5)
            const standard = () => {
                const record = filter.records().find((r) => r.state.id === window.id)
                return record ? `${record.state.standard} ${record.state.role}` : "not listed"
            }
            t.assert.equal(standard(), "true AXStandardWindow", "on screen")
            window.minimize()
            await t.wait(1)
            t.assert.equal(standard(), "true AXStandardWindow", "minimized")
            window.unminimize()
            await t.wait(1)
            window.application.hide()
            await t.wait(1)
            t.assert.equal(standard(), "true AXStandardWindow", "with its application hidden")
        }
    },
    {
        name: "windowState reports a fullscreen window as fullscreen",
        timeout: 15,
        run: async (t) => {
            const window = await windowOpen(t)
            window.toggleFullscreen()
            const started = Date.now()
            while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            await t.wait(1.5)
            t.assert.equal(t.spoon.windowState(window).fullscreen, true, "fullscreen")
        }
    },
    {
        name: "windowState returns null for a window that has closed",
        run: async (t) => {
            const window = await windowOpen(t)
            await t.windowClose(window)
            t.assert.equal(t.spoon.windowState(window), null)
        }
    }
]
