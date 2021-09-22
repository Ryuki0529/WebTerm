const path = require('path');
const webpackObfuscator = require('webpack-obfuscator');

module.exports = {
  // modeはproduction/developmentで記述
  // ""で囲むことに注意
  mode: "production",
  target: 'electron-main',
  // どのファイルを読み込むか default=> ./src/index.js
  entry: './src/js/index.js',
  // entryで読み込んだファイルのコンパイルの吐き出し場所
  output: {
    path: path.resolve(__dirname, 'src/js'),
    // distにsample.jsというファイル名で吐き出し
    filename: 'bundle.js',

  },

  module: {
    rules: [
      // Sassファイルの読み込みとコンパイル
      {
        // 拡張子がsassとscssのファイルを対象とする
        test: /\.(scss|css)$/i,
        // ローダー名
        use: [
          // linkタグに出力する機能
          "style-loader",
          // CSSをバンドルするための機能
          "css-loader",
          // sass2css
          "sass-loader",
        ],
      },
      {
        // 対象となるファイルの拡張子
        test: /\.(gif|png|jpg|eot|wof|woff|ttf|svg)$/,
        // 画像をBase64として取り込む
        type: "asset/inline",
      },
      {
        test: /\.js$/,
        use: [
          {
            loader: webpackObfuscator.loader,
            options: {
              compact: true,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              debugProtection: false,
              debugProtectionInterval: false,
              disableConsoleOutput: true,
              identifierNamesGenerator: 'hexadecimal',
              log: false,
              renameGlobals: false,
              rotateStringArray: true,
              selfDefending: true,
              stringArray: true,
              stringArrayEncoding: ['none'],
              stringArrayThreshold: 0.75,
              unicodeEscapeSequence: false
            }
          }
        ],
      },
    ],
  },
  // ES5(IE11等)向けの指定（webpack 5以上で必要）
  //target: ["web", "es5"],
};