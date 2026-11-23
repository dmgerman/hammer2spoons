// The tests of hs_selectWindow-gt that need two screens, as the readme describes them under
// "Windows on a screen showing a fullscreen window". With fewer connected, the harness reports
// each of them as skipped without running it. make test-two-screens runs this file alone.
//
// Each test puts a test window into fullscreen on the first screen of hs.screen.all(), with
// another test window behind it on the same screen, and switches to that window with
// windowPreviousSelect(). The fixture takes the windows out of fullscreen when the test ends.

const { focus } = require("./chooser.js")

// Opens a test window in the middle of a screen.
async function windowOn(t, screen) {
    const [window] = await t.windowsOpen()
    const f = screen.frame
    await t.frameSet(window, { x: f.x + f.w * 0.3, y: f.y + f.h * 0.3, w: f.w * 0.3, h: f.h * 0.3 })
    return window
}

// Puts a window into fullscreen and waits until the Space switch has finished.
async function fullscreenEnter(t, window) {
    window.focus()
    await t.wait(0.4)
    window.toggleFullscreen()
    const started = Date.now()
    while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
    t.assert.ok(window.isFullscreen, `"${window.title}" did not enter fullscreen`)
    await t.wait(1.5)
}

function skipSet(t, value) {
    const original = t.spoon.config.fullscreenScreenSkip
    t.spoon.config.fullscreenScreenSkip = value
    t.cleanup(() => { t.spoon.config.fullscreenScreenSkip = original })
}

// A window behind a fullscreen window on the first screen, used before it. Resolves to both.
async function behindFullscreen(t) {
    const [first] = hs.screen.all()
    const behind = await windowOn(t, first)
    const fullscreen = await windowOn(t, first)
    await focus(t, behind)
    await fullscreenEnter(t, fullscreen)
    await t.wait(0.5)
    return { first, behind, fullscreen }
}

async function previousSelect(t) {
    t.assert.equal(t.spoon.windowPreviousSelect(), true, "windowPreviousSelect()")
    await t.wait(2)
}

const focusedId = () => { const w = hs.window.focusedWindow(); return w ? w.id : null }

const tests = [
    {
        name: "with fullscreenScreenSkip false, the chosen window is focused on the screen showing the fullscreen window",
        timeout: 25,
        run: async (t) => {
            skipSet(t, false)
            const { first, behind } = await behindFullscreen(t)
            await previousSelect(t)
            t.assert.equal(behind.screen.id, first.id, "the chosen window's screen")
            t.assert.equal(focusedId(), behind.id, "the focused window")
        }
    },
    {
        name: "with fullscreenScreenSkip true, the chosen window moves to the next screen and the fullscreen window stays",
        timeout: 25,
        run: async (t) => {
            skipSet(t, true)
            const { behind, fullscreen } = await behindFullscreen(t)
            const second = hs.screen.all()[1]
            await previousSelect(t)
            t.assert.equal(behind.screen.id, second.id, "the chosen window's screen")
            t.assert.equal(focusedId(), behind.id, "the focused window")
            t.assert.ok(fullscreen.isFullscreen, "the fullscreen window left fullscreen")
        }
    },
    {
        name: "with fullscreenScreenSkip true, a minimized window is focused where it is",
        timeout: 25,
        run: async (t) => {
            skipSet(t, true)
            const { first, behind } = await behindFullscreen(t)
            behind.minimize()
            await t.wait(1)
            await previousSelect(t)
            t.assert.ok(!behind.isMinimized, "the window is still minimized")
            t.assert.equal(behind.screen.id, first.id, "the chosen window's screen")
        }
    },
    {
        name: "with fullscreenScreenSkip true, the window is focused where it is when every other screen shows a fullscreen window",
        // A fullscreen window on every screen, each taking about 2 s to enter.
        timeout: 45,
        run: async (t) => {
            skipSet(t, true)
            const others = hs.screen.all().slice(1)
            for (const screen of others) await fullscreenEnter(t, await windowOn(t, screen))
            const { first, behind } = await behindFullscreen(t)
            await previousSelect(t)
            t.assert.equal(behind.screen.id, first.id, "the chosen window's screen")
            t.assert.equal(focusedId(), behind.id, "the focused window")
        }
    }
]

module.exports = { screens: 2, tests }
