// A short run that takes the focus from the user's window, for checking by hand that the harness
// gives it back at the end. Run it with tests/run tests/selftest/focus.test.js, with the focus on
// a window of an application that has another window in front on another screen, such as Google
// Chrome, and compare the "Before the tests" and "After restoring" lines it prints.

module.exports = [
    {
        name: "a test window takes the focus",
        run: async (t) => {
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.5)
            const focused = hs.window.focusedWindow()
            t.assert.equal(focused ? focused.id : null, window.id, "the focused window")
        }
    }
]
