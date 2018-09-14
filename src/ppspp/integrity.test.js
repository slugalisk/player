/* globals it expect */

const integrity = require('./integrity');
const crypto = require('crypto');
const Address = require('./address');

const webcrypto = require(process.env.REACT_APP_CRYPTO_PLUGIN);

import {
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
} from './constants';

it ('search', async () => {
  const {publicKey, privateKey} = await webcrypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  )

  const liveSignatureSignFunction = integrity.createLiveSignatureSignFunction(
    LiveSignatureAlgorithm.ECDSAP256SHA256,
    privateKey,
  );

  const liveSignatureVerifyFunction = integrity.createLiveSignatureVerifyFunction(
    LiveSignatureAlgorithm.ECDSAP256SHA256,
    publicKey,
  );

  const merkleHashTreeFunction  = integrity.createMerkleHashTreeFunction(
    MerkleHashTreeFunction.SHA256,
  );

  const verifierFactory = integrity.createContentIntegrityVerifierFactory(
    ContentIntegrityProtectionMethod.UnifiedMerkleTree,
    merkleHashTreeFunction,
    liveSignatureVerifyFunction,
    liveSignatureSignFunction,
  );

  const data = Buffer.alloc(1.25 * 1024 * 1024);
  crypto.randomFillSync(data);

  const chunkCount = 16;
  const chunkSize = data.length / chunkCount;
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i ++) {
    chunks[i] = data.slice(i * chunkSize, i * chunkSize + chunkSize);
  }

  const subtree = await verifierFactory.createSubtree(new Address(15), chunks);
  console.log(subtree);

  const verifier = subtree.createVerifier();
  console.log(verifier);

  const bin = 14;
  return verifier.verifyChunk(bin, chunks[bin / 2])
    .then(() => console.log('success'))
    .catch(e => console.log('error', e));
});
