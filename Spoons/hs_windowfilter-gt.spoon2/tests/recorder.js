// Records the events a filter of the copy under test emits, for hs_windowfilter-gt's tests.
//
//   const recorder = require("./recorder.js").create(t, filter)
//   await recorder.waitFor("windowMinimized", window)
//
// The recorder subscribes one handler to every event of the filter, and removes it through
// t.cleanup() when the test ends, also when it fails.

// Seconds to wait for an event before failing. The slowest event measured on 2026-11-23 was
// windowMinimized, 0.36 s after minimize(), which includes the animation; most arrive within
// 0.12 s. See ai/tests-hs_windowfilter-gt.org.
const EVENT_TIMEOUT = 2

function wait(seconds) {
    return new Promise((resolve) => hs.timer.doAfter(seconds, resolve))
}

function create(t, filter) {
    // Every event received, in order: {event, id, state, at}. `at` is milliseconds since the
    // recorder was created or last cleared.
    const events = []
    let since = Date.now()
    const handler = (event, window, state) => {
        events.push({ event, id: state ? state.id : (window ? window.id : null), state, at: Date.now() - since })
    }
    filter.on(t.spoon.events, handler)
    t.cleanup(() => filter.off(t.spoon.events, handler))

    // The events received for a window, or for every window.
    function of(window, event) {
        return events.filter((e) => (!window || e.id === window.id) && (!event || e.event === event))
    }

    // Resolves to the first recorded event of that name for that window, waiting for it when it
    // has not arrived yet. Fails the test with the events that did arrive when it does not come.
    async function waitFor(event, window, timeout = EVENT_TIMEOUT) {
        const started = Date.now()
        for (;;) {
            const found = of(window, event)[0]
            if (found) return found
            if (Date.now() - started > timeout * 1000) {
                const received = of(window).map((e) => e.event).join(", ") || "none"
                t.assert.fail(`no ${event} for "${window ? window.title : "any window"}" within ${timeout} s; received: ${received}`)
            }
            await wait(0.05)
        }
    }

    // Waits as long as an event could take, and checks that none of that name came for the window.
    async function waitForNone(event, window, timeout = EVENT_TIMEOUT) {
        await wait(timeout)
        const found = of(window, event)
        if (found.length) t.assert.fail(`${event} came for "${window.title}" ${found.length} time(s), expected none`)
    }

    // Forgets the events received so far.
    function clear() {
        events.length = 0
        since = Date.now()
    }

    return { events, of, waitFor, waitForNone, clear }
}

module.exports = { create, EVENT_TIMEOUT }
