'use strict';

var assert = require('assert');

describe('[Access]', function() {
    it('User should browse', function() {
        return browser.url('https://www.coorpacademy.com')
        .getTitle()
        .then(function(title) {
            assert.ok(title.indexOf('Coorpacademy') >= 0, 'can\'t find Coorpacademy in title:' + title);
        });
    });
});
