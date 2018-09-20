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
const {Swarm} = require('../ppspp');

class Injector {
  constructor(swarm, chunkSize, chunksPerSignature) {
    this.swarm = swarm;
    this.chunkSize = chunkSize;
    this.chunksPerSignature = chunksPerSignature;
    this.chunkBuffer = [];
  }

  appendChunk(videoChunk) {
    for (let i = 0; i < videoChunk.length; i += this.chunkSize) {
      this.chunkBuffer.push(videoChunk.slice(i, Math.min(videoChunk.length, i + this.chunkSize)));
    }

    while (this.chunkBuffer.length > this.chunksPerSignature) {
      const subtreeChunks = this.chunkBuffer.splice(0, this.chunksPerSignature);
      this.swarm.contentIntegrity.appendSubtree(subtreeChunks).then(subtree => {
        this.swarm.chunkBuffer.set(subtree.rootAddress, subtreeChunks);
        this.swarm.availableChunks.set(subtree.rootAddress);
      });
    }
  }

  static create(options = {}) {
    const {
      chunkSize = 8 * 1024,
      chunksPerSignature = 128,
      liveDiscardWindow = Math.ceil(15 * 3500 * 1024 / chunkSize),
      chunkAddressingMethod = ChunkAddressingMethod.Bin32,
      contentIntegrityProtectionMethod = ContentIntegrityProtectionMethod.UnifiedMerkleTree,
      merkleHashTreeFunction = MerkleHashTreeFunction.SHA256,
      liveSignatureAlgorithm = LiveSignatureAlgorithm.ECDSAP256SHA256,
    } = options;

    return generateKeyPair(liveSignatureAlgorithm).then(({swarmId, privateKey}) => {
      const encoding = createEncoding();
      encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, this.chunkSize));
      encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
      encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, swarmId));

      const contentIntegrity = createContentIntegrityVerifierFactory(
        contentIntegrityProtectionMethod,
        createMerkleHashTreeFunction(merkleHashTreeFunction),
        createLiveSignatureVerifyFunction(liveSignatureAlgorithm, swarmId),
        createLiveSignatureSignFunction(liveSignatureAlgorithm, privateKey),
      );

      const swarm = new Swarm(swarmId, encoding, contentIntegrity);
      swarm.contentIntegrity.setLiveDiscardWindow(liveDiscardWindow);
      swarm.availableChunks.setLiveDiscardWindow(liveDiscardWindow);
      swarm.chunkBuffer.setLiveDiscardWindow(liveDiscardWindow);

      // TODO: Swarm.create?
      swarm.protocolOptions = [
        new encoding.VersionProtocolOption(),
        new encoding.MinimumVersionProtocolOption(),
        new encoding.SwarmIdentifierProtocolOption(swarmId.toBuffer()),
        new encoding.ContentIntegrityProtectionMethodProtocolOption(contentIntegrityProtectionMethod),
        new encoding.MerkleHashTreeFunctionProtocolOption(merkleHashTreeFunction),
        new encoding.LiveSignatureAlgorithmProtocolOption(liveSignatureAlgorithm),
        new encoding.ChunkAddressingMethodProtocolOption(chunkAddressingMethod),
        new encoding.ChunkSizeProtocolOption(chunkSize),
      ];

      return swarm;
    }).then(swarm => new Injector(swarm, chunkSize, chunksPerSignature));
  }
}

module.exports = Injector;
