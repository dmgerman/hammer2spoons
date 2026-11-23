// Tests of the functions of the Spoon itself: create(), destroy(), status(), start() and stop(),
// and of when the copy observes windows. The test of stop() is last, because it stops the copy
// under test and starts it again.
//
// Measured on 2026-11-23, with 19 applications and 27 windows open: starting to observe took
// 0.3 s and registered 219 accessibility notifications; stop() took 0.02 s and removed all of
// them. See ai/tests-hs_windowfilter-gt.org.

const recorders = require("./recorder.js")

function noop() {}

function testRules(t) {
    return { allowTitles: (title) => (title || "").startsWith(t.titlePrefix) }
}

// Counts the accessibility notifications and application listeners registered and removed
// until the test ends. hs.ax.on and off, and hs.application.on and off, are wrapped, and pass
// every call on unchanged.
function registrationsCount(t) {
    const counts = { axOn: 0, axOff: 0, appOn: 0, appOff: 0 }
    const originals = { axOn: hs.ax.on, axOff: hs.ax.off, appOn: hs.application.on, appOff: hs.application.off }
    const size = (n) => (Array.isArray(n) ? n.length : 1)
    hs.ax.on = function (element, notifications) {
        counts.axOn += size(notifications)
        return originals.axOn.apply(hs.ax, arguments)
    }
    hs.ax.off = function (element, notifications) {
        counts.axOff += size(notifications)
        return originals.axOff.apply(hs.ax, arguments)
    }
    hs.application.on = function () {
        counts.appOn += 1
        return originals.appOn.apply(hs.application, arguments)
    }
    hs.application.off = function () {
        counts.appOff += 1
        return originals.appOff.apply(hs.application, arguments)
    }
    t.cleanup(() => {
        hs.ax.on = originals.axOn
        hs.ax.off = originals.axOff
        hs.application.on = originals.appOn
        hs.application.off = originals.appOff
    })
    return counts
}

module.exports = [
    {
        name: "create() adds a filter, and destroy() removes it and its handlers",
        run: (t) => {
            const before = t.spoon.status().filters
            const filter = t.spoon.create({})
            t.assert.equal(t.spoon.status().filters, before + 1, "filters after create()")
            filter.on("windowCreated", noop)
            t.assert.equal(t.spoon.destroy(filter), true, "destroy() returned")
            t.assert.equal(filter.isWatched(), false, "the filter still has a handler")
            t.assert.equal(t.spoon.status().filters, before, "filters after destroy()")
            t.assert.equal(t.spoon.destroy(filter), false, "a second destroy() returned")
        }
    },
    {
        name: "the copy observes windows only while a filter has a handler",
        run: (t) => {
            t.assert.equal(t.spoon.status().tracking, false, "observing before any handler")
            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            filter.on("windowCreated", noop)
            const status = t.spoon.status()
            t.assert.equal(status.tracking, true, "observing after on()")
            t.assert.equal(status.watched, 1, "watched filters")
            t.assert.ok(status.applications > 0, "no application is observed")
            t.assert.ok(status.windows > 0, "no window is observed")
            filter.off()
            const after = t.spoon.status()
            t.assert.equal(after.tracking, false, "observing after off()")
            t.assert.equal(after.applications, 0, "applications after off()")
            t.assert.equal(after.windows, 0, "windows after off()")
        }
    },
    {
        name: "status() reports the focused window's id and the windows observed",
        run: async (t) => {
            const filter = t.spoon.create(testRules(t))
            t.cleanup(() => t.spoon.destroy(filter))
            const recorder = recorders.create(t, filter)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
            window.focus()
            await recorder.waitFor("windowFocused", window)
            const status = t.spoon.status()
            t.assert.equal(status.focusedId, window.id, "focusedId")
            t.assert.ok(status.windows >= 1, "windows")
        }
    },
    {
        name: "events lists the nineteen event names",
        run: (t) => {
            const events = t.spoon.events
            t.assert.equal(events.length, 19, "the number of names")
            for (const name of ["windowCreated", "windowDestroyed", "windowMoved", "windowResized",
                "windowTitleChanged", "windowFocused", "windowUnfocused", "windowMinimized",
                "windowUnminimized", "windowVisible", "windowNotVisible", "windowOnScreen",
                "windowNotOnScreen", "windowFullscreened", "windowUnfullscreened", "windowHidden",
                "windowUnhidden", "windowAllowed", "windowRejected"]) {
                t.assert.ok(events.includes(name), `${name} is missing`)
            }
        }
    },
    {
        name: "windows() reads the records while observing, without querying the applications",
        run: (t) => {
            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            filter.on("windowCreated", noop)
            const started = Date.now()
            const windows = filter.windows()
            const ms = Date.now() - started
            t.assert.ok(windows.length > 0, "no window was listed")
            // Querying the applications takes about 100 ms; reading the records about 1 ms.
            t.assert.ok(ms < 30, `windows() took ${ms} ms`)
        }
    },
    {
        name: "starting to observe takes less than 1 s",
        run: (t) => {
            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            const started = Date.now()
            filter.on("windowCreated", noop)
            const ms = Date.now() - started
            t.assert.ok(ms < 1000, `starting to observe took ${ms} ms`)
        }
    },
    {
        name: "stop() removes every accessibility notification and application listener it registered",
        run: (t) => {
            const counts = registrationsCount(t)
            const filter = t.spoon.create({})
            filter.on("windowCreated", noop)
            t.assert.ok(counts.axOn > 0, "nothing was registered")
            t.spoon.stop()
            t.spoon.start()
            t.assert.equal(counts.axOff, counts.axOn, "accessibility notifications removed")
            t.assert.equal(counts.appOff, counts.appOn, "application listeners removed")
            const status = t.spoon.status()
            t.assert.equal(status.tracking, false, "observing after stop()")
            t.assert.equal(status.applications + status.windows, 0, "applications and windows after stop()")
        }
    },
    {
        name: "after stop() and start(), default is still a filter that receives events",
        run: async (t) => {
            t.spoon.stop()
            t.spoon.start()
            const recorder = recorders.create(t, t.spoon.default)
            const [window] = await t.windowsOpen()
            await recorder.waitFor("windowCreated", window)
        }
    }
]
