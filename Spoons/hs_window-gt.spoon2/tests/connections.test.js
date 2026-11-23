// Tests of the parts of hs_window-gt that connect it to the user: the exported functions that
// read omitted arguments, the menu, the keys bound by bindHotkeys(), and start() and stop().
//
// The keys bound here use ctrl-alt-shift with 7, 8 and 9, which the user's configuration does
// not bind, as in keys.test.js. A key is sent only when a test window has the focus.

const MODIFIERS = ["ctrl", "alt", "shift"]

function keySend(t, modifiers, key) {
    const window = hs.window.focusedWindow()
    const title = window ? window.title || "" : ""
    if (!title.startsWith(t.titlePrefix)) {
        t.assert.fail(`not sending ${key}: the focused window is not a test window ("${title}")`)
    }
    hs.eventtap.keyStroke(modifiers, key, null)
}

function isPromise(value) {
    return Boolean(value) && typeof value.then === "function"
}

function promptIsOpen() {
    return hs.spoons["hs_interactive-gt"].promptIsOpen()
}

// Opens a test window inside its screen, focuses it, and returns it with its frame.
async function windowOpen(t) {
    const [window] = await t.windowsOpen()
    const screen = t.screenFrame(window)
    const frame = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
    await t.frameSet(window, frame)
    window.focus()
    await t.wait(0.4)
    return { window, screen, frame }
}

// Every option of a menu, its submenus' options included.
function menuOptions(buttons) {
    const options = []
    for (const button of buttons) {
        options.push(button)
        if (button.children) options.push(...menuOptions(button.children))
    }
    return options
}

// The functions an exported function's prompted arguments are read for, with the arguments
// that leave the prompted one out, and the arguments that give it.
const PROMPTING = [
    { name: "fractionWidth", omitted: (w) => [undefined, w], given: (w) => [3, w] },
    { name: "moveByOwnSize", omitted: (w) => [undefined, w], given: (w) => ["right", w] },
    { name: "digitAttach", omitted: (w) => [w, undefined], given: (w) => [w, "7", true] },
    { name: "attachedFocus", omitted: () => [], given: () => ["7"], attached: true },
    { name: "keyDetach", omitted: () => [], given: () => ["7"], attached: true }
]

const tests = []

for (const entry of PROMPTING) {
    tests.push({
        name: `${entry.name} prompts for its omitted argument, and returns null when the prompt is cancelled`,
        run: async (t) => {
            const { window } = await windowOpen(t)
            const modifiers = t.spoon.config.attachModifiers
            t.spoon.config.attachModifiers = MODIFIERS
            try {
                if (entry.attached) t.spoon.digitAttach(window, "7", true)
                const cancelled = t.promptCancel()
                const result = t.spoon[entry.name](...entry.omitted(window))
                t.assert.ok(isPromise(result), "the function did not return a promise")
                await cancelled
                t.assert.equal(await result, null, "the result")
            } finally {
                t.spoon.keysAllDetach()
                t.spoon.config.attachModifiers = modifiers
            }
        }
    })

    tests.push({
        name: `${entry.name} does not prompt when its argument is given`,
        run: async (t) => {
            const { window } = await windowOpen(t)
            const modifiers = t.spoon.config.attachModifiers
            t.spoon.config.attachModifiers = MODIFIERS
            try {
                if (entry.attached) t.spoon.digitAttach(window, "7", true)
                const result = t.spoon[entry.name](...entry.given(window))
                t.assert.ok(!isPromise(result), "the function returned a promise")
                t.assert.ok(!promptIsOpen(), "a prompt is open")
            } finally {
                t.spoon.keysAllDetach()
                t.spoon.config.attachModifiers = modifiers
            }
        }
    })
}

tests.push({
    name: "a function given its window does not prompt",
    run: async (t) => {
        const { window } = await windowOpen(t)
        const result = t.spoon.center(window)
        t.assert.equal(result, true, "the result")
        t.assert.ok(!promptIsOpen(), "a prompt is open")
    }
})

tests.push({
    name: "a function whose window is omitted acts on the focused window without prompting",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        const result = t.spoon.center()
        t.assert.equal(result, true, "the result")
        t.assert.ok(!promptIsOpen(), "a prompt is open")
        t.assert.frameEqual(window.frame,
            { x: screen.x + (screen.w - 500) / 2, y: screen.y + (screen.h - 400) / 2, w: 500, h: 400 })
    }
})

tests.push({
    name: "a function whose screen is omitted uses the focused window's screen without prompting",
    run: async (t) => {
        const { window } = await windowOpen(t)
        const result = t.spoon.screenHasFullscreenWindow()
        t.assert.equal(result, false, "the result")
        t.assert.ok(!promptIsOpen(), "a prompt is open")
    }
})

tests.push({
    name: "attachedFocus with nothing attached shows a message instead of an empty prompt",
    run: async (t) => {
        await windowOpen(t)
        const alerts = t.alertsCapture()
        const result = await t.spoon.attachedFocus()
        t.assert.equal(result, null, "the result")
        t.assert.ok(!promptIsOpen(), "a prompt is open")
        t.assert.ok(alerts.some((a) => a.includes("No number key is attached to a window")),
            `alerts: ${alerts.join(" | ")}`)
    }
})

tests.push({
    name: "every option of the menu calls a function the Spoon exports, or opens a submenu",
    run: (t) => {
        const options = menuOptions(t.spoon.menu.buttons)
        t.assert.ok(options.length > 0, "the menu has no options")
        const wrong = []
        for (const option of options) {
            if (option.children) continue
            if (typeof option.fn !== "function") {
                wrong.push(`${option.label}: no fn`)
                continue
            }
            const source = String(option.fn)
            const names = [...source.matchAll(/module\.exports\.(\w+)/g)].map((m) => m[1])
            // Fullscreen and Minimize call a method of the window instead, through onWindow(),
            // whose function reads the window with readerRun().
            if (!names.length && source.includes("readerRun")) continue
            for (const name of names) {
                if (typeof t.spoon[name] !== "function") wrong.push(`${option.label}: ${name} is not exported`)
            }
            if (!names.length) wrong.push(`${option.label}: calls nothing the test recognizes`)
        }
        t.assert.equal(wrong.length, 0, wrong.join("; "))
    }
})

tests.push({
    name: "every option of the menu has a key, unique within its menu",
    run: (t) => {
        const check = (buttons, where) => {
            const seen = new Set()
            for (const button of buttons) {
                t.assert.ok(button.key, `${where}: ${button.label} has no key`)
                t.assert.ok(!seen.has(button.key), `${where}: the key ${button.key} is used twice`)
                seen.add(button.key)
                if (button.children) check(button.children, button.label)
            }
        }
        check(t.spoon.menu.buttons, "the window menu")
    }
})

tests.push({
    name: "menuShow displays the window menu, and Escape closes it",
    run: async (t) => {
        await windowOpen(t)
        const menu = hs.spoons["hs_menu-gt"]
        t.assert.ok(!menu.onScreenIsShown(), "a menu was already shown")
        try {
            t.assert.equal(t.spoon.menuShow(), t.spoon, "returned")
            await t.wait(0.5)
            t.assert.ok(menu.onScreenIsShown(), "the menu is not shown")
            keySend(t, [], "escape")
            await t.wait(0.5)
            t.assert.ok(!menu.onScreenIsShown(), "the menu is still shown after Escape")
        } finally {
            if (menu.onScreenIsShown()) menu.onScreenHide()
        }
    }
})

tests.push({
    name: "bindHotkeys binds a key to a function, and the key runs it on the focused window",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        try {
            t.assert.equal(t.spoon.bindHotkeys({ leftHalf: [MODIFIERS, "9"] }), t.spoon, "returned")
            keySend(t, MODIFIERS, "9")
            await t.wait(0.5)
            t.assert.frameEqual(window.frame, { x: screen.x, y: screen.y, w: screen.w / 2, h: screen.h })
        } finally {
            t.spoon.bindHotkeys({})
        }
    }
})

tests.push({
    name: "a second bindHotkeys replaces the keys of the first",
    run: async (t) => {
        const { window, frame } = await windowOpen(t)
        try {
            t.spoon.bindHotkeys({ leftHalf: [MODIFIERS, "9"] })
            t.spoon.bindHotkeys({ rightHalf: [MODIFIERS, "8"] })
            keySend(t, MODIFIERS, "9")
            await t.wait(0.5)
            t.assert.frameEqual(window.frame, frame, "the key of the first call still acted")
        } finally {
            t.spoon.bindHotkeys({})
        }
    }
})

tests.push({
    name: "bindHotkeys refuses a function a key cannot run, and binds nothing",
    run: async (t) => {
        const { window, frame } = await windowOpen(t)
        try {
            let error = null
            try {
                t.spoon.bindHotkeys({ leftHalf: [MODIFIERS, "9"], place: [MODIFIERS, "8"] })
            } catch (e) {
                error = e
            }
            t.assert.ok(error, "bindHotkeys did not throw")
            t.assert.ok(String(error.message).includes("place is not a function a key can run"), `the error: ${error.message}`)
            keySend(t, MODIFIERS, "9")
            await t.wait(0.5)
            t.assert.frameEqual(window.frame, frame, "the valid key was bound")
        } finally {
            t.spoon.bindHotkeys({})
        }
    }
})

tests.push({
    name: "bindHotkeys refuses a binding that is not [modifiers, key]",
    run: (t) => {
        let error = null
        try {
            t.spoon.bindHotkeys({ leftHalf: "ctrl-9" })
        } catch (e) {
            error = e
        }
        t.assert.ok(error, "bindHotkeys did not throw")
        t.assert.ok(String(error.message).includes("leftHalf needs [modifiers, key]"), `the error: ${error.message}`)
    }
})

tests.push({
    name: "stop() releases keys, isolation, the ring, attached digits and the window filter, and start() works again",
    timeout: 20,
    run: async (t) => {
        const { window, frame } = await windowOpen(t)
        const windowfilter = hs.spoons["hs_windowfilter-gt"]
        const filtersBefore = windowfilter.status().filters
        const modifiers = t.spoon.config.attachModifiers
        t.spoon.config.attachModifiers = MODIFIERS
        const canvases = t.canvasesCapture()
        let stopped = false
        try {
            t.spoon.bindHotkeys({ leftHalf: [MODIFIERS, "9"] })
            t.spoon.digitAttach(window, "7", true)
            t.spoon.isolationStart()
            t.spoon.mouseHighlight(frame.x + 50, frame.y + 50)
            t.assert.ok(canvases.length > 1, "no panel or ring was drawn")

            t.assert.equal(t.spoon.stop(), t.spoon, "stop returned")
            stopped = true
            t.assert.equal(windowfilter.status().filters, filtersBefore - 1, "hs_windowfilter-gt's filters after stop")
            t.assert.equal(t.spoon.isolationOn(), false, "isolation is on")
            const shown = canvases.filter((c) => { try { return c.canvas.isShowing() } catch (e) { return false } })
            t.assert.equal(shown.length, 0, "panels or the ring still shown")
            t.assert.equal(Object.keys(t.spoon.attachedWindows()).length, 0, "digits still attached")
            const saved = JSON.parse(hs.fs.read(t.spoon.config.attachFile, 0, 0))
            t.assert.ok(saved["7"], "stop removed the digit from config.attachFile")
            keySend(t, MODIFIERS, "9")
            await t.wait(0.5)
            t.assert.frameEqual(window.frame, frame, "the key bound by bindHotkeys still acted")

            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.start(), t.spoon, "start returned")
            stopped = false
            t.assert.equal(windowfilter.status().filters, filtersBefore, "hs_windowfilter-gt's filters after start")
            t.assert.ok(t.spoon.attachedWindows()["7"], "start did not attach 7 again")
            t.assert.ok(alerts.some((a) => a.startsWith("Window keys restored:")), `alerts: ${alerts.join(" | ")}`)
        } finally {
            if (stopped) t.spoon.start()
            t.spoon.bindHotkeys({})
            t.spoon.isolationStop()
            t.spoon.keysAllDetach()
            t.spoon.config.attachModifiers = modifiers
        }
    }
})

tests.push({
    name: "start() called twice creates one window filter",
    run: (t) => {
        const windowfilter = hs.spoons["hs_windowfilter-gt"]
        const before = windowfilter.status().filters
        t.spoon.start()
        t.assert.equal(windowfilter.status().filters, before, "hs_windowfilter-gt's filters")
    }
})

module.exports = tests
