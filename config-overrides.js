module.exports = function override(config, env) {
  config.module.rules.push({
    test: /\.worker\.js$/,
    use: {loader: 'worker-loader'},
  });

  config.output.globalObject = '(self || this)';

  // console.log(config);
  // process.exit();

  return config;
};
