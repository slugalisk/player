// const ppspp = require('./ppspp');
const crypto = require('crypto');
const { Buffer } = require('buffer');

function test1() {
  const data = Buffer.alloc(1024);
  crypto.randomFillSync(data);

  const chunkCount = 16;
  const chunkSize = data.length / chunkCount;
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i ++) {
    chunks[i] = data.slice(i * chunkSize, i * chunkSize + chunkSize);
  }

  const digestCount = chunkCount * 2;
  const digests = new Array(digestCount);
  for (let i = 0; i < chunkCount; i ++) {
    const hash = crypto.createHash('SHA256');
    hash.update(chunks[i]);
    digests[i * 2] = hash.digest();
  }

  for (let i = 0; i < Math.log2(chunkCount); i ++) {
    const stride = Math.pow(2, i + 1);
    const start = Math.pow(2, i) + stride - 1;
    for (let j = start; j < digestCount; j += stride) {
      const hash = crypto.createHash('SHA256');
      hash.update(Buffer.concat([digests[j - stride], digests[j]]));
      digests[j - stride / 2] = hash.digest();
    }
  }

  console.log(n);
}

test1();