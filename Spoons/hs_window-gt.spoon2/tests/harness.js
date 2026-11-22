// Runs hs_window-gt's tests inside the running Hammerspoon 2. tests/run sends one line through
// hs2 that calls run(); see tests/readme.org.
//
// hs2 does not wait for a promise, so run() returns at once and the tests continue in
// Hammerspoon 2. When they have finished, run() writes a report to options.reportFile, and
// tests/run waits for that file.
//
// The tests call a fresh copy of the Spoon, not the copy the user's configuration loaded.
// require() caches a module under the path it was given, and the configuration loads the Spoon
// through its link in Spoons/, so loading init.js from this directory's parent gives a
// separate copy with its own state and its own config.

const SPOON_FILE = __dirname.replace(/\/tests$/, "") + "/init.js"

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
        placeholder: `Run ${count} hs_window-gt test files? Do not use the mouse or keyboard until they finish`,
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
    const fixture = fixtures.create(shared.runId, skip)
    const context = Object.assign({}, shared, {
        assert: Object.assign({ frameEqual: fixture.frameEqual }, assert),
        windowsOpen: fixture.windowsOpen,
        windowClose: fixture.windowClose,
        frameSet: fixture.frameSet,
        screenFrame: fixture.screenFrame,
        screensNeed: fixture.screensNeed,
        alertsCapture: fixture.alertsCapture,
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
    if (running) throw new Error("hs_window-gt's tests are already running")
    running = true
    runAll(options)
        .catch((error) => reportWrite(options.reportFile, [`result\terror\t${error && error.message || error}`]))
        .finally(() => {
            running = false
            // tests/run loads this file again for every run, so the cached copy is not needed.
            delete require.cache[__filename]
        })
    return `started; the report will be written to ${options.reportFile}`
}

async function runAll(options) {
    if (!(await startConfirm(options.files.length))) {
        reportWrite(options.reportFile, ["result\tcancelled"])
        return
    }

    const runId = Date.now()
    const dir = `${hs.fs.tempDirectory()}/hs_window-gt-tests-${runId}`
    hs.fs.mkdir(dir)
    const fixtures = requireFresh(`${__dirname}/fixture.js`)
    const spoon = requireFresh(SPOON_FILE)
    // The copy writes its attached keys and its screenshots here, never where the user's do.
    spoon.config.attachFile = `${dir}/window-keys.json`
    spoon.config.screenshotDir = dir

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
                        message: `needs ${loaded.screens} screens, and ${connected} is connected` })
                }
                continue
            }
            for (const test of tests) {
                results.push(await testRun(file, test, { spoon, dir, runId, skip, wait }, fixtures))
            }
        }
    } finally {
        spoon.stop()
        hs.fs.deletePath(dir)
    }

    const count = (status) => results.filter((r) => r.status === status).length
    const lines = results.map((r) => [r.status, r.file.replace(/^.*\//, ""), r.name, r.message || ""].join("\t"))
    lines.push(["result", count("fail") ? "fail" : "pass", count("pass"), count("fail"), count("skip")].join("\t"))
    // The user asked to acknowledge the end of a run, so that they know when the mouse and the
    // keyboard can be used again. The report is written only after that, whichever choice
    // closes the chooser.
    await finishConfirm(`${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped`)
    reportWrite(options.reportFile, lines)
}

// Shows a chooser saying that the tests have finished, with their totals, and resolves when
// the user closes it.
async function finishConfirm(totals) {
    const interactive = hs.spoons["hs_interactive-gt"]
    await interactive.readerRun(interactive.readers.choice.prompted, {
        placeholder: "The hs_window-gt tests have finished. The mouse and keyboard can be used again",
        choices: [{ text: "OK", subText: totals, value: "ok" }]
    })
}

module.exports = { run }
