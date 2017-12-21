
const path = require('path');
const Mocha = require('mocha');
const _ = require('lodash');
const Promise = require('bluebird');
const webdriverio = require('webdriverio');
const chai = require('chai');
const request = Promise.promisify(require('request'));

const args = process.argv;
const capabilities = JSON.parse(args[2]);
const mochaOptions = capabilities;
const testFiles = capabilities.tests;
const commandHelpersFiles = capabilities.commandHelpers;
const debug = require('debug')('webdriver.io:process');
const Reporter = require('./reporter');

function tryRequire(moduleName) {
    try {
      // eslint-disable-next-line import/no-dynamic-require
      return require(moduleName);
    }
    catch (er) {
        return null;
    }
}

const SauceLabs = tryRequire('saucelabs');
const bugsnag = tryRequire('bugsnag');
const wdclient = webdriverio.remote(capabilities);
let exitCode = 0;

if (SauceLabs) {
    Promise.promisifyAll(SauceLabs.prototype);
}

if (bugsnag && process.env.BUGSNAG_SAUCELAB) {
    bugsnag.register(process.env.BUGSNAG_SAUCELAB, _.defaultsDeep(capabilities.bugsnag, {
        packageJSON: '../../../../package.json',
        releaseStage: process.env.NODE_ENV || 'development',
        autoNotifyUnhandledRejection: false,
        autoNotify: false
    }));
}

function output(msg) {
    process.send(msg);
}

function getSaucelab(sauceLabsId) {
    if (!sauceLabsId) return;
    return {
        saucelabs: sauceLabsId,
        saucelabs_url: 'https://saucelabs.com/beta/tests/' + sauceLabsId
    };
}

function getTravis(travisId) {
    if (!travisId) return;
    return {
        travis: travisId,
        travis_url: 'https://travis-ci.com/CoorpAcademy/coorpacademy/jobs/' + travisId
    };
}

function getFullTitle(_test) {
    if (_test.parent)
        return [
            getFullTitle(_test.parent),
            _test.title
        ].join(' ').trim();
    return _test.title;
}

function parseTest(_test) {
    return _.assign(
        _.pick(_test, ['title', 'file', 'body']),
        _test && _test.parent ? {
            parent: parseTest(_test.parent)
        } : null
    );
}

function notify(error, _test) {
    const options = {
        userId: [
            capabilities.desiredCapabilities.browserName,
            capabilities.desiredCapabilities.version,
            capabilities.desiredCapabilities.platform
        ].join(' ').trim(),
        groupingHash: error.message,
        metaData: _.assign(
            {
                brand: process.env.NODE_BRAND,
                browser: _.pick(capabilities.desiredCapabilities, ['browserName', 'version', 'platform']),
                title: getFullTitle(_test),
                test: parseTest(_test)
            },
            getSaucelab(_.get(wdclient, 'requestHandler.sessionID')),
            getTravis(process.env.TRAVIS_JOB_ID)
        )
    };

    return Promise.fromNode(function(cb = _.noop) {
        if (!bugsnag) {
            return cb();
        }
        bugsnag.notify(error, options, cb);
    });
}

commandHelpersFiles.forEach(function(file) {
    // eslint-disable-next-line import/no-dynamic-require
    const mod = require(path.resolve(file));
    const methods = _.functions(mod);
    methods.forEach(function(method) {
        wdclient.addCommand(method, mod[method].bind(wdclient));
    });
});

global.browser = wdclient;
global.client = wdclient;
global.expect = chai.expect;
global.throwIfErr = function(err) {
    if (err) {
        console.error('here is error ' + err);
        throw err;
    }
};

/**
 * initialize Mocha
 */
const mochaRunner = new Mocha(mochaOptions);
debug('mocha options', mochaOptions);

_.forEach(testFiles, function(file) {
    mochaRunner.addFile(file);
});

process.listeners('uncaughtException');
process.removeAllListeners('uncaughtException');

wdclient.capabilities = capabilities;

const updateJobStatus = Promise.method(function updateJobStatus() {
    debug('update jobs', '#' + capabilities.index, 'with exitCode', exitCode, ' sessionID : ',
        wdclient.requestHandler.sessionID);
    // if we have a sauce id then update status
    if (SauceLabs && capabilities.updateSauceJob && wdclient.requestHandler.sessionID) {
        const sauceAccount = new SauceLabs({
            username: capabilities.user,
            password: capabilities.key
        });
        debug('updateJob ', wdclient.requestHandler.sessionID, exitCode);
        return sauceAccount.updateJobAsync(wdclient.requestHandler.sessionID, {
                passed: exitCode === 0
            }).then(function() {
                if (exitCode !== 0) {
                    debug('stopJob ', wdclient.requestHandler.sessionID, exitCode);
                    return sauceAccount.stopJobAsync(wdclient.requestHandler.sessionID, {});
                }
                return true;
            });
    }
    if (capabilities.updateBrowserstackSession && wdclient.requestHandler.sessionID) {
        debug('updateSession ', wdclient.requestHandler.sessionID, exitCode);
        // http://www.browserstack.com/automate/rest-api#rest-api-sessions
        return request({
            url: 'https://www.browserstack.com/automate/sessions/' + wdclient.requestHandler.sessionID + '.json',
            method: 'PUT',
            json: true,
            body: {status: exitCode === 0 ? 'completed' : 'error'},
            auth: {
                user: capabilities.user,
                pass: capabilities.key,
                sendImmediately: true
            }
        });
    }
    return true;
});

function takeSeleniumLogs() {
    // IE have issue with driver and logs
    if (exitCode > 0 && exitCode !== 3 && exitCode !== 4 &&
        capabilities.desiredCapabilities.browserName !== 'internet explorer') {
        return wdclient.log('browser')
            .then(function(result) {
                console.log('Browser logs:');
                if (!result || !result.value || result.value.length === 0) {
                    console.log('logs are empty');
                    return;
                }
                result.value.forEach(function(line) {
                    console.log('[' + line.timestamp + ']', '[' + line.level + ']', line.message);
                });
                return true;
            })
            .catch(function(err) {
                console.error('Unable to get browser logs (not supported on this driver)', err.stack || err);
            });
}
    return false;
}

function setJobsAsTeam() {
    // only set team job for
    if (SauceLabs && capabilities.updateSauceJob && wdclient.requestHandler.sessionID && process.env.CI) {
        const sauceAccount = new SauceLabs({
            username: capabilities.user,
            password: capabilities.key
        });
        debug('setJobsAsTeam ', wdclient.requestHandler.sessionID);
        return sauceAccount.updateJobAsync(wdclient.requestHandler.sessionID, {
            public: 'team'
        }).catch(function(err) {
            console.error('setJobsAsTeam jobs failed set public', '#' + capabilities.index, 'SIGINT');
        });
    }
}

process.on('SIGINT', function() {
    debug('updating jobs', '#' + capabilities.index, 'SIGINT');
    // Setting code status to 0 when interruption required
    return wdclient.end()
        .catch(function(err) {
            console.error('updating jobs failed endify', '#' + capabilities.index, 'SIGINT');
        })
        .then(function() {
            debug('updated jobs', '#' + capabilities.index, 'SIGINT');
            // eslint-disable-next-line promise/no-nesting
            return updateJobStatus().then(() => {
                debug('updated jobs', '#' + capabilities.index, 'SIGINT');
                return true;
            }).catch(function(err) {
            console.error('updating jobs failed update job', '#' + capabilities.index, 'SIGINT');
        });
    });
});

debug('-------------------');
debug('trying to init pid [', process.pid, '] ');
wdclient.init()
    .then(function() {
        debug('init pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
        return true;
    })
    .then(function() {
        // eslint-disable-next-line promise/no-nesting
        return wdclient.timeouts('script', capabilities.timeoutsAsyncScript)
        .catch(err => {
            console.log('an error occured while trying to set timeouts "script".',
                'This could be normal with old selenium server or driver. A fallback api call was used instead.',
                err.message);
            return wdclient.timeoutsAsyncScript(capabilities.timeoutsAsyncScript);
        });
    })
    .then(function() {
        // eslint-disable-next-line promise/no-nesting
        return wdclient.timeouts('implicit', capabilities.timeoutsImplicitWait)
        .catch(err => {
            console.log('an error occured while trying to set timeouts "implicit".',
                'This could be normal with old selenium server or driver. A fallback api call was used instead.',
                err.message);
            return wdclient.timeoutsImplicitWait(capabilities.timeoutsAsyncScript);
        });
    })
    .then(function() {
        // eslint-disable-next-line promise/no-nesting
        return wdclient.timeouts('pageLoad', capabilities.timeoutsPageLoad)
        .catch(err => {
            console.log('an error occured while trying to set timeouts "pageLoad".',
                'This could be normal with old selenium server or driver. A fallback api call was used instead.',
                err.message);
            // eslint-disable-next-line promise/no-nesting
            return wdclient.timeouts('page load', capabilities.timeoutsPageLoad)
            .catch(err2 => {
                console.log('an error occured while trying to set timeouts "page load".',
                    'This could be normal with old selenium server or driver.', err2.message);
            });
        });
    })
    .then(setJobsAsTeam)
    .then(function() {
        if (!capabilities.desiredCapabilities['browser-resolution'] || wdclient.isMobile) {
            return;
        }
        const screenResolution = capabilities.desiredCapabilities['browser-resolution'].split('x');
        debug('switching to windows size', capabilities.desiredCapabilities['browser-resolution']);
        return wdclient.windowHandleSize({
            width: parseInt(screenResolution[0]),
            height: parseInt(screenResolution[1])
        });
    })
    .then(function() {
        return new Promise(function(resolve, reject) {
            const runner = mochaRunner.run(function(failures) {
                if (failures) {
                    return reject(failures);
                }
                return resolve();
            });

            runner.on('fail', function(_test, err) {
                notify(err, _test);
            });
            // pass index to help notify on process parent
            runner.index = capabilities.index;
            // init new reporter
            return new Reporter(runner, output);
        });
    })
    .catch(function(err) {
        exitCode = 1;
        debug('catch pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');

        if (wdclient.requestHandler.sessionID === null) {
            debug('------>  No sessionID, retrying later');
            exitCode = 3;
        }

        // saucelabs reached limit
        else if ((err.message && err.message.indexOf('receive further commands') >= 0) ||
            (typeof err.indexOf === 'function' && err.indexOf('receive further commands') >= 0)) {
            exitCode = 3;
        }
        // browserstack
        else if ((err.message && err.message.indexOf('Please upgrade to add more parallel sessions') >= 0) ||
            (typeof err.indexOf === 'function' && err.indexOf('Please upgrade to add more parallel sessions') >= 0)) {
            exitCode = 3;
        }
        else if ((err.message && err.message.indexOf('Automate daily limit reached for your plan') >= 0) ||
            (typeof err.indexOf === 'function' && err.indexOf('Automate daily limit reached for your plan') >= 0)) {
            exitCode = 4;
        }

        if (exitCode === 1) {
            console.error('An unknow error occured while running e2e test with',
                capabilities.desiredCapabilities.testName);
        }

        console.error('----------  ERROR [' + exitCode + '] ---------------');
        console.error(err);
        console.error('----------------------------------');

        // eslint-disable-next-line promise/no-nesting
        return updateJobStatus(exitCode).then(function() {
            debug('carefully stopped pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
            return false;
        });
    })
    .then(takeSeleniumLogs)
    .then(updateJobStatus)
    .finally(function() {
        setTimeout(function() {
            debug('waiting for exit pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(exitCode);
        }, 1000);
    })
    .finally(wdclient.end)
    .catch(console.error);

