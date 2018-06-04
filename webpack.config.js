const path = require('path');
const webpack = require('webpack');

const config = {
  entry: {
    'jeriview': './build_npm/jeriview.js',
    'jeriview.min': './build_npm/jeriview.js'
  },
  output: {
    path: path.resolve(__dirname, 'build_web'),
    filename: '[name].js',
    libraryTarget: 'umd',
    library: 'JeriView',
    umdNamedDefine: true,
    publicPath: '/',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json']
  },
  module: {
    loaders: [
      {
        enforce: "pre",
        test: /\.js$/,
        loader: "source-map-loader"
      }
    ]
  },
  devtool: "source-map",
  plugins: [
    new webpack.optimize.UglifyJsPlugin({
      minimize: true,
      sourceMap: true,
      include: /\.min\.js$/,
    }),
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
