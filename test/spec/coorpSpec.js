'use strict';

var assert = require('assert');

describe('[Access]', function() {
    it('User should browse', function() {
        return browser.url('https://www.coorpacademy.com')
        .getTitle()
        .then(function(title) {
            assert.equal(title, 'Formation en ligne sur le digital pour entreprises et particuliers');
        });
    });
});
