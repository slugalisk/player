const { Buffer } = require('buffer');
const arrayEqual = require('array-equal');
const crypto = require(process.env.REACT_APP_CRYPTO_PLUGIN);
const binSearch = require('../binSearch');

const {
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} = require('./constants');

const createMerkleHashTreeFunction = (merkleHashTreeFunction) => {
  const algorithms = {
    [MerkleHashTreeFunction.SHA1]: 'SHA-1',
    [MerkleHashTreeFunction.SHA224]: 'SHA-224',
    [MerkleHashTreeFunction.SHA256]: 'SHA-256',
    [MerkleHashTreeFunction.SHA384]: 'SHA-384',
    [MerkleHashTreeFunction.SHA512]: 'SHA-512',
  };
  const algorithm = algorithms[merkleHashTreeFunction];

  if (algorithm === undefined) {
    throw new Error('invalid merkle hash tree function');
  }

  return data => crypto.subtle.digest(algorithm, data);
};

const liveSignatureAlgorithms = {
  [LiveSignatureAlgorithm.RSASHA1]: {
    name: 'RSASSA-PKCS1-v1_5',
    hash: {name: 'SHA-1'},
  },
  [LiveSignatureAlgorithm.RSASHA256]: {
    name: 'RSASSA-PKCS1-v1_5',
    hash: {name: 'SHA-256'},
  },
  [LiveSignatureAlgorithm.ECDSAP256SHA256]: {
    name: 'ECDSA',
    hash: {name: 'SHA-256'},
  },
  [LiveSignatureAlgorithm.ECDSAP384SHA384]: {
    name: 'ECDSA',
    hash: {name: 'SHA-384'},
  },
};

const createLiveSignatureSignFunction = (liveSignatureAlgorithm, privateKey) => {
  // generateKey to bootstrap broadcast
  // importKey...? might be needed to initialize shit

  return data => crypto.subtle.sign(
    liveSignatureAlgorithms[liveSignatureAlgorithm],
    privateKey,
    data,
  );
};

const createLiveSignatureVerifyFunction = (liveSignatureAlgorithm, publicKey) => {
  // public key from swarm identifier?

  return (signature, data) => crypto.subtle.verify(
    liveSignatureAlgorithms[liveSignatureAlgorithm],
    publicKey,
    signature,
    data,
  );
};

const createContentIntegrity = (
  contentIntegrityProtectionMethod,
  merkleHashTreeFunction,
  liveSignatureVerifyFunction,
  liveDiscardWindow,
) => {
  class MerkleHashTree {
    constructor(size) {
      this.size = size;
      this.hashes = new Array(size * 2 - 1);
      this.verifyPromise = Promise.reject();
    }

    static from(values) {
      const tree = new MerkleHashTree(values.length);

      for (let i = 0; i < tree.size; i ++) {
        tree.hashes[i + tree.size - 1] = merkleHashTreeFunction(values[i]);
      }
      for (let i = (tree.size - 1) * 2; i > 0; i -= 2) {
        const siblings = [tree.hashes[i - 1], tree.hashes[i]];
        tree.hashes[Math.floor(i / 2) - 1] = merkleHashTreeFunction(Buffer.concat(siblings));
      }

      return tree;
    }

    setHash(bin, hash) {
      if (bin >= this.hashes.length) {
        throw new Error('hash bin out of range');
      }

      let index = 0;
      binSearch(
        this.hashes.length - 1,
        i => {
          if (i !== bin) {
            index = (index + 1) * 2 - (bin < i ? 1 : 0);
          }
          return i - bin;
        },
      );

      this.hashes[index] = hash;
    }

    verifyChunk(bin, value) {
      return this.verifyPromise.then(() => this.unsafelyVerifyChunk(bin, value));
    }

    unsafelyVerifyChunk(bin, value) {
      const uncles = this.getUncles(bin);
      if (uncles === null) {
        return false;
      }

      const hashes = new Array(uncles.lenght);
      let hash = merkleHashTreeFunction(value);

      for (let i = 0; i < uncles.length; i ++) {
        const {
          branch,
          hash: uncleHash,
          uncleIndex: index,
        } = uncles[i];

        hashes[i] = {
          index,
          hash,
        };

        const siblings = branch === 1 ? [hash, uncleHash] : [uncleHash, hash];
        hash = merkleHashTreeFunction(Buffer.concat(siblings));
      }

      if (!arrayEqual(this.hashes[0], hash)) {
        return false;
      }

      hashes.forEach(({index, hash}) => this.hashes[index] = hash);

      return true;
    }

    verifyRootHash(signature) {
      return this.verifyPromise = liveSignatureVerifyFunction(signature, this.hashes[0]);
    }

    getUncles(bin) {
      if (bin >= this.hashes.length) {
        return null;
      }

      const hashes = [];
      let index = this.size + bin / 2 - 1;
      let stride = 2;
      let parent = bin;

      while (index !== 0) {
        const branch = index % 2 === 1 ? 1 : -1;

        hashes.push({
          branch,
          bin: parent + branch * stride,
          hash: this.hashes[index + branch],
          uncleIndex: index,
        });

        index = Math.floor((index - 1) / 2);
        parent += branch * stride / 2;
        stride *= 2;
      }

      return hashes;
    }
  }

  class MerkleHashTreeVerifier {
    constructor() {
      this.hashTree = null;
    }

    setHash(address, hash) {
      if (this.hashTree === null) {
        this.hashTree = new MerkleHashTree(address.getChunkCount());
      }
      this.hashTree.setHash(address.bin, hash);
    }

    verifyHash({bin}, signature) {
      return this.hashTree === null
        ? Promise.reject()
        : this.hashTree.verifyPeakHash(signature);
    }

    verifyChunk({bin}, value) {
      return this.hashTree === null
        ? Promise.reject()
        : this.hashTree.verifyChunk(bin, value);
    }

    getIntegrityMessages() {
      return [];
    }
  }

  class MerkleHashSubtree {
    constructor(start, end) {
      this.start = start;
      this.end = end;
      this.hashTree = new MerkleHashTree(end - start);
    }

    static from(values, start) {
      return Object.create(MerkleHashSubtree.prototype, {
        start,
        end: start + values.length,
        hashTree: MerkleHashTree.from(values),
      });
    }

    setHash(bin, hash) {
      this.hashTree.setHash(bin - this.start, hash);
    }

    verifyChunk(bin, value) {
      return this.hashTree.verifyChunk(bin - this.start, value);
    }

    verifyPeakHash(signature) {
      return this.hashTree.verifyRootHash(signature);
    }

    getUncles(bin) {
      return this.hashTree.getUncles(bin - this.start).map((bin, ...rest) => ({
        ...rest,
        bin: bin + this.start,
      }));
    }

    getChunkCount() {
      return this.end - this.start;
    }
  }

  class UnifiedMerkleHashTreeVerifier {
    constructor() {
      this.hashTrees = [];
      this.chunkCount = 0;
    }

    findSubtree(bin) {
      const index = binSearch(
        this.hashTrees.length - 1,
        i => {
          const {start, end} = this.hashTree[i];
          return start <= bin && bin <= end ? 0 : start - bin;
        },
      );

      return index >= 0 ? this.hashTrees[index] : null;
    }

    createSubtree({start, end}) {
      const subtree = new MerkleHashSubtree(start, end);

      this.hashTrees.push(subtree);
      this.hashTrees.sort((a, b) => a.start - b.start);

      this.chunkCount += subtree.getChunkCount();
      while (this.chunkCount - this.hashTrees[0].getChunkCount() > liveDiscardWindow) {
        const removedTree = this.hashTrees.shift();
        this.chunkCount -= removedTree.getChunkCount();
      }

      return subtree;
    }

    setHash(address, hash) {
      const subtree = this.findSubtree(address.bin) || this.createSubtree(address);
      subtree.setHash(address.bin, hash);
    }

    verifyHash({bin}, signature) {
      const subtree = this.findSubtree(bin);
      return subtree === null
        ? Promise.reject()
        : subtree.verifyPeakHash(signature);
    }

    verifyChunk({bin}, value) {
      const subtree = this.findSubtree(bin);
      return subtree === null
        ? Promise.reject()
        : subtree.verifyChunk(bin, value);
    }

    getIntegrityMessages() {
      return [];
    }
  }

  class SignatureVerifier {
    setHash() {}

    verifyHash() {}

    verifyChunk() {
      return Promise.resolve();
    }

    getIntegrityMessages() {
      return [];
    }
  }

  class NoneVerifier {
    constructor() {
      this.promise = Promise.resolve(true);
    }

    setHash() {}

    verifyHash() {
      return this.promise;
    }

    verifyChunk() {
      return this.promise;
    }

    getIntegrityMessages() {
      return [];
    }
  }

  switch (contentIntegrityProtectionMethod) {
    case ContentIntegrityProtectionMethod.None:
      return NoneVerifier;
    case ContentIntegrityProtectionMethod.SignAll:
      return SignatureVerifier;
    case ContentIntegrityProtectionMethod.MerkleHashTree:
      return MerkleHashTreeVerifier;
    case ContentIntegrityProtectionMethod.UnifiedMerkleTree:
      return UnifiedMerkleHashTreeVerifier;
    default:
      throw new Error('unsupported content integrity protection method');
  }
};

module.exports = {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrity,
};
