if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
    window.Q = module.exports;
    exports.chuck = chuck;
    exports.Q = window.Q;
    module.exports = exports;
}

window.chuck = chuck;