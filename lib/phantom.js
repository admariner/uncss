'use strict';

var async   = require('async'),
    fs      = require('fs'),
    phantom = require('node-phantom-simple'),
    _       = require('underscore'),
    /* PhantomJS */
    phantomPath = require('phantomjs').path,
    instances;

function nextFree() {
    return instances
        .sort(function (x, y) {
            return x.pages - y.pages;
        })[0].instance;
}

function init(numThreads, callback) {
    numThreads = Math.min(numThreads, require('os').cpus().length) || 1;
    instances = new Array(numThreads);

    return async.whilst(
        function () { return numThreads > 0; },
        function (done) {
            phantom.create(function (err, ph) {
                if (err) {
                    return done(err);
                }
                instances.push({
                    instance: ph,
                    numPages: 0
                });
                --numThreads;
                return done(null);
            }, {
                phantomPath: phantomPath,
                parameters: {'ignore-ssl-errors': 'yes'}
            });
        },
        callback
    );
}

function exit() {
    return instances.forEach(function (obj) {
        obj.instance.exit();
    });
}

function fromRaw(html, timeout, callback) {
    return nextFree().createPage(function (err, page) {
        if (err) {
            return callback(err);
        }
        page.set('content', html, function () {
            setTimeout(function () {
                return callback(err, page);
            }, timeout);
        });
    });
}

function fromLocal(filename, timeout, callback) {
    return fs.readFile(filename, 'utf-8', function (err, html) {
        if (err) {
            return callback(err);
        }
        return fromRaw(html, timeout, callback);
    });
}

function fromRemote(url, timeout, callback) {
    return nextFree().createPage(function (err, page) {
        if (err) {
            return callback(err);
        }
        page.open(url, function (err, status) {
            if (status !== 'success') {
                return callback(err);
            }
            setTimeout(function () {
                return callback(err, page);
            }, timeout);
        });
    });
}

/**
 * Extract stylesheets' hrefs from dom
 * @param {Array}    dom      List of DOMs loaded by cheerio
 * @param {Object}   options  Options, as passed to UnCSS
 * @param {Function} callback
 */
function getStylesheets(page, options, callback) {
    var media = _.union(['', 'all', 'screen'], options.media);
    return page.evaluate(
        function () {
            /* jshint browser: true */
            return Array.prototype.map.call(document.querySelectorAll('link[rel="stylesheet"]'), function (link) {
                return { href: link.href, media: link.media };
            });
            /* jshint browser: false */
        },
        function (err, stylesheets) {
            stylesheets = _
                .toArray(stylesheets)
                /* Match only specified media attributes, plus defaults */
                .filter(function (sheet) {
                    return media.indexOf(sheet.media) !== -1;
                })
                .map(function (sheet) {
                    return sheet.href;
                });
            return callback(err, stylesheets);
        }
    );
}

function find(page, selector, callback) {
    page.evaluate(
        function (selector) {
            /* jshint browser: true */
            return {
                match: Array.prototype.slice.call(document.querySelectorAll(selector)).length > 0,
            };
            /* jshint browser: false */
        },
        function (err, res) {
            if (err) {
                return callback(err);
            }
            if (res === null) {
                /* Probably a vendor-specific selector, gracefully include it */
                return callback(err, true);
            }
            return callback(err, res.match);
        },
        selector
    );
}

module.exports = {
    exit       : exit,
    init       : init,
    fromLocal  : fromLocal,
    fromRaw    : fromRaw,
    fromRemote : fromRemote,
    find       : find,
    getStylesheets: getStylesheets
};