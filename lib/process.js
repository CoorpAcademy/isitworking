'use strict';

const Mocha = require('mocha');
const _ = require('lodash');
const Promise = require('bluebird');
const webdriverio = require('webdriverio');
const chai = require('chai');
const args = process.argv;
const capabilities = JSON.parse(args[2]);
const mochaOptions = capabilities;
const testFiles = capabilities.tests;
const commandHelpersFiles = capabilities.commandHelpers;
const debug = require('debug')('webdriver.io:process');
const Reporter = require('./reporter');
const SauceLabs = tryRequire('saucelabs');
const request = Promise.promisify(require('request'));
const bugsnag = tryRequire('bugsnag');

if (SauceLabs) {
    Promise.promisifyAll(SauceLabs.prototype);
}
let exitCode = 0;

function tryRequire(moduleName) {
    try {
      return require(moduleName);
    }
    catch (er) {
        return null;
    }
}

function output(msg) {
    process.send(msg);
}

if (bugsnag && process.env.BUGSNAG_SAUCELAB) {
    bugsnag.register(process.env.BUGSNAG_SAUCELAB, {
        packageJSON: '../../../../package.json',
        releaseStage: process.env.NODE_ENV || 'development'
    });
}

function notify(error, test) {
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
                title: getFullTitle(test),
                test: parseTest(test)
            },
            getSaucelab(_.get(wdclient, 'requestHandler.sessionID')),
            getTravis(process.env.TRAVIS_JOB_ID)
        )
    };

    return Promise.fromNode(function(cb) {
        cb = cb || _.noop;
        if (!bugsnag) {
            return cb();
        }
        bugsnag.notify(error, options, cb);
    });
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

function getFullTitle(test) {
    if (test.parent)
        return [
            getFullTitle(test.parent),
            test.title
        ].join(' ').trim();
    return test.title;
}

function parseTest(test) {
    return _.assign(
        _.pick(test, ['title', 'file', 'body']),
        test && test.parent ? {
            parent: parseTest(test.parent)
        } : null
    );
}

const wdclient = webdriverio.remote(capabilities);

commandHelpersFiles.forEach(function(file) {
    const mod = require(file);
    const methods = _.functions(mod);
    methods.forEach(function(method) {
        wdclient.addCommand(method, mod[method].bind(wdclient));
    });
});

Promise.promisifyAll(wdclient, {suffix: 'ify'});
_.bindAll(wdclient);

global.client = global.browser = wdclient;
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
const mocha = new Mocha(mochaOptions);
debug('mocha options', mochaOptions);

_.forEach(testFiles, function(file) {
    mocha.addFile(file);
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
            })
            .catch(function(err) {
                console.error('Unable to get browser logs (not supported on this driver)', err.stack || err);
            })
        ;
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
    return wdclient.endify()
        .catch(function(err) {
            console.error('updating jobs failed endify', '#' + capabilities.index, 'SIGINT');
        })
        .then(function() {
            debug('updated jobs', '#' + capabilities.index, 'SIGINT');
            return updateJobStatus().then(function() {
                debug('updated jobs', '#' + capabilities.index, 'SIGINT');
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
        wdclient.timeoutsImplicitWait(capabilities.timeoutsImplicitWait);
        return true;
    })
    .then(setJobsAsTeam)
    .then(function() {
        wdclient.timeoutsAsyncScript(capabilities.timeoutsAsyncScript);
        return true;
    })
    .then(function() {
        if (!capabilities.desiredCapabilities['browser-resolution'] || wdclient.isMobile) {
            return;
        }
        const screenResolution = capabilities.desiredCapabilities['browser-resolution'].split('x');
        debug('switching to windows size', capabilities.desiredCapabilities['browser-resolution']);
        wdclient.windowHandleSize({
            width: parseInt(screenResolution[0]),
            height: parseInt(screenResolution[1])
        });
        return true;
    })
    .then(function() {
        return new Promise(function(resolve, reject) {
            const runner = mocha.run(function(failures) {
                if (failures) {
                    return reject(failures);
                }
                return resolve();
            });

            runner.on('fail', function(test, err) {
                notify(err, test);
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
            process.exit(exitCode);
        }, 1000);
    })
    .finally(wdclient.end)
;
