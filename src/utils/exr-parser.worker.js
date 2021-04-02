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

// Research
// - https://www.reddit.com/r/rust/comments/8fjyxn/a_question_regarding_webassembly_and_global_scope/
// - https://github.com/webpack/webpack/issues/7647


// Fails with exr-wrap.js:3152 Uncaught TypeError: Cannot read property '__webpack_init__' of undefined
// eslint-disable-next-line import/no-webpack-loader-syntax
// import wasm from "file-loader!../exr-wrap/exr-wrap.wasm";

// Fails with exr-wrap.js:3152 Uncaught TypeError: Cannot read property '__webpack_init__' of undefined
// eslint-disable-next-line import/no-webpack-loader-syntax
// import wasm from "../exr-wrap/exr-wrap.wasm";
// WebAssembly.instantiateStreaming(fetch(wasm)).then(results => {
//     debugger;
//     console.log(`We have wasm!`)
// }).catch(err => console.error("Error importing `exr-wrap.wasm`:", err));

// eslint-disable-next-line import/no-webpack-loader-syntax
// const wasm = require("!!file-loader!../exr-wrap/exr-wrap.wasm");

// eslint-disable-next-line import/no-webpack-loader-syntax
// import * as wasm from "../exr-wrap/exr-wrap.wasm";
// import("!!file-loader!../exr-wrap/exr-wrap.wasm")
//   .then(wasm => {
//     debugger;
//     console.log(`wasm: ${wasm}`)
//   })
//   .catch(err => console.error("Error importing `exr-wrap.wasm`:", err));

exports.__esModule = true;

var EXR = require("../exr-wrap/exr-wrap.js");

// While this does appear to work, it ultimately fails as the wasm itself is a module with a default that is a Promise.  Attempting to await that gives:
// exr-parser.worker.js:172 Error importing `exr-wrap.wasm`: LinkError: WebAssembly.instantiate(): memory import 0 is smaller than initial 256, got 10
// Even with the wasm-loader
// TODO: 03/24/2021 - 4:31pm - I think the answer here is actually just to proxy the /scripts/js/exr-wrap.wasm so it resolves
// Try to do that with CRACO
// import('../exr-wrap/exr-wrap.wasm').then((wasm) => {
//     console.log(`Wasm loaded!`);
//     var EXR = require("../exr-wrap/exr-wrap.js");
//     EXR["wasmBinary"] = wasm;
// }).catch(err => console.error("Error importing `exr-wrap.wasm`:", err));;
// We have to require this so that it's generated to the proper directory
// var wasm = require("file-loader!../exr-wrap/exr-wrap.wasm");

// eslint-disable-next-line import/no-webpack-loader-syntax
// var wasm = require("!!raw-loader!../exr-wrap/exr-wrap.wasm");

// If a node app installs jeri the exr-wrap.js will atttempt to load the wasm based on the current url
// this won't work however, unless the wasm is either proxied or manually copied to the application,
// Loading it here is the better approach and solves that problem.
// EXR["wasmBinary"] = null;

// eslint-disable-next-line no-restricted-globals
var ctx = self;
// declare var EXR: Function;
// declare var importScripts: Function;
var openEXRLoaded = false;
var queuedJobs = [];
var openEXR;
// eslint-disable-next-line no-restricted-globals
ctx.addEventListener('message', function (event) {
    if (!openEXRLoaded) {
        queuedJobs.push(event.data);
    }
    else {
        handleJob(event.data);
    }
});
// const exrwrapPath = require('file-loader?name=exr-wrap.js!../exr-wrap/exr-wrap.js');
// TODO: Left off, this still isn't working.
// Uncaught DOMException: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'http://localhost:3001/static/js/[object%20Module]' failed to load.
// at Object../node_modules/babel-loader/lib/index.js?!./jeri/build_npm/utils/exr-parser.worker.js (http://localhost:3001/static/js/bundle.worker.js:145:1)
// at __webpack_require__ (http://localhost:3001/static/js/bundle.worker.js:20:30)
// at http://localhost:3001/static/js/bundle.worker.js:84:18
// at http://localhost:3001/static/js/bundle.worker.js:87:10
// So the [objct%20Module] is actually the esModule where we'd want to do .default to get the actual path of '../exr-wrap/exr-wrap.js', the issue there is that
// That would resolve in the parent application and there is no path of that in the parent application unless we specifically bound it or something or resolved it
// I guess I could alias that to jeri?  That is an idea
// See https://webpack.js.org/configuration/resolve/ for some ideas on how to resolve this
// eslint-disable-next-line import/no-webpack-loader-syntax
// const exrwrapPath = require('raw-loader?name=exr-wrap.js!../exr-wrap/exr-wrap.js');
// const exrwrapWasmPath = require('file-loader?name=exr-wrap.wasm!../exr-wrap/exr-wrap.wasm');
// eslint-disable-next-line no-undef
// importScripts(exrwrapPath);
// eslint-disable-next-line no-undef
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
