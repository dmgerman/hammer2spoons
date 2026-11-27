// Runs a Spoon's tests inside the running Hammerspoon 2. tests/run sends one line through hs2
// that calls run(); see tests-common/readme.org at the top of the repository.
//
// This file is shared by every Spoon's tests. The copy in a Spoon's tests/ directory is made by
// tests-common/sync from tests-common/, and is never edited there: edit tests-common/harness.js
// and run tests-common/sync. Anything particular to one Spoon goes in that Spoon's
// tests/spoon.js.
//
// hs2 does not wait for a promise, so run() returns at once and the tests continue in
// Hammerspoon 2. When they have finished, run() writes a report to options.reportFile, and
// tests/run waits for that file.
//
// The tests call a fresh copy of the Spoon, not the copy the user's configuration loaded.
// require() caches a module under the path it was given, and the configuration loads the Spoon
// through its link in Spoons/, so loading init.js from this directory's parent gives a
// separate copy with its own state and its own config.

const SPOON_DIR = __dirname.replace(/\/tests$/, "")
const SPOON_FILE = `${SPOON_DIR}/init.js`
// The Spoon's name, from its spoon.json, for messages and for the test windows' titles. The file
// is removed from require.cache after reading, so that a run leaves nothing cached.
const SPOON_NAME = (() => {
    const path = `${SPOON_DIR}/spoon.json`
    try {
        return require(path).name
    } finally {
        delete require.cache[path]
    }
})()

// Seconds a test may take before it is reported as failed.
const TEST_TIMEOUT = 10

// Raised by skip(), so that a test which cannot run here is reported as skipped, not failed.
class Skip extends Error {}

const assert = {
    ok(value, message) {
        if (!value) throw new Error(message || `expected a true value, got ${JSON.stringify(value)}`)
    },
    equal(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(`${message ? message + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
        }
    },
    fail(message) {
        throw new Error(message)
    }
}

function skip(reason) {
    throw new Skip(reason)
}

// Resolves after the given number of seconds. A test waits with this for a window to finish
// moving or for an event to arrive.
function wait(seconds) {
    return new Promise((resolve) => hs.timer.doAfter(seconds, resolve))
}

// require() with the cache entry removed before and after, so that every run reads the file
// again and no copy outlives the run.
function requireFresh(path) {
    delete require.cache[path]
    try {
        return require(path)
    } finally {
        delete require.cache[path]
    }
}

// Asks the user on screen to start the tests, so that they can stop using the mouse and the
// keyboard first. Resolves to true when the user chose to start.
async function startConfirm(count) {
    const interactive = hs.spoons["hs_interactive-gt"]
    if (!interactive) throw new Error("hs_interactive-gt is not loaded")
    const answer = await interactive.readerRun(interactive.readers.choice.prompted, {
        placeholder: `Run ${count} ${SPOON_NAME} test files? Do not use the mouse or keyboard until they finish`,
        choices: [
            { text: "Start the tests", value: "start" },
            { text: "Cancel", value: "cancel" }
        ]
    })
    return answer === "start"
}

// Runs one test and returns its result. A test that does not finish within its timeout fails;
// its promise is abandoned, and the timer that ended it is stopped. The test's windows are
// closed whatever happened.
async function testRun(file, test, shared, fixtures) {
    const started = Date.now()
    const seconds = test.timeout || TEST_TIMEOUT
    const fixture = fixtures.create(shared.titlePrefix, skip, shared.dir)
    const context = Object.assign({}, shared, {
        assert: Object.assign({ frameEqual: fixture.frameEqual }, assert),
        windowsOpen: fixture.windowsOpen,
        windowOpenBorderless: fixture.windowOpenBorderless,
        windowClose: fixture.windowClose,
        windowTitleSet: fixture.windowTitleSet,
        cleanup: fixture.cleanup,
        frameSet: fixture.frameSet,
        screenFrame: fixture.screenFrame,
        screensNeed: fixture.screensNeed,
        alertsCapture: fixture.alertsCapture,
        canvasesCapture: fixture.canvasesCapture,
        promptCancel: fixture.promptCancel
    })
    let timer = null
    const timeout = new Promise((resolve, reject) => {
        timer = hs.timer.doAfter(seconds, () => reject(new Error(`did not finish within ${seconds} s`)))
    })
    const result = { file, name: test.name }
    try {
        await Promise.race([Promise.resolve().then(() => test.run(context)), timeout])
        result.status = "pass"
    } catch (error) {
        result.status = error instanceof Skip ? "skip" : "fail"
        result.message = String(error && error.message || error)
    } finally {
        if (timer) timer.stop()
        await fixture.close()
    }
    // A test that fails because of a known defect elsewhere names it in knownIssue. Its failure
    // is reported as "known" and does not fail the run. If it passes, the defect may have been
    // fixed, so it is reported as "fixed", which fails the run until knownIssue is removed.
    if (test.knownIssue && result.status === "fail") {
        result.status = "known"
        result.message = `${test.knownIssue}: ${result.message}`
    } else if (test.knownIssue && result.status === "pass") {
        result.status = "fixed"
        result.message = `${test.knownIssue} may be fixed; remove knownIssue from this test`
    }
    result.seconds = (Date.now() - started) / 1000
    return result
}

function reportWrite(path, lines) {
    // Written under another name and then moved, so that tests/run never reads half a report.
    const partial = `${path}.partial`
    hs.fs.write(partial, lines.join("\n") + "\n", false)
    hs.fs.move(partial, path)
}

let running = false

// options.files lists the test files as absolute paths. options.reportFile is where the report
// is written: one line per test, "pass", "fail" or "skip", its file, its name and any message,
// separated by tabs, followed by a last line "result" with the totals.
function run(options) {
    if (running) throw new Error(`${SPOON_NAME}'s tests are already running`)
    running = true
    runAll(options)
        .catch((error) => reportWrite(options.reportFile, [`result\terror\t${error && error.message || error}`]))
        .finally(() => {
            running = false
            // tests/run loads this file again for every run, so nothing from the tests/ directory
            // needs to stay cached: neither this file nor a helper that a test file loaded with
            // require("./...").
            for (const path of Object.keys(require.cache)) {
                if (path.startsWith(`${__dirname}/`)) delete require.cache[path]
            }
        })
    return `started; the report will be written to ${options.reportFile}`
}

async function runAll(options) {
    // options.confirm is false when the user started the run with make, which needs no
    // confirmation on screen.
    if (options.confirm !== false && !(await startConfirm(options.files.length))) {
        reportWrite(options.reportFile, ["result\tcancelled"])
        return
    }

    const runId = Date.now()
    const made = `${hs.fs.tempDirectory()}/${SPOON_NAME}-tests-${runId}`
    hs.fs.mkdir(made)
    // Resolved, so that a test comparing a path the Spoon built from this directory sees the
    // same spelling: the Spoon resolves config.screenshotDir, which turns /var into
    // /private/var.
    const dir = hs.fs.pathToAbsolute(made) || made
    const fixtures = requireFresh(`${__dirname}/fixture.js`)
    const spoon = requireFresh(SPOON_FILE)
    // A Spoon whose copy must not touch the user's files points them into the run's directory
    // here. tests/spoon.js exports setup(spoon, dir), and may export teardown(spoon, dir), which
    // runs after the copy is stopped, to undo what setup() did outside the copy. A Spoon that
    // needs neither has no such file.
    const setupFile = `${__dirname}/spoon.js`
    const setup = hs.fs.exists(setupFile) ? requireFresh(setupFile) : null
    if (setup) setup.setup(spoon, dir)
    // Every test window's title starts with this, so that no other window is mistaken for one.
    const titlePrefix = `${SPOON_NAME} test ${runId} `

    const front = frontWindowsRecord()
    const results = []
    try {
        // As Hammerspoon 2 does when it loads and starts a Spoon: init() when the Spoon has one,
        // then start() when it has one. A Spoon may have either, both or neither.
        if (typeof spoon.init === "function") spoon.init()
        if (typeof spoon.start === "function") spoon.start()
        for (const file of options.files) {
            let loaded
            try {
                loaded = requireFresh(file)
            } catch (error) {
                results.push({ file, name: "(loading the file)", status: "fail", message: String(error.message || error) })
                continue
            }
            // A file exports a list of tests, or {screens, tests} when every test in it needs
            // that many screens. Such a file is skipped as a whole when fewer are connected.
            const tests = Array.isArray(loaded) ? loaded : loaded.tests
            const connected = hs.screen.all().length
            if (!Array.isArray(loaded) && loaded.screens > connected) {
                for (const test of tests) {
                    results.push({ file, name: test.name, status: "skip",
                        message: `needs ${loaded.screens} screens, and ${connected} ${connected === 1 ? "is" : "are"} connected` })
                }
                continue
            }
            for (const test of tests) {
                results.push(await testRun(file, test,
                    { spoon, spoonName: SPOON_NAME, dir, runId, titlePrefix, skip, wait }, fixtures))
            }
        }
    } finally {
        if (typeof spoon.stop === "function") spoon.stop()
        if (setup && typeof setup.teardown === "function") {
            try {
                await setup.teardown(spoon, dir)
            } catch (e) {
                console.error(`[tests] tests/spoon.js teardown() failed: ${e && e.message ? e.message : e}`)
            }
        }
        hs.fs.deletePath(dir)
        await frontWindowsRestore(front)
    }
    const restored = frontWindowsRecord()

    const count = (status) => results.filter((r) => r.status === status).length
    const lines = results.map((r) => [r.status, r.file.replace(/^.*\//, ""), r.name, r.message || ""].join("\t"))
    const failed = count("fail") + count("fixed")
    lines.push(["result", failed ? "fail" : "pass", count("pass"), failed, count("skip"), count("known")].join("\t"))
    // When the run was started on screen, the user asked to acknowledge its end, so that they
    // know when the mouse and the keyboard can be used again, and to say whether they used
    // either during the run, which can make tests fail. The report is written only after that,
    // whichever choice closes the chooser. A run started with make shows no chooser at either
    // end: the user is at the terminal, which prints the results.
    if (options.confirm !== false) {
        const answer = await finishConfirm(`${count("pass")} passed, ${failed} failed, ${count("skip")} skipped, ${count("known")} known failures`)
        lines.push(["interrupted", answer === "no" ? "no" : answer === "yes" ? "yes" : "unknown"].join("\t"))
        // The chooser took the focus, and closing it may not give it back to the window that
        // had it.
        if (front.focused) await frontWindowFocus(front.focused)
    }
    lines.push(["front", frontWindowsDescribe(front), frontWindowsDescribe(restored)].join("\t"))
    reportWrite(options.reportFile, lines)
}

// Shows a chooser saying that the tests have finished, with their totals, and asking whether
// the run was uninterrupted. Resolves to "no" when it was, "yes" when the user used the mouse
// or the keyboard, and null when the chooser was dismissed.
async function finishConfirm(totals) {
    const interactive = hs.spoons["hs_interactive-gt"]
    return interactive.readerRun(interactive.readers.choice.prompted, {
        placeholder: `The ${SPOON_NAME} tests have finished. Did they run without interruption?`,
        choices: [
            { text: "Yes, I did not use the mouse or the keyboard", subText: totals, value: "no" },
            { text: "No, I used the mouse or the keyboard during the run", subText: totals, value: "yes" }
        ]
    })
}

// The window in front on each screen, and the focused window, before the tests start. Only the
// front window of each screen is recorded: macOS can bring a window forward but cannot send one
// back, so the order of the windows behind it cannot be restored.
//
// Only standard, visible windows count. hs.window.orderedWindows() also lists windows such as a
// menu bar agent's and the Finder's desktop, which were measured in front of the user's windows
// on 2026-11-23.
//
// The order comes from the space each screen shows: HSSpace.windowIDs() lists its windows front
// to back. hs.window.orderedWindows() is not used for it, because it lists every window of the
// focused application first, and then the windows of each other application. On 2026-11-23 it
// recorded a Google Chrome window as the laptop's front window, while a Skim window covered it,
// and the restore then raised the Chrome window over the Skim window. orderedWindows() is used
// only for a screen whose current space cannot be read.
function frontWindowsRecord() {
    const usable = (w) => {
        try {
            return w.isStandard && w.isVisible
        } catch (e) {
            return false
        }
    }
    const ordered = hs.window.orderedWindows().filter(usable)
    const byId = new Map(ordered.map((w) => [w.id, w]))
    const perScreen = []
    for (const screen of hs.screen.all()) {
        const onScreen = (w) => w && w.screen && w.screen.id === screen.id
        let window = null
        try {
            const space = (screen.spaces || []).find((s) => s.isCurrent)
            if (space) window = space.windowIDs().map((id) => byId.get(id)).find(onScreen) || null
        } catch (e) {
            window = null
        }
        if (!window) window = ordered.find(onScreen)
        if (window) perScreen.push(window)
    }
    return { perScreen, spaces: spacesRecord(), focused: hs.window.focusedWindow() }
}

// The id of the Space showing on each screen.
//
// A test window opened on a screen makes macOS show a desktop Space there. On 2026-11-25 the
// iPad mini, which showed a fullscreen kiosk browser, was left showing its desktop after a run.
// The kiosk browser turns its Accessibility API off, so its window could not be raised either:
// only going back to its Space brings it back.
function spacesRecord() {
    const spaces = []
    for (const screen of hs.screen.all()) {
        try {
            const space = screen.currentSpace
            if (space) spaces.push(space.id)
        } catch (e) {
            // A screen whose Space cannot be read is left as it is.
        }
    }
    return spaces
}

// Shows again each recorded Space that still exists and is no longer showing.
async function spacesRestore(spaces) {
    for (const id of spaces || []) {
        try {
            const space = hs.screen.spaceForID(id)
            if (space && space.exists && !space.isCurrent) await space.goto()
        } catch (e) {
            // A Space that cannot be shown again is left as it is.
        }
    }
}

// The recorded windows, by application name and window id, for the report. Titles are left out,
// because they can hold the user's private information.
function frontWindowsDescribe(front) {
    const name = (w) => `${w.application ? w.application.name : "?"} #${w.id}`
    return `in front: ${front.perScreen.map(name).join(", ")}; spaces: ${(front.spaces || []).join(", ")}; ` +
        `focused: ${front.focused ? name(front.focused) : "none"}`
}

// Whether a recorded window still exists.
const windowExists = (window) => hs.window.allWindows().some((w) => w.id === window.id)

// Gives the focus back to a recorded window, if it still exists, and resolves once it has it.
//
// focus() makes the window main and brings its application to the front, and Hammerspoon 2
// makes it main again 0.3 s later. Some applications still give main status back to the window
// they had before: on 2026-11-23, Google Chrome kept the focus on its other window. So the focus
// is checked after each attempt, and asked for again, a few times.
async function frontWindowFocus(window) {
    if (!windowExists(window)) return false
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            window.focus()
        } catch (e) {
            return false
        }
        await wait(0.5)
        const focused = hs.window.focusedWindow()
        if (focused && focused.id === window.id) return true
    }
    return false
}

// Shows again the Space that was showing on each screen, brings back the window that was in
// front on each screen, then gives the focus back to the window that had it.
//
// The front windows are raised, not focused. focus() activates the window's application, and
// activating every application in turn brought their windows forward over the user's, on
// 2026-11-23. raise() brings only that window forward, without activating its application.
async function frontWindowsRestore(front) {
    await spacesRestore(front.spaces)
    const focusedId = front.focused ? front.focused.id : null
    for (const window of front.perScreen) {
        if (window.id === focusedId || !windowExists(window)) continue
        try {
            window.raise()
        } catch (e) {
            // A window that cannot be raised stays where it is.
        }
    }
    if (front.focused) await frontWindowFocus(front.focused)
}

module.exports = { run }
