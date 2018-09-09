const { Buffer } = require('buffer');
const arrayEqual = require('array-equal');
const webcrypto = require('node-webcrypto-ossl');

const createMerkleHashTreeFunction = (MerkleHashTreeFunction) => {
  const algorithms = {
    [MerkleHashTreeFunction.SHA1]: 'SHA-1',
    [MerkleHashTreeFunction.SHA224]: 'SHA-224',
    [MerkleHashTreeFunction.SHA256]: 'SHA-256',
    [MerkleHashTreeFunction.SHA384]: 'SHA-384',
    [MerkleHashTreeFunction.SHA512]: 'SHA-512',
  };
  const algorithm = algorithms[algorithmSpecifier];

  if (algorithm === undefined) {
    throw new Error('invalid merkle hash tree function');
  }

  return data => webcrypto.subtle.digest(algorithm, data);
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

const createLiveSignatureSignFunction = (
  liveSignatureAlgorithm,
  privateKey,
) => {
  // generateKey to bootstrap broadcast
  // importKey...? might be needed to initialize shit

  return data => webcrypto.subtle.sign(
    liveSignatureAlgorithms[liveSignatureAlgorithm],
    privateKey,
    data,
  );
};

const createLiveSignatureVerifyFunction = (
  liveSignatureAlgorithm,
  publicKey,
) => {
  // public key from swarm identifier?

  return (signature, data) => webcrypto.subtle.verify(
    liveSignatureAlgorithms[liveSignatureAlgorithm],
    publicKey,
    signature,
    data,
  );
};

const createContentIntegrity = (
  contentIntegrityProtectionMethod,
  merkleHashTreeFunction,
  liveSignatureAlgorithm,
) => {
  class MerkleHashTree {
    constructor(size) {
      this.size = size;
      this.hashes = new Array(size * 2 - 1);
    }

    static from(values) {
      const tree = new MerkleHashTree(values.length);

      for (let i = 0; i < tree.size; i ++) {
        tree.hashes[i + tree.size - 1] = MerkleHashTree.hash(chunks[i]);
      }
      for (let i = (tree.size - 1) * 2; i > 0; i -= 2) {
        const siblings = [tree.hashes[i - 1], tree.hashes[i]];
        tree.hashes[Math.floor(i / 2) - 1] = MerkleHashTree.hash(Buffer.concat(siblings));
      }

      return tree;
    }

    insert(bin, hash) {
      if (bin >= this.hashes.length) {
        throw new Error('hash bin out of range');
      }

      let left = 0;
      let right = this.hashes.length - 1;
      let index = 0;

      while (true) {
        const mid = Math.floor((left + right) / 2);

        if (mid === bin) {
          break;
        }

        index = (index + 1) * 2;
        if (mid < bin) {
          left = mid + 1;
        } else {
          right = mid - 1;
          index --;
        }
      }

      this.hashes[index] = hash;
    }

    verify(bin, value) {
      const uncles = this.getUncles(bin);
      if (uncles === null) {
        return false;
      }

      const hashes = new Array(uncles.lenght);
      let hash = MerkleHashTree.hash(value);

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
        hash = MerkleHashTree.hash(Buffer.concat(siblings));
      }

      if (!arrayEqual(this.hashes[0], hash)) {
        return false;
      }

      hashes.forEach(({index, hash}) => this.hashes[index] = hash);

      return true;
    }

    getPeak() {
      return this.hashes[0];
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

  class NoneVerifier {
    insert() {}

    verify() {
      return true;
    }
  }

  // handle signed integrity
  // ... generate signed integrity
  // handle/generate integrity hashes
  // verify chunks

  switch (contentIntegrityProtectionMethod) {
    case ContentIntegrityProtectionMethod.None:
      return NoneVerifier;
    case ContentIntegrityProtectionMethod.SignAll:
      return SignatureVerifier;
    case ContentIntegrityProtectionMethod.MerkleHashTree:
    case ContentIntegrityProtectionMethod.UnifiedMerkleTree:
      MerkleHashTree.hash = createMerkleHashTreeFunction(merkleHashTreeFunction);
      return MerkleHashTree;
  }
};

module.exports = {
  createMerkleHashTreeFunction,
  createLiveSignatureSignFunction,
  createLiveSignatureVerifyFunction,
  createContentIntegrity,
};
