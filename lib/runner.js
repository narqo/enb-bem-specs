var fs = require('fs'),
    path = require('path'),
    vow = require('vow'),
    util = require('util'),
    Logger = require('enb/lib/logger'),
    execFile = require('child_process').execFile,
    PHANTOM_BIN = require('phantomjs').path,
    MOCHA_PHANTOM = require.resolve('mocha-phantomjs'),
    logger = new Logger(),
    oldTargets = [],
    NEED_COVERAGE = process.env.ISTANBUL_COVERAGE,
    covCollector,
    covIdx;

if (NEED_COVERAGE) {
    covCollector = new (require('istanbul').Collector)();
    covIdx = 0;
}

exports.run = function (targets, root) {
    var MOCHA_PHANTOM_REPORTER = process.env.MOCHA_PHANTOM_REPORTER || 'spec',
        MOCHA_PHANTOM_MAX_COUNT = parseInt(process.env.MOCHA_PHANTOM_MAX_COUNT, 10) || 10,
        MOCHA_PHANTOM_HOOK = path.resolve(__dirname, './hooks/mocha-phantomjs.js'),
        phantomCount = 0,
        phantomQueue = [],
        errorCount = 0,
        toRun = [],
        needRun = false;

    targets = targets.filter(function (target) {
        return target.indexOf('.bundles') === -1;
    });

    targets.forEach(function (target) {
        if (oldTargets.indexOf(target) === -1) {
            oldTargets.push(target);
            toRun.push(target);

            needRun = true;
        }
    });

    return needRun ? vow.allResolved(toRun.map(function (nodePath) {
        var nodeName = path.basename(nodePath),
            target = nodeName + '.html',
            targetPath = path.join(nodePath, target),
            fullpath = path.join(root, nodePath, target),
            config = {},
            args = [MOCHA_PHANTOM, fullpath, MOCHA_PHANTOM_REPORTER],
            deferer = vow.defer(),
            covBufFile;

        if (NEED_COVERAGE) {
            covBufFile = path.join(root, util.format(
                '__coverage-%s-%s-%s.json',
                targetPath.replace(/[^A-Za-z0-9_. ]/g, '_'),
                    Date.now() - 0,
                covIdx++));

            config.hooks = MOCHA_PHANTOM_HOOK;
            config.settings = {
                'coverage-file': covBufFile
            };
        }

        args.push(JSON.stringify(config));

        phantomCount < MOCHA_PHANTOM_MAX_COUNT ?
            runMochaPhantom() :
            phantomQueue.push(runMochaPhantom);

        function getCovData() {
            var data = {},
                exists = fs.existsSync(covBufFile);

            if (exists) {
                logger.logAction('coverage', path.relative(root, covBufFile));
                data = JSON.parse(fs.readFileSync(covBufFile, 'utf8'));

                dropCovBuffer();
            } else {
                logger.logErrorAction('coverage', path.relative(root, covBufFile));
            }

            return data;
        }

        function dropCovBuffer() {
            try {
                fs.unlinkSync(covBufFile);
            } catch (e) {}
        }

        function runMochaPhantom() {
            phantomCount++;

            execFile(PHANTOM_BIN, args, { cwd: root }, function (err, stdout, stderr) {
                --phantomCount;
                phantomQueue.length && phantomQueue.shift()();

                var passed = err === null;

                if (passed) {
                    if (NEED_COVERAGE) {
                        covCollector.add(getCovData());
                        phantomCount || storeFinalCoverage();
                    }

                    logger.logAction('spec', targetPath);

                    deferer.resolve();
                } else {
                    logger.logErrorAction('spec', targetPath);

                    ++errorCount;
                    deferer.reject(err);
                }

                console.log(stdout);
            });
        }

        function storeFinalCoverage() {
            var covFile = path.resolve(root, 'coverage.json');

            fs.writeFileSync(covFile, JSON.stringify(covCollector.getFinalCoverage()), 'utf8');

            covCollector.dispose();
        }

        return deferer.promise();
    }))
    .then(function () {
        if (errorCount) {
            return vow.reject(new Error('specs: ' + errorCount + ' failing'));
        }
    }) : vow.resolve([]);
};
