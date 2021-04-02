declare module "*.worker.js" {
    // You need to change `Worker`, if you specified a different value for the `workerType` option
    class WebpackWorker extends Worker {
      constructor();
    }
  
    // Uncomment this if you set the `esModule` option to `false`
    // export = WebpackWorker;
    export default WebpackWorker;
}

declare module "*.worker.ts" {
    // You need to change `Worker`, if you specified a different value for the `workerType` option
    class WebpackWorker extends Worker {
      constructor();
    }
  
    // Uncomment this if you set the `esModule` option to `false`
    // export = WebpackWorker;
    export default WebpackWorker;
}

declare module "ts-loader!worker-loader!*" {
    class WebpackWorker extends Worker {
      constructor();
    }

    export default WebpackWorker;
}

declare module 'file-loader*' {
    const content: string;
    export default content;
}

declare module "raw-loader!*" {
    const content: string;
    export default content;
}

declare module 'common-prefix';

declare module '*exr-wrap.js';