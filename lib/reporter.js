
module.exports = function reporter(runner, output) {
    this.output = output;

    if (!runner) {
        return;
    }
    this.stats = {
        suites: 0, tests: 0, passes: 0, pending: 0, failures: 0, total: runner.total
    };

    // notify new test
    output({
        progress: {
            max: this.stats.total,
            index: runner.index
        }
    });

    const failures = [];

    runner.on('start', function() {
        this.stats.start = new Date();
    }.bind(this));

    runner.on('suite', function(_suite) {
        this.stats.suites = this.stats.suites || 0;
        _suite.root || this.stats.suites++;
    }.bind(this));

    runner.on('test end', function() {
        this.stats.tests = this.stats.tests || 0;
        this.stats.tests++;
        output({
            progress: {
                index: runner.index
            }
        });
    }.bind(this));

    runner.on('pass', function(_test) {
        this.stats.passes = this.stats.passes || 0;

        const medium = _test.slow() / 2;
        if (_test.duration > _test.slow()) {
            _test.speed = 'slow';
        } else {
            _test.speed = _test.duration > medium ? 'medium' : 'fast';
        }

        this.stats.passes++;
    }.bind(this));

    runner.on('fail', function(_test, err) {
        this.stats.failures = this.stats.failures || 0;
        this.stats.failures++;
        _test.err = err;
        failures.push(_test);
    }.bind(this));

    runner.on('end', function() {
        this.stats.end = new Date();
        this.stats.duration = new Date() - this.stats.start;
    }.bind(this));

    runner.on('pending', function() {
        this.stats.pending++;
    }.bind(this));
};
