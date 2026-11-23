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
    // here. tests/spoon.js exports setup(spoon, dir); a Spoon that needs nothing has no such file.
    const setupFile = `${__dirname}/spoon.js`
    if (hs.fs.exists(setupFile)) requireFresh(setupFile).setup(spoon, dir)
    // Every test window's title starts with this, so that no other window is mistaken for one.
    const titlePrefix = `${SPOON_NAME} test ${runId} `

    const front = frontWindowsRecord()
    const results = []
    try {
        spoon.start()
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
        spoon.stop()
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
        if (front.focused) frontWindowFocus(front.focused)
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
// hs.window.orderedWindows() lists every window of the focused application first, and then the
// windows of each other application, not the order the windows are stacked on screen. So a
// window of the focused application can be recorded for a screen where another application's
// window covers it. See "Running the tests" in readme.org.
function frontWindowsRecord() {
    const ordered = hs.window.orderedWindows().filter((w) => {
        try {
            return w.isStandard && w.isVisible
        } catch (e) {
            return false
        }
    })
    const perScreen = []
    for (const screen of hs.screen.all()) {
        const window = ordered.find((w) => w.screen && w.screen.id === screen.id)
        if (window) perScreen.push(window)
    }
    return { perScreen, focused: hs.window.focusedWindow() }
}

// The recorded windows, by application name and window id, for the report. Titles are left out,
// because they can hold the user's private information.
function frontWindowsDescribe(front) {
    const name = (w) => `${w.application ? w.application.name : "?"} #${w.id}`
    return `in front: ${front.perScreen.map(name).join(", ")}; focused: ${front.focused ? name(front.focused) : "none"}`
}

// Focuses a recorded window, if it still exists. Returns whether it did.
function frontWindowFocus(window) {
    const id = window.id
    if (!hs.window.allWindows().some((w) => w.id === id)) return false
    try {
        window.focus()
        return true
    } catch (e) {
        return false
    }
}

// Brings back the window that was in front on each screen, then the focused window, so that it
// ends up with the focus.
async function frontWindowsRestore(front) {
    const focusedId = front.focused ? front.focused.id : null
    for (const window of front.perScreen) {
        if (window.id === focusedId) continue
        if (frontWindowFocus(window)) await wait(0.3)
    }
    if (front.focused && frontWindowFocus(front.focused)) await wait(0.3)
}

module.exports = { run }
