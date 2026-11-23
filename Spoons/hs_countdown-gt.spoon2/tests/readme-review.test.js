// Tests of the statements of the readme that the other files do not cover, found by reading the
// readme as a whole against the tests: a click through the progress bar, the warnings at other
// powers of two, the minutes sent with paused and resumed, a cancelled prompt, the defaults, and
// the names that version 4.0.0 removed.

function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

// Quiets the end of a countdown, keeps the default length, and cancels a countdown left running.
function quiet(t) {
    settingsSet(t, { alertSound: null, notify: false, alertLen: 0, defaultLenMinutes: t.spoon.config.defaultLenMinutes })
    t.cleanup(() => { if (t.spoon.countdownIsRunning()) t.spoon.countdownCancel() })
}

// Resolves once `test()` is true, or fails after `seconds`.
async function until(t, test, seconds, message) {
    const started = Date.now()
    while (!test()) {
        if (Date.now() - started > seconds * 1000) t.assert.fail(message)
        await t.wait(0.1)
    }
}

// The progress that leaves `seconds` of a countdown of `minutes`.
const progressLeaving = (minutes, seconds) => 1 - seconds / (minutes * 60)

module.exports = [
    {
        name: "a click on the progress bar reaches the window beneath it",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            const [beneath, focused] = await t.windowsOpen(2)
            const screen = beneath.screen
            const full = screen.fullFrame
            // The Dock along the bottom edge of a screen is under the bar, and a click on it would
            // open an application, so the test clicks only on a screen without the Dock there.
            if (screen.frame.y + screen.frame.h < full.y + full.h) t.skip("the Dock is along the bottom of the test window's screen")
            const bottom = full.y + full.h
            await t.frameSet(beneath, { x: full.x + 100, y: bottom - 300, w: 600, h: 300 })
            await t.frameSet(focused, { x: full.x + 800, y: full.y + 100, w: 300, h: 200 })
            focused.focus()
            await t.wait(0.4)
            t.spoon.countdownStart(3)
            await t.wait(0.3)

            // Clicks only where the test window is beneath the bar.
            const point = { x: full.x + 400, y: bottom - 2 }
            const b = beneath.frame
            if (!(point.x > b.x && point.x < b.x + b.w && point.y > b.y && point.y < b.y + b.h)) {
                t.assert.fail(`not clicking: the test window, at ${JSON.stringify(b)}, is not beneath the bar`)
            }
            if (hs.window.focusedWindow().id !== focused.id) t.assert.fail("not clicking: the other test window does not have the focus")
            hs.eventtap.leftClick(point.x, point.y)
            await t.wait(0.5)
            t.assert.equal(hs.window.focusedWindow().id, beneath.id, "the window with the focus after the click")
        }
    },
    {
        name: "warnings appear at 16 and 1 minutes left, and none at 3, which is not a power of two",
        timeout: 30,
        run: async (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            t.spoon.countdownStart(32)
            t.spoon.progressSet(progressLeaving(32, 16 * 60 + 3))
            await until(t, () => alerts.includes("Time left 00:16"), 6, `no warning at 16 minutes; alerts: ${alerts.join(" | ")}`)
            t.spoon.progressSet(progressLeaving(32, 3 * 60 + 2))
            await until(t, () => t.spoon.timeLeft() < 3 * 60, 6, "the time left did not pass 3 minutes")
            await t.wait(1.2)
            t.assert.ok(!alerts.includes("Time left 00:03"), `alerts: ${alerts.join(" | ")}`)
            t.spoon.progressSet(progressLeaving(32, 62))
            await until(t, () => alerts.includes("Time left 00:01"), 6, `no warning at 1 minute; alerts: ${alerts.join(" | ")}`)
        }
    },
    {
        name: "paused and resumed send the minutes left",
        run: (t) => {
            quiet(t)
            const calls = []
            t.spoon.countdownStart(4, (event, minutes) => calls.push([event, minutes]))
            t.spoon.progressSet(0.5)
            t.spoon.pauseToggle()
            t.spoon.pauseToggle()
            t.assert.equal(JSON.stringify(calls.slice(2)), JSON.stringify([["paused", 2], ["resumed", 2]]), "the events")
        }
    },
    {
        name: "countdownPromptedStart() resolves to the Spoon, with no countdown, when the prompt is cancelled",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            // The prompt is modal, and no promise of the test resolves while it is open, so it is
            // cancelled from timers set before it opens. In the user's configuration, cancelling a
            // prompt takes two presses of Escape, so a second is sent if the prompt is still open
            // after the first. Each key is sent only while the user's hs_interactive-gt reports a
            // prompt open.
            const interactive = hs.spoons["hs_interactive-gt"]
            const escape = () => { if (interactive.promptIsOpen()) hs.eventtap.keyStroke([], "escape", null) }
            const timers = [hs.timer.doAfter(0.8, escape), hs.timer.doAfter(1.4, escape)]
            t.cleanup(() => { for (const timer of timers) timer.stop() })
            const result = await t.spoon.countdownPromptedStart()
            t.assert.equal(result, t.spoon, "the promise's value")
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning()")
        }
    },
    {
        name: "the settings' defaults are the ones in the readme's table",
        run: (t) => {
            const expected = {
                defaultLenMinutes: 25, useLastTimerAsDefault: true, notify: true, messageDuration: 2,
                barHeight: 5, barTransparency: 0.8, barColorPassed: "#28CD41", barColorToPass: "#FF3B30", barSegments: 240,
                alertLen: 5, alertSound: "Sonar", warningShow: true, warningDuration: 3, menuBarAlwaysShow: true,
                menuBarIconIdle: "⏰", menuBarIconActive: "☣️", menuBarIconPause: "⏸️", menuBarIconPlay: "▶️", menuBarIconStop: "🛑"
            }
            const config = t.spoon.config
            for (const [name, value] of Object.entries(expected)) t.assert.equal(config[name], value, name)
            const others = Object.keys(config).filter((name) => !(name in expected))
            t.assert.equal(others.join(", "), "", "settings the readme does not list")
        }
    },
    {
        name: "the names that version 4.0.0 replaced are no longer exported",
        run: (t) => {
            for (const name of ["startFor", "startUntil", "startAsk", "cancel", "isRunning"]) {
                t.assert.equal(t.spoon[name], undefined, name)
            }
        }
    }
]
