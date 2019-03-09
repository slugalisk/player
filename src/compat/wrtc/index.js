module.exports = require('detect-node')
  ? require('./node')
  : require('./browser');
