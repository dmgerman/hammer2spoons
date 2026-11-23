// Tests of the harness itself, run with make test TESTS="tests/selftest/*.test.js". One test
// fails on purpose, to show that a failure is reported and makes the run fail.

module.exports = [
    {
        name: "a passing test passes",
        run: (t) => t.assert.equal(1 + 1, 2)
    },
    {
        name: "a failing test fails (expected)",
        run: (t) => t.assert.equal(1 + 1, 3, "this test fails on purpose")
    },
    {
        name: "a skipped test is reported as skipped",
        run: (t) => t.skip("skipped on purpose")
    },
    {
        name: "an asynchronous test waits",
        run: async (t) => {
            const started = Date.now()
            await t.wait(0.5)
            t.assert.ok(Date.now() - started >= 400, "wait(0.5) returned too early")
        }
    },
    {
        name: "a test that does not finish times out (expected)",
        timeout: 1,
        run: (t) => t.wait(3)
    },
    {
        name: "a test with a known issue that fails is reported as known",
        knownIssue: "example#1",
        run: (t) => t.assert.fail("fails because of example#1")
    },
    {
        name: "a test with a known issue that passes is reported as fixed (expected)",
        knownIssue: "example#2",
        run: () => {}
    },
    {
        name: "the copy of the Spoon is not the one the configuration loaded",
        run: (t) => {
            t.assert.ok(t.spoon !== hs.spoons["hs_window-gt"], "the tests received the loaded copy")
            t.assert.ok(t.spoon.config.attachFile.startsWith(t.dir), "attachFile is not in the test directory")
        }
    }
]
