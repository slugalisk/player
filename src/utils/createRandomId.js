import crypto from 'crypto';

const createRandomId = () => {
  const id = new Uint8Array(16);
  crypto.randomFillSync(id);
  return id;
};

export default createRandomId;
