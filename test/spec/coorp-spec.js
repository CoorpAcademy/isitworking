describe('[Access]', function() {
    it('User should browse', function() {
        return browser.url('https://www.coorpacademy.com/en')
        .getTitle()
        .then(function(title) {
            expect(title).to.equal('Coorpacademy - Online Courses & Corporate training');
            expect(title.length > 0).to.equal(true);
            return;
        });
    });
});
