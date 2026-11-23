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
// every call on unchanged. A call is counted only once it has returned: one that throws, such as
// hs.ax.on() for an application that has turned the Accessibility API off, registers nothing.
function registrationsCount(t) {
    const counts = { axOn: 0, axOff: 0, appOn: 0, appOff: 0 }
    const originals = { axOn: hs.ax.on, axOff: hs.ax.off, appOn: hs.application.on, appOff: hs.application.off }
    const size = (n) => (Array.isArray(n) ? n.length : 1)
    // Taken before the replacements, so that each function is put back as it was: a function
    // Hammerspoon 2 provides is not the object's own property, and setting it back would leave a
    // copy on the object.
    const own = {
        axOn: Object.prototype.hasOwnProperty.call(hs.ax, "on"), axOff: Object.prototype.hasOwnProperty.call(hs.ax, "off"),
        appOn: Object.prototype.hasOwnProperty.call(hs.application, "on"), appOff: Object.prototype.hasOwnProperty.call(hs.application, "off")
    }
    hs.ax.on = function (element, notifications) {
        const result = originals.axOn.apply(hs.ax, arguments)
        counts.axOn += size(notifications)
        return result
    }
    hs.ax.off = function (element, notifications) {
        const result = originals.axOff.apply(hs.ax, arguments)
        counts.axOff += size(notifications)
        return result
    }
    hs.application.on = function () {
        const result = originals.appOn.apply(hs.application, arguments)
        counts.appOn += 1
        return result
    }
    hs.application.off = function () {
        const result = originals.appOff.apply(hs.application, arguments)
        counts.appOff += 1
        return result
    }
    t.cleanup(() => {
        if (own.axOn) hs.ax.on = originals.axOn; else delete hs.ax.on
        if (own.axOff) hs.ax.off = originals.axOff; else delete hs.ax.off
        if (own.appOn) hs.application.on = originals.appOn; else delete hs.application.on
        if (own.appOff) hs.application.off = originals.appOff; else delete hs.application.off
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
        name: "an application that has turned the Accessibility API off is reported once, as a warning, not tried again, and listed by applicationsAccessibilityDisabled()",
        timeout: 15,
        run: async (t) => {
            t.assert.equal(t.spoon.status().tracking, false, "observing before the test")
            // A made-up application, which only the copy sees: it is added to
            // hs.application.runningApplications(), which the copy reads when it starts to observe.
            // hs.ax.on() throws for it the error Hammerspoon 2 throws for an application such as
            // Firefox in kiosk mode, and passes every other call on unchanged.
            const pid = -5101
            const element = { pid, zqMadeUp: true }
            const application = { name: "Zq Disabled", bundleID: "org.hammer2spoons.test.disabled", kind: "standard", pid, axElement: () => element }
            const attempts = []
            const originals = { running: hs.application.runningApplications, axOn: hs.ax.on, warn: console.warn }
            const own = {
                running: Object.prototype.hasOwnProperty.call(hs.application, "runningApplications"),
                axOn: Object.prototype.hasOwnProperty.call(hs.ax, "on")
            }
            hs.application.runningApplications = function () {
                return originals.running.apply(hs.application, arguments).concat([application])
            }
            hs.ax.on = function (target) {
                if (!target || !target.zqMadeUp) return originals.axOn.apply(hs.ax, arguments)
                attempts.push(Date.now())
                const error = new Error("hs.ax.on(): failed to start watcher for 'AXWindowCreated': the Accessibility API is disabled, for Hammerspoon or for this application (kAXErrorAPIDisabled)")
                error.code = "kAXErrorAPIDisabled"
                throw error
            }
            const warnings = []
            console.warn = (...args) => {
                const text = args.join(" ")
                if (text.includes("Zq Disabled")) warnings.push(text)
                else originals.warn.apply(console, args)
            }
            t.cleanup(() => {
                if (own.running) hs.application.runningApplications = originals.running; else delete hs.application.runningApplications
                if (own.axOn) hs.ax.on = originals.axOn; else delete hs.ax.on
                console.warn = originals.warn
            })

            const filter = t.spoon.create({})
            t.cleanup(() => t.spoon.destroy(filter))
            filter.on("windowCreated", noop)
            // Longer than the first three of config.applicationRetryDelays together.
            await t.wait(4)
            t.assert.equal(attempts.length, 1, "attempts to observe the application")
            t.assert.equal(warnings.length, 1, `warnings: ${warnings.join(" | ") || "none"}`)
            t.assert.ok(warnings[0].includes(`pid ${pid}`) && warnings[0].includes("Accessibility API off"), `the warning: ${warnings[0]}`)
            const listed = t.spoon.applicationsAccessibilityDisabled().filter((a) => a.pid === pid)
            t.assert.equal(listed.length, 1, "applicationsAccessibilityDisabled() lists the application")
            filter.off()
            t.assert.equal(t.spoon.applicationsAccessibilityDisabled().length, 0, "applicationsAccessibilityDisabled() after observing stopped")
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
