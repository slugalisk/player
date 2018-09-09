// const ppspp = require('./ppspp');
const crypto = require('crypto');
const { Buffer } = require('buffer');


const createProtocol = ({
  [ProtocolOptions.SwarmIdentifier]: {value: swarmIdentifier},
  [ProtocolOptions.ContentIntegrityProtectionMethod]: {value: contentIntegrityProtectionMethod},
  [ProtocolOptions.MerkleHashTreeFunction]: {value: merkleHashTreeFunction},
  [ProtocolOptions.LiveSignatureAlgorithm]: {value: liveSignatureAlgorithm},
  [ProtocolOptions.ChunkAddressingMethod]: {value: chunkAddressingMethod},
  [ProtocolOptions.LiveDiscardWindow]: {value: liveDiscardWindow},
  [ProtocolOptions.SupportedMessages]: {value: supportedMessages},
  [ProtocolOptions.ChunkSize]: {value: chunkSize},
}) => {

  class DataMeme {
    constructor(size) {
      this.values = new Array(size);
    }

    static from(values) {
      const set = new new DataMeme(values.length);
      values.forEach((value, i) => set.values[i] = value);
      return set;
    }

    set(bin, value) {
      this.values[bin / 2] = value;
    }

    get(bin) {
      return this.values[bin / 2];
    }
  }

  // TODO: start/end
  // TODO: address to bin
  // TODO: protocol factory to capture protocol options as protocol aspect implementationss
  class ChunkSet {
    constructor(size) {
      this.size = size;
      this.values = new DataMeme(size);
      this.verifier = new HashTree(size);
    }

    static from(chunks) {
      const set = Object.create(ChunkSet.prototype);
      set.size = chunks.length;
      set.values = DataMeme.from(chunks);
      set.verifier = HashTree.from(chunks);

      return set;
    }

    setIntegrity(address, integrity) {

    }

    insertChunk(address, data) {
      this.verifier.verify(bin, value);
      this.values[bin / 2] = value;
    }

    getChunk(bin) {
      return this.values[bin / 2];
    }
  }

  return {

  };
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
