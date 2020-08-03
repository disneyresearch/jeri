const path = require('path');
const webpack = require('webpack');
const terser = require('terser-webpack-plugin');

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
    publicPath: './',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json']
  },
  module: {
    rules: [
      // {
      //   test: /exr-parser\.worker\.js$/,
      //   use: {
      //     loader: 'worker-loader',
      //     options: {
      //       name: 'exr.worker.js',
      //       inline: false,
      //       fallback: false
      //     }
      //   }
      // },
      {
        test: /\.js$/,
        enforce: "pre",
        use: [ "source-map-loader" ]
      },
      {
        test: /\.wasm$/,
        type: "javascript/auto",
      },
    ]
  },
  mode: 'production',
  devtool: "source-map",
  optimization: {
    minimize: true,
    minimizer: [
      new terser({
        cache: true,
        parallel: true,
        sourceMap: true,
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
};

module.exports = config;
