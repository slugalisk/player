const {
  createContentIntegrityVerifierFactory,
  createMerkleHashTreeFunction,
  createLiveSignatureVerifyFunction,
  createLiveSignatureSignFunction,
  generateKeyPair,
} = require('../ppspp/integrity');
const {
  createEncoding,
  createChunkAddressFieldType,
  createIntegrityHashFieldType,
  createLiveSignatureFieldType,
} = require('../ppspp/encoding');
const {
  ChunkAddressingMethod,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} = require('../ppspp/constants');

class Injector {
  constructor() {
    const chunkSize = 8 * 1024;
    const liveDiscardWindow = Math.ceil(15 * 3500 * 1024 / 8 / chunkSize);
    const chunkAddressingMethod = ChunkAddressingMethod.Bin32;
    const merkleHashTreeFunction = MerkleHashTreeFunction.SHA256;
    const liveSignatureAlgorithm = LiveSignatureAlgorithm.ECDSAP256SHA256;

    generateKeyPair(liveSignatureAlgorithm).then(({swarmId, privateKey}) => {
      const integrity = createContentIntegrityVerifierFactory(
        ContentIntegrityProtectionMethod.UnifiedMerkleTree,
        createMerkleHashTreeFunction(merkleHashTreeFunction),
        createLiveSignatureVerifyFunction(liveSignatureAlgorithm, swarmId),
        createLiveSignatureSignFunction(liveSignatureAlgorithm, privateKey),
      );
      integrity.setLiveDiscardWindow(liveDiscardWindow);

      const encoding = createEncoding();
      encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, chunkSize));
      encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
      encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, swarmId));

      // setInterval(() => {
      //   const data = Buffer.alloc(1.25 * 1024 * 1024);
      //   for (let i = 0; i < data.length; i ++) {
      //     data[i] = Math.round(Math.random() * 255);
      //   }

      //   integrity.appendSubtree(data).then(() => {
      //     console.log('yee');
      //     // send HAVE
      //   });
      // }, 1000);
    });
  }
}

module.exports = Injector;
