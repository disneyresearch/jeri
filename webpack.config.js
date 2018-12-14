const path = require('path');
const webpack = require('webpack');

const config = {
  entry: {
    'jeri': './build_npm/jeri.js',
    'jeri.min': './build_npm/jeri.js'
  },
  output: {
    path: path.resolve(__dirname, 'build_web'),
    filename: '[name].js',
    libraryTarget: 'umd',
    library: 'Jeri',
    umdNamedDefine: true,
    publicPath: '/',
  },
  optimization: {
    minimize: true
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json']
  },
  module: {
    rules: [
      {
        enforce: "pre",
        test: /\.js$/,
        loader: "source-map-loader"
      },
//       {
//         test: /\.wasm$/,
//         type: "javascript/auto", // ← !! This seems to be required to stop webpack from messing with wasm
//         loader: "file-loader"
//       }
    ],
    defaultRules: [
      {
        type: 'javascript/auto',
        resolve: {}
      },
      {
        test: /\.json$/i,
        type: 'json'
      }
    ]
  },
  devtool: "source-map",
  plugins: [
  ],
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
};

module.exports = config;
