// Points the album list of the copy of hs_appleMusic-gt under test into the run's directory, so
// that the user's albums.txt is never read or written by the tests.

module.exports = {
    setup(spoon, dir) {
        spoon.config.albumListPath = `${dir}/albums.txt`
    }
}
