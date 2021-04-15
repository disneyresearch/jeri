// eslint-disable-next-line import/no-webpack-loader-syntax
import ExrParserWorker from 'worker-loader!./exr-parser.worker.js';

export type Image = LdrImage | HdrImage;

export interface HdrImage {
    type: 'HdrImage';
    url: string;
    width: number;
    height: number;
    nChannels: number;
    data: Float32Array;
}

export interface LdrImage {
    type: 'LdrImage';
    url: string;
    width: number;
    height: number;
    nChannels: number;
    data: HTMLImageElement;
}

/**
 * A pool of exr parsing webworkers that get assigned tasks in a round-robin fashion.
 */
class ExrParserPool {
    private workers: Worker[];
    /** To divide the work equally, keep track of the worker that got the previous job. */
    private nextWorkerId: number = 0;
    /** Each job that is sent to a worker gets a unique jobId. */
    private jobId: number = 0;
    /** After sending a job to a web worker, we register a return handler for when data comes back  */
    private returnHandlers: {[x: string]: Function } = {};

    constructor(private nWorkers: number) {
        this.workers = [];
        for (let i = 0; i < nWorkers; ++i) {
            const worker = new ExrParserWorker();
            this.workers.push(worker);
            worker.onmessage = this.handleResult.bind(this);
        }
    }

    /**
     * Parse raw EXR data using by assigning the task to a web worker in the pool
     */
    parse(url: string, data: ArrayBuffer): Promise<HdrImage> {
        return new Promise((resolve, reject) => {
            const worker = this.nextWorker();
            const jobId = this.jobId++;
            this.returnHandlers[jobId] = (event: MessageEvent) => {
                if (event.data.success) {
                    resolve({ url, ...event.data.image } as HdrImage);
                } else {
                    reject(new Error(event.data.message as string));
                }
            };
            worker.postMessage({ jobId, data }, [data]);
        });
    }

    /**
     * Handler that gets called whenever a result comes back from the webworkers
     * It looks up the corresponding handler by the jobId.
     */
    handleResult(event: MessageEvent) {
        if (event.data.jobId != null) {
            const callback = this.returnHandlers[event.data.jobId];
            delete this.returnHandlers[event.data.jobId];
            callback(event);
        } else {
            throw new Error(`Got a message from the webworker without job id.`);
        }
    }

    /**
     * Get the web worker whose turn it is
     */
    private nextWorker(): Worker {
        const worker = this.workers[this.nextWorkerId];
        this.nextWorkerId = (this.nextWorkerId + 1) % this.nWorkers;
        return worker;
    }
}

const pool = new ExrParserPool(2);
function parseExr(url: string, data: ArrayBuffer): Promise<HdrImage> {
    return pool.parse(url, data);
}

export function loadImage(url: string): Promise<Image> {
    const suffix = url.split('.').pop();
    if (suffix && suffix.toLocaleLowerCase() === 'exr') {
        return loadExr(url);
    } else {
        return loadLdr(url);
    }
}

export function loadExr(url: string): Promise<HdrImage> {
    console.time(`Downloading '${url}'`); // tslint:disable-line
    return fetch(url)
        .then(result => {
            console.timeEnd(`Downloading '${url}'`); // tslint:disable-line
            return result;
        })
        .then(result => result.arrayBuffer())
        .then(data => parseExr(url, data));
}

export function loadLdr(url: string): Promise<LdrImage> {
    console.time(`Downloading '${url}'`); // tslint:disable-line
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = (error) => reject(new Error(`Failed to load '${url}'.`));
        image.onload = () => {
            console.timeEnd(`Downloading '${url}'`); // tslint:disable-line
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get 2d canvas context.'));
                    return;
                }
                ctx.drawImage(image, 0, 0);
                resolve({
                    url: url,
                    width: image.width,
                    height: image.height,
                    nChannels: 4,
                    data: image,
                    type: 'LdrImage',
                } as LdrImage);
            } catch (error) {
                reject(new Error(`Failed to load image '${url}': ${error}`));
            }
        };
        image.src = url;
        image.crossOrigin = "";
    });
}

const pixelColorCache: Map<Image, Function> = new Map();
/**
 * Extract a pixel's color
 * Caches data for LDR images
 * @param image image
 * @param x pixel's x coordinate
 * @param y pixel's y coordinate
 * @param c color channel (r=0, g=1, b=2)
 */
export function getPixelColor(image: Image, x: number, y: number, c: number) {
    if (image.type === 'HdrImage') {
        return image.data[(x + y * image.width) * image.nChannels + c];
    } else {
        let getColorFnc = pixelColorCache.get(image);
        if (getColorFnc == null) {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to create 2d context to retrieve LDR image data');
            }
            ctx.drawImage(image.data, 0, 0, image.width, image.height);
            getColorFnc = (X: number, Y: number, C: number) => ctx.getImageData(X, Y, 1, 1).data[C] / 256;
            pixelColorCache.set(image, getColorFnc);
        }
        return getColorFnc(x, y, c);
    }
}

export class ImageCache {

    private images: { [x: string]: Image } = {};
    private downloading: { [x: string]: Promise<Image> } = {};

    contains(url: string): boolean {
        return this.images.hasOwnProperty(url);
    }

    currentlyDownloading(url: string): boolean {
        return this.downloading.hasOwnProperty(url);
    }

    size(): number {
        return Object.keys(this.images).length;
    }

    get(url: string): Promise<Image> {
        if (this.contains(url)) {
            // console.log(`Image ${url} was in cache.`); // tslint:disable-line
            return Promise.resolve(this.images[url]);
        } else if (this.currentlyDownloading(url)) {
            return this.downloading[url];
        } else {
            // console.log(`Image ${url} is downloaded.`); // tslint:disable-line
            return this.load(url);
        }
    }

    private store(url: string, image: Image): Image {
        if (this.currentlyDownloading(url)) {
            delete this.currentlyDownloading[url];
        }
        this.images[url] = image;
        return image;
    }

    private load(url: string) {
        const imagePromise = loadImage(url);
        this.downloading[url] = imagePromise;
        return imagePromise
            .then((image: Image) => this.store(url, image));
    }
}
