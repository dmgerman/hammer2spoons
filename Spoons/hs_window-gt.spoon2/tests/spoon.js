// What hs_window-gt's tests need of the copy under test, before it starts. The shared harness
// calls setup() with the copy and the run's temporary directory.

module.exports = {
    setup(spoon, dir) {
        // The copy writes its attached keys and its screenshots here, never where the user's do.
        spoon.config.attachFile = `${dir}/window-keys.json`
        spoon.config.screenshotDir = dir
    }
}
