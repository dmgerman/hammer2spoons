// The configuration of the install test: it installs the published Spoons from GitHub, as a user
// would. Every file a Spoon writes goes to /tmp/hs2-install-test. readme.org beside this file
// gives the steps, which set the user's own init.js and Spoons/ aside while this runs.
console.log("install test: init.js")
hs.ipc.start()

const SOURCE = "dmgerman/hammer2spoons"
const DIR = "/tmp/hs2-install-test"
const result = { steps: [], errors: [] }
globalThis.installTest = result

function note(step) {
    result.steps.push(step)
    console.log(`install test: ${step}`)
}

async function run() {
    // 1. A Spoon installed alone, without the Spoons it requires: its start() must throw an error
    //    naming one of them.
    try {
        await hs.spoons.use("hs_countdown-gt", { source: SOURCE, start: true })
        note("countdown alone: start() did not throw")
    } catch (e) {
        note(`countdown alone: start() threw: ${e.message}`)
    }

    // 2. Every published Spoon, in the order the readme gives, with its files in DIR.
    const spoons = [
        // hs_interactive-gt has no start(), and use() refuses the start option for it.
        ["hs_interactive-gt", { start: false }],
        ["hs_windowfilter-gt", {}],
        ["hs_menu-gt", { config: { cacheDir: `${DIR}/menu-cache` } }],
        ["hs_window-gt", { config: { attachFile: `${DIR}/window-keys.json` }, hotkeys: { menuShow: [["alt"], "w"] } }],
        ["hs_selectWindow-gt", { hotkeys: { windowSelect: [["alt"], "b"] } }],
        ["hs_clipboard-gt", { config: { clipboardDir: `${DIR}/clipboard`, historyFile: `${DIR}/clipboard/clipboard.json` } }],
        ["hs_countdown-gt", { hotkeys: { menuShow: [["cmd", "ctrl", "alt"], "t"] } }],
        ["hs_appleMusic-gt", { config: { albumListPath: `${DIR}/albums.txt` } }]
    ]
    for (const [name, options] of spoons) {
        try {
            const settings = Object.assign({ source: SOURCE, start: true }, options)
            if (settings.start === false) delete settings.start
            const spoon = await hs.spoons.use(name, settings)
            note(`${name}: ${spoon ? `loaded ${spoon.version}` : "null"}`)
        } catch (e) {
            result.errors.push(`${name}: ${e.message}`)
            note(`${name}: failed: ${e.message}`)
        }
    }
    const interactive = hs.spoons["hs_interactive-gt"]
    if (interactive) interactive.keySet(["cmd", "ctrl", "alt"], "x", "commands-execute")
    note("done")
}

run()
