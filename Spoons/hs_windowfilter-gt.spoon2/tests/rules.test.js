// Tests of the rules a filter applies, as the readme describes them under "Rules" and "Rules for
// particular applications", and of the default filter. Each rule is tested with a window it
// accepts and a window it refuses. allowScreens across two screens is in two-screens.test.js.
//
// Each filter is watched, so that the tracker follows the test windows as it does in use, and
// isWindowAllowed() reads the tracker's record of them.

const recorders = require("./recorder.js")

function noop() {}

// A watched filter of the copy under test, removed when the test ends.
function filterMake(t, rules) {
    const filter = t.spoon.create(rules)
    filter.on("windowCreated", noop)
    t.cleanup(() => t.spoon.destroy(filter))
    return filter
}

// Opens test windows, and waits until the tracker of the copy follows them: a filter that
// accepts only them has reported each one created.
async function windowsOpenTracked(t, count = 1) {
    const watcher = filterMake(t, { allowTitles: (title) => (title || "").startsWith(t.titlePrefix) })
    const recorder = recorders.create(t, watcher)
    const windows = await t.windowsOpen(count)
    for (const window of windows) await recorder.waitFor("windowCreated", window)
    const screen = t.screenFrame(windows[0])
    for (let i = 0; i < windows.length; i++) {
        await t.frameSet(windows[i], { x: screen.x + 100 + 500 * i, y: screen.y + 80, w: 450, h: 350 })
    }
    return windows
}

function allowed(t, rules, window) {
    return filterMake(t, rules).isWindowAllowed(window)
}

// Checks that a rule set accepts one window and refuses another.
function acceptsAndRefuses(t, rules, accepted, refused) {
    t.assert.equal(allowed(t, rules, accepted), true, `${JSON.stringify(rules)} refused "${accepted.title}"`)
    t.assert.equal(allowed(t, rules, refused), false, `${JSON.stringify(rules)} accepted "${refused.title}"`)
}

function centerOf(f) {
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
}

const tests = [
    {
        name: "the empty rule set accepts every window",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, {}, window), true)
        }
    },
    {
        name: "visible accepts a window whose visibility equals the value",
        run: async (t) => {
            const [shown, minimized] = await windowsOpenTracked(t, 2)
            minimized.minimize()
            await t.wait(0.8)
            acceptsAndRefuses(t, { visible: true }, shown, minimized)
            acceptsAndRefuses(t, { visible: false }, minimized, shown)
        }
    },
    {
        name: "fullscreen accepts a window whose fullscreen state equals the value",
        timeout: 20,
        run: async (t) => {
            const [full, normal] = await windowsOpenTracked(t, 2)
            full.focus()
            await t.wait(0.4)
            full.toggleFullscreen()
            const started = Date.now()
            while (!full.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            await t.wait(1.5)
            acceptsAndRefuses(t, { fullscreen: true }, full, normal)
            acceptsAndRefuses(t, { fullscreen: false }, normal, full)
        }
    },
    {
        name: "focused accepts a window whose focus equals the value",
        run: async (t) => {
            const [focused, other] = await windowsOpenTracked(t, 2)
            focused.focus()
            await t.wait(0.5)
            acceptsAndRefuses(t, { focused: true }, focused, other)
            acceptsAndRefuses(t, { focused: false }, other, focused)
        }
    },
    {
        name: "hasTitlebar accepts a standard window when true, and refuses it when false",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, { hasTitlebar: true }, window), true, "hasTitlebar true")
            t.assert.equal(allowed(t, { hasTitlebar: false }, window), false, "hasTitlebar false")
        }
    },
    {
        name: "activeApplication accepts only windows of the frontmost application",
        run: async (t) => {
            // Two separate processes, so two applications.
            const [front] = await windowsOpenTracked(t)
            const [back] = await windowsOpenTracked(t)
            t.assert.ok(front.application.pid !== back.application.pid, "both windows belong to one process")
            front.focus()
            await t.wait(0.5)
            acceptsAndRefuses(t, { activeApplication: true }, front, back)
        }
    },
    {
        name: "allowTitles accepts a window whose title matches",
        run: async (t) => {
            const [first, second] = await windowsOpenTracked(t, 2)
            acceptsAndRefuses(t, { allowTitles: first.title }, first, second)
        }
    },
    {
        name: "rejectTitles refuses a window whose title matches",
        run: async (t) => {
            const [first, second] = await windowsOpenTracked(t, 2)
            acceptsAndRefuses(t, { rejectTitles: first.title }, second, first)
        }
    },
    {
        name: "allowApplications accepts a window whose application's name matches",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, { allowApplications: "osascript" }, window), true, "osascript")
            t.assert.equal(allowed(t, { allowApplications: ["Finder", /^Safari/] }, window), false, "Finder or Safari")
        }
    },
    {
        name: "rejectApplications refuses a window whose application's name matches",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, { rejectApplications: "osascript" }, window), false, "osascript")
            t.assert.equal(allowed(t, { rejectApplications: "Finder" }, window), true, "Finder")
        }
    },
    {
        name: "allowRoles accepts a window whose role matches, or any window for *",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, { allowRoles: "AXStandardWindow" }, window), true, "AXStandardWindow")
            t.assert.equal(allowed(t, { allowRoles: "AXWindow" }, window), false, "AXWindow")
            t.assert.equal(allowed(t, { allowRoles: "*" }, window), true, "*")
        }
    },
    {
        name: "allowScreens accepts a window on a screen named or numbered by the rule",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            const screen = window.screen
            t.assert.equal(allowed(t, { allowScreens: screen.name }, window), true, "the screen's name")
            t.assert.equal(allowed(t, { allowScreens: String(screen.id) }, window), true, "the screen's id")
            t.assert.equal(allowed(t, { allowScreens: "no such screen" }, window), false, "another name")
        }
    },
    {
        name: "allowRegions accepts a window whose centre is inside one of the rectangles",
        run: async (t) => {
            const [inside, outside] = await windowsOpenTracked(t, 2)
            const c = centerOf(inside.frame)
            const around = { x: c.x - 20, y: c.y - 20, w: 40, h: 40 }
            acceptsAndRefuses(t, { allowRegions: around }, inside, outside)
            const far = { x: c.x + 5000, y: c.y + 5000, w: 10, h: 10 }
            acceptsAndRefuses(t, { allowRegions: [far, around] }, inside, outside)
        }
    },
    {
        name: "a window is accepted only when it satisfies every key present",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            t.assert.equal(allowed(t, { visible: true, allowTitles: window.title }, window), true, "both satisfied")
            t.assert.equal(allowed(t, { visible: true, allowTitles: "another title" }, window), false, "one not satisfied")
        }
    },
    {
        name: "the rules for an application replace the default rules for its windows",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            const filter = filterMake(t, { allowTitles: "another title" })
            t.assert.equal(filter.isWindowAllowed(window), false, "by the default rules")
            filter.setApplicationFilter("osascript", { visible: true })
            t.assert.equal(filter.isWindowAllowed(window), true, "with rules for osascript")
            filter.setApplicationFilter("osascript", null)
            t.assert.equal(filter.isWindowAllowed(window), false, "after the application's rules were removed")
        }
    },
    {
        name: "an application's rules of true accept every window, and of false refuse every one",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            const refusing = filterMake(t, { allowTitles: "another title" })
            refusing.setApplicationFilter("osascript", true)
            t.assert.equal(refusing.isWindowAllowed(window), true, "true")
            const accepting = filterMake(t, {})
            accepting.setApplicationFilter("osascript", false)
            t.assert.equal(accepting.isWindowAllowed(window), false, "false")
        }
    },
    {
        name: "the override rules alone decide while they are set",
        run: async (t) => {
            const [focused, other] = await windowsOpenTracked(t, 2)
            focused.focus()
            await t.wait(0.5)
            const filter = filterMake(t, {})
            filter.setApplicationFilter("osascript", true)
            filter.setOverrideFilter({ focused: true })
            t.assert.equal(filter.isWindowAllowed(focused), true, "the focused window")
            t.assert.equal(filter.isWindowAllowed(other), false, "the other window, which its application's rules accept")
            filter.setOverrideFilter(null)
            t.assert.equal(filter.isWindowAllowed(other), true, "the other window after the override was removed")
        }
    },
    {
        name: "setDefaultFilter replaces the default rules",
        run: async (t) => {
            const [window] = await windowsOpenTracked(t)
            const filter = filterMake(t, {})
            filter.setDefaultFilter({ allowTitles: "another title" })
            t.assert.equal(filter.isWindowAllowed(window), false)
        }
    },
    {
        name: "default accepts a visible window of an ordinary application, and refuses a minimized one",
        run: async (t) => {
            const [shown, minimized] = await windowsOpenTracked(t, 2)
            minimized.minimize()
            await t.wait(0.8)
            t.assert.equal(t.spoon.default.isWindowAllowed(shown), true, "the visible window")
            t.assert.equal(t.spoon.default.isWindowAllowed(minimized), false, "the minimized window")
        }
    },
    {
        name: "default refuses Hammerspoon 2's windows, which a filter can still ask for by name",
        run: async (t) => {
            const title = `${t.titlePrefix}Hammerspoon window`
            // With something in it: an hs.ui window with no content is not shown.
            const ui = hs.ui.window({ x: 300, y: 300, w: 300, h: 200 }).windowTitle(title)
                .rectangle().fill("#4A90E2").frame({ w: "100%", h: "100%" }).show()
            t.cleanup(() => ui.destroy())
            let window = null
            const started = Date.now()
            while (!window && Date.now() - started < 3000) {
                window = hs.window.allWindows().find((w) => w.title === title)
                if (!window) await t.wait(0.1)
            }
            t.assert.ok(window, "the Hammerspoon 2 window was not found")
            t.assert.equal(window.application.name, "Hammerspoon 2", "its application")
            t.assert.equal(t.spoon.default.isWindowAllowed(window), false, "default")
            t.assert.equal(allowed(t, { allowApplications: "Hammerspoon 2" }, window), true, "a filter asking for it")
        }
    }
]

module.exports = tests
