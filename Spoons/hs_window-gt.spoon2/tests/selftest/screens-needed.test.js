// A test of the harness: a file that needs more screens than are connected is skipped as a
// whole. The test would fail if it ran, so a run with fewer screens must report it as skipped.
// With that many screens connected it runs and fails, which is expected.

module.exports = {
    screens: 9,
    tests: [
        {
            name: "a file that needs more screens than are connected is skipped",
            run: (t) => t.assert.fail("this test ran, but the file needs 9 screens")
        }
    ]
}
