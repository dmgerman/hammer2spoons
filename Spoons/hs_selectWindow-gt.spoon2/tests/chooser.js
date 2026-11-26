// Helpers for hs_selectWindow-gt's tests: recording choosers, sending keys to the copy's chooser
// only while it is open, focusing a test window, and listing only the test windows.
//
//   const { choosersCapture, open, openWait, type, key, focus } = require("./chooser.js")
//
// Keys are sent one at a time, each only while the copy's chooser is visible and the user's
// hs_interactive-gt reports a prompt open, which the copy reports for its chooser. A key sent
// after the chooser closed would reach the application behind it.

// Records every chooser created until the test ends: {rows, placeholder, assigned, chooser},
// where assigned holds every property set on the chooser, such as visibleRows and width, and
// chooser is the chooser itself, for reading its state.
// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

function choosersCapture(t) {
    const original = hs.chooser.create
    // Taken before the replacement, so that the function is put back as it was.
    const own = Object.prototype.hasOwnProperty.call(hs.chooser, "create")
    const choosers = []
    hs.chooser.create = function () {
        const real = original.apply(hs.chooser, arguments)
        const record = { rows: [], placeholder: null, assigned: {}, chooser: real }
        choosers.push(record)
        const proxy = new Proxy(real, {
            get(target, property) {
                const value = target[property]
                if (typeof value !== "function") return value
                return (...args) => {
                    if (property === "setChoices") record.rows = args[0]
                    const result = value.apply(target, args)
                    return result === target ? proxy : result
                }
            },
            set(target, property, value) {
                if (property === "placeholder") record.placeholder = value
                record.assigned[property] = value
                target[property] = value
                return true
            }
        })
        return proxy
    }
    t.cleanup(() => { if (own) hs.chooser.create = original; else delete hs.chooser.create })
    return choosers
}

// Opens a chooser with one of the copy's functions. When the test ends, the copy is stopped,
// which closes the chooser if it is still open, and started again.
function open(t, fn) {
    const chooser = fn()
    t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
    return chooser
}

const interactive = () => hs.spoons["hs_interactive-gt"]

function isOpen(chooser) {
    try {
        return Boolean(chooser) && chooser.isVisible && interactive().promptIsOpen()
    } catch (e) {
        return false
    }
}

async function openWait(t, chooser) {
    const started = Date.now()
    while (!isOpen(chooser)) {
        if (Date.now() - started > 3000) t.assert.fail("the chooser did not open")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

async function type(t, chooser, text) {
    for (const character of text) {
        if (!isOpen(chooser)) t.assert.fail(`the chooser closed while "${text}" was typed`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
    await t.wait(0.4)
}

async function key(t, chooser, modifiers, name) {
    if (!isOpen(chooser)) t.assert.fail(`the chooser closed before ${name} was pressed`)
    hs.eventtap.keyStroke(withFn(modifiers, name), name, null)
    await t.wait(0.5)
}

// Focuses a window and waits until hs.windowfilter has had time to report it.
async function focus(t, window) {
    window.focus()
    const started = Date.now()
    while (!hs.window.focusedWindow() || hs.window.focusedWindow().id !== window.id) {
        if (Date.now() - started > 3000) t.assert.fail(`"${window.title}" did not take the focus`)
        await t.wait(0.1)
    }
    await t.wait(0.5)
}

const focusedId = () => { const w = hs.window.focusedWindow(); return w ? w.id : null }
const testRows = (t, record) => record.rows.filter((row) => String(row.text).startsWith(t.titlePrefix))
const titles = (...windows) => windows.map((w) => w.title).join(", ")

// Makes the copy list only the test windows, by restarting it with every other running
// application in skipApplications. Restored, and the copy restarted, when the test ends.
function onlyTestWindows(t) {
    const config = t.spoon.config
    const original = config.skipApplications
    const others = hs.application.runningApplications().map((a) => a.name).filter((name) => name && name !== "osascript")
    t.spoon.stop()
    config.skipApplications = original.concat(others)
    t.spoon.start()
    t.cleanup(() => {
        t.spoon.stop()
        config.skipApplications = original
        t.spoon.start()
    })
}

// Fails the test, before anything is switched, unless `window` is listed by order() with only
// test windows before it. A test calls this before a function that switches without a chooser,
// such as windowPreviousSelect(), which acts on the first window order() lists, or on the first
// of those on the current Space. Without it, a window missing from the list makes that function
// act on a window of the user's: on 2026-11-26, a minimized test window was missing, and
// windowPreviousSelect() moved the user's Chrome window to another screen.
function previousGuard(t, window) {
    const listed = t.spoon.order()
    const at = listed.findIndex((entry) => entry.endsWith(`: ${window.title}`))
    if (at === -1) t.assert.fail(`"${window.title}" is not listed by order(), so nothing was switched`)
    const before = listed.slice(0, at).filter((entry) => !entry.includes(t.titlePrefix))
    if (before.length) t.assert.fail(`windows of the user's come before "${window.title}" in order(), so nothing was switched: ${before.join(" | ")}`)
}

module.exports = { choosersCapture, open, interactive, isOpen, openWait, type, key, focus, focusedId, testRows, titles, onlyTestWindows, previousGuard }
