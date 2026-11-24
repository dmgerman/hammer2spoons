// Tests of the settings in config, as the readme lists them under "Settings", each with a value
// other than its default. Each test puts the setting back when it ends.
//
// applicationRetryDelays has no test. It applies only when an application refuses to be
// observed, as one that has just started can, and a test cannot make an application refuse.

const recorders = require("./recorder.js")

const SETTLE = 0.6

// Sets some settings of the copy under test until the test ends.
function configSet(t, values) {
    const saved = {}
    for (const key of Object.keys(values)) {
        saved[key] = t.spoon.config[key]
        t.spoon.config[key] = values[key]
    }
    t.cleanup(() => Object.assign(t.spoon.config, saved))
}

function testRules(t) {
    return { allowTitles: (title) => (title || "").startsWith(t.titlePrefix) }
}

// A watched filter of the copy under test, with a recorder, removed when the test ends.
function filterRecorded(t, rules) {
    const filter = t.spoon.create(rules || testRules(t))
    t.cleanup(() => t.spoon.destroy(filter))
    return { filter, recorder: recorders.create(t, filter) }
}

// Opens a test window, waits for its windowCreated and for any event of its placement, and
// clears the recorder.
async function windowReady(t, recorder) {
    const [window] = await t.windowsOpen()
    await recorder.waitFor("windowCreated", window)
    await t.wait(SETTLE)
    recorder.clear()
    return window
}

// Records console.error and console.log until the test ends.
function consoleCapture(t) {
    const original = { error: console.error, log: console.log }
    const written = { error: [], log: [] }
    console.error = (...args) => { written.error.push(args.join(" ")); original.error.apply(console, args) }
    console.log = (...args) => { written.log.push(args.join(" ")); original.log.apply(console, args) }
    t.cleanup(() => { console.error = original.error; console.log = original.log })
    return written
}

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
    {
        name: "moveDebounce is how long windowMoved waits after the last move",
        run: async (t) => {
            configSet(t, { moveDebounce: 0.8 })
            const { recorder } = filterRecorded(t)
            const window = await windowReady(t, recorder)
            const f = window.frame
            window.frame = new HSRect(f.x + 40, f.y + 20, f.w, f.h)
            await t.wait(0.5)
            t.assert.equal(recorder.of(window, "windowMoved").length, 0, "windowMoved came before 0.5 s")
            const event = await recorder.waitFor("windowMoved", window)
            t.assert.ok(event.at >= 800, `windowMoved came after ${event.at} ms`)
        }
    },
    {
        name: "titleDebounce is how long windowTitleChanged waits after the last change",
        run: async (t) => {
            configSet(t, { titleDebounce: 0.8 })
            const { recorder } = filterRecorded(t)
            const window = await windowReady(t, recorder)
            await t.windowTitleSet(window, `${t.titlePrefix}renamed`)
            const changed = Date.now()
            const event = await recorder.waitFor("windowTitleChanged", window)
            const after = Date.now() - changed
            t.assert.ok(after >= 600, `windowTitleChanged came ${after} ms after the title changed`)
            t.assert.ok(event.at >= 800, `windowTitleChanged came after ${event.at} ms`)
        }
    },
    {
        name: "stateDebounce is how long a window is left before it is read after it is minimized",
        run: async (t) => {
            configSet(t, { stateDebounce: 1 })
            const { recorder } = filterRecorded(t)
            const window = await windowReady(t, recorder)
            window.minimize()
            const event = await recorder.waitFor("windowMinimized", window, 3)
            t.assert.ok(event.at >= 1000, `windowMinimized came after ${event.at} ms`)
        }
    },
    {
        name: "untitledNonStandardSkip leaves out a window with no title that is not standard",
        run: async (t) => {
            const { recorder } = filterRecorded(t, { allowApplications: "osascript", allowTitles: "" })
            const window = await t.windowOpenBorderless("")
            t.assert.equal(window.isStandard, false, "the window is standard")
            await recorder.waitForNone("windowCreated", window, 2.5)
        }
    },
    {
        name: "untitledNonStandardSkip false keeps a window with no title that is not standard",
        run: async (t) => {
            configSet(t, { untitledNonStandardSkip: false })
            const { recorder } = filterRecorded(t, { allowApplications: "osascript", allowTitles: "" })
            const window = await t.windowOpenBorderless("")
            await recorder.waitFor("windowCreated", window, 3)
        }
    },
    {
        name: "createdRescanDelay is when a window that got its title late is found",
        timeout: 15,
        run: async (t) => {
            configSet(t, { createdRescanDelay: 3 })
            const { recorder } = filterRecorded(t)
            const opened = Date.now()
            const window = await t.windowOpenBorderless("")
            await t.wait(0.3)
            await t.windowTitleSet(window, `${t.titlePrefix}late`)
            await t.wait(1.5)
            t.assert.equal(recorder.of(window, "windowCreated").length, 0, "windowCreated came before the rescan")
            await recorder.waitFor("windowCreated", window, 4)
            const after = Date.now() - opened
            t.assert.ok(after >= 2800, `windowCreated came ${after} ms after the window opened`)
        }
    },
    {
        name: "skipApplications leaves out every window of the applications it names",
        run: async (t) => {
            configSet(t, { skipApplications: [...t.spoon.config.skipApplications, "osascript"] })
            t.assert.equal(t.spoon.status().tracking, false, "the copy was already observing")
            const { recorder } = filterRecorded(t)
            const [window] = await t.windowsOpen()
            await recorder.waitForNone("windowCreated", window, 2.5)
        }
    },
    {
        name: "skipInDefault changed in place keeps default from accepting those applications",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const window = await windowReady(t, recorder)
            t.assert.equal(t.spoon.default.isWindowAllowed(window), true, "before the change")
            const list = t.spoon.config.skipInDefault
            list.push("osascript")
            t.cleanup(() => list.splice(list.indexOf("osascript"), 1))
            t.assert.equal(t.spoon.default.isWindowAllowed(window), false, "after the change")
        }
    },
    {
        name: "skipInDefault given a new list keeps default from accepting those applications",
        run: async (t) => {
            const { recorder } = filterRecorded(t)
            const window = await windowReady(t, recorder)
            configSet(t, { skipInDefault: [...t.spoon.config.skipInDefault, "osascript"] })
            t.assert.equal(t.spoon.default.isWindowAllowed(window), false)
        }
    },
    {
        name: "logLevel none writes nothing, and error writes errors",
        run: (t) => {
            const written = consoleCapture(t)
            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            configSet(t, { logLevel: "none" })
            filter.on("windowNoSuchEvent", () => {})
            t.assert.equal(written.error.length, 0, "an error was written with none")
            t.spoon.config.logLevel = "error"
            filter.on("windowNoSuchEvent", () => {})
            t.assert.ok(written.error.some((e) => e.includes("windowNoSuchEvent")), "no error was written with error")
        }
    },
    {
        name: "logLevel debug also writes debugging messages",
        run: (t) => {
            const written = consoleCapture(t)
            configSet(t, { logLevel: "debug" })
            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            filter.on("windowCreated", () => {})
            t.assert.ok(written.log.some((m) => m.includes("[hs_windowfilter-gt]")), `messages: ${written.log.length}`)
        }
    },
    {
        name: "a handler that throws has its error written to the console",
        run: async (t) => {
            const written = consoleCapture(t)
            const filter = t.spoon.create(testRules(t))
            t.cleanup(() => t.spoon.destroy(filter))
            filter.on("windowCreated", () => { throw new Error("handler error on purpose") })
            const recorder = recorders.create(t, filter)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            t.assert.ok(written.error.some((e) => e.includes("handler error on purpose")), `errors: ${written.error.join(" | ") || "none"}`)
        }
    }
]
