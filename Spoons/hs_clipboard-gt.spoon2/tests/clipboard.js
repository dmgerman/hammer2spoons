// Helpers for hs_clipboard-gt's tests: copying test text and images, and waiting until the copy
// has read them.
//
//   const { copy, copyImage, entries, imageMake } = require("./clipboard.js")
//
// Every text a test copies starts with "clipboard test", so it cannot be mistaken for the user's.

// The longest wait for the copy to read a change: two readings of the clipboard, and a margin.
// The clipboard is read at the interval of Hammerspoon 2's one clipboard watcher, which is set
// when the watcher starts, so the user's hs_clipboard-gt has already set it.
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

module.exports = { settle, copy, copyWith, imageMake, copyImage, fresh, entries, texts, images }
