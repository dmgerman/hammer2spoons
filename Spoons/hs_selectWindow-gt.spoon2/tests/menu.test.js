// Tests of the menu, as the readme describes it under "The menu".
//
// menuShow() shows the menu through the user's hs_menu-gt, and showing it there would change where
// the user's on-screen menu reopens. The tests therefore record that call instead of making it, and
// press the menu's options through a session of the user's hs_menu-gt with a presenter that shows
// nothing. The functions the options call are replaced by recorders, so that no chooser opens and
// no window is focused.

const MODIFIERS = ["ctrl", "alt", "shift"]

// Replaces obj[name] with `ours` until the test ends, recording each call.
function replace(t, obj, name, ours) {
    const original = obj[name]
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) {
        calls.push(args)
        return ours(...args)
    }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

// A session of the user's hs_menu-gt on a presenter that shows nothing.
function menuSession(t) {
    const presenter = { progressive: false, canHide: true, present() {}, close() {} }
    const session = hs.spoons["hs_menu-gt"].sessionOpen(t.spoon.menu, presenter, { name: "Switch window" })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

// Each option's letter, the function it calls, and the arguments it passes.
const OPTIONS = [
    ["b", "windowSelect", []],
    ["s", "windowSelect", [{ currentSpace: true }]],
    ["a", "applicationWindowSelect", []],
    ["h", "applicationWindowSelect", [undefined, { currentSpace: true }]],
    ["t", "applicationSelect", []],
    ["p", "windowPreviousSelect", []],
    ["o", "windowPreviousSelect", [{ currentSpace: true }]],
    ["n", "applicationWindowPreviousSelect", []],
    ["m", "windowToCurrentSpaceSelect", []],
    ["f", "fullscreenWindowNextSelect", []],
    ["k", "bindingsShow", []]
]

module.exports = [
    {
        name: "the menu has eleven options, lettered b, s, a, h, t, p, o, n, m, f and k",
        run: (t) => {
            const session = menuSession(t)
            t.assert.equal(session.buttons().map((b) => b.label).join(", "),
                "All windows, Windows here, App windows, App windows here, Applications, Previous, Previous here, App previous, Bring here, Fullscreen, Bindings",
                "the options")
            t.assert.equal(session.letters().join(","), "b,s,a,h,t,p,o,n,m,f,k", "the letters")
        }
    },
    {
        name: "menuShow() shows the menu with hs_menu-gt, and returns the Spoon",
        run: (t) => {
            const calls = replace(t, hs.spoons["hs_menu-gt"], "onScreenShow", () => {})
            t.assert.equal(t.spoon.menuShow(), t.spoon, "menuShow() returned")
            t.assert.equal(calls.length, 1, "onScreenShow() calls")
            t.assert.equal(calls[0][0], t.spoon.menu, "the menu shown")
        }
    },
    {
        name: "each option calls its function with its arguments, and closes the menu",
        run: (t) => {
            const recorded = {}
            for (const name of new Set(OPTIONS.map(([, name]) => name))) {
                recorded[name] = replace(t, t.spoon, name, () => null)
            }
            for (const [letter, name, args] of OPTIONS) {
                const before = recorded[name].length
                const session = menuSession(t)
                session.activate(session.letters().indexOf(letter))
                t.assert.ok(session.isClosed(), `the menu stayed open after ${letter}`)
                t.assert.equal(recorded[name].length, before + 1, `${letter}: calls of ${name}`)
                t.assert.equal(JSON.stringify(recorded[name][before]), JSON.stringify(args), `${letter}: the arguments`)
            }
        }
    },
    {
        name: "bindingsShow() lists the keys bound with bindHotkeys() in a rectangle, and a key bound to menuShow opens the menu",
        run: async (t) => {
            const canvases = t.canvasesCapture()
            const shown = replace(t, hs.spoons["hs_menu-gt"], "onScreenShow", () => {})
            t.cleanup(() => t.spoon.bindHotkeys({}))
            t.spoon.bindHotkeys({ menuShow: [MODIFIERS, "9"] })
            const label = hs.spoons["hs_interactive-gt"].keyLabel({ mods: MODIFIERS, key: "9" })
            const lines = t.spoon.bindingsShow()
            t.assert.ok(lines.includes(`${label}  menuShow`), `the lines: ${lines.join(" | ")}`)
            t.assert.equal(canvases.length, 1, "canvases drawn")
            const canvas = canvases[0].canvas
            t.assert.equal(canvas.elementAttribute(0, "type"), "rectangle", "the first element")
            const radii = canvas.elementAttribute(0, "roundedRectRadii")
            t.assert.ok(!radii || (!radii.xRadius && !radii.yRadius), `the rectangle has rounded corners: ${JSON.stringify(radii)}`)
            t.assert.ok(String(canvas.elementAttribute(1, "text")).includes(`${label}  menuShow`), "the text drawn")
            t.assert.ok(canvas.isShowing(), "the rectangle is not shown")
            hs.eventtap.keyStroke(MODIFIERS, "9", null)
            await t.wait(0.6)
            t.assert.equal(shown.length, 1, "the menu shown by the key")
            t.spoon.bindHotkeys({})
            t.assert.ok(!t.spoon.bindingsShow().some((line) => line.endsWith("  menuShow")), "the key is still listed after it was released")
        }
    }
]
