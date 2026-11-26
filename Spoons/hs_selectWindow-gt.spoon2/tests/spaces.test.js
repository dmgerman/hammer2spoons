// Tests of the Space shown in a row, as the readme describes it under "windowSelect()": a window on
// a Space its screen is not showing has that Space after its screen, "Desktop 2" for another
// desktop and "fullscreen" for a window in fullscreen.
//
// The first test moves a test window to another desktop of its screen with window.moveToSpace(),
// which does not switch to that desktop, and moves it back when the test ends. It needs a screen
// with a second desktop, and is skipped without one. The second test puts a test window in
// fullscreen and focuses another test window on the same screen, which shows that screen's desktop
// again; the fixture takes a window out of fullscreen before closing it.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const { choosersCapture, open, openWait, type, key, focus, focusedId, interactive, previousGuard } = require("./chooser.js")

const MODIFIERS = ["ctrl", "alt", "shift"]

// A screen showing a desktop that has a second desktop, or null.
function screenWithTwoDesktops() {
    return hs.screen.all().find((s) => {
        const { current, all } = spacesOf(s)
        return current && current.type === "desktop" && all.some((sp) => sp.type === "desktop" && !sp.isCurrent)
    }) || null
}

// Opens three test windows on a screen with two desktops, and moves `away` to the other desktop,
// where it stays until the test ends. Before the move they were focused in the order shown, away,
// focused, so away is the previous window, and shown the one before it.
async function threeWithOneAway(t) {
    const screen = screenWithTwoDesktops()
    if (!screen) t.skip("no screen shows a desktop and has a second one")
    const { current, all } = spacesOf(screen)
    const other = all.find((sp) => sp.type === "desktop" && !sp.isCurrent)
    const [shown, away, focused] = await t.windowsOpen(3)
    const f = screen.frame
    for (const [i, window] of [shown, away, focused].entries()) {
        await t.frameSet(window, { x: f.x + 60 + 40 * i, y: f.y + 60 + 40 * i, w: 400, h: 300 })
    }
    for (const window of [shown, away, focused]) await focus(t, window)
    await away.moveToSpace(other)
    t.cleanup(async () => {
        if (!away.spaces.some((sp) => sp.id === current.id)) await away.moveToSpace(current)
    })
    await t.wait(0.5)
    t.assert.ok(away.spaces.some((sp) => sp.id === other.id), "the window was not moved to the other desktop")
    return { screen, current, other, shown, away, focused }
}

// Whether a window is on a Space.
const isOn = (window, space) => window.spaces.some((sp) => sp.id === space.id)

// The row of a window, found by its title.
const rowOf = (record, window) => record.rows.find((row) => row.text === window.title)

// The Spaces of a screen, the one it shows first.
function spacesOf(screen) {
    const spaces = screen.spaces || []
    return { current: spaces.find((s) => s.isCurrent) || null, all: spaces }
}

// Opens windowSelect()'s chooser, and returns its record once it is open.
async function chooserRows(t, choosers) {
    const chooser = open(t, () => t.spoon.windowSelect())
    await openWait(t, chooser)
    const record = choosers[choosers.length - 1]
    return { chooser, record }
}

module.exports = [
    {
        name: "a window on another desktop has that desktop after its screen, and a window on the desktop shown has none",
        timeout: 20,
        run: async (t) => {
            const screen = hs.screen.all().find((s) => {
                const { current, all } = spacesOf(s)
                return current && current.type === "desktop" && all.some((sp) => sp.type === "desktop" && !sp.isCurrent)
            })
            if (!screen) t.skip("no screen shows a desktop and has a second one")
            const { current, all } = spacesOf(screen)
            const other = all.find((sp) => sp.type === "desktop" && !sp.isCurrent)

            const choosers = choosersCapture(t)
            const [focused, shown, away] = await t.windowsOpen(3)
            const f = screen.frame
            for (const [i, window] of [focused, shown, away].entries()) {
                await t.frameSet(window, { x: f.x + 60 + 40 * i, y: f.y + 60 + 40 * i, w: 400, h: 300 })
            }
            await focus(t, focused)
            await away.moveToSpace(other)
            t.cleanup(async () => {
                if (!away.spaces.some((sp) => sp.id === current.id)) await away.moveToSpace(current)
            })
            await t.wait(0.5)
            t.assert.ok(away.spaces.some((sp) => sp.id === other.id), "the window was not moved to the other desktop")

            const { chooser, record } = await chooserRows(t, choosers)
            const awayRow = rowOf(record, away)
            const shownRow = rowOf(record, shown)
            t.assert.ok(awayRow, "the window on the other desktop has no row")
            t.assert.ok(shownRow, "the window on the desktop shown has no row")
            t.assert.equal(awayRow.subText, `osascript  ·  ${screen.name}  ·  Desktop ${other.desktopNumber}`, "the row of the window on the other desktop")
            t.assert.equal(shownRow.subText, `osascript  ·  ${screen.name}`, "the row of the window on the desktop shown")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "a window in fullscreen on a Space that is not shown has fullscreen after its screen",
        timeout: 30,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [full, other, focused] = await t.windowsOpen(3)
            const screen = full.screen
            const f = screen.frame
            await t.frameSet(other, { x: f.x + 100, y: f.y + 100, w: 400, h: 300 })
            await t.frameSet(focused, { x: f.x + 140, y: f.y + 140, w: 400, h: 300 })

            await focus(t, full)
            full.toggleFullscreen()
            const started = Date.now()
            while (!full.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(full.isFullscreen, "the window did not enter fullscreen")
            await t.wait(1.5)
            // Focusing a window on the same screen shows that screen's desktop again.
            await focus(t, focused)
            await t.wait(1.5)
            const fullscreenSpace = full.spaces[0]
            t.assert.ok(fullscreenSpace && fullscreenSpace.type === "fullscreen", "the window is not on a fullscreen Space")
            t.assert.ok(!fullscreenSpace.isCurrent, "the fullscreen Space is still shown")

            const { chooser, record } = await chooserRows(t, choosers)
            const fullRow = rowOf(record, full)
            t.assert.ok(fullRow, "the window in fullscreen has no row")
            t.assert.equal(fullRow.subText, `osascript  ·  ${screen.name}  ·  fullscreen`, "the row of the window in fullscreen")
            t.assert.equal(rowOf(record, other).subText, `osascript  ·  ${screen.name}`, "the row of the window on the desktop shown")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "with currentSpace, the choosers and the previous window leave out a window on another desktop",
        timeout: 30,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { shown, away, focused } = await threeWithOneAway(t)
            const listed = async (fn) => {
                const chooser = open(t, fn)
                await openWait(t, chooser)
                const rows = choosers[choosers.length - 1].rows
                await key(t, chooser, [], "escape")
                return { shown: Boolean(rowOf({ rows }, shown)), away: Boolean(rowOf({ rows }, away)) }
            }
            t.assert.equal(JSON.stringify(await listed(() => t.spoon.windowSelect())), JSON.stringify({ shown: true, away: true }), "windowSelect()")
            t.assert.equal(JSON.stringify(await listed(() => t.spoon.windowSelect({ currentSpace: true }))), JSON.stringify({ shown: true, away: false }), "windowSelect({ currentSpace: true })")
            t.assert.equal(JSON.stringify(await listed(() => t.spoon.applicationWindowSelect(undefined, { currentSpace: true }))), JSON.stringify({ shown: true, away: false }), "applicationWindowSelect(undefined, { currentSpace: true })")
            // away was used after shown, so without the option it would be the previous window.
            previousGuard(t, shown)
            t.assert.equal(t.spoon.windowPreviousSelect({ currentSpace: true }), true, "windowPreviousSelect() returned")
            await t.wait(0.8)
            t.assert.equal(focusedId(), shown.id, "the window windowPreviousSelect({ currentSpace: true }) focused")
            await focus(t, focused)
            t.assert.equal(t.spoon.applicationWindowPreviousSelect({ currentSpace: true }), true, "applicationWindowPreviousSelect() returned")
            await t.wait(0.8)
            t.assert.equal(focusedId(), shown.id, "the window applicationWindowPreviousSelect({ currentSpace: true }) focused")
        }
    },
    {
        name: "windowToCurrentSpaceSelect brings the chosen window to the current Space and focuses it",
        timeout: 30,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { current, away } = await threeWithOneAway(t)
            const chooser = open(t, () => t.spoon.windowToCurrentSpaceSelect())
            await openWait(t, chooser)
            t.assert.equal(choosers[choosers.length - 1].placeholder, "Window to bring here", "the prompt")
            await type(t, chooser, away.title)
            await key(t, chooser, [], "return")
            const started = Date.now()
            while (!isOn(away, current) && Date.now() - started < 5000) await t.wait(0.1)
            await t.wait(0.8)
            t.assert.ok(isOn(away, current), "the window is not on the current Space")
            t.assert.equal(focusedId(), away.id, "the focused window")
        }
    },
    {
        name: "windowToCurrentSpaceSelect refuses a window in fullscreen, and one that closed while the chooser was open, with an alert",
        timeout: 40,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const alerts = t.alertsCapture()
            const [full, gone, focused] = await t.windowsOpen(3)
            const f = full.screen.frame
            await t.frameSet(focused, { x: f.x + 140, y: f.y + 140, w: 400, h: 300 })
            await focus(t, full)
            full.toggleFullscreen()
            const started = Date.now()
            while (!full.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(full.isFullscreen, "the window did not enter fullscreen")
            await t.wait(1.5)
            await focus(t, focused)
            await t.wait(1.5)

            let chooser = open(t, () => t.spoon.windowToCurrentSpaceSelect())
            await openWait(t, chooser)
            await type(t, chooser, full.title)
            await key(t, chooser, [], "return")
            await t.wait(0.5)
            t.assert.ok(alerts.some((a) => a.includes("fullscreen")), `alerts: ${alerts.join(" | ")}`)
            t.assert.ok(full.isFullscreen, "the window left fullscreen")

            chooser = open(t, () => t.spoon.windowToCurrentSpaceSelect())
            await openWait(t, chooser)
            await type(t, chooser, gone.title)
            await t.windowClose(gone)
            await key(t, chooser, [], "return")
            await t.wait(0.5)
            t.assert.ok(alerts.some((a) => a.includes("no longer open")), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(choosers.length, 2, "choosers opened")
        }
    },
    {
        name: "bindHotkeys() binds windowToCurrentSpaceSelect and the names ending in CurrentSpace",
        timeout: 30,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { away } = await threeWithOneAway(t)
            t.cleanup(() => t.spoon.bindHotkeys({}))
            t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
            t.spoon.bindHotkeys({ windowToCurrentSpaceSelect: [MODIFIERS, "f17"], windowSelectCurrentSpace: [MODIFIERS, "f18"] })
            hs.eventtap.keyStroke(withFn(MODIFIERS, "f17"), "f17", null)
            await t.wait(1)
            t.assert.equal(choosers.length, 1, "choosers after the first key")
            t.assert.equal(choosers[0].placeholder, "Window to bring here", "the first key's chooser")
            if (interactive().promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
            await t.wait(0.8)
            hs.eventtap.keyStroke(withFn(MODIFIERS, "f18"), "f18", null)
            await t.wait(1)
            t.assert.equal(choosers.length, 2, "choosers after the second key")
            t.assert.ok(!rowOf(choosers[1], away), "the second key's chooser lists the window on the other desktop")
            if (interactive().promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
            await t.wait(0.5)
            let error = null
            try { t.spoon.bindHotkeys({ applicationSelectCurrentSpace: [MODIFIERS, "f19"] }) } catch (e) { error = e }
            t.assert.ok(error, "no error for applicationSelectCurrentSpace, which does not exist")
        }
    }
]
