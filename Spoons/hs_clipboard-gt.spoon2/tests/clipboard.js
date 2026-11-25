// Helpers for hs_clipboard-gt's tests: copying test text and images, and waiting until the copy
// has read them.
//
//   const { copy, copyImage, entries, imageMake } = require("./clipboard.js")
//
// It also opens the copy's chooser and sends keys to it, each only while the chooser is visible
// and a prompt is reported open, and records keys instead of sending them.
//
// Every text a test copies starts with "clipboard test", so it cannot be mistaken for the user's.

// The longest wait for the copy to read a change: two readings of the clipboard, and a margin.
// The clipboard is read at the interval of Hammerspoon 2's one clipboard watcher, which is set
// when the watcher starts, so the user's hs_clipboard-gt has already set it.
// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const settle = () => (Number(hs.pasteboard.watcherInterval) || 0.8) * 2 + 0.5

// Resolves once the copy's history has changed, or after settle() seconds when it does not.
async function changed(t, before) {
    const started = Date.now()
    while (Date.now() - started < settle() * 1000) {
        if (JSON.stringify(t.spoon.historyEntries()) !== before) {
            // Lets the rest of the copy's handling, such as saving the history, finish.
            await t.wait(0.1)
            return
        }
        await t.wait(0.05)
    }
}

async function copy(t, text) {
    const before = JSON.stringify(t.spoon.historyEntries())
    hs.pasteboard.writeString(text)
    await changed(t, before)
}

// Copies with extra pasteboard types, such as a marker of a private copy.
async function copyWith(t, text, types) {
    const before = JSON.stringify(t.spoon.historyEntries())
    hs.pasteboard.writeObjects(Object.assign({ "public.utf8-plain-text": text }, types))
    await changed(t, before)
}

// An image of one colour, drawn offscreen.
function imageMake(w, h, red = 1) {
    const canvas = hs.canvas.create({ x: 0, y: 0, w, h })
    canvas.appendElements([{ type: "rectangle", action: "fill", fillColor: { red, green: 0.2, blue: 0.4, alpha: 1 }, frame: { x: 0, y: 0, w, h } }])
    const image = canvas.imageFromCanvas()
    canvas.destroy()
    return image
}

async function copyImage(t, image) {
    const before = JSON.stringify(t.spoon.historyEntries())
    hs.pasteboard.writeImage(image)
    await changed(t, before)
}

// The copy's history, emptied when a test starts.
function fresh(t) {
    t.spoon.historyClear()
}

const entries = (t) => t.spoon.historyEntries()
const texts = (t) => entries(t).filter((e) => !e.startsWith("[image "))
const images = (t) => entries(t).filter((e) => e.startsWith("[image "))

const text = (t, name) => `clipboard test ${t.runId} ${name}`
const interactive = () => hs.spoons["hs_interactive-gt"]

// Restarts the copy with hs.chooser.create recorded, and resolves to the copy's chooser, as
// {chooser, record}, where record holds the rows given to setChoices() and every property set.
function chooserCapture(t) {
    const original = hs.chooser.create
    const own = Object.prototype.hasOwnProperty.call(hs.chooser, "create")
    const record = { rows: [], assigned: {}, chooser: null }
    hs.chooser.create = function () {
        const real = original.apply(hs.chooser, arguments)
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
                record.assigned[property] = value
                target[property] = value
                return true
            }
        })
        // The latest, since a test that restarts the copy makes a new one.
        record.chooser = proxy
        return proxy
    }
    t.cleanup(() => { if (own) hs.chooser.create = original; else delete hs.chooser.create })
    t.spoon.stop()
    t.spoon.start()
    t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
    return record
}

// Replaces obj[name] until the test ends, recording each call instead of making it.
function record(t, obj, name) {
    const original = obj[name]
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) { calls.push(args) }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

function isOpen(record) {
    try {
        return Boolean(record.chooser) && record.chooser.isVisible && interactive().promptIsOpen()
    } catch (e) {
        return false
    }
}

// Opens the history with a test window focused, and resolves once the chooser is on screen.
// beforeShow, when given, runs once the window has the focus, just before the history opens.
async function historyOpen(t, record, beforeShow) {
    const [window] = await t.windowsOpen(1)
    window.focus()
    await t.wait(0.4)
    if (beforeShow) beforeShow()
    t.spoon.historyShow()
    const started = Date.now()
    while (!isOpen(record)) {
        if (Date.now() - started > 3000) t.assert.fail("the history did not open")
        await t.wait(0.05)
    }
    await t.wait(0.3)
    return window
}

async function key(t, record, modifiers, name) {
    if (!isOpen(record)) t.assert.fail(`the history closed before ${name} was pressed`)
    hs.eventtap.keyStroke(withFn(modifiers, name), name, null)
    await t.wait(0.5)
}

async function type(t, record, value) {
    for (const character of value) {
        if (!isOpen(record)) t.assert.fail(`the history closed while "${value}" was typed`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
    await t.wait(0.4)
}

const selected = (record) => record.chooser.selectedRowContents(record.chooser.selectedRow)
const menuItem = (record, id) => record.assigned.contextMenu.find((item) => item.id === id)
const rightClick = (record, row, id) => record.assigned.onContextMenuSelect(record.rows.find((r) => r.row === row), menuItem(record, id))

module.exports = { settle, copy, copyWith, imageMake, copyImage, fresh, entries, texts, images, text, interactive,
    chooserCapture, record, isOpen, historyOpen, key, type, selected, menuItem, rightClick }
