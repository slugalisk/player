import seedrandom from 'seedrandom';

const rng = seedrandom('seed');

const createRandomId = () => {
  const id = new Uint8Array(16);
  for (let i = 0; i < 16; i ++) {
    id[i] = (rng() * 255) >> 0;
  }
  return id;
};

export default createRandomId;
