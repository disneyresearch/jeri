# JERI Viewer

The JavaScript Extended-Range Image Viewer was designed to be easy to use off the shelf as an interactive component in any website or web-based document. It contains a version of OpenEXR that was compiled with [emscripten](http://kripken.github.io/emscripten-site/index.html) to work in a web browser. Around this core, JERI offers multi-level tabs that allow easy navigation through large sets of images and the viewer supports zooming, panning, changing exposure, and quickly toggling between images. These features are built in [React](https://reactjs.org/), but knowledge of this framework is not required to use the viewer.

## Getting started--quick and dirty and Webpack-free

1. Build the network (see later), or [get the latest build](#).
2. Copy `jeriview.js`, `exr-warp.js`, `exr-warp.js.mem` and `exr.worker.js` to your project.
3. Include `<script src="/jeriview.js"></script>` on your webpage.
4. See the [Examples](build_web/examples/) for use instructions. You view the examples in a browser by running a web-server in the `build_web` directory and then opening http://localhost:3000/examples in a browser.

To run a webserver for viewing the examples, use one of the following:
```bash
python -m SimpleHTTPServer 3000 # Python 2
python3 -m http.server 3000 # Python 3
npm install -g serve && serve -s . # JavaScript
```

## Getting started with Webpack

For users experienced with web development that build their projects with [webpack](https://webpack.js.org/) or even use React for their project, it is recommended to directly use the React components defined in `src/` and outlined in the [API Documentation](documentation/index.html).

To use JERI Viewer in a web application that is built with webpack, run

```bash
npm install --save react
npm install --save react-dom
npm install --save jeriview
```

You can then

```jsx
import {ImageViewer} from 'jeriview';
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

## Contributing

1. Clone this repository
2. Run `npm install` inside the repository direction.
3. Run `npm run docs` to generate the API documentation.
4. Build with `npm run build`.
