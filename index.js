
const fork = require('child_process').fork;
const path = require('path');
const async = require('async');
const _ = require('lodash');
const chalk = require('chalk');
const debug = require('debug')('webdriver.io:runner');
const glob = require('glob');
const Progress = require('./lib/progress');

function upperCaseFirst(string) {
    if (!string) {
        return;
    }
    return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * convert capability from saucelabs to browserstack
 * https://www.browserstack.com/automate/node
 * https://docs.saucelabs.com/reference/platforms-configurator/#/
 * @param  {[type]} capability [description]
 * @return {[type]}            [description]
 */
function sauce2browserstack(capability) {
    /* IOS */
    if (capability.platformName === 'iOS') {
        capability.platform = 'MAC';
        capability.browserName = 'iPhone';
        return capability;
    }

    /* ANDROID */
    if (capability.browserName === 'android') {
        capability.browserName = 'android';
        capability.platform = 'ANDROID';
        if (!capability.device) {
            // hard to convert from sauce device to browserstack device.
            // try remove Emulator
            capability.device = capability.deviceName.replace(' Emulator', '');
        }
        delete capability.deviceName;
        return capability;
    }

    if (capability['screen-resolution']) {
        capability.resolution = capability['screen-resolution'];
    }

    const os = capability.platform.split(' ');

    if (capability.platform.indexOf('Windows') >= 0) {
        capability.os = os[0];
        capability.os_version = os[1];
    }

    if (capability.platform.indexOf('Mac') >= 0) {
        capability.os = 'OS X';
        switch (os[1]) {
            case '10.6':
            capability.os_version = 'Snow Leopard';
            break;
            case '10.7':
            capability.os_version = 'Lion';
            break;
            case '10.8':
            capability.os_version = 'Mountain Lion';
            break;
            case '10.9':
            capability.os_version = 'Mavericks';
            break;
            case '10.10':
            capability.os_version = 'Yosemite';
            break;
            case '10.11':
            capability.os_version = 'El Capitan';
            break;
        }
    }

    if (capability.version) {
        capability.browser_version = capability.version.indexOf('.') >= 0 ?
        capability.version : capability.version + '.0';
    }
    capability.browser = upperCaseFirst(capability.browserName);
    return capability;
}

function launchFork(options, progress, next) {
    debug('starting webdriver with options', options);
    let failedScreenShotUrl;
    let tunnelLogsUrl;
    const desiredCapability = options.desiredCapabilities;
    if (desiredCapability.debugProcess) {
        options.logger.debug('debugging process with args', desiredCapability.debugProcess);
        process.execArgv.push(desiredCapability.debugProcess);
    }
    let webdriverioProcess = fork(path.join(__dirname, '/lib/process'),
            [JSON.stringify(options)],
            {
                env: process.env,
                silent: true,
                cwd: process.cwd()
            });

        let stdout = '';
        let stderr = '';

        webdriverioProcess.on('message', function(message) {
            if (message.progress) {
                if (message.progress.max) {
                    // prepare the progress bar
                    return progress.initBar(desiredCapability.testName,
                        message.progress.index,
                        message.progress.max);
                }
                progress.tick(desiredCapability.testName, message.progress.index);
            }
            if (message.e2e && message.e2e.screenshotUrl) {
                failedScreenShotUrl = message.e2e.screenshotUrl;
            }
            if (message.e2e && message.e2e.tunnelLogsUrl) {
                tunnelLogsUrl = message.e2e.tunnelLogsUrl;
            }
        });

        webdriverioProcess.stdout.on('data', function(data) {
            stdout += data;
            // const lines = getLines(data);
            // lines.forEach(function(line) {
            //     if (!line || line.length === 0) {
            //         return;
            //     }
            //     stdout.push(chalk.reset(line));
            // });
        });

        webdriverioProcess.stderr.on('data', function(data) {
            stderr += data;
            // const lines = getLines(data);
            // lines.forEach(function(line) {
            //     if (!line || line.length === 0) {
            //         return;
            //     }
            //     stderr.push(chalk.reset(line));
            // });
        });

        webdriverioProcess.on('close', function(code) {
            const testNameFormated = '[' + desiredCapability.testName + ']';
            // stdout.forEach(function(line) {
            if (stdout) {
                options.logger.info(testNameFormated + ' RESULT');
                options.logger.info(chalk.reset(stdout));
            }
            // });
            // stderr.forEach(function(line) {
            if (stderr) {
                options.logger.info(chalk.bgWhite(testNameFormated + ' ERROR'));
                options.logger.info(chalk.reset(stderr));
            }
            // });
            switch (code) {
                // error code when reached browserstack limit
                // Problem: x (currently 10) sessions are currently being used.
                // Please upgrade to add more parallel sessions
                case 3:
                    // restart the test
                    options.logger.error(testNameFormated + ' failed, test queued, retrying in 1 minute');
                    return setTimeout(function() {
                        webdriverioProcess = launchFork(options, progress, next);
                    },
                    60 * 1000);
                // Automate daily limit reached for your plan
                case 4:
                    options.logger.error('Daily limit reached, exiting');
                    return next(new Error('Daily limit reached, exiting ' + code));
                case 0:
                default: {
                    let err;
                    if (failedScreenShotUrl) {
                        options.logger.warn('You can find last e2e screenshot here:', failedScreenShotUrl);
                    }
                    if (tunnelLogsUrl) {
                        options.logger.warn('You can find last e2e tunnel logs here:', tunnelLogsUrl);
                    }
                    if (code > 0) {
                        err = new Error('ps process exited with code ' + code);
                    }
                    return next(err);
                }
            }
        });
    return webdriverioProcess;
    }

function globalize(_patterns) {
    let patterns = _patterns;
    if (Array.isArray(_patterns) === false) {
        patterns = [_patterns];
    }
    return _.flatten(_.map(patterns, function(pattern) {
        return glob.sync(pattern);
    }));
}

function runner(_options, done) {
    const options = _.extend({
        reporter: 'spec',
        ui: 'bdd',
        slow: 75,
        bail: false,
        grep: null,
        timeout: 1000000,
        updateSauceJob: false,
        output: null,
        quiet: false,
        nospawn: false,
        timeoutsAsyncScript: 1000,
        timeoutsPageLoad: 7000,
        timeoutsImplicitWait: 5000,
        maxSessions: Infinity,
        logger: console,
        tests: './test/**/*Spec.js',
        commandHelpers: './test/**/*Helper.js',
        desiredCapabilities: [],
        deprecationWarnings: false
    }, _options);
    const logger = options.logger;
    logger.debug = logger.debug || logger.log || logger.info;
    debug(options);

    // used to know position in muti browser test
    let capabilitiesIndex = 0;

    const testFiles = globalize(options.tests);
    debug('testFiles', testFiles);
    const commandHelpersFiles = globalize(options.commandHelpers);
    debug('commandHelpersFiles', commandHelpersFiles);

    // const capabilitiesDone = 0;
    const forksCache = [];
    const desiredCapabilities = _.clone(options.desiredCapabilities);

    const progress = new Progress(desiredCapabilities.length);

    desiredCapabilities.forEach(function(desiredCapability) {
        desiredCapability.index = capabilitiesIndex;
        const testNameParts = [];
        testNameParts.push(desiredCapability.browserName);
        testNameParts.push(desiredCapability.platformVersion || desiredCapability.version);
        testNameParts.push(desiredCapability.platformName || desiredCapability.platform);
        const testName = _.without(testNameParts, '', undefined, null).join(' ');
        desiredCapability.testName = testName;
        capabilitiesIndex++;
    });

    debug('starting async running', desiredCapabilities.length, `max ${options.maxSessions}`);

    async.eachLimit(desiredCapabilities, options.maxSessions, function(_item, next) {
        let item = _item;
        debug('Capabilities >>>>>', item);
        const desiredCapability = _.clone(options);
        // flat to one capability for webdriver.io
        if (options.host && options.host.indexOf('browserstack') >= 0) {
            item = sauce2browserstack(item);
        }
        desiredCapability.index = item.index;
        // because tunnel identifier could be set on item to be unique (browserstack need)
        desiredCapability['browserstack.localIdentifier'] = desiredCapability['browserstack.localIdentifier'] ||
            item['browserstack.localIdentifier'];
        desiredCapability.desiredCapabilities = item;
        desiredCapability.tests = testFiles;
        desiredCapability.commandHelpers = commandHelpersFiles;
        const forked = launchFork(desiredCapability, progress, next);
        forksCache.push(forked);
        debug('spawing fork with pid : ', forked.pid);
    }, function(_err) {
        let err = _err;
        progress.destroy();
        if (err) {
            logger.error(err);
            if (err.message === 'Daily limit reached, exiting 4') {
                // don't throw an error
                err = null;
            }
        }
        forksCache.forEach(function(forked) {
            debug('sending SIGINT signal to ', forked.pid);
            forked.kill('SIGINT');
        });
        debug('wait a little while cleaning forks');
        setTimeout(function() {
            process.nextTick(process.nextTick.bind(process, done.bind(null, err)));
        }, 1000);
    });
}

module.exports = runner;
