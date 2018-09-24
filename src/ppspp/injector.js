const {generateKeyPair} = require('./integrity');
const URI = require('./uri')
const {
  ChunkAddressingMethod,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
  ProtocolOptions,
} = require('./constants');
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
        this.swarm.scheduler.markChunksLoaded(subtree.rootAddress);
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
      const uri = new URI(
        swarmId,
        {
          [ProtocolOptions.ContentIntegrityProtectionMethod]: contentIntegrityProtectionMethod,
          [ProtocolOptions.MerkleHashTreeFunction]: merkleHashTreeFunction,
          [ProtocolOptions.LiveSignatureAlgorithm]: liveSignatureAlgorithm,
          [ProtocolOptions.ChunkAddressingMethod]: chunkAddressingMethod,
          [ProtocolOptions.ChunkSize]: chunkSize,
        }
      );

      console.log(uri.toString());

      const clientOptions = {
        liveDiscardWindow,
        privateKey,
        uploadRateLimit: 10e6,
      };

      return new Swarm(uri, clientOptions);
    }).then(swarm => new Injector(swarm, chunkSize, chunksPerSignature));
  }
}

module.exports = Injector;
