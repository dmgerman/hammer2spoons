// Tests of bindHotkeys(), start(), stop() and the settings, as the readme describes them under
// "bindHotkeys(mapping)", "start() and stop()" and "Settings".
//
// The keys bound are ctrl-alt-shift with 7, 8 or 9, which the user does not bind. A test window
// has the focus before each key, so a key the copy did not bind reaches that window.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const { choosersCapture, open, interactive, isOpen, openWait, key, focus } = require("./chooser.js")

const MODIFIERS = ["ctrl", "alt", "shift"]

// Presses a test key while a test window has the focus, and resolves to whether the copy's
// chooser opened. The chooser is closed with Escape.
async function keyOpens(t, name) {
    const focused = hs.window.focusedWindow()
    if (!focused || !String(focused.title).startsWith(t.titlePrefix)) t.assert.fail(`not pressing ${name}: a test window does not have the focus`)
    hs.eventtap.keyStroke(withFn(MODIFIERS, name), name, null)
    const started = Date.now()
    while (Date.now() - started < 1500) {
        if (interactive().promptIsOpen()) {
            await t.wait(0.3)
            if (interactive().promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
            await t.wait(0.5)
            return true
        }
        await t.wait(0.05)
    }
    return false
}

// Sets fields of the copy's config until the test ends.
function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

// Opens two test windows, focusing the first and then the second.
async function windowsReady(t) {
    const [a, b] = await t.windowsOpen(2)
    await focus(t, a)
    await focus(t, b)
    return [a, b]
}

// The thumbnails drawn from now on. A change of focus can make the user's other Spoons draw
// canvases, so a test records only once its windows have the focus.
const thumbnails = (t) => t.canvasesCapture()

module.exports = [
    {
        name: "each setting can also be set on the Spoon's object, as hs.spoons.use()'s config option sets it",
        run: (t) => {
            const config = t.spoon.config
            const saved = Object.assign({}, config)
            t.cleanup(() => Object.assign(config, saved))
            const names = Object.keys(config)
            t.assert.ok(names.length > 0, "no settings")
            // A value that no setting has, set and restored at once.
            const marker = { zqMarker: true }
            for (const name of names) {
                // As hs.spoons.use() applies its config option: Object.assign(spoon, config).
                Object.assign(t.spoon, { [name]: marker })
                t.assert.equal(config[name], marker, `${name}: config after setting the object`)
                config[name] = saved[name]
                t.assert.equal(t.spoon[name], saved[name], `${name}: the object after setting config`)
            }
        }
    },
    // --- bindHotkeys ---
    {
        name: "bindHotkeys() binds a key to a function, and a second call releases the keys of the first",
        run: async (t) => {
            t.cleanup(() => t.spoon.bindHotkeys({}))
            await windowsReady(t)
            t.spoon.bindHotkeys({ windowSelect: [MODIFIERS, "f17"] })
            t.assert.ok(await keyOpens(t, "f17"), "f17 did not open the chooser")
            t.spoon.bindHotkeys({ applicationWindowSelect: [MODIFIERS, "f18"] })
            t.assert.ok(!(await keyOpens(t, "f17")), "f17 still opens the chooser")
            t.assert.ok(await keyOpens(t, "f18"), "f18 did not open the chooser")
        }
    },
    {
        name: "bindHotkeys() throws for an unknown name or a malformed binding, and binds nothing",
        run: async (t) => {
            t.cleanup(() => t.spoon.bindHotkeys({}))
            await windowsReady(t)
            let error = null
            try { t.spoon.bindHotkeys({ windowSelect: [MODIFIERS, "f17"], noSuchFunction: [MODIFIERS, "f18"] }) } catch (e) { error = e }
            t.assert.ok(error && error.message.includes("noSuchFunction"), `the error: ${error && error.message}`)
            error = null
            try { t.spoon.bindHotkeys({ windowSelect: [MODIFIERS, "f17"], applicationSelect: ["f19"] }) } catch (e) { error = e }
            t.assert.ok(error && error.message.includes("applicationSelect"), `the error: ${error && error.message}`)
            t.assert.ok(!(await keyOpens(t, "f17")), "f17 was bound")
        }
    },
    {
        name: "every function the readme names can be bound",
        run: (t) => {
            t.cleanup(() => t.spoon.bindHotkeys({}))
            const names = ["windowSelect", "applicationWindowSelect", "applicationSelect", "windowPreviousSelect",
                "applicationWindowPreviousSelect", "windowToCurrentSpaceSelect", "menuShow", "windowSelectCurrentSpace",
                "applicationWindowSelectCurrentSpace", "windowPreviousSelectCurrentSpace", "applicationWindowPreviousSelectCurrentSpace"]
            const mapping = {}
            names.forEach((name, i) => { mapping[name] = [MODIFIERS, ["f17", "f18", "f19"][i % 3]] })
            // Names share keys here; only whether bindHotkeys() accepts each name matters.
            for (const name of names) t.spoon.bindHotkeys({ [name]: mapping[name] })
        }
    },
    // --- start and stop ---
    {
        name: "stop() releases the keys, closes an open chooser and reports its prompt closed",
        run: async (t) => {
            t.cleanup(() => { t.spoon.bindHotkeys({}); t.spoon.start() })
            await windowsReady(t)
            t.spoon.bindHotkeys({ windowSelect: [MODIFIERS, "f17"] })
            const chooser = t.spoon.windowSelect()
            await openWait(t, chooser)
            t.spoon.stop()
            await t.wait(0.4)
            t.assert.ok(!isOpen(chooser), "the chooser is still open")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
            t.spoon.start()
            t.assert.ok(!(await keyOpens(t, "f17")), "f17 still opens the chooser")
        }
    },
    {
        name: "start() throws, naming the Spoon, when hs_interactive-gt, hs_window-gt or hs_menu-gt is not loaded",
        run: (t) => {
            t.cleanup(() => t.spoon.start())
            for (const name of ["hs_interactive-gt", "hs_window-gt", "hs_menu-gt"]) {
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
    },
    {
        name: "start() throws, naming hs.windowfilter, when Hammerspoon 2 does not have inaccessibleApplications()",
        run: (t) => {
            t.cleanup(() => t.spoon.start())
            t.spoon.stop()
            // Taken away and put back within this one synchronous call, so nothing else runs
            // while the function is missing.
            const original = hs.windowfilter.inaccessibleApplications
            let error = null
            try {
                hs.windowfilter.inaccessibleApplications = undefined
                t.spoon.start()
            } catch (e) {
                error = e
            } finally {
                hs.windowfilter.inaccessibleApplications = original
            }
            t.assert.ok(error && error.message.includes("hs.windowfilter"), error ? error.message : "no error")
        }
    },
    // --- the settings ---
    {
        name: "rowsToDisplay and width are given to the chooser, and wideWidth is used above wideScreenPoints",
        run: async (t) => {
            const choosers = choosersCapture(t)
            await windowsReady(t)
            settingsSet(t, { rowsToDisplay: 5, width: 0.3, wideWidth: 0.2 })
            const screen = hs.screen.main() || hs.screen.primary()
            settingsSet(t, { wideScreenPoints: screen.fullFrame.w + 1 })
            const narrow = open(t, () => t.spoon.windowSelect())
            await openWait(t, narrow)
            await key(t, narrow, [], "escape")
            settingsSet(t, { wideScreenPoints: screen.fullFrame.w - 1 })
            const wide = open(t, () => t.spoon.windowSelect())
            await openWait(t, wide)
            await key(t, wide, [], "escape")
            t.assert.equal(choosers[0].assigned.visibleRows, 5, "visibleRows")
            t.assert.equal(choosers[0].assigned.width, 0.3, "the width on a screen narrower than wideScreenPoints")
            t.assert.equal(choosers[1].assigned.width, 0.2, "the width on a screen wider than wideScreenPoints")
        }
    },
    {
        name: "textSize, subTextSize and querySize are given to the chooser, about 20% above its own by default, and null keeps its own",
        run: async (t) => {
            const choosers = choosersCapture(t)
            await windowsReady(t)
            const first = open(t, () => t.spoon.windowSelect())
            await openWait(t, first)
            await key(t, first, [], "escape")
            const sizes = (record) => JSON.stringify(["textSize", "subTextSize", "querySize"].map((name) => record.assigned[name] === undefined ? null : record.assigned[name]))
            t.assert.equal(sizes(choosers[0]), JSON.stringify([17, 14, 24]), "the default sizes")
            settingsSet(t, { textSize: 18, subTextSize: null, querySize: 30 })
            const second = open(t, () => t.spoon.windowSelect())
            await openWait(t, second)
            await key(t, second, [], "escape")
            t.assert.equal(sizes(choosers[1]), JSON.stringify([18, null, 30]), "the sizes set, with subTextSize null")
        }
    },
    {
        name: "skipApplications, read at start(), leaves an application's windows out",
        run: async (t) => {
            const [a] = await windowsReady(t)
            const original = t.spoon.config.skipApplications
            t.cleanup(() => { t.spoon.stop(); t.spoon.config.skipApplications = original; t.spoon.start() })
            t.spoon.config.skipApplications = original.concat(["osascript"])
            t.assert.ok(t.spoon.order().some((e) => e.endsWith(a.title)), "listed before start()")
            t.spoon.stop()
            t.spoon.start()
            t.assert.ok(!t.spoon.order().some((e) => e.endsWith(a.title)), "listed after start()")
        }
    },
    {
        name: "thumbnailToggleKey and thumbnailRefreshKey change the keys that show and refresh the thumbnail",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            await windowsReady(t)
            // Ordinary keys rather than function keys: a function key sent with keyStroke() may carry the fn
            // flag, and then does not match a key bound without modifiers.
            settingsSet(t, { thumbnailToggleKey: "`", thumbnailRefreshKey: "=" })
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            const canvases = thumbnails(t)
            await key(t, chooser, [], "`")
            await t.wait(0.8)
            const shown = canvases.length
            t.assert.ok(shown >= 1, "` showed no thumbnail")
            await key(t, chooser, ["shift"], "=")
            await t.wait(0.8)
            t.assert.ok(canvases.length > shown, "shift-= drew no new thumbnail")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "thumbnailGap is the space between the thumbnail and the chooser",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            await windowsReady(t)
            settingsSet(t, { showThumbnail: true, thumbnailGap: 12 })
            const chooser = open(t, () => t.spoon.windowSelect())
            const canvases = thumbnails(t)
            await openWait(t, chooser)
            await t.wait(0.8)
            const first = canvases[canvases.length - 1]
            t.assert.ok(first, "no thumbnail")
            t.spoon.config.thumbnailGap = 52
            await key(t, chooser, ["shift"], t.spoon.config.thumbnailRefreshKey)
            await t.wait(0.8)
            const second = canvases[canvases.length - 1]
            t.assert.ok(second !== first, "no new thumbnail")
            const rightEdge = (c) => c.frame.x + c.frame.w
            t.assert.ok(Math.abs(rightEdge(first) - rightEdge(second) - 40) <= 1, `the right edge moved by ${rightEdge(first) - rightEdge(second)} points`)
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "thumbnailHeightRatio limits the thumbnail's height",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            const [a] = await t.windowsOpen(1)
            const area = a.screen.frame
            await t.frameSet(a, { x: area.x + 40, y: area.y + 40, w: area.w * 0.5, h: area.h * 0.8 })
            const [b] = await t.windowsOpen(1)
            await focus(t, a)
            await focus(t, b)
            settingsSet(t, { showThumbnail: true, thumbnailHeightRatio: 0.1 })
            const canvases = thumbnails(t)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await t.wait(0.8)
            const thumbnail = canvases[canvases.length - 1]
            t.assert.ok(thumbnail, "no thumbnail")
            const screen = (hs.screen.main() || hs.screen.primary()).frame
            t.assert.ok(thumbnail.frame.h <= screen.h * 0.1 + 1, `the thumbnail is ${thumbnail.frame.h} points high, against ${screen.h * 0.1}`)
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "the thumbnail follows the selection as soon as it moves, and no repeating timer runs while the chooser is open",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            const [a, b] = await t.windowsOpen(2)
            const [c] = await t.windowsOpen(1)
            for (const w of [a, b, c]) await focus(t, w)
            settingsSet(t, { showThumbnail: true })
            // Counts the repeating timers started until the test ends. Before Hammerspoon 2's
            // onSelectionChange (issue #390), this Spoon read the selected row on such a timer.
            const doEvery = hs.timer.doEvery
            let repeating = 0
            hs.timer.doEvery = function () { repeating += 1; return doEvery.apply(hs.timer, arguments) }
            t.cleanup(() => { hs.timer.doEvery = doEvery })
            const canvases = thumbnails(t)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await t.wait(0.6)
            const shown = canvases.length
            t.assert.ok(shown >= 1, "no thumbnail when the chooser opened")
            await key(t, chooser, [], "down")
            await t.wait(1)
            t.assert.ok(canvases.length > shown, "no thumbnail drawn within 1 s of the selection moving")
            await key(t, chooser, [], "escape")
            t.assert.equal(repeating, 0, "repeating timers started while the chooser was open")
        }
    }
]
