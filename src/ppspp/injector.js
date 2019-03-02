import {EventEmitter} from 'events';
import crypto from 'crypto';
import {generateKeyPair} from './integrity';
import URI from './uri';
import {
  ChunkAddressingMethod,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
  ProtocolOptions,
} from './constants';
import {Swarm} from '../ppspp';

export default class Injector {
  constructor(swarm, chunkSize, chunksPerSignature) {
    this.swarm = swarm;
    this.chunkSize = chunkSize;
    this.chunksPerSignature = chunksPerSignature;
    this.inputBuffer = Buffer.alloc(0);
    this.chunkBuffer = [];
  }

  appendData(data) {
    if (this.inputBuffer.length + data.length < this.chunkSize) {
      this.inputBuffer = Buffer.concat([this.inputBuffer, data]);
      return;
    }

    let dataOffset = 0;
    if (this.inputBuffer.length > 0) {
      dataOffset = this.chunkSize - this.inputBuffer.length;
      this.chunkBuffer.push(Buffer.concat([this.inputBuffer, data.slice(0, dataOffset)], this.chunkSize));
    }

    for (let i = dataOffset; i + this.chunkSize < data.length; i += this.chunkSize) {
      this.chunkBuffer.push(data.slice(i, Math.min(data.length, i + this.chunkSize)));
      dataOffset = i + this.chunkSize;
    }

    if (dataOffset < data.length) {
      this.inputBuffer = data.slice(dataOffset);
    }

    while (this.chunkBuffer.length > this.chunksPerSignature) {
      const subtreeChunks = this.chunkBuffer.splice(0, this.chunksPerSignature);
      this.swarm.contentIntegrity.appendSubtree(subtreeChunks).then(subtree => {
        this.swarm.chunkBuffer.setRange(subtree.rootAddress, subtreeChunks);
        this.swarm.scheduler.markChunksLoaded(subtree.rootAddress);
      });
    }
  }

  static create(options = {}) {
    const {
      chunkSize = 8 * 1024,
      chunksPerSignature = 64,
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

      console.log('swarm uri:', uri.toString());

      const clientOptions = {
        liveDiscardWindow,
        privateKey,
        uploadRateLimit: 10e6,
      };

      return new Swarm(uri, clientOptions);
    }).then(swarm => new Injector(swarm, chunkSize, chunksPerSignature));
  }
}

export class NoiseInjector extends EventEmitter {
  constructor(dataRate = 3.5e6 / 8, interval = 250) {
    super();
    this.dataRate = dataRate * (interval / 1000);
    this.interval = interval;
  }

  start() {
    const data = Buffer.alloc(this.dataRate);
    crypto.randomFillSync(data);

    Injector.create().then(injector => {
      this.intervalId = setInterval(() => injector.appendChunk(data), this.interval);
      this.injector = injector;
      this.emit('publish', injector);
    });
  }

  stop(done) {
    clearInterval(this.intervalId);
    this.emit('unpublish', this.injector);
    if (done) {
      setTimeout(done);
    }
  }
}
