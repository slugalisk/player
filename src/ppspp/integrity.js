const { Buffer } = require('buffer');
const arrayEqual = require('array-equal');
const crypto = require(process.env.REACT_APP_CRYPTO_PLUGIN);
const binSearch = require('../binSearch');

const {
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} = require('./constants');

const toUint8Array = data => new Uint8Array(data);

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

  return data => crypto.subtle.digest(algorithm, data).then(toUint8Array);
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
    namedCurve: 'P-256',
    hash: {name: 'SHA-256'},
  },
  [LiveSignatureAlgorithm.ECDSAP384SHA384]: {
    name: 'ECDSA',
    namedCurve: 'P-384',
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
  ).then(toUint8Array);
};

const createLiveSignatureVerifyFunction = (liveSignatureAlgorithm, publicKey) => {
  // public key from swarm identifier?

  return (signature, data) => crypto.subtle.verify(
    liveSignatureAlgorithms[liveSignatureAlgorithm],
    publicKey,
    signature,
    data,
  ).then(toUint8Array);
};

const unavailableLiveSignatureSignFunction = () => Promise.reject('live signature function not available');

const createContentIntegrityVerifierFactory = (
  contentIntegrityProtectionMethod,
  merkleHashTreeFunction,
  liveSignatureVerifyFunction,
  liveSignatureSignFunction = unavailableLiveSignatureSignFunction,
) => {
  class Signature {
    constructor(hash) {
      this.hash = hash;
    }

    getHash() {
      return this.hash;
    }

    compare(value) {
      return Promise.resolve(arrayEqual(this.hash, value));
    }
  }

  class SignedSignature {
    constructor(signature, hash) {
      this.signature = signature;
      this.hash = hash;
      this.verificationResult = null;
    }

    verifyHash() {
      return this.verificationResult === null
        ? (this.verificationResult = liveSignatureVerifyFunction(this.hash, this.getHash()))
        : this.verificationResult;
    }

    getHash() {
      return this.signature.getHash();
    }

    compare(value) {
      return this.verifyHash().then(() => this.signature.compare(value));
    }
  }

  class MerkleHashTree {
    constructor(size, signatures = new Array(size * 2 - 1)) {
      this.size = size;
      this.signatures = signatures;
    }

    createVerifier() {
      return new MerkleHashTreeVerifier(this);
    }

    getConstituentHashBins(bin) {
      const bins = [];
      let bfsIndex = this.size + bin / 2 - 1;
      let stride = 2;
      let parent = bin;

      while (bfsIndex !== 0) {
        const branch = bfsIndex % 2 === 1 ? 1 : -1;

        bins.push({
          isRoot: false,
          branch,
          bin: parent,
          bfsIndex,
          siblingBin: parent + branch * stride,
          siblingBfsIndex: bfsIndex + branch,
        });

        bfsIndex = Math.floor((bfsIndex - 1) / 2);
        parent += branch * stride / 2;
        stride *= 2;
      }

      bins.push({
        isRoot: true,
        branch: 0,
        bin: parent,
        bfsIndex: 0,
        siblingBin: parent,
        siblingBfsIndex: 0,
      });

      return bins;
    }

    static from(values) {
      const hashes = new Array(values.length * 2 - 1);
      for (let i = 0; i < values.length; i ++) {
        hashes[i + values.length - 1] = merkleHashTreeFunction(values[i]);
      }
      for (let i = (values.length - 1) * 2; i > 0; i -= 2) {
        hashes[Math.floor(i / 2) - 1] = Promise.all([hashes[i - 1], hashes[i]])
          .then(siblings => merkleHashTreeFunction(new Uint8Array(siblings)));
      }

      return Promise.all(hashes).then(hashes => {
        const signatures = hashes.map(hash => new Signature(hash));

        signatures[0] = new SignedSignature(
          signatures[0],
          liveSignatureSignFunction(hashes[0]),
        );

        return new MerkleHashTree(values.length, signatures);
      });
    }
  }

  class MerkleHashTreeVerifier {
    constructor(hashTree) {
      this.hashTree = hashTree;
      this.signatures = {};
    }

    setHash(bin, hash) {
      this.signatures[bin] = new Signature(hash);
    }

    setHashSignature(bin, hash) {
      const signature = new SignedSignature(this.signatures[bin], hash);
      this.signatures[bin] = signature;
    }

    verifyChunk(bin, value) {
      const signatures = [];
      let hashResult = merkleHashTreeFunction(value);

      this.hashTree.getConstituentHashBins(bin).some(({
        isRoot,
        branch,
        bfsIndex,
        siblingBin,
        siblingBfsIndex,
      }) => {
        let siblingSignature = this.hashTree.signatures[siblingBfsIndex];
        if (siblingSignature === undefined) {
          siblingSignature = this.signatures[siblingBin];
          signatures.push({
            index: siblingBfsIndex,
            signature: siblingSignature,
          });
        }

        // if the current branch has already been verified short circuit
        const verifiedSignature = this.hashTree.signatures[bfsIndex];
        if (verifiedSignature !== undefined) {
          hashResult = hashResult.then(hash => verifiedSignature.compare(hash));
          return true;
        }

        // verify the generated root hash using the one supplied to the mutator
        if (isRoot) {
          hashResult = hashResult.then(hash => siblingSignature.compare(hash));
          return true;
        }

        // chain generating the next parent hash
        hashResult = hashResult.then(hash => {
          signatures.push({
            index: bfsIndex,
            signature: new Signature(hash),
          });

          const siblingHash = siblingSignature.getHash();
          const siblings = branch === 1 ? [hash, siblingHash] : [siblingHash, hash];
          return merkleHashTreeFunction(Buffer.concat(siblings));
        });
        return false;
      });

      return hashResult.then(() => {
        signatures.forEach(({index, signature}) => this.hashTree.signatures[index] = signature);
      });
    }
  }

  class MerkleHashSubtree {
    constructor(start, end, hashTree = new MerkleHashTree(end - start)) {
      this.start = start;
      this.end = end;
      this.hashTree = hashTree;
    }

    createVerifier() {
      return new MerkleHashSubtreeVerifier(this);
    }

    getConstituentHashBins(bin) {
      const constituents = this.hashTree.getConstituentHashBins();
      constituents.forEach(constituent => {
        constituent.bin += this.start;
        constituent.siblingBfsIndex += this.start;
      });
      return constituents;
    }

    static from(values, start) {
      return MerkleHashTree.from(values)
        .then(hashTree => new MerkleHashSubtree(
          start,
          start + values.length,
          hashTree,
        ));
    }
  }

  class MerkleHashSubtreeVerifier {
    constructor(subtree) {
      this.subtree = subtree;
      this.hashTreeVerifier = new MerkleHashTreeVerifier(subtree.hashTree);
    }

    setHash(bin, hash) {
      this.hashTreeVerifier.setHash(bin - this.subtree.start, hash);
    }

    setHashSignature(bin, hash) {
      this.hashTreeVerifier.setHashSignature(bin - this.subtree.start, hash);
    }

    verifyChunk(bin, value) {
      return this.hashTreeVerifier.verifyChunk(bin - this.subtree.start, value);
    }
  }

  class MerkleHashTreeVerifierFactory {
    constructor() {
      this.hashTree = null;
    }

    createVerifier() {
      return new this.hashTree.createVerifier();
    }

    getIntegrityMessages() {
      return [];
    }
  }

  class UnifiedMerkleHashTreeVerifierFactory {
    constructor() {
      this.hashTrees = [];
      this.chunkCount = 0;
      this.liveDiscardWindow = Infinity;
    }

    setLiveDiscardWindow(liveDiscardWindow) {
      this.liveDiscardWindow = liveDiscardWindow;
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

    insertSubtree(subtree) {
      // TODO: detect duplicate and.... merge?
      this.hashTrees.push(subtree);
      this.hashTrees.sort((a, b) => a.start - b.start);

      this.chunkCount += subtree.getChunkCount();
      this.pruneSubtrees();
    }

    pruneSubtrees() {
      while (this.chunkCount - this.hashTrees[0].getChunkCount() > this.liveDiscardWindow) {
        const removedTree = this.hashTrees.shift();
        this.chunkCount -= removedTree.getChunkCount();
      }
    }

    createSubtree({start, end}, values = null) {
      return values === null
        ? Promise.resolve(new MerkleHashSubtree(start, end))
        : MerkleHashSubtree.from(values, start);
    }

    createVerifier() {

    }

    getIntegrityMessages() {
      return [];
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

    getIntegrityMessages() {
      return [];
    }
  }

  // TODO: sign all method
  switch (contentIntegrityProtectionMethod) {
    case ContentIntegrityProtectionMethod.None:
      return new NoneVerifierFactory();
    case ContentIntegrityProtectionMethod.MerkleHashTree:
      return new MerkleHashTreeVerifierFactory();
    case ContentIntegrityProtectionMethod.UnifiedMerkleTree:
      return new UnifiedMerkleHashTreeVerifierFactory();
    default:
      throw new Error('unsupported content integrity protection method');
  }
};

module.exports = {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrityVerifierFactory,
};
