// const ppspp = require('./ppspp');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const arrayEqual = require('array-equal');

function hashValue(value) {
  const hash = crypto.createHash('SHA256');
  hash.update(value);
  return hash.digest();
}

function test1() {
  const data = Buffer.alloc(1.25 * 1024 * 1024);
  crypto.randomFillSync(data);

  const chunkCount = 16;
  const chunkSize = data.length / chunkCount;
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i ++) {
    chunks[i] = data.slice(i * chunkSize, i * chunkSize + chunkSize);
  }

  // ---

  // const digestCount = chunkCount * 2 - 1;
  // const digests = new Array(digestCount);
  // for (let i = 0; i < chunkCount; i ++) {
  //   digests[i * 2] = hashValue(chunks[i]);
  // }

  // for (let i = 0; i < Math.log2(chunkCount); i ++) {
  //   const stride = Math.pow(2, i + 1);
  //   const start = Math.pow(2, i) + stride - 1;

  //   for (let j = start; j < digestCount; j += stride * 2) {
  //     digests[j - stride / 2] = hashValue(Buffer.concat([digests[j - stride], digests[j]]));
  //   }
  // }

  // const digestCount = chunkCount * 2 - 1;
  // const digests = new Array(digestCount);

  // for (let i = 0; i < chunkCount; i ++) {
  //   digests[i + chunkCount - 1] = hashValue(chunks[i]);
  // }

  // for (let i = digestCount - 1; i > 0; i -= 2) {
  //   digests[Math.floor(i / 2) - 1] = hashValue(Buffer.concat([digests[i - 1], digests[i]]));
  // }

  // for (let i = 0; i < digests.length; i ++) {
  //   console.log(i, digests[i]);
  // }

  const src = ChunkSet.from(chunks);

  const uncles = src.getUncleHashes(22);
  console.log(uncles);

  const dst = new ChunkSet(16);

  dst.insertHash(15, src.getRootHash());

  src.getUncleHashes(22).forEach(({bin, hash}) => dst.insertHash(bin, hash));
  dst.insertChunk(22, src.getChunk(22));

  src.getUncleHashes(4).forEach(({bin, hash}) => dst.insertHash(bin, hash));
  dst.insertChunk(4, src.getChunk(4));

  src.getUncleHashes(28).forEach(({bin, hash}) => dst.insertHash(bin, hash));
  dst.insertChunk(28, src.getChunk(28));

  dst.debug();

  // const memes = new ChunkSet(0, 15);
  // memes.insertHash(15, digests[0]);
  // memes.insertHash(23, digests[2]);
  // memes.insertHash(11, digests[4]);

  // // ---
  // // memes.insertHash(5, digests[8]);
  // // memes.insertHash(4, digests[17]);
  // // ---

  // memes.insertHash(1, digests[7]);
  // memes.insertHash(6, digests[18]);

  // // memes.insertChunk(0, chunks[0]);
  // memes.insertChunk(4, chunks[2]);

  // console.log('---');
  // memes.debug();
}

test1();
