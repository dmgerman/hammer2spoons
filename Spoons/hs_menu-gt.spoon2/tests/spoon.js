// What hs_menu-gt's tests need of the copy under test, before it starts. The shared harness
// calls setup() with the copy and the run's temporary directory.

module.exports = {
    setup(spoon, dir) {
        // The copy writes its drawn options here, and diskCacheClear() empties this directory,
        // never the user's cache. iconDir is only read, so the user's icons are used as they are.
        spoon.config.cacheDir = `${dir}/cache`
    }
}
