// Tests of the chooser and of the functions that select a window, as the readme describes them
// under "The chooser", "The thumbnail" and "Functions".
//
// The chooser lists the user's windows as well as the test windows. The tests look only at the
// rows of the test windows, found by their titles, and their messages never show the title of
// one of the user's windows.
//
// Choosers are recorded by wrapping hs.chooser.create. Keys are sent one at a time, each only
// while the copy's chooser is visible and the user's hs_interactive-gt reports a prompt open,
// which the copy reports for its chooser. A key sent after the chooser closed would reach the
// application behind it.
//
// The test windows have no bundle identifier, so applicationByBundleSelect() is tested only for
// an application that is not running and for its alerts.

const { choosersCapture, open, interactive, openWait, type, key, focus, focusedId, testRows, titles, onlyTestWindows } = require("./chooser.js")

module.exports = [
    // --- the chooser ---
    {
        name: "windowSelect() lists every window except the focused one, most recently used first, and Escape changes nothing",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            t.assert.equal(choosers.length, 1, "choosers created")
            t.assert.equal(testRows(t, choosers[0]).map((r) => r.text).join(", "), titles(b, a), "the test windows' rows")
            t.assert.equal(choosers[0].placeholder, "Window", "the prompt")
            await key(t, chooser, [], "escape")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
            t.assert.equal(focusedId(), c.id, "the focused window")
        }
    },
    {
        name: "a row shows the window's title, and beneath it the application, the screen, and minimized or hidden",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [a, b] = await t.windowsOpen(2)
            const [hiddenWindow] = await t.windowsOpen(1)
            const [c] = await t.windowsOpen(1)
            for (const w of [a, b, hiddenWindow, c]) await focus(t, w)
            b.minimize()
            hiddenWindow.application.hide()
            await t.wait(1)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            const row = (w) => testRows(t, choosers[0]).find((r) => r.text === w.title)
            const screen = a.screen.name
            t.assert.equal(row(a) && row(a).subText, `osascript  ·  ${screen}`, "an ordinary window")
            t.assert.equal(row(b) && row(b).subText, `osascript  ·  ${screen}  ·  minimized`, "a minimized window")
            t.assert.equal(row(hiddenWindow) && row(hiddenWindow).subText, `osascript  ·  ${screen}  ·  hidden`, "a window of a hidden application")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "typing part of a title narrows the rows, and Return focuses the selected window",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            // a is the second row; typing its title leaves it alone.
            await type(t, chooser, a.title)
            await key(t, chooser, [], "return")
            t.assert.equal(focusedId(), a.id, "the focused window")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
        }
    },
    {
        name: "the application's name, typed, finds its windows",
        run: async (t) => {
            onlyTestWindows(t)
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await type(t, chooser, "osascript")
            await key(t, chooser, [], "return")
            t.assert.equal(focusedId(), a.id, "the focused window")
        }
    },
    {
        name: "choosing a minimized window brings it back and focuses it",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            a.minimize()
            await t.wait(1)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await type(t, chooser, a.title)
            await key(t, chooser, [], "return")
            await t.wait(1)
            t.assert.ok(!a.isMinimized, "the window is still minimized")
            t.assert.equal(focusedId(), a.id, "the focused window")
        }
    },
    // --- the thumbnail ---
    {
        name: "Tab shows a thumbnail to the left of the chooser, no higher than thumbnailHeightRatio, and Tab hides it",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            // Recorded only from here: a change of focus can make the user's other Spoons draw
            // canvases.
            const canvases = t.canvasesCapture()
            await t.wait(0.5)
            t.assert.equal(canvases.length, 0, "thumbnails before Tab")
            await key(t, chooser, [], t.spoon.config.thumbnailToggleKey)
            await t.wait(1)
            t.assert.ok(canvases.length >= 1, "no thumbnail after Tab")
            const thumbnail = canvases[canvases.length - 1]
            const screen = (hs.screen.main() || hs.screen.primary()).frame
            t.assert.ok(thumbnail.frame.x + thumbnail.frame.w <= screen.x + screen.w / 2, "the thumbnail is not left of the middle of the screen")
            t.assert.ok(thumbnail.frame.h <= screen.h * t.spoon.config.thumbnailHeightRatio + 1, `the thumbnail is ${thumbnail.frame.h} points high`)
            await key(t, chooser, [], t.spoon.config.thumbnailToggleKey)
            let showing = false
            try { showing = thumbnail.canvas.isShowing() } catch (e) { showing = false }
            t.assert.ok(!showing, "the thumbnail is still shown after the second Tab")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "with showThumbnail, the thumbnail is shown when the chooser opens, and Shift+Tab takes a new snapshot",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            const config = t.spoon.config
            const original = config.showThumbnail
            config.showThumbnail = true
            t.cleanup(() => { config.showThumbnail = original })
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            // Recorded only from here: a change of focus can make the user's other Spoons draw
            // canvases.
            const canvases = t.canvasesCapture()
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await t.wait(1)
            const shown = canvases.length
            t.assert.ok(shown >= 1, "no thumbnail when the chooser opened")
            await key(t, chooser, ["shift"], config.thumbnailRefreshKey)
            await t.wait(1)
            t.assert.ok(canvases.length > shown, "Shift+Tab drew no new thumbnail")
            await key(t, chooser, [], "escape")
        }
    },
    // --- the functions ---
    {
        name: "applicationWindowSelect() lists the focused application's windows, with its name as the prompt",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            const chooser = open(t, () => t.spoon.applicationWindowSelect())
            await openWait(t, chooser)
            const rows = choosers[0].rows
            t.assert.equal(choosers[0].placeholder, "osascript", "the prompt")
            t.assert.equal(rows.length, testRows(t, choosers[0]).length, "rows of other applications")
            t.assert.equal(testRows(t, choosers[0]).map((r) => r.text).join(", "), titles(b, a), "the rows")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "applicationWindowSelect(name) lists that application's windows, and an alert says when there are none",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const alerts = t.alertsCapture()
            const [a] = await t.windowsOpen(1)
            await focus(t, a)
            const result = t.spoon.applicationWindowSelect("NoSuchApplication-zq")
            t.assert.equal(result, null, "the result")
            t.assert.equal(choosers.length, 0, "choosers created")
            t.assert.ok(alerts.includes("No windows to choose from"), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    {
        name: "applicationSelect() lists each application once, at its most recently used window, without the focused application",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const order = t.spoon.order()
            const chooser = open(t, () => t.spoon.applicationSelect())
            await openWait(t, chooser)
            // The windows' rows only: the rows of applications without windows follow them.
            const rows = choosers[0].rows.filter((r) => r.id !== undefined)
            const applications = rows.map((r) => String(r.subText).split("  ·  ")[0])
            t.assert.equal(choosers[0].placeholder, "Application", "the prompt")
            t.assert.ok(!applications.includes("osascript"), "the focused application is listed")
            t.assert.equal(new Set(applications).size, applications.length, "applications listed more than once")
            const notFirst = rows.filter((r, i) => order.find((e) => e.startsWith(`${applications[i]}: `)) !== `${applications[i]}: ${r.text}`)
            t.assert.equal(notFirst.length, 0, "rows that are not their application's most recently used window")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "windowSelect() and applicationSelect() list running applications without windows, then those whose windows are not accessible, after the windows, and choosing one activates it",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            // Made-up applications, added to the real ones: two copies of one application
            // without windows, an application that is not standard, and an application with the
            // bundle of the frontmost one. Activating them is recorded, not done.
            const activated = []
            const made = (name, bundleID, kind, pid) => ({
                name, bundleID, kind, pid,
                activate: (all) => { activated.push([name, pid, all]); return true },
                setFrontmost: () => true
            })
            const frontmost = hs.application.frontmost()
            const fakes = [
                made("Zq Windowless", "org.hammer2spoons.test.windowless", "standard", -4101),
                made("Zq Windowless", "org.hammer2spoons.test.windowless", "standard", -4102),
                made("Zq Accessory", "org.hammer2spoons.test.accessory", "accessory", -4103),
                made("Zq Frontmost", frontmost ? frontmost.bundleID : "none", "standard", -4104),
                made("Zq Kiosk", "org.hammer2spoons.test.kiosk", "standard", -4105)
            ]
            const original = hs.application.runningApplications
            const own = Object.prototype.hasOwnProperty.call(hs.application, "runningApplications")
            hs.application.runningApplications = function () { return original.apply(hs.application, arguments).concat(fakes) }
            t.cleanup(() => { if (own) hs.application.runningApplications = original; else delete hs.application.runningApplications })
            // Zq Kiosk stands for an application that has turned the Accessibility API off, which
            // the user's hs_windowfilter-gt reports, replaced here until the test ends.
            const windowfilter = hs.spoons["hs_windowfilter-gt"]
            const filterOriginal = windowfilter.applicationsAccessibilityDisabled
            const filterOwn = Object.prototype.hasOwnProperty.call(windowfilter, "applicationsAccessibilityDisabled")
            windowfilter.applicationsAccessibilityDisabled = () => [fakes[4]]
            t.cleanup(() => { if (filterOwn) windowfilter.applicationsAccessibilityDisabled = filterOriginal; else delete windowfilter.applicationsAccessibilityDisabled })

            for (const [fn, n] of [["windowSelect", 0], ["applicationSelect", 1]]) {
                const chooser = open(t, () => t.spoon[fn]())
                await openWait(t, chooser)
                const rows = choosers[n].rows
                const ours = rows.filter((r) => String(r.text).startsWith("Zq "))
                t.assert.equal(ours.map((r) => r.text).join(", "), "Zq Windowless (no windows), Zq Kiosk (windows are not accessible)", `${fn}(): the made-up applications' rows`)
                t.assert.equal(ours[0].subText, "org.hammer2spoons.test.windowless", `${fn}(): the row's second line`)
                t.assert.equal(ours[1].subText, "org.hammer2spoons.test.kiosk  ·  pid -4105", `${fn}(): the second line of the row whose windows are not accessible`)
                const firstApplication = rows.findIndex((r) => r.pid !== undefined)
                const lastWindow = rows.map((r) => r.id !== undefined).lastIndexOf(true)
                t.assert.ok(firstApplication > lastWindow, `${fn}(): an application's row comes before a window's`)
                await type(t, chooser, "Zq Windowless")
                await key(t, chooser, [], "return")
                await t.wait(0.3)
                t.assert.equal(JSON.stringify(activated.splice(0)), JSON.stringify([["Zq Windowless", -4101, true]]), `${fn}(): the applications activated`)
                t.assert.equal(focusedId(), b.id, `${fn}(): the focused window`)
            }
        }
    },
    {
        name: "windowPreviousSelect() focuses the window used before the focused one, and returns true",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            t.assert.equal(t.spoon.windowPreviousSelect(), true, "the result")
            await t.wait(0.8)
            t.assert.equal(focusedId(), a.id, "the focused window")
        }
    },
    {
        name: "windowPreviousSelect() shows an alert and returns false when there is no previous window",
        run: async (t) => {
            onlyTestWindows(t)
            const alerts = t.alertsCapture()
            const [a] = await t.windowsOpen(1)
            await focus(t, a)
            t.assert.equal(t.spoon.windowPreviousSelect(), false, "the result")
            t.assert.ok(alerts.includes("No previous window"), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    {
        name: "applicationWindowPreviousSelect() switches between the application's two most recently used windows",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            t.assert.equal(t.spoon.applicationWindowPreviousSelect(), true, "the first result")
            await t.wait(0.8)
            t.assert.equal(focusedId(), b.id, "after the first call")
            t.spoon.applicationWindowPreviousSelect()
            await t.wait(0.8)
            t.assert.equal(focusedId(), c.id, "after the second call")
        }
    },
    {
        name: "applicationWindowPreviousSelect() shows an alert and returns false when the application has one window",
        run: async (t) => {
            const alerts = t.alertsCapture()
            const [a] = await t.windowsOpen(1)
            await focus(t, a)
            t.assert.equal(t.spoon.applicationWindowPreviousSelect(), false, "the result")
            t.assert.ok(alerts.includes("No previous window in this application"), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    {
        name: "applicationByBundleSelect() starts an application that is not running, and alerts on no bundle or a bad pattern",
        run: async (t) => {
            const alerts = t.alertsCapture()
            const launched = []
            const original = hs.application.launchOrFocus
            const own = Object.prototype.hasOwnProperty.call(hs.application, "launchOrFocus")
            hs.application.launchOrFocus = function (bundle) {
                if (String(bundle).startsWith("test.")) { launched.push(bundle); return true }
                return original.apply(hs.application, arguments)
            }
            t.cleanup(() => { if (own) hs.application.launchOrFocus = original; else delete hs.application.launchOrFocus })
            t.assert.equal(t.spoon.applicationByBundleSelect("test.not-running"), true, "the result for an application not running")
            t.assert.equal(launched.join(","), "test.not-running", "launchOrFocus calls")
            t.assert.equal(t.spoon.applicationByBundleSelect(""), false, "the result for no bundle identifier")
            t.assert.equal(t.spoon.applicationByBundleSelect("test.not-running", "("), false, "the result for a bad pattern")
            t.assert.equal(launched.length, 1, "launchOrFocus calls after the alerts")
            t.assert.ok(alerts.includes("No bundle identifier given"), `alerts: ${alerts.join(" | ") || "none"}`)
            t.assert.ok(alerts.some((m) => m.startsWith("Bad title pattern (")), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    }
]
