const {
  override,
  addBabelPlugins,
} = require('customize-cra');

const applyCustomizeCraOverrides = override(
  ...addBabelPlugins(
    '@babel/plugin-proposal-optional-chaining',
  ),
);

module.exports = function override(config, env) {
  config.module.rules.push({
    test: /\.worker\.js$/,
    use: {loader: 'worker-loader'},
  });

  config.output.globalObject = '(self || this)';

  config = applyCustomizeCraOverrides(config);

  // console.log(config);
  // process.exit();

  return config;
};
