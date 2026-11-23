// Tests that the protections set up by tests/spoon.js work: the copy records what the tests copy,
// in the run's directory, and the user's own hs_clipboard-gt, paused for the run, does not. The
// messages never show an entry of the user's history.

const user = () => hs.spoons["hs_clipboard-gt"]

module.exports = [
    {
        name: "the copy keeps its history and images in the run's directory",
        run: (t) => {
            t.assert.ok(t.spoon.config.historyFile.startsWith(t.dir), "historyFile is outside the run's directory")
            t.assert.ok(t.spoon.config.clipboardDir.startsWith(t.dir), "clipboardDir is outside the run's directory")
            t.assert.ok(t.spoon.config.historyFile !== user().config.historyFile, "the copy uses the user's history file")
        }
    },
    {
        name: "text copied during a run is recorded by the copy and not by the user's hs_clipboard-gt",
        run: async (t) => {
            const text = `clipboard test ${t.runId} protection`
            const before = user().historyEntries().length
            hs.pasteboard.writeString(text)
            await t.wait(t.spoon.config.watchInterval * 2 + 0.4)
            t.assert.equal(t.spoon.historyEntries()[0], text, "the copy's newest entry")
            t.assert.ok(!user().historyEntries().includes(text), "the user's history recorded the text")
            t.assert.equal(user().historyEntries().length, before, "entries in the user's history")
        }
    }
]
