const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

const config = {
  entry: {
    'jeri': './src/jeri.tsx',
    'jeri.min': './src/jeri.tsx'
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: '[name].js',
    libraryTarget: 'umd',
    library: 'Jeri',
    umdNamedDefine: true,
    publicPath: './',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json', '.glsl', '.wasm']
  },
  module: {
    rules: [
      {
        test: /\.worker\.js$/,
        loader: 'worker-loader',
        options: {
          filename: "[name].js",
          // If desired you can force the exr-parser.worker.js to be separate here by commenting out
          // the below inline, that just says also include the worker in jeri.js so one doesn't have to
          // also include the file in the browser.  It's convientent though it increases the size of jeri.js by 8mb
          // The 8+mb needs to be transferred regardless when parsing exr images, so bundling it for convienience.
          inline: 'fallback'
        },
      },
      {
        test: /\.js$/,
        enforce: "pre",
        use: [ "source-map-loader" ]
      },
      {
        test: /\.wasm$/,
        type: "javascript/auto",
        loader: 'wasm-loader',
      },
      {
        test: /\.glsl$/,
        use: { loader: "raw-loader" },
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ]
  },
  mode: 'production',
  devtool: "source-map",
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        cache: true,
        parallel: false,
        sourceMap: true,
        include: /\.min\.js$/,
        terserOptions: {
        }
      }),
    ],
  },
  externals: {
    react: {
      root: 'React',
      commonjs2: 'react',
      commonjs: 'react',
      amd: 'react',
      umd: 'react',
    },
    'react-dom': {
      root: 'ReactDOM',
      commonjs2: 'react-dom',
      commonjs: 'react-dom',
      amd: 'react-dom',
      umd: 'react-dom',
    },
  },
  node: {
    fs: 'empty'
  },
};

module.exports = config;

