// Tests of the settings in config whose effect no other file tests with a value other than the
// default. Each test sets the value on the copy under test and puts the default back.
//
// The other settings are tested elsewhere, with values other than their defaults:
//
//   historySize          history.test.js, set to 3
//   attachModifiers      keys.test.js and connections.test.js, set to ctrl-alt-shift
//   attachKeyWait        keys.test.js, set to 1
//   attachFile           the harness sets it to the run's directory; keys.test.js reads it
//   screenshotDir        the harness sets it to the run's directory; isolation.test.js reads it
//
// fullscreenLeaveWait is not tested. Its effect shows only when a window takes longer to leave
// fullscreen than the setting allows. A test window leaves fullscreen before the Spoon's first
// check, 0.05 s after asking, so even a setting of 0 does not make the move give up. That was
// measured on 2026-11-23.

const MODIFIERS = ["ctrl", "alt", "shift"]

// Runs body with some settings changed, and puts them back afterwards.
async function withConfig(t, values, body) {
    const saved = {}
    for (const key of Object.keys(values)) {
        saved[key] = t.spoon.config[key]
        t.spoon.config[key] = values[key]
    }
    try {
        await body()
    } finally {
        Object.assign(t.spoon.config, saved)
    }
}

function showing(canvas) {
    try {
        return canvas.isShowing()
    } catch (e) {
        return false
    }
}

function colorEqual(t, color, expected, message) {
    for (const key of ["red", "green", "blue", "alpha"]) {
        t.assert.ok(Math.abs(color[key] - expected[key]) < 0.01,
            `${message}: ${key} is ${color[key]}, expected ${expected[key]}`)
    }
}

// The id of the main window of a window's application.
function mainId(window) {
    const main = window.application ? window.application.mainWindow : null
    return main ? main.id : null
}

// Opens two test windows of one application, at two different frames, and focuses the second.
async function twoOpen(t) {
    const [first, second] = await t.windowsOpen(2)
    const screen = t.screenFrame(first)
    await t.frameSet(first, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
    await t.frameSet(second, { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 })
    second.focus()
    await t.wait(0.4)
    return { first, second }
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
        name: "isolationColor and isolationOpacity give the panels their colour",
        run: async (t) => {
            await twoOpen(t)
            const canvases = t.canvasesCapture()
            await withConfig(t, { isolationColor: "#FF8000", isolationOpacity: 0.5 }, async () => {
                try {
                    t.spoon.isolationStart()
                    t.assert.ok(canvases.length > 0, "no panel was drawn")
                    for (const { canvas } of canvases) {
                        colorEqual(t, canvas.canvasElements()[0].fillColor,
                            { red: 1, green: 128 / 255, blue: 0, alpha: 0.5 }, "a panel's colour")
                    }
                } finally {
                    t.spoon.isolationStop()
                }
            })
        }
    },
    {
        name: "mouseHighlightColor, mouseHighlightSize and mouseHighlightWidth shape the ring",
        run: async (t) => {
            const canvases = t.canvasesCapture()
            await withConfig(t, { mouseHighlightColor: "#00FF00", mouseHighlightSize: 100, mouseHighlightWidth: 8 }, async () => {
                const screen = hs.screen.primary().frame
                t.spoon.mouseHighlight(screen.x + 300, screen.y + 200)
                t.assert.equal(canvases.length, 1, "canvases created")
                const { frame, canvas } = canvases[0]
                t.assert.equal(frame.w, 108, "the canvas's width")
                t.assert.equal(frame.h, 108, "the canvas's height")
                const ring = canvas.canvasElements()[0]
                t.assert.equal(ring.radius, 50, "the ring's radius")
                t.assert.equal(ring.strokeWidth, 8, "the ring's line width")
                colorEqual(t, ring.strokeColor, { red: 0, green: 1, blue: 0, alpha: 1 }, "the ring's colour")
            })
        }
    },
    {
        name: "mouseHighlightSeconds is how long the ring is shown",
        run: async (t) => {
            const canvases = t.canvasesCapture()
            await withConfig(t, { mouseHighlightSeconds: 1 }, async () => {
                const screen = hs.screen.primary().frame
                t.spoon.mouseHighlight(screen.x + 300, screen.y + 200)
                await t.wait(0.7)
                t.assert.ok(showing(canvases[0].canvas), "the ring was removed before 1 s")
                await t.wait(0.6)
                t.assert.ok(!showing(canvases[0].canvas), "the ring is still shown after 1.3 s")
            })
        }
    },
    {
        name: "attachKeys limits the digits a window can be attached to",
        run: async (t) => {
            const { first } = await twoOpen(t)
            await withConfig(t, { attachKeys: "89", attachModifiers: MODIFIERS }, async () => {
                try {
                    const alerts = t.alertsCapture()
                    t.assert.equal(t.spoon.digitAttach(first, "7", true), false, "7 returned")
                    t.assert.equal(alerts.join(" | "), `Cannot attach to "7"\nuse one of 89`, "alert")
                    t.assert.equal(t.spoon.digitAttach(first, "9", true), true, "9 returned")
                    t.assert.equal(Object.keys(t.spoon.attachedWindows()).join(","), "9", "the digits attached")
                } finally {
                    t.spoon.keysAllDetach()
                }
            })
        }
    },
    // Hammerspoon 2's own focus(), which windowFocus() calls, asserts its window again 0.3 s
    // later, whatever this Spoon's setting is. So the second window is made main at 0.45 s,
    // after that, and the Spoon's assertion comes at 0.6 s. becomeMain() is used rather than
    // focus(), as a click would make the window main, because focus() would assert the second
    // window again too.
    {
        name: "focusReassertDelay makes the window main again after that delay",
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await withConfig(t, { focusReassertDelay: 0.6 }, async () => {
                t.spoon.windowFocus(first)
                await t.wait(0.45)
                second.becomeMain()
                await t.wait(0.1)
                t.assert.equal(mainId(first), second.id, "the main window before the delay ran out")
                await t.wait(0.5)
                t.assert.equal(mainId(first), first.id, "the main window after the delay")
            })
        }
    },
    {
        name: "focusReassertDelay 0 turns the second assertion off",
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await withConfig(t, { focusReassertDelay: 0 }, async () => {
                t.spoon.windowFocus(first)
                await t.wait(0.45)
                second.becomeMain()
                await t.wait(0.6)
                t.assert.equal(mainId(first), second.id, "the main window")
            })
        }
    },
    {
        name: "screenshotAlertSeconds is how long the screenshot's alert is shown",
        timeout: 15,
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("Hammerspoon 2 has no Screen Recording permission")
            const { first } = await twoOpen(t)
            // The user's clipboard text is put back afterwards, as in isolation.test.js.
            const text = hs.pasteboard.readString()
            let path = null
            try {
                await withConfig(t, { screenshotAlertSeconds: 5 }, async () => {
                    const alerts = t.alertsCapture()
                    path = await t.spoon.screenshot(first)
                    t.assert.ok(path, "screenshot returned no path")
                    t.assert.equal(alerts.length, 1, "alerts shown")
                    t.assert.equal(alerts.durations[0], 5, "the alert's duration")
                })
            } finally {
                if (text !== null) hs.pasteboard.writeString(text)
                if (path) hs.fs.deletePath(path)
            }
        }
    }
]
