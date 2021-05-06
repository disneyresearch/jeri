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

const EXR = require("../exr-wrap/exr-wrap.js");

const openEXRLoaded = false;
const queuedJobs = [];
const OpenEXR;

self.addEventListener('message', function (event) {
    if (!openEXRLoaded) {
        queuedJobs.push(event.data);
    } else {
        handleJob(event.data);
    }
});

// The wasmBinary will be read in as a function to be instantiated in the exr-wrap.js
const wasmBinary = require('../exr-wrap/exr-wrap.wasm');
EXR({
  instantiateWasm: wasmBinary
}).then(function (Module) {
    OpenEXR = Module;
    openEXRLoaded = true;
    while (queuedJobs.length > 0) {
        var job = queuedJobs.shift();
        if (job) {
            handleJob(job);
        }
    }
});
function handleJob(job) {
    const jobId = job.jobId;
    try {
        const image = parseExr(job.data);
        // eslint-disable-next-line no-restricted-globals
        self.postMessage(
            {
                jobId,
                success: true,
                image
            }, 
            [image.data.buffer]
        );
    } catch (error) {
        console.log('Error: ', error);
        // eslint-disable-next-line no-restricted-globals
        self.postMessage({
            jobId,
            success: false,
            message: error.toString()
        });
    }
}
// tslint:disable-line:no-any
function parseExr(data) {
    console.time('Decoding EXR'); // tslint:disable-line
    let exrImage = null; // tslint:disable-line:no-any
    try {
        exrImage = OpenEXR.loadEXRStr(data);
        const channels = exrImage.channels();
        const {
          width,
          height
        } = exrImage;
        let nChannels = channels.length;
        let exrData = void 0;
        if (nChannels === 1) {
            const z = exrImage.plane(exrImage.channels()[0]);
            exrData = new Float32Array(width * height);
            for (let i = 0; i < width * height; i++) {
                exrData[i] = z[i];
            }
        } else if (exrImage.channels().includes('R') &&
            exrImage.channels().includes('G') &&
            exrImage.channels().includes('B')) {
            const r = exrImage.plane('R');
            const g = exrImage.plane('G');
            const b = exrImage.plane('B');
            exrData = new Float32Array(width * height * 3);
            for (let i = 0; i < width * height; i++) {
                exrData[i * 3] = r[i];
                exrData[i * 3 + 1] = g[i];
                exrData[i * 3 + 2] = b[i];
            }
            nChannels = 3;
        } else {
            throw new Error('EXR image not supported');
        }
        return {
            height,
            width,
            nChannels,
            data: exrData,
            type: 'HdrImage',
        };
    } finally {
        if (exrImage) {
            exrImage.delete();
        }
        console.timeEnd('Decoding EXR'); // tslint:disable-line
    }
};