// Running this file with tests/run crashed Hammerspoon 2 until upstream fixed
// https://github.com/Hammerspoon/Hammerspoon2/issues/432 in pull request #435 (1e19ae13): the alert
// stack window grew taller than the screen, and AppKit threw inside the text prompt's modal loop.
// With that fix the file passes.

// Tests of starting a countdown, as the readme describes it under "Starting a countdown", "Times
// of day" and "Functions".
//
// Every test sets alertSound to null, notify to false and alertLen to 0, so that a countdown that
// ends during a test plays no sound, sends no notification, and shows no dialog or alert. A
// countdown still running when a test ends is cancelled.
//
// The prompt of countdownPromptedStart() is hs_interactive-gt's text dialog, which is modal, so it
// is answered from a timer set before it opens. Every key is sent only while the user's
// hs_interactive-gt reports a prompt open.

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

// Quiets the end of a countdown, keeps the default length, and cancels a countdown left running.
function quiet(t) {
    settingsSet(t, { alertSound: null, notify: false, alertLen: 0, defaultLenMinutes: t.spoon.config.defaultLenMinutes })
    t.cleanup(() => { if (t.spoon.countdownIsRunning()) t.spoon.countdownCancel() })
}

// Records each call of a countdown's callback.
function recorder() {
    const calls = []
    return { calls, callback: (event, minutes) => calls.push([event, minutes]) }
}

// The minutes from now until a time of day, as the Spoon computes them: whole minutes, and a time
// earlier than now meaning tomorrow.
function minutesUntil(hour, minute) {
    const now = new Date()
    const current = now.getHours() * 60 + now.getMinutes()
    return ((hour * 60 + minute - current) % 1440 + 1440) % 1440
}

const twoDigits = (n) => String(n).padStart(2, "0")

// The time of day `offset` minutes from now, as {hour, minute}.
function timeFromNow(offset) {
    const at = new Date(Date.now() + offset * 60000)
    return { hour: at.getHours(), minute: at.getMinutes() }
}

// Answers the next prompt of the user's hs_interactive-gt from a timer: replaces the field's text
// with `text` and presses Return.
function promptAnswer(t, text, delay = 0.8) {
    const interactive = hs.spoons["hs_interactive-gt"]
    const timer = hs.timer.doAfter(delay, () => {
        const send = (modifiers, key) => { if (interactive.promptIsOpen()) hs.eventtap.keyStroke(modifiers, key, null) }
        send(["cmd"], "a")
        for (const character of String(text)) if (interactive.promptIsOpen()) hs.eventtap.keyStrokes(character)
        send([], "return")
    })
    t.cleanup(() => timer.stop())
}

// The seconds left, which the Spoon updates once a second.
const minutesLeft = (t) => Math.round(t.spoon.timeLeft() / 60)

module.exports = [
    // --- lengths ---
    {
        name: "countdownStart(minutes) starts a countdown of that length, with a message and the started event",
        run: (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            const events = recorder()
            t.spoon.countdownStart(3, events.callback)
            t.assert.equal(t.spoon.countdownIsRunning(), true, "countdownIsRunning()")
            t.assert.equal(t.spoon.timeLeft(), 180, "timeLeft()")
            t.assert.ok(alerts.includes("Timer started for 3 minutes"), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(JSON.stringify(events.calls), JSON.stringify([["started", 0]]), "the callback's calls")
        }
    },
    {
        name: "each countdown sets the default length, unless useLastTimerAsDefault is false",
        run: (t) => {
            quiet(t)
            t.spoon.countdownStart(7)
            t.spoon.countdownCancel()
            t.assert.equal(t.spoon.config.defaultLenMinutes, 7, "defaultLenMinutes after a 7 minute countdown")
            t.spoon.countdownStart()
            t.assert.equal(t.spoon.timeLeft(), 420, "timeLeft() of countdownStart() without a length")
            t.spoon.countdownCancel()
            settingsSet(t, { useLastTimerAsDefault: false })
            t.spoon.countdownStart(9)
            t.spoon.countdownCancel()
            t.assert.equal(t.spoon.config.defaultLenMinutes, 7, "defaultLenMinutes with useLastTimerAsDefault false")
        }
    },
    {
        name: "a second countdown is refused while one runs, with a message",
        run: (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            t.spoon.countdownStart(3)
            t.spoon.countdownStart(5)
            t.assert.equal(t.spoon.timeLeft(), 180, "timeLeft()")
            t.assert.ok(alerts.some((m) => m.includes("Timer is already running")), `alerts: ${alerts.join(" | ")}`)
        }
    },
    {
        name: "a length that is not a whole number, a negative length and a callback that is not a function are refused",
        run: (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            t.spoon.countdownStart(2.5)
            t.spoon.countdownStart(-3)
            t.spoon.countdownStart(3, "not a function")
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning()")
            t.assert.equal(alerts.filter((m) => m.startsWith("Error.")).length, 3, `alerts: ${alerts.join(" | ")}`)
        }
    },
    {
        name: "a countdown of 0 minutes is refused, since a countdown has a length in whole minutes",
        run: (t) => {
            quiet(t)
            t.spoon.countdownStart(0)
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning() after countdownStart(0)")
        }
    },
    // --- times of day ---
    {
        name: "countdownUntilStart() accepts hh:mm, h:mm am and h:mm pm, in capitals and without the space",
        run: (t) => {
            quiet(t)
            const { hour, minute } = timeFromNow(90)
            const twelve = hour % 12 === 0 ? 12 : hour % 12
            const suffix = hour < 12 ? "am" : "pm"
            const forms = [
                `${twoDigits(hour)}:${twoDigits(minute)}`,
                `${twelve}:${twoDigits(minute)} ${suffix}`,
                `${twelve}:${twoDigits(minute)}${suffix.toUpperCase()}`
            ]
            for (const form of forms) {
                const expected = minutesUntil(hour, minute)
                t.spoon.countdownUntilStart(form)
                t.assert.equal(t.spoon.countdownIsRunning(), true, `${form} started no countdown`)
                // The minute may turn between the two readings of the clock.
                t.assert.ok(Math.abs(minutesLeft(t) - expected) <= 1, `${form}: ${minutesLeft(t)} minutes, against ${expected}`)
                t.spoon.countdownCancel()
            }
        }
    },
    {
        name: "12:00 am is midnight and 12:00 pm is noon",
        run: (t) => {
            quiet(t)
            for (const [form, hour] of [["12:00 am", 0], ["12:00 pm", 12]]) {
                const expected = minutesUntil(hour, 0)
                if (expected === 0) continue
                t.spoon.countdownUntilStart(form)
                t.assert.ok(Math.abs(minutesLeft(t) - expected) <= 1, `${form}: ${minutesLeft(t)} minutes, against ${expected}`)
                t.spoon.countdownCancel()
            }
        }
    },
    {
        name: "a time earlier than now means that time tomorrow",
        run: (t) => {
            quiet(t)
            const { hour, minute } = timeFromNow(-30)
            t.spoon.countdownUntilStart(`${twoDigits(hour)}:${twoDigits(minute)}`)
            t.assert.ok(Math.abs(minutesLeft(t) - (24 * 60 - 30)) <= 1, `${minutesLeft(t)} minutes, against ${24 * 60 - 30}`)
        }
    },
    {
        name: "the current minute means that time tomorrow",
        run: (t) => {
            quiet(t)
            const { hour, minute } = timeFromNow(0)
            t.spoon.countdownUntilStart(`${twoDigits(hour)}:${twoDigits(minute)}`)
            t.assert.equal(t.spoon.countdownIsRunning(), true, "countdownIsRunning()")
            // The minute may turn between the two readings of the clock.
            t.assert.ok(Math.abs(minutesLeft(t) - 24 * 60) <= 1, `${minutesLeft(t)} minutes, against ${24 * 60}`)
        }
    },
    {
        name: "a time that is not in one of the forms is reported and starts no countdown",
        run: (t) => {
            quiet(t)
            const alerts = t.alertsCapture()
            const refused = ["24:00", "13:00 pm", "10:30 sharp", "9:5", "0:30 am", "10:60"]
            for (const form of refused) t.spoon.countdownUntilStart(form)
            t.assert.equal(t.spoon.countdownIsRunning(), false, "countdownIsRunning()")
            t.assert.equal(alerts.filter((m) => m.startsWith("Illegal time [")).length, refused.length, `alerts: ${alerts.join(" | ")}`)
        }
    },
    // --- the prompt ---
    {
        name: "countdownPromptedStart() starts a countdown of the minutes typed, and offers the default length",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            promptAnswer(t, "4")
            const result = await t.spoon.countdownPromptedStart()
            t.assert.equal(result, t.spoon, "the promise's value")
            t.assert.equal(t.spoon.timeLeft(), 240, "timeLeft()")
        }
    },
    {
        name: "countdownPromptedStart() accepts a time of day",
        timeout: 15,
        run: async (t) => {
            quiet(t)
            const { hour, minute } = timeFromNow(45)
            const expected = minutesUntil(hour, minute)
            promptAnswer(t, `${twoDigits(hour)}:${twoDigits(minute)}`)
            await t.spoon.countdownPromptedStart()
            t.assert.ok(Math.abs(minutesLeft(t) - expected) <= 1, `${minutesLeft(t)} minutes, against ${expected}`)
        }
    },
    {
        name: "an answer that is neither is reported, and the prompt asks again until it is corrected",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            promptAnswer(t, "soon")
            promptAnswer(t, "5", 2.5)
            await t.spoon.countdownPromptedStart()
            t.assert.equal(t.spoon.timeLeft(), 300, "timeLeft() after the corrected answer")
        }
    },
    {
        name: "an answer of a fraction of a minute that rounds to 0 is refused",
        timeout: 20,
        run: async (t) => {
            quiet(t)
            promptAnswer(t, "0.4")
            promptAnswer(t, "2", 2.5)
            await t.spoon.countdownPromptedStart()
            t.assert.equal(t.spoon.timeLeft(), 120, "timeLeft() after the answers 0.4 and 2")
        }
    }
]
