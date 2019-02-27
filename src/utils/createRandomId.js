const crypto = require('crypto');

const createRandomId = () => {
  const id = new Uint8Array(16);
  crypto.randomFillSync(id);
  return id;
};

module.exports = createRandomId;
