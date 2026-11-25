// Tests of the clipboard menu, the functions, start() and stop(), as the readme describes them
// under "The clipboard menu" and "Functions".
//
// menuShow() shows the menu through the user's hs_menu-gt, and showing it there would change
// where the user's on-screen menu reopens. The tests therefore record that call instead of
// making it, and press the menu's options through a session of the user's hs_menu-gt with a test
// presenter, which shows nothing and does not touch that position.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const { copy, fresh, entries, text, interactive, chooserCapture, record, historyOpen, key } = require("./clipboard.js")

const MODIFIERS = ["ctrl", "alt", "shift"]
const PASSWORD = "Zq7#vK2$mP9!xR4w"

// Replaces obj[name] until the test ends, recording each call and passing it on.
function spy(t, obj, name) {
    const original = obj[name]
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) {
        calls.push(args)
        return original.apply(obj, args)
    }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

// A session of the user's hs_menu-gt on a presenter that shows nothing.
function menuSession(t) {
    const presenter = { progressive: false, canHide: true, present() {}, close() {} }
    const session = hs.spoons["hs_menu-gt"].sessionOpen(t.spoon.menu, presenter, { name: "Clipboard" })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

const indexOf = (session, letter) => session.letters().indexOf(letter)

module.exports = [
    // --- the menu ---
    {
        name: "the menu has History, Paste-on-select, Drop last and Clear all, lettered v, s, d and c",
        run: (t) => {
            const session = menuSession(t)
            t.assert.equal(session.buttons().map((b) => b.label).join(", "), "History, Paste-on-select, Drop last, Clear all", "the options")
            t.assert.equal(session.letters().join(","), "v,s,d,c", "the letters")
        }
    },
    {
        name: "menuShow() shows the menu with hs_menu-gt",
        run: (t) => {
            const menuSpoon = hs.spoons["hs_menu-gt"]
            const original = menuSpoon.onScreenShow
            const own = Object.prototype.hasOwnProperty.call(menuSpoon, "onScreenShow")
            const calls = []
            menuSpoon.onScreenShow = (...args) => { calls.push(args) }
            t.cleanup(() => { if (own) menuSpoon.onScreenShow = original; else delete menuSpoon.onScreenShow })
            t.spoon.menuShow()
            t.assert.equal(calls.length, 1, "onScreenShow() calls")
            t.assert.equal(calls[0][0], t.spoon.menu, "the menu shown")
        }
    },
    {
        name: "Drop last removes the newest entry, Paste-on-select toggles it, and both keep the menu open",
        run: async (t) => {
            fresh(t)
            t.cleanup(() => { if (t.spoon.pasteOnSelectIsEnabled()) t.spoon.pasteOnSelectToggle() })
            await copy(t, text(t, "older"))
            await copy(t, text(t, "newer"))
            const session = menuSession(t)
            session.activate(indexOf(session, "d"))
            t.assert.equal(entries(t).join(" | "), text(t, "older"), "the history after Drop last")
            t.assert.ok(!session.isClosed(), "the menu closed after Drop last")
            session.activate(indexOf(session, "s"))
            t.assert.equal(t.spoon.pasteOnSelectIsEnabled(), true, "paste on select after Paste-on-select")
            t.assert.ok(!session.isClosed(), "the menu closed after Paste-on-select")
        }
    },
    {
        name: "Clear all empties the history and keeps the menu open, and History opens the chooser and closes the menu",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, text(t, "cleared"))
            const session = menuSession(t)
            session.activate(indexOf(session, "c"))
            t.assert.equal(entries(t).length, 0, "entries after Clear all")
            t.assert.ok(!session.isClosed(), "the menu closed after Clear all")
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            session.activate(indexOf(session, "v"))
            await t.wait(0.6)
            t.assert.ok(session.isClosed(), "the menu is still open after History")
            t.assert.ok(chooser.chooser.isVisible, "the chooser did not open")
            t.spoon.historyHide()
        }
    },
    // --- the functions ---
    {
        name: "historyShow(), historyHide() and historyToggle() open and close the chooser",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await historyOpen(t, chooser)
            t.assert.ok(interactive().promptIsOpen(), "the open chooser is not reported as a prompt")
            t.spoon.historyHide()
            await t.wait(0.4)
            t.assert.ok(!chooser.chooser.isVisible, "open after historyHide()")
            t.assert.ok(!interactive().promptIsOpen(), "a prompt is still reported open")
            t.spoon.historyToggle()
            await t.wait(0.4)
            t.assert.ok(chooser.chooser.isVisible, "closed after the first historyToggle()")
            t.spoon.historyToggle()
            await t.wait(0.4)
            t.assert.ok(!chooser.chooser.isVisible, "open after the second historyToggle()")
        }
    },
    {
        name: "the functions that change the history return the Spoon, and the row functions act on that row",
        run: async (t) => {
            fresh(t)
            for (const name of ["r1", "r2", "r3"]) await copy(t, text(t, name))
            const names = () => entries(t).map((e) => e.split(" ").pop()).join(",")
            t.assert.equal(t.spoon.entryToTopMove(2), t.spoon, "entryToTopMove()")
            t.assert.equal(names(), "r1,r3,r2", "after entryToTopMove(2)")
            t.assert.equal(t.spoon.entryDownMove(0), t.spoon, "entryDownMove()")
            t.assert.equal(names(), "r3,r1,r2", "after entryDownMove(0)")
            t.assert.equal(t.spoon.entryUpMove(2), t.spoon, "entryUpMove()")
            t.assert.equal(names(), "r3,r2,r1", "after entryUpMove(2)")
            t.assert.equal(t.spoon.entriesInvert(1), t.spoon, "entriesInvert()")
            t.assert.equal(names(), "r2,r3,r1", "after entriesInvert(1)")
            t.assert.equal(t.spoon.entryDelete(1), t.spoon, "entryDelete()")
            t.assert.equal(names(), "r2,r1", "after entryDelete(1)")
            t.assert.equal(t.spoon.historyLastDelete(), t.spoon, "historyLastDelete()")
            t.assert.equal(names(), "r1", "after historyLastDelete()")
            t.assert.equal(t.spoon.historyClear(), t.spoon, "historyClear()")
            t.assert.equal(entries(t).length, 0, "after historyClear()")
        }
    },
    {
        name: "entriesPaste(row, delimiter) types the entries from row to the newest, oldest first",
        run: async (t) => {
            fresh(t)
            for (const name of ["p1", "p2", "p3"]) await copy(t, text(t, name))
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            const typed = record(t, hs.eventtap, "keyStrokes")
            t.spoon.entriesPaste(1, ";")
            await t.wait(t.spoon.config.pasteDelay + 0.4)
            t.assert.equal(typed.map((c) => c[0]).join(""), `${text(t, "p2")};${text(t, "p3")};`)
        }
    },
    {
        name: "pasteOnSelectToggle() returns whether paste on select is now on",
        run: (t) => {
            const before = t.spoon.pasteOnSelectIsEnabled()
            t.cleanup(() => { if (t.spoon.pasteOnSelectIsEnabled() !== before) t.spoon.pasteOnSelectToggle() })
            t.assert.equal(t.spoon.pasteOnSelectToggle(), !before, "the first toggle")
            t.assert.equal(t.spoon.pasteOnSelectIsEnabled(), !before, "pasteOnSelectIsEnabled()")
            t.assert.equal(t.spoon.pasteOnSelectToggle(), before, "the second toggle")
        }
    },
    {
        name: "currentPasswordRevealToggle() and passwordsRevealToggle() reveal masked entries",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, PASSWORD)
            await historyOpen(t, chooser)
            t.spoon.currentPasswordRevealToggle()
            t.assert.equal(chooser.rows[0].text, PASSWORD, "after currentPasswordRevealToggle()")
            t.spoon.currentPasswordRevealToggle()
            t.spoon.passwordsRevealToggle()
            t.assert.equal(chooser.rows[0].text, PASSWORD, "after passwordsRevealToggle()")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "bindHotkeys() binds historyShow, historyToggle and menuShow, releases the keys of a first call, and refuses another name",
        run: async (t) => {
            const chooser = chooserCapture(t)
            t.cleanup(() => t.spoon.bindHotkeys({}))
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            t.spoon.bindHotkeys({ historyShow: [MODIFIERS, "f17"] })
            hs.eventtap.keyStroke(withFn(MODIFIERS, "f17"), "f17", null)
            await t.wait(0.6)
            t.assert.ok(chooser.chooser.isVisible, "7 did not open the chooser")
            await key(t, chooser, [], "escape")
            t.spoon.bindHotkeys({ historyToggle: [MODIFIERS, "f18"] })
            hs.eventtap.keyStroke(withFn(MODIFIERS, "f17"), "f17", null)
            await t.wait(0.6)
            t.assert.ok(!chooser.chooser.isVisible, "7 still opens the chooser")
            let error = null
            try { t.spoon.bindHotkeys({ historyClear: [MODIFIERS, "f19"] }) } catch (e) { error = e }
            t.assert.ok(error && error.message.includes("historyClear"), `the error: ${error && error.message}`)
            t.spoon.bindHotkeys({ menuShow: [MODIFIERS, "f19"] })
        }
    },
    // --- start and stop ---
    {
        name: "start() adds the menu bar item, whose click toggles the chooser, and stop() removes it and stops recording",
        run: async (t) => {
            const chooser = chooserCapture(t)
            // Records each menu bar item created, and the click callback given to it.
            const items = []
            const original = hs.menubar.create
            const own = Object.prototype.hasOwnProperty.call(hs.menubar, "create")
            hs.menubar.create = function () {
                const real = original.apply(hs.menubar, arguments)
                const item = { real, click: null }
                items.push(item)
                return new Proxy(real, {
                    get(target, property) {
                        const value = target[property]
                        if (typeof value !== "function") return value
                        return (...args) => {
                            if (property === "setClickCallback") item.click = args[0]
                            return value.apply(target, args)
                        }
                    },
                    set(target, property, value) { target[property] = value; return true }
                })
            }
            t.cleanup(() => { if (own) hs.menubar.create = original; else delete hs.menubar.create })
            t.spoon.stop()
            t.spoon.start()
            t.assert.equal(items.length, 1, "menu bar items created by start()")
            t.assert.equal(items[0].real.title, t.spoon.config.menubarTitle, "the item's title")
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            items[0].click()
            await t.wait(0.5)
            t.assert.ok(chooser.chooser.isVisible, "the first click did not open the chooser")
            items[0].click()
            await t.wait(0.5)
            t.assert.ok(!chooser.chooser.isVisible, "the second click did not close the chooser")
            t.spoon.stop()
            fresh(t)
            hs.pasteboard.writeString(text(t, "after stop"))
            await t.wait((Number(hs.pasteboard.watcherInterval) || 0.8) * 2 + 0.5)
            t.assert.ok(!t.spoon.historyEntries().includes(text(t, "after stop")), "recorded after stop()")
            t.spoon.start()
        }
    },
    {
        name: "with menubarShow false, start() adds no menu bar item",
        run: (t) => {
            const created = spy(t, hs.menubar, "create")
            const original = t.spoon.config.menubarShow
            t.cleanup(() => { t.spoon.stop(); t.spoon.config.menubarShow = original; t.spoon.start() })
            t.spoon.stop()
            t.spoon.config.menubarShow = false
            t.spoon.start()
            t.assert.equal(created.length, 0, "menu bar items created")
        }
    },
    {
        name: "start() throws, naming the Spoon, when hs_interactive-gt or hs_menu-gt is not loaded",
        run: (t) => {
            t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
            for (const name of ["hs_interactive-gt", "hs_menu-gt"]) {
                t.spoon.stop()
                // Taken away and put back within this one synchronous call, so nothing else runs
                // while the user's Spoon is missing.
                const descriptor = Object.getOwnPropertyDescriptor(hs.spoons, name)
                let error = null
                try {
                    hs.spoons[name] = undefined
                    t.spoon.start()
                } catch (e) {
                    error = e
                } finally {
                    Object.defineProperty(hs.spoons, name, descriptor)
                }
                t.assert.ok(error && error.message.includes(name), `${name}: ${error ? error.message : "no error"}`)
            }
        }
    }
]
