declare module 'worker-loader*' {
    class WebpackWorker extends Worker {
        constructor();
    }
    export = WebpackWorker;
}

declare module 'file-loader*' {
    const content: string;
    export = content;
}
