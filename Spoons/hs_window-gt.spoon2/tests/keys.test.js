// Tests of the number keys attached to windows.
//
// The copy of the Spoon under test binds real hot keys. The user's configuration binds Option
// with a digit, so these tests use modifiers nothing in it binds, and only the digits 7 and 8.
// Every test releases what it attached, also when it fails, and the copy saves its
// attachments into the run's temporary directory, so the user's own keys and file are not
// touched.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const MODIFIERS = ["ctrl", "alt", "shift"]
const LABEL = MODIFIERS.join("-")

// Runs body with the test modifiers set, and releases every key afterwards.
async function withKeys(t, body) {
    const modifiers = t.spoon.config.attachModifiers
    t.spoon.config.attachModifiers = MODIFIERS
    try {
        await body()
    } finally {
        t.spoon.keysAllDetach()
        t.spoon.config.attachModifiers = modifiers
    }
}

function saved(t) {
    const body = hs.fs.read(t.spoon.config.attachFile, 0, 0)
    return body ? JSON.parse(body) : null
}

function focusedId() {
    const window = hs.window.focusedWindow()
    return window ? window.id : null
}

// Sends a key, after checking that a test window has the focus. A key the Spoon fails to take
// goes to the focused window, and must never reach one of the user's.
function keySend(t, modifiers, key) {
    const window = hs.window.focusedWindow()
    const title = window ? window.title || "" : ""
    if (!title.startsWith(t.titlePrefix)) {
        t.assert.fail(`not sending ${key}: the focused window is not a test window ("${title}")`)
    }
    hs.eventtap.keyStroke(withFn(modifiers, key), key, null)
}

// Opens two test windows and focuses the second, so that a key for the first has something
// to do.
async function twoOpen(t) {
    const [first, second] = await t.windowsOpen(2)
    const screen = t.screenFrame(first)
    await t.frameSet(first, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
    await t.frameSet(second, { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 })
    second.focus()
    await t.wait(0.4)
    return { first, second }
}

// Stops and starts the copy of the Spoon, as a reload of Hammerspoon 2 does.
async function restart(t) {
    t.spoon.stop()
    t.spoon.start()
    await t.wait(0.3)
}

module.exports = [
    {
        name: "digitAttach attaches a window to a digit, lists it and saves it",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.digitAttach(first, "9"), true, "returned")
            const listed = t.spoon.attachedWindows()["9"]
            t.assert.ok(listed, "attachedWindows does not list 7")
            t.assert.equal(listed.id, first.id, "id")
            t.assert.equal(listed.title, first.title, "title")
            t.assert.equal(listed.alive, true, "alive")
            t.assert.equal(saved(t)["9"].id, first.id, "the saved id")
            t.assert.equal(alerts.join(" | "), `${LABEL}-9\n${first.title}`, "alert")
        })
    },
    {
        name: "digitAttach refuses a digit that is not in config.attachKeys",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.digitAttach(first, "0"), false, "returned")
            t.assert.equal(t.spoon.attachedWindows()["0"], undefined, "0 is listed")
            t.assert.equal(alerts.join(" | "), `Cannot attach to "0"\nuse one of ${t.spoon.config.attachKeys}`, "alert")
        })
    },
    {
        name: "attachedFocus focuses the attached window",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            t.assert.equal(t.spoon.attachedFocus("9"), true, "returned")
            await t.wait(0.4)
            t.assert.equal(focusedId(), first.id, "the focused window")
        })
    },
    {
        name: "the digit's key, pressed, focuses the attached window",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            keySend(t, MODIFIERS, "9")
            await t.wait(0.6)
            t.assert.equal(focusedId(), first.id, "the focused window")
        })
    },
    {
        name: "attachedFocus on the window that already has the focus goes back to the previous window",
        run: (t) => withKeys(t, async () => {
            const { first, second } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            t.spoon.attachedFocus("9")
            await t.wait(0.6)
            t.spoon.attachedFocus("9")
            await t.wait(0.6)
            t.assert.equal(focusedId(), second.id, "the focused window")
        })
    },
    {
        name: "attaching a digit already in use releases the earlier window",
        run: (t) => withKeys(t, async () => {
            const { first, second } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            t.spoon.digitAttach(second, "9")
            const listed = t.spoon.attachedWindows()
            t.assert.equal(Object.keys(listed).join(","), "9", "the digits listed")
            t.assert.equal(listed["9"].id, second.id, "the window on 9")
        })
    },
    {
        name: "keyDetach releases a digit and removes it from the file",
        run: (t) => withKeys(t, async () => {
            const { first, second } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            t.spoon.digitAttach(second, "8")
            t.assert.equal(t.spoon.keyDetach("9"), true, "returned")
            t.assert.equal(Object.keys(t.spoon.attachedWindows()).join(","), "8", "the digits listed")
            t.assert.equal(Object.keys(saved(t)).join(","), "8", "the digits saved")
            t.assert.equal(t.spoon.keyDetach("9"), false, "a second keyDetach returned")
        })
    },
    {
        name: "keysAllDetach releases every digit and empties the file",
        run: (t) => withKeys(t, async () => {
            const { first, second } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            t.spoon.digitAttach(second, "8")
            t.assert.equal(t.spoon.keysAllDetach(), true, "returned")
            t.assert.equal(Object.keys(t.spoon.attachedWindows()).length, 0, "digits still listed")
            t.assert.equal(Object.keys(saved(t)).length, 0, "digits still saved")
        })
    },
    {
        name: "a digit is released when its window closes",
        run: (t) => withKeys(t, async () => {
            const [window] = await t.windowsOpen()
            const title = window.title
            t.spoon.digitAttach(window, "9")
            const alerts = t.alertsCapture()
            await t.windowClose(window)
            const started = Date.now()
            while (t.spoon.attachedWindows()["9"] && Date.now() - started < 3000) await t.wait(0.1)
            t.assert.equal(t.spoon.attachedWindows()["9"], undefined, "9 is still listed")
            t.assert.equal(alerts.join(" | "), `${LABEL}-9 released\n${title} has closed`, "alert")
        })
    },
    {
        name: "start() attaches the saved windows again, as after a reload",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            t.spoon.digitAttach(first, "9")
            const alerts = t.alertsCapture()
            await restart(t)
            const listed = t.spoon.attachedWindows()["9"]
            t.assert.ok(listed, "9 was not attached again")
            t.assert.equal(listed.id, first.id, "id")
            t.assert.equal(alerts.join(" | "), `Window keys restored:\n${LABEL}-9 ${first.title}`, "alert")
        })
    },
    {
        name: "start() attaches a window by its title when its id has changed",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            t.spoon.stop()
            hs.fs.write(t.spoon.config.attachFile,
                JSON.stringify({ 9: { id: 999999999, bundleID: null, title: first.title } }), false)
            const alerts = t.alertsCapture()
            t.spoon.start()
            await t.wait(0.3)
            const listed = t.spoon.attachedWindows()["9"]
            t.assert.ok(listed, "9 was not attached")
            t.assert.equal(listed.id, first.id, "id")
            t.assert.equal(alerts.join(" | "), `Window keys restored:\n${LABEL}-9 ${first.title} (by title)`, "alert")
        })
    },
    {
        name: "start() drops a saved digit whose window is gone",
        run: (t) => withKeys(t, async () => {
            t.spoon.stop()
            hs.fs.write(t.spoon.config.attachFile,
                JSON.stringify({ 9: { id: 999999999, bundleID: null, title: "no such window" } }), false)
            const alerts = t.alertsCapture()
            t.spoon.start()
            await t.wait(0.3)
            t.assert.equal(t.spoon.attachedWindows()["9"], undefined, "9 is listed")
            t.assert.equal(Object.keys(saved(t)).length, 0, "9 is still saved")
            t.assert.equal(alerts.join(" | "), `Windows gone, keys released:\n${LABEL}-9 no such window`, "alert")
        })
    },
    {
        name: "keyToWindowAttach with a key attaches the window to it",
        run: (t) => withKeys(t, async () => {
            const { first } = await twoOpen(t)
            t.assert.equal(t.spoon.keyToWindowAttach(first, "9"), true, "returned")
            t.assert.equal(t.spoon.attachedWindows()["9"].id, first.id, "the window on 9")
        })
    },
    {
        name: "keyToWindowAttach without a key attaches the window to the next digit pressed",
        run: (t) => withKeys(t, async () => {
            const { second } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.keyToWindowAttach(second), true, "returned")
            await t.wait(0.3)
            keySend(t, [], "8")
            await t.wait(0.5)
            const listed = t.spoon.attachedWindows()["8"]
            t.assert.ok(listed, "8 was not attached")
            t.assert.equal(listed.id, second.id, "the window on 8")
            t.assert.equal(alerts[0], `Press a number key for\n${second.title}`, "the first alert")
        })
    },
    {
        name: "keyToWindowAttach stops waiting on Escape, and attaches nothing",
        run: (t) => withKeys(t, async () => {
            const { second } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.spoon.keyToWindowAttach(second)
            await t.wait(0.3)
            keySend(t, [], "escape")
            await t.wait(0.5)
            t.assert.equal(Object.keys(t.spoon.attachedWindows()).length, 0, "a digit was attached")
            t.assert.equal(alerts.length, 1, `alerts after the first: ${alerts.slice(1).join(" | ")}`)
        })
    },
    {
        name: "keyToWindowAttach refuses a key that is not a digit, with an alert",
        run: (t) => withKeys(t, async () => {
            const { second } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.spoon.keyToWindowAttach(second)
            await t.wait(0.3)
            keySend(t, [], "a")
            await t.wait(0.5)
            t.assert.equal(Object.keys(t.spoon.attachedWindows()).length, 0, "a digit was attached")
            t.assert.equal(alerts[1], `Cannot attach to ""\nuse one of ${t.spoon.config.attachKeys}`, "the second alert")
        })
    },
    {
        name: "keyToWindowAttach stops waiting after config.attachKeyWait seconds",
        run: (t) => withKeys(t, async () => {
            const { second } = await twoOpen(t)
            const wait = t.spoon.config.attachKeyWait
            t.spoon.config.attachKeyWait = 1
            try {
                t.spoon.keyToWindowAttach(second)
                await t.wait(1.5)
                // The wait has ended, so this key is not taken by the Spoon. It goes to the
                // test window, which ignores it.
                keySend(t, [], "8")
                await t.wait(0.5)
                t.assert.equal(Object.keys(t.spoon.attachedWindows()).length, 0, "a digit was attached")
            } finally {
                t.spoon.config.attachKeyWait = wait
            }
        })
    }
]
