// Sets up the copy of hs_clipboard-gt under test, and keeps the user's clipboard and clipboard
// history as they were.
//
// Hammerspoon 2 has only the general pasteboard, which is the user's clipboard, so the tests
// write to it. Three things protect the user:
//
// 1. The copy keeps its history and its images in the run's directory.
// 2. The user's own hs_clipboard-gt is paused for the run, so that it records nothing the tests
//    copy. Its ignoredIdentifiers is replaced with a list that matches every type, so that it
//    ignores every change. It keeps running, so the history it holds in memory, which includes
//    the password-like entries it never saves, is untouched. It reads the setting at each
//    change, so the original takes effect again as soon as it is put back.
// 3. The clipboard's text, HTML, RTF, address and image are saved before the run, and put back
//    after it. Anything else on the clipboard, such as files copied in the Finder, is lost.
//    The user agreed to this on 2026-11-23.

// The representations saved, by their type, with the function that reads each.
const SAVED = [
    ["public.utf8-plain-text", () => hs.pasteboard.readString()],
    ["public.html", () => hs.pasteboard.readHTML()],
    ["public.rtf", () => hs.pasteboard.readRTF()],
    ["public.url", () => hs.pasteboard.readURL()]
]

let saved = null
let userIgnored = null

// A list whose includes() is true for every type, which makes hs_clipboard-gt ignore every change.
function everythingIgnored() {
    const list = []
    list.includes = () => true
    return list
}

function userSpoon() {
    return hs.spoons["hs_clipboard-gt"]
}

function clipboardSave() {
    const image = hs.pasteboard.readImage()
    const texts = {}
    for (const [type, read] of SAVED) {
        const value = read()
        if (value !== null && value !== undefined && value !== "") texts[type] = value
    }
    return { image, texts }
}

function clipboardRestore(contents) {
    if (contents.image) {
        hs.pasteboard.writeImage(contents.image)
    } else if (Object.keys(contents.texts).length) {
        hs.pasteboard.writeObjects(contents.texts)
    } else {
        hs.pasteboard.clear()
    }
}

module.exports = {
    setup(spoon, dir) {
        spoon.config.clipboardDir = `${dir}/clipboard`
        spoon.config.historyFile = `${dir}/clipboard/clipboard.json`

        saved = clipboardSave()
        const user = userSpoon()
        if (user) {
            userIgnored = { honor: user.config.honorIgnoredIdentifiers, ids: user.config.ignoredIdentifiers }
            user.config.honorIgnoredIdentifiers = true
            user.config.ignoredIdentifiers = everythingIgnored()
        }
    },

    async teardown() {
        if (saved) clipboardRestore(saved)
        saved = null
        // The user's Spoon notices the restored contents at its next poll, and ignores them
        // while it is still paused. Waiting longer than its interval lets that poll pass first.
        const user = userSpoon()
        const interval = user ? Number(user.config.watchInterval) || 0.8 : 0.8
        await new Promise((resolve) => hs.timer.doAfter(interval * 2 + 0.5, resolve))
        if (user && userIgnored) {
            user.config.honorIgnoredIdentifiers = userIgnored.honor
            user.config.ignoredIdentifiers = userIgnored.ids
        }
        userIgnored = null
    }
}
