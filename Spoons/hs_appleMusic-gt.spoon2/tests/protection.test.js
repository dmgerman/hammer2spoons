// Tests that the copy's album list is in the run's directory, as tests/spoon.js sets it.

module.exports = [
    {
        name: "the copy's album list is in the run's directory, not the user's",
        run: (t) => {
            t.assert.ok(t.spoon.config.albumListPath.startsWith(t.dir), "albumListPath is outside the run's directory")
            const user = hs.spoons["hs_appleMusic-gt"]
            if (user) t.assert.ok(t.spoon.config.albumListPath !== user.config.albumListPath, "the copy uses the user's album list")
        }
    }
]
