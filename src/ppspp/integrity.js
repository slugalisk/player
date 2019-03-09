import {Buffer} from 'buffer';
import arrayEqual from 'array-equal';
import binSearch from '../binSearch';
import Address from './address';
import SwarmId from './swarmid';

import {
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} from './constants';

const crypto = require('../compat/crypto');

const toUint8Array = data => new Uint8Array(data);

export const MerkleHashTreeFunctionAlgorithms = {
  [MerkleHashTreeFunction.SHA1]: 'SHA-1',
  [MerkleHashTreeFunction.SHA224]: 'SHA-224',
  [MerkleHashTreeFunction.SHA256]: 'SHA-256',
  [MerkleHashTreeFunction.SHA384]: 'SHA-384',
  [MerkleHashTreeFunction.SHA512]: 'SHA-512',
};

export const MerkleHashTreeFunctionByteLengths = {
  [MerkleHashTreeFunction.SHA1]: 20,
  [MerkleHashTreeFunction.SHA224]: 28,
  [MerkleHashTreeFunction.SHA256]: 32,
  [MerkleHashTreeFunction.SHA384]: 48,
  [MerkleHashTreeFunction.SHA512]: 64,
};

export const createMerkleHashTreeFunction = (merkleHashTreeFunction) => {
  const algorithm = MerkleHashTreeFunctionAlgorithms[merkleHashTreeFunction];
  if (algorithm === undefined) {
    throw new Error('invalid merkle hash tree function');
  }

  const nullHash = new Uint8Array(MerkleHashTreeFunctionByteLengths[merkleHashTreeFunction]);

  return (...values) => {
    values = values.map(value => value === undefined ? nullHash : value);

    if (values.every(value => arrayEqual(value, nullHash))) {
      return Promise.resolve(nullHash);
    }

    if (values.length > 1) {
      values = new Uint8Array(Buffer.concat(values.map(value => Buffer.from(value))));
    } else {
      values = values[0];
    }

    return crypto.subtle.digest(algorithm, values).then(toUint8Array);
  };
};

export const LiveSignatureAlgorithms = {
  [LiveSignatureAlgorithm.RSASHA1]: {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: {name: 'SHA-1'},
  },
  [LiveSignatureAlgorithm.RSASHA256]: {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: {name: 'SHA-256'},
  },
  [LiveSignatureAlgorithm.ECDSAP256SHA256]: {
    name: 'ECDSA',
    namedCurve: 'P-256',
    hash: {name: 'SHA-256'},
  },
  [LiveSignatureAlgorithm.ECDSAP384SHA384]: {
    name: 'ECDSA',
    namedCurve: 'P-384',
    hash: {name: 'SHA-384'},
  },
};

export const createLiveSignatureSignFunction = (liveSignatureAlgorithm, privateKey, algorithm = {}) => {
  algorithm = {
    ...LiveSignatureAlgorithms[liveSignatureAlgorithm],
    ...algorithm,
  };

  const importResult = crypto.subtle.importKey('pkcs8', privateKey, algorithm, false, ['sign']);

  return data => importResult
    .then(privateKey => crypto.subtle.sign(algorithm, privateKey, data))
    .then(toUint8Array);
};

export const createLiveSignatureVerifyFunction = (liveSignatureAlgorithm, swarmId, algorithm = {}) => {
  algorithm = {
    ...LiveSignatureAlgorithms[liveSignatureAlgorithm],
    ...swarmId.getKeyParams(),
    ...algorithm,
  };

  const publicKey = new Uint8Array(swarmId.publicKey);
  const importResult = crypto.subtle.importKey('spki', publicKey, algorithm, false, ['verify']);

  return (signature, data) => importResult
    .then(publicKey => crypto.subtle.verify(algorithm, publicKey, signature, data))
    .then(toUint8Array);
};

export const generateKeyPair = (liveSignatureAlgorithm, algorithm = {}) => {
  algorithm = {
    ...LiveSignatureAlgorithms[liveSignatureAlgorithm],
    ...algorithm,
  };

  return crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
    .then(keyPair => Promise.all([
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      crypto.subtle.exportKey('spki', keyPair.publicKey),
    ]))
    .then(([privateKey, publicKey]) => ({
      privateKey,
      publicKey,
      swarmId: SwarmId.from({
        ...algorithm,
        liveSignatureAlgorithm,
        publicKey,
      }),
    }));
};

const unavailableLiveSignatureSignFunction = () => Promise.reject('live signature function not available');

export const createContentIntegrityVerifierFactory = (
  contentIntegrityProtectionMethod,
  merkleHashTreeFunction,
  liveSignatureVerifyFunction,
  liveSignatureSignFunction = unavailableLiveSignatureSignFunction,
  liveDiscardWindow = Infinity,
) => {
  class Signature {
    constructor(hash, verified = false) {
      this.hash = hash;
      this.verified = verified;
    }

    markVerified() {
      this.verified = true;
    }

    getHash() {
      return this.hash;
    }

    compare(value) {
      return !this.verified
        ? Promise.reject('cannot use unverified signature')
        : Promise.resolve(arrayEqual(this.hash, value));
    }
  }

  // TODO: timestamp in hash?
  class SignedSignature {
    constructor(signature, hash) {
      this.signature = signature;
      this.hash = hash;
      this.verificationResult = undefined;
    }

    verifyHash() {
      if (this.verificationResult === undefined) {
        this.verificationResult = liveSignatureVerifyFunction(this.hash, this.getHash())
          .then(() => this.markVerified());
      }
      return this.verificationResult;
    }

    markVerified() {
      this.signature.markVerified();
    }

    getHash() {
      return this.signature.getHash();
    }

    getSignatureHash() {
      return this.hash;
    }

    compare(value) {
      return this.verifyHash().then(() => this.signature.compare(value));
    }
  }

  class MerkleHashTree {
    constructor(rootAddress, signatures = new Array(rootAddress.getChunkCount() * 2 - 1)) {
      this.rootAddress = rootAddress;
      this.signatures = signatures;
    }

    createVerifier() {
      return new MerkleHashTreeVerifier(this);
    }

    copy(hashTree) {
      for (let i = 0; i < this.signatures.length; i ++) {
        if (hashTree.signatures[i] === undefined) {
          hashTree.signatures[i] = this.signatures[i];
        }
      }
    }

    getChunkCount() {
      return this.rootAddress.getChunkCount();
    }

    *getConstituentHashBins({bin}) {
      if (!this.rootAddress.containsBin(bin)) {
        throw new Error('bin out of range');
      }

      const {start} = this.rootAddress;
      bin -= start;

      const bins = [];
      let bfsIndex = this.rootAddress.getChunkCount() + bin / 2 - 1;
      let stride = 2;
      let parent = bin;

      while (bfsIndex !== 0) {
        const branch = (bfsIndex & 1) === 1 ? 1 : -1;

        yield {
          isRoot: false,
          branch,
          bin: parent + start,
          bfsIndex,
          siblingBin: parent + branch * stride + start,
          siblingBfsIndex: bfsIndex + branch,
        };

        bfsIndex = Math.floor((bfsIndex - 1) / 2);
        parent += branch * stride / 2;
        stride *= 2;
      }

      yield {
        isRoot: true,
        branch: 0,
        bin: parent + start,
        bfsIndex: 0,
        siblingBin: parent + start,
        siblingBfsIndex: 0,
      };

      return bins;
    }

    getConstituentSignatures(address) {
      return Array.from(this.getConstituentHashBins(address)).map(({
        siblingBin,
        siblingBfsIndex,
      }) => ({
        bin: siblingBin,
        signature: this.signatures[siblingBfsIndex],
      }));
    }

    static from(values, rootAddress = new Address(MerkleHashTree.minSize(values.length) - 1)) {
      const size = rootAddress.getChunkCount();
      const hashes = new Array(size * 2 - 1);
      for (let i = 0; i < size; i ++) {
        hashes[i + size - 1] = merkleHashTreeFunction(values[i]);
      }
      for (let i = (size - 1) * 2; i > 0; i -= 2) {
        hashes[Math.floor(i / 2) - 1] = Promise.all([hashes[i - 1], hashes[i]])
          .then(siblings => merkleHashTreeFunction(...siblings));
      }

      return Promise.all(hashes).then(hashes => {
        const signatures = hashes.map(hash => new Signature(hash, true));

        return liveSignatureSignFunction(hashes[0]).then(rootHashSignature => {
          signatures[0] = new SignedSignature(
            signatures[0],
            rootHashSignature,
          );

          return new MerkleHashTree(rootAddress, signatures);
        });
      });
    }

    static minSize(size) {
      return Math.pow(2, Math.ceil(Math.log2(size)));
    }
  }

  class MerkleHashTreeVerifier {
    constructor(hashTree) {
      this.hashTree = hashTree;
      this.signatures = {};
    }

    setHash({bin}, hash) {
      this.signatures[bin] = new Signature(hash);
    }

    setHashSignature({bin}, hash) {
      this.signatures[bin] = new SignedSignature(this.signatures[bin], hash);
    }

    verifyChunk(address, value) {
      const signatures = [];
      let hashResult = merkleHashTreeFunction(value);

      for (let bin of this.hashTree.getConstituentHashBins(address)) {
        let siblingSignature = this.hashTree.signatures[bin.siblingBfsIndex];
        if (siblingSignature === undefined) {
          siblingSignature = this.signatures[bin.siblingBin];
          signatures.push({
            index: bin.siblingBfsIndex,
            signature: siblingSignature,
          });
        }

        // if the current branch has already been verified short circuit
        const verifiedSignature = this.hashTree.signatures[bin.bfsIndex];
        if (verifiedSignature !== undefined) {
          hashResult = hashResult.then(hash => verifiedSignature.compare(hash));
          break;
        }

        // verify the generated root hash using the one supplied to the verifier
        if (bin.isRoot) {
          hashResult = hashResult.then(hash => siblingSignature.compare(hash));
          break;
        }

        // chain generating the next parent hash
        hashResult = hashResult.then(hash => {
          signatures.push({
            index: bin.bfsIndex,
            signature: new Signature(hash),
          });

          const siblingHash = siblingSignature.getHash();
          const siblings = bin.branch === 1 ? [hash, siblingHash] : [siblingHash, hash];
          return merkleHashTreeFunction(...siblings);
        });
      }

      return hashResult.then(() => {
        signatures.forEach(({index, signature}) => {
          signature.markVerified();
          this.hashTree.signatures[index] = signature;
        });
      });
    }
  }

  class UnifiedMerkleHashTree {
    constructor() {
      this.subtrees = [];
      this.nextStart = 0;
      this.chunkCount = 0;
    }

    findSubtree({bin}) {
      const index = binSearch(
        this.subtrees.length - 1,
        i => {
          const {start, end} = this.subtrees[i].rootAddress;
          return start <= bin && bin <= end ? 0 : start - bin;
        },
      );

      return index < 0 ? undefined : this.subtrees[index];
    }

    insertSubtree(subtree) {
      const storedSubtree = this.findSubtree(subtree.rootAddress);
      if (storedSubtree !== undefined) {
        if (storedSubtree !== subtree) {
          subtree.copy(storedSubtree);
        }

        return storedSubtree;
      }

      this.subtrees.push(subtree);
      this.subtrees.sort((a, b) => a.rootAddress.start - b.rootAddress.start);

      this.chunkCount += subtree.getChunkCount();
      this.pruneSubtrees();

      return subtree;
    }

    pruneSubtrees() {
      while (this.subtrees.length > 0 && this.chunkCount - this.subtrees[0].getChunkCount() > liveDiscardWindow) {
        const removedTree = this.subtrees.shift();
        this.chunkCount -= removedTree.getChunkCount();
      }
    }

    appendSubtree(values) {
      const treeSize = MerkleHashTree.minSize(values.length);
      const nextAddress = new Address(
        this.nextStart + treeSize - 1,
        [this.nextStart, this.nextStart + (treeSize - 1) * 2],
      );

      this.nextStart += treeSize * 2;

      return MerkleHashTree.from(values, nextAddress)
        .then(subtree => this.insertSubtree(subtree));
    }

    createVerifier(address) {
      let subtree = this.findSubtree(address) || new MerkleHashTree(address);
      return new MerkleHashSubtreeVerifier(this, subtree);
    }

    getConstituentSignatures(address) {
      const subtree = this.findSubtree(address);
      if (subtree === undefined) {
        return;
      }

      return subtree.getConstituentSignatures(address);
    }
  }

  class MerkleHashSubtreeVerifier extends MerkleHashTreeVerifier {
    constructor(unifiedHashTree, subtree) {
      super(subtree);
      this.unifiedHashTree = unifiedHashTree;
    }

    verifyChunk(address, value) {
      return super.verifyChunk(address, value)
        .then(this.unifiedHashTree.insertSubtree(this.hashTree));
    }
  }

  class NoneVerifier {
    setHash() {}

    setHashSignature() {}

    verifyChunk() {
      return Promise.resolve();
    }
  }

  class NoneVerifierFactory {
    createVerifier() {
      return new NoneVerifier();
    }

    getConstituentSignatures() {
      return [];
    }
  }

  // TODO: sign all method
  switch (contentIntegrityProtectionMethod) {
    case ContentIntegrityProtectionMethod.None:
      return new NoneVerifierFactory();
    case ContentIntegrityProtectionMethod.MerkleHashTree:
      return new MerkleHashTree();
    case ContentIntegrityProtectionMethod.UnifiedMerkleTree:
      return new UnifiedMerkleHashTree();
    default:
      throw new Error('unsupported content integrity protection method');
  }
};
