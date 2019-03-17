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
    this.inputBuffer = [];
    this.inputBufferSize = 0;
    this.outputResult = Promise.resolve();
  }

  appendData(data) {
    this.inputBuffer.push(data);
    this.inputBufferSize += data.length;

    const signatureSize = this.chunkSize * this.chunksPerSignature;
    if (this.inputBufferSize < signatureSize) {
      return;
    }

    let buf = Buffer.concat(this.inputBuffer, this.inputBufferSize);
    while (buf.length > signatureSize) {
      this.outputChunks(buf.slice(0, signatureSize));
      buf = buf.slice(signatureSize);
    }

    this.inputBuffer = [buf];
    this.inputBufferSize = buf.length;
  }

  flush() {
    if (this.inputBufferSize === 0) {
      return;
    }

    const signatureSize = this.chunkSize * this.chunksPerSignature;
    let buf = Buffer.concat(this.inputBuffer, this.inputBufferSize);
    while (buf.length > 0) {
      this.outputChunks(buf.slice(0, Math.min(buf.length, signatureSize)));
      buf = buf.slice(signatureSize);
    }

    this.inputBuffer = [];
    this.inputBufferSize = 0;
  }

  outputChunks(buf) {
    var chunks = [];
    for (let i = 0; i < this.chunksPerSignature; i ++) {
      const offset = i * this.chunkSize;
      chunks.push(buf.slice(offset, offset + this.chunkSize));
    }

    this.outputResult = Promise.all([
      this.swarm.contentIntegrity.appendSubtree(chunks),
      this.outputResult,
    ]).then(([subtree]) => {
      this.swarm.chunkBuffer.setRange(subtree.rootAddress, chunks);
      this.swarm.scheduler.markChunksLoaded(subtree.rootAddress);
    });
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
