# JERI Viewer

The JavaScript Extended-Range Image (JERI) Viewer was designed to be an easy-to-use, interactive component that can be embedded in websites and web-based documents. It contains a version of OpenEXR that was transpiled with [emscripten](http://kripken.github.io/emscripten-site/index.html) from C++ to JavaScript to enable running it in a web browser. Around this core, JERI offers multi-level tabs that allow easy navigation through large sets of images and supports zooming, panning, changing exposure and view transform, and quickly toggling between images. These features are built using [React](https://reactjs.org/), but knowledge of this framework is not required to use the viewer.

See [jeri.io](https://jeri.io/) for a live demonstration.

## Getting started--quick and dirty and without Webpack

1. Build the network (see Contributing section), or [get the latest build](#).
2. Copy `jeri.js`, `exr-warp.js`, `exr-warp.wasm` and `exr.worker.js` to your project.
3. Add `<script src="/jeri.js"></script>` to your webpage.
4. See the [Examples](build_web/examples/) for use instructions. The examples can be opened in a browser by running a web-server in the `build_web` directory and then opening http://localhost:3000/examples in a browser.

To run a webserver for viewing the examples, use one of the following:

```bash
python -m SimpleHTTPServer 3000 # Python 2
python3 -m http.server 3000 # Python 3
npm install -g serve && serve -s . # JavaScript
```

## Getting started with Webpack

For users experienced with web development that build their projects with [webpack](https://webpack.js.org/) and/or use React for their project, it is recommended to directly use the React components defined in `src/` and outlined in the [API Documentation](documentation/index.html).

To use JERI Viewer in a web application that is built with webpack, run

```bash
npm install --save react
npm install --save react-dom
npm install --save jeri
```

You can then

```jsx
import {ImageViewer} from 'jeri';
import {render} from 'react-dom';
const data = {
    title: 'root',
    children: [
        {
            title: 'Mountains',
            image: '/test_image.jpg',
        },
        {
            title: 'Living room',
            image: '/test_image.exr',
            compareTo: {
                reference: '/test_reference.exr',
                input: '/test_input.exr',
            }
        }
    ]
};
render(<ImageViewer data={data} baseUrl='' />, document.getElementById('my-container'));
```

When using JERI as a node module (npm i -D jeri) the [exr-wrap.js](./src/exr-wrap/exr-wrap.js) file, when loaded as a module and executed in the browser, attempts to load the [exr-wrap.wasm](./src/exr-wrap/exr-wrap.wasm) from the `location.href`, see the following in the `exr-wrap.js`:

```javascript
} else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    if (ENVIRONMENT_IS_WEB) {
        if (document.currentScript) {
            scriptDirectory = document.currentScript.src;
        }
    } else {
        // This right here ->
        scriptDirectory = self.location.href;
    }
```

If using Create React App, for example, you'd need to serve the request that attempts to load `exr-wrap.wasm`.   [Create React App Configuration Override](https://github.com/gsoft-inc/craco) gives the ability to solve this by enhancing the dev server.

Install the [craco](https://github.com/gsoft-inc/craco) module to your webapp then create a file called `craco.config.js` in the root of your project:

```javascript
const path = require("path");

module.exports = {
  webpack: {
    alias: {
      'react': path.resolve(__dirname, "node_modules/react/")
    },
  },
  devServer: {
    before:(app) => {
      app.get('/static/js/exr-wrap.wasm', function(req, res, next) {
          res.set('Content-Type', 'application/wasm');
          res.sendFile('exr-wrap.wasm', {
            root: path.join(__dirname, 'public'),
            dotfiles: 'deny',
            headers: {
              'Content-Type': 'application/wasm'
            }
          });
      });
  }
  }
}
```

This will allow the automatic resolution of the `exr-wrap.wasm` in your webapp.

If hosting your static app in NodeJs/Express then you'll want the following:

```javascript
app.get('/static/js/exr-wrap.wasm', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.set('Content-Type', 'application/wasm');
  res.sendFile(path.join(__dirname, '/public/exr-wrap.wasm'));
});

app.get('*', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.sendFile(path.join(__dirname, '/public/index.html'));
});
```

This will tell Express to serve wasm from the given directory and also any other request should be loaded by the React App.

## Contributing

1. Clone this repository
2. Run `npm install` inside the repository directory.
3. Run `npm run docs` to generate the API documentation.
4. Build with `npm run build`.
5. Contributors are required to fill out a CLA in order for us to be allowed to accept contributions. See [CLA-Individual](CLA-Individual.md) or [CLA-Corporate](CLA-Corporate.md) for details.

If you want to develop on JERI locally while using it in a project:

```text
npm i -g npm-sync
cd /path/to/jeri
npm i
npm-sync --dest /path/to/project
cd /path/to/project
```

Note that the `/path/to/project` is the path to the root directory of your React app (or any webapp using jeri).  Do not use `npm link` due to issues cited in [npm-sync](https://github.com/sunknudsen/npm-sync#readme), which resolves those issues, primarily being duplicate React libs being included or seen when using `npm-link`.

## Contributors

JERI features contributions by the following people:

- Jan Novák (Disney Research): Initial code, WebGL
- Thijs Vogels (Disney Research): Asynchronous EXR loading, React & webpack, UI and API improvements
- Gerhard Röthlin (Disney Research): Emscripten, code review
- Alessia Marra (Disney Research): Logo, graphic design
