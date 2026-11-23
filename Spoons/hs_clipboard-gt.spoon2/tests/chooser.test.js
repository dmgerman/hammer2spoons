// Tests of the chooser, acting on one entry, and the image preview, as the readme describes them
// under "The chooser", "Acting on one entry" and "The image preview".
//
// The copy creates its chooser in start(), so each test restarts the copy with hs.chooser.create
// recorded, to reach the chooser, its rows and its right-click handler. A right-click on a real
// row needs the row's position, which hs.chooser does not report, so the actions on one entry
// are run through the handler, as the chooser runs them.
//
// The paste actions type with hs.eventtap.keyStrokes() and paste with ⌘V. The tests record both
// instead of sending them, so nothing is typed anywhere. A test window has the focus before the
// chooser opens, so that the window focused afterwards is a test window.

const { copy, imageMake, copyImage, fresh, entries } = require("./clipboard.js")

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
        if (!record.chooser) record.chooser = proxy
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
    hs.eventtap.keyStroke(modifiers, name, null)
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

module.exports = [
    // --- the rows ---
    {
        name: "the chooser lists the history newest first, then the clear and paste on select rows",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "one"))
            await copy(t, text(t, "two"))
            await historyOpen(t, chooser)
            const rows = chooser.rows.map((r) => r.text)
            t.assert.equal(rows.join(" | "), [text(t, "two"), text(t, "one"), "《Clear Clipboard History》", "《Enable Paste-on-select》"].join(" | "))
            await key(t, chooser, [], "escape")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
        }
    },
    {
        name: "a text row shows the first displayMaxLength characters, and typing finds only those",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            const config = t.spoon.config
            const original = config.displayMaxLength
            config.displayMaxLength = 40
            t.cleanup(() => { config.displayMaxLength = original })
            const long = `${text(t, "long")} ${"z".repeat(30)} hiddenword`
            await copy(t, long)
            await copy(t, text(t, "other"))
            await historyOpen(t, chooser)
            t.assert.equal(chooser.rows[1].text, long.slice(0, 40), "the row's text")
            await type(t, chooser, text(t, "long"))
            const found = selected(chooser)
            t.assert.equal(found && found.row, 1, "the row found by its shown text")
            await key(t, chooser, ["cmd"], "a")
            await type(t, chooser, "hiddenword")
            const hidden = selected(chooser)
            t.assert.ok(!hidden || hidden.row !== 1, "the row was found by text beyond displayMaxLength")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "an image row shows the image's size and file",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copyImage(t, imageMake(34, 24))
            await historyOpen(t, chooser)
            const row = chooser.rows[0]
            t.assert.equal(row.text, "34x24 image", "the row's text")
            t.assert.ok(/^\d{8}T\d{6}(-\d+)?\.png$/.test(row.subText), `the row's subText: ${row.subText}`)
            t.assert.ok(row.image, "the row has no image")
            await key(t, chooser, [], "escape")
        }
    },
    // --- selecting ---
    {
        name: "selecting an entry with Return copies it to the clipboard and focuses the window that had the focus",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "chosen"))
            await copy(t, text(t, "newer"))
            const window = await historyOpen(t, chooser)
            await key(t, chooser, [], "down")
            await key(t, chooser, [], "return")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
            t.assert.equal(hs.pasteboard.readString(), text(t, "chosen"), "the clipboard")
            t.assert.equal(hs.window.focusedWindow().id, window.id, "the focused window")
            t.assert.equal(entries(t)[0], text(t, "newer"), "the history's newest entry")
        }
    },
    {
        name: "with paste on select, selecting an entry also pastes it with ⌘V",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "pasted"))
            t.spoon.pasteOnSelectToggle()
            t.cleanup(() => { if (t.spoon.pasteOnSelectIsEnabled()) t.spoon.pasteOnSelectToggle() })
            await historyOpen(t, chooser)
            const pastes = record(t, hs.eventtap, "keyStroke")
            chooser.assigned.onSelect(chooser.rows[0])
            await t.wait(t.spoon.config.pasteDelay + 0.4)
            t.assert.equal(JSON.stringify(pastes), JSON.stringify([[["cmd"], "v"]]), "the keys sent")
            t.spoon.historyHide()
        }
    },
    {
        name: "the clear row empties the history and the clipboard",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "cleared"))
            await historyOpen(t, chooser)
            chooser.assigned.onSelect(chooser.rows.find((r) => r.text === "《Clear Clipboard History》"))
            await t.wait(0.3)
            t.assert.equal(entries(t).length, 0, "entries")
            t.assert.ok(!hs.pasteboard.readString(), "the clipboard still holds text")
            t.spoon.historyHide()
        }
    },
    {
        name: "the paste on select row turns it on and off, and the setting is kept in the history file",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            t.cleanup(() => { if (t.spoon.pasteOnSelectIsEnabled()) t.spoon.pasteOnSelectToggle() })
            await historyOpen(t, chooser)
            chooser.assigned.onSelect(chooser.rows.find((r) => r.text === "《Enable Paste-on-select》"))
            await t.wait(0.3)
            t.assert.equal(t.spoon.pasteOnSelectIsEnabled(), true, "after the row was selected")
            t.assert.equal(JSON.parse(hs.fs.read(t.spoon.config.historyFile, 0, 0)).pasteOnSelect, true, "in the history file")
            t.assert.ok(chooser.rows.some((r) => r.text === "《Disable Paste-on-select》"), "the row now offers to disable it")
            t.spoon.historyHide()
        }
    },
    // --- acting on one entry ---
    {
        name: "the right-click menu offers each action the readme lists, once",
        run: async (t) => {
            const chooser = chooserCapture(t)
            const titles = chooser.assigned.contextMenu.filter((item) => item.title).map((item) => item.title)
            const expected = ["Paste all up to here, tab separated", "Paste all up to here, one per line", "Delete entry",
                "Move entry to top", "Move entry up", "Move entry down", "Invert order above"]
            t.assert.equal(titles.join(" | "), expected.join(" | "))
        }
    },
    {
        name: "Paste all up to here types the entries from that one to the newest, oldest first, skipping images",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "a"))
            await copyImage(t, imageMake(20, 20))
            await copy(t, text(t, "b"))
            await copy(t, text(t, "c"))
            await historyOpen(t, chooser)
            const typed = record(t, hs.eventtap, "keyStrokes")
            rightClick(chooser, 3, "pasteTabs")
            await t.wait(t.spoon.config.pasteDelay + 0.4)
            t.assert.equal(typed.map((c) => c[0]).join(""), `${text(t, "a")}\t${text(t, "b")}\t${text(t, "c")}\t`, "tab separated")
            typed.length = 0
            t.spoon.historyShow()
            await t.wait(0.5)
            rightClick(chooser, 2, "pasteLines")
            await t.wait(t.spoon.config.pasteDelay + 0.4)
            t.assert.equal(typed.map((c) => c[0]).join(""), `${text(t, "b")}\n${text(t, "c")}\n`, "one per line")
        }
    },
    {
        name: "Delete, Move to top, Move up, Move down and Invert order above rearrange the history",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            for (const name of ["e1", "e2", "e3", "e4"]) await copy(t, text(t, name))
            await historyOpen(t, chooser)
            const names = () => entries(t).map((e) => e.split(" ").pop()).join(",")
            t.assert.equal(names(), "e4,e3,e2,e1", "to begin with")
            rightClick(chooser, 3, "moveToTop")
            t.assert.equal(names(), "e1,e4,e3,e2", "after Move entry to top on e1")
            rightClick(chooser, 2, "moveUp")
            t.assert.equal(names(), "e1,e3,e4,e2", "after Move entry up on e3")
            rightClick(chooser, 0, "moveDown")
            t.assert.equal(names(), "e3,e1,e4,e2", "after Move entry down on e1")
            rightClick(chooser, 2, "invert")
            t.assert.equal(names(), "e4,e1,e3,e2", "after Invert order above on e4")
            rightClick(chooser, 1, "delete")
            t.assert.equal(names(), "e4,e3,e2", "after Delete entry on e1")
            t.spoon.historyHide()
        }
    },
    // --- the image preview ---
    {
        name: "selecting an image row draws it beside the chooser, at its own size when small",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "text"))
            await copyImage(t, imageMake(60, 40))
            // Recorded from just before the history opens, which draws the preview at once. A
            // change of focus can make the user's other Spoons draw canvases.
            let canvases = null
            await historyOpen(t, chooser, () => { canvases = t.canvasesCapture() })
            await t.wait(0.6)
            t.assert.ok(canvases.length >= 1, "no preview for the selected image row")
            const preview = canvases[canvases.length - 1]
            const size = HSImage.fromPath(chooser.rows[0].data).size
            t.assert.ok(Math.abs(preview.frame.h - size.h) <= 1, `the preview is ${preview.frame.h} points high, and the image ${size.h}`)
            await key(t, chooser, [], "down")
            await t.wait(0.5)
            let showing = false
            try { showing = preview.canvas.isShowing() } catch (e) { showing = false }
            t.assert.ok(!showing, "the preview is still shown with a text row selected")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "a large image's preview is no higher than previewHeightRatio of the screen",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copyImage(t, imageMake(900, 1400))
            // Recorded from just before the history opens, which draws the preview at once. A
            // change of focus can make the user's other Spoons draw canvases.
            let canvases = null
            await historyOpen(t, chooser, () => { canvases = t.canvasesCapture() })
            await t.wait(0.6)
            const preview = canvases[canvases.length - 1]
            t.assert.ok(preview, "no preview")
            const screen = (hs.screen.main() || hs.screen.primary()).frame
            t.assert.ok(preview.frame.h <= screen.h * t.spoon.config.previewHeightRatio + 1, `the preview is ${preview.frame.h} points high, against ${screen.h * t.spoon.config.previewHeightRatio}`)
            await key(t, chooser, [], "escape")
        }
    }
]
