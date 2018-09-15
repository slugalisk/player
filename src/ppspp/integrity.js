const { Buffer } = require('buffer');
const arrayEqual = require('array-equal');
const crypto = require(process.env.REACT_APP_CRYPTO_PLUGIN);
const binSearch = require('../binSearch');
const Address = require('./address');

const {
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} = require('./constants');

const toUint8Array = data => new Uint8Array(data);

const MerkleHashTreeFunctionAlgorithms = {
  [MerkleHashTreeFunction.SHA1]: 'SHA-1',
  [MerkleHashTreeFunction.SHA224]: 'SHA-224',
  [MerkleHashTreeFunction.SHA256]: 'SHA-256',
  [MerkleHashTreeFunction.SHA384]: 'SHA-384',
  [MerkleHashTreeFunction.SHA512]: 'SHA-512',
};

const MerkleHashTreeFunctionByteLengths = {
  [MerkleHashTreeFunction.SHA1]: 20,
  [MerkleHashTreeFunction.SHA224]: 28,
  [MerkleHashTreeFunction.SHA256]: 32,
  [MerkleHashTreeFunction.SHA384]: 48,
  [MerkleHashTreeFunction.SHA512]: 64,
};

const createMerkleHashTreeFunction = (merkleHashTreeFunction) => {
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
      values = new Uint8Array(values);
    } else {
      values = values[0];
    }

    return crypto.subtle.digest(algorithm, values).then(toUint8Array);
  }
};

const LiveSignatureAlgorithms = {
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
    LiveSignatureAlgorithms[liveSignatureAlgorithm],
    privateKey,
    data,
  ).then(toUint8Array);
};

const createLiveSignatureVerifyFunction = (liveSignatureAlgorithm, publicKey) => {
  // public key from swarm identifier?

  return (signature, data) => crypto.subtle.verify(
    LiveSignatureAlgorithms[liveSignatureAlgorithm],
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

  class SignedSignature {
    constructor(signature, hash) {
      this.signature = signature;
      this.hash = hash;
      this.verificationResult = null;
    }

    verifyHash() {
      if (this.verificationResult === null) {
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

    getConstituentHashBins({bin}) {
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
        const branch = bfsIndex % 2 === 1 ? 1 : -1;

        bins.push({
          isRoot: false,
          branch,
          bin: parent + start,
          bfsIndex,
          siblingBin: parent + branch * stride + start,
          siblingBfsIndex: bfsIndex + branch,
        });

        bfsIndex = Math.floor((bfsIndex - 1) / 2);
        parent += branch * stride / 2;
        stride *= 2;
      }

      bins.push({
        isRoot: true,
        branch: 0,
        bin: parent + start,
        bfsIndex: 0,
        siblingBin: parent + start,
        siblingBfsIndex: 0,
      });

      return bins;
    }

    getConstituentSignatures(address) {
      return this.getConstituentHashBins(address).map(({
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
      const signature = new SignedSignature(this.signatures[bin], hash);
      this.signatures[bin] = signature;
    }

    verifyChunk(address, value) {
      const signatures = [];
      let hashResult = merkleHashTreeFunction(value);

      this.hashTree.getConstituentHashBins(address).some(({
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
        signatures.forEach(({index, signature}) => {
          signature.markVerified();
          this.hashTree.signatures[index] = signature
        });
      });
    }
  }

  class UnifiedMerkleHashTree {
    constructor() {
      this.subtrees = [];
      this.nextStart = 0;
      this.chunkCount = 0;
      this.liveDiscardWindow = Infinity;
    }

    setLiveDiscardWindow(liveDiscardWindow) {
      this.liveDiscardWindow = liveDiscardWindow;
      this.pruneSubtrees();
    }

    findSubtree({bin}) {
      const index = binSearch(
        this.subtrees.length - 1,
        i => {
          const {start, end} = this.subtrees[i].rootAddress;
          return start <= bin && bin <= end ? 0 : start - bin;
        },
      );

      return index < 0 ? null : this.subtrees[index];
    }

    insertSubtree(subtree) {
      const storedSubtree = this.findSubtree(subtree.rootAddress);
      if (storedSubtree !== null) {
        if (storedSubtree !== subtree) {
          subtree.copy(storedSubtree);
        }

        return storedSubtree;
      }

      this.subtrees.push(subtree);
      this.subtrees.sort((a, b) => a.start - b.start);

      this.chunkCount += subtree.getChunkCount();
      this.pruneSubtrees();

      return subtree;
    }

    pruneSubtrees() {
      while (this.chunkCount - this.subtrees[0].getChunkCount() > this.liveDiscardWindow) {
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
      return this.findSubtree(address).getConstituentSignatures(address);
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

module.exports = {
  MerkleHashTreeFunctionByteLengths,
  MerkleHashTreeFunctionAlgorithms,
  LiveSignatureAlgorithms,
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrityVerifierFactory,
};
