/**
 * Web worker script that uses an emscripten-compiled version
 * of OpenEXR to parse EXR files. The webworker can be used like this:
 *
 *  const ExrParser = require('worker-loader!./utils/exr-parser-webworker.js');
 *  var worker = new ExrParser();
 *  # Send an ArrayBuffer to the webworker
 *  # Because it's basses as the second argument, the data won't be copied
 *  # but ownership will be transfered.
 *  worker.postMessage({ data }, [data]);
 *  worker.onmessage = (event: MessageEvent) => {
 *      if (event.data.success) {
 *          console.log(event.data.image);
 *      } else {
 *          console.error(event.data.message);
 *      }
 *  };
 */

exports.__esModule = true;

var EXR = require("../exr-wrap/exr-wrap.js");

// eslint-disable-next-line no-restricted-globals
var ctx = self;
var openEXRLoaded = false;
var queuedJobs = [];
var openEXR;

ctx.addEventListener('message', function (event) {
    if (!openEXRLoaded) {
        queuedJobs.push(event.data);
    }
    else {
        handleJob(event.data);
    }
});

EXR().then(function (Module) {
    openEXR = Module;
    openEXRLoaded = true;
    while (queuedJobs.length > 0) {
        var job = queuedJobs.shift();
        if (job) {
            handleJob(job);
        }
    }
});
function handleJob(job) {
    var jobId = job.jobId;
    try {
        var image = parseExr(job.data);
        // eslint-disable-next-line no-restricted-globals
        ctx.postMessage({
            jobId: jobId,
            success: true,
            image: image
        }, [image.data.buffer]);
    }
    catch (error) {
        console.log('Error: ', error);
        // eslint-disable-next-line no-restricted-globals
        ctx.postMessage({
            jobId: jobId,
            success: false,
            message: error.toString()
        });
    }
}
// tslint:disable-line:no-any
function parseExr(data) {
    console.time('Decoding EXR'); // tslint:disable-line
    var exrImage = null; // tslint:disable-line:no-any
    try {
        exrImage = openEXR.loadEXRStr(data);
        var channels = exrImage.channels();
        var width = exrImage.width, height = exrImage.height;
        var nChannels = channels.length;
        var exrData = void 0;
        if (nChannels === 1) {
            var z = exrImage.plane(exrImage.channels()[0]);
            exrData = new Float32Array(width * height);
            for (var i = 0; i < width * height; i++) {
                exrData[i] = z[i];
            }
        }
        else if (exrImage.channels().includes('R') &&
            exrImage.channels().includes('G') &&
            exrImage.channels().includes('B')) {
            var r = exrImage.plane('R');
            var g = exrImage.plane('G');
            var b = exrImage.plane('B');
            exrData = new Float32Array(width * height * 3);
            for (var i = 0; i < width * height; i++) {
                exrData[i * 3] = r[i];
                exrData[i * 3 + 1] = g[i];
                exrData[i * 3 + 2] = b[i];
            }
            nChannels = 3;
        }
        else {
            throw new Error('EXR image not supported');
        }
        return {
            height: height,
            width: width,
            nChannels: nChannels,
            data: exrData,
            type: 'HdrImage'
        };
    }
    finally {
        if (exrImage) {
            exrImage["delete"]();
        }
        console.timeEnd('Decoding EXR'); // tslint:disable-line
    }
}
;
