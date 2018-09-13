/* globals it expect */

import integrity from './integrity';
import crypto from 'crypto';
import Address from './address';

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

  // const liveSignatureSignFunction = integrity.createLiveSignatureSignFunction(
  //   LiveSignatureAlgorithm.RSASHA256,
  //   privateKey,
  // );

  const liveSignatureVerifyFunction = integrity.createLiveSignatureVerifyFunction(
    LiveSignatureAlgorithm.RSASHA256,
    publicKey,
  );

  const merkleHashTreeFunction  = integrity.createMerkleHashTreeFunction(
    MerkleHashTreeFunction.SHA256,
  );

  const VerifierType = integrity.createContentIntegrity(
    ContentIntegrityProtectionMethod.UnifiedMerkleTree,
    merkleHashTreeFunction,
    liveSignatureVerifyFunction,
    Infinity,
  );

  const verifier = new VerifierType();

  const data = Buffer.alloc(1.25 * 1024 * 1024);
  crypto.randomFillSync(data);

  const chunkCount = 16;
  const chunkSize = data.length / chunkCount;
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i ++) {
    chunks[i] = data.slice(i * chunkSize, i * chunkSize + chunkSize);
  }

  const subtree = await verifier.createSubtree(new Address(15), chunks);
  console.log(subtree);
});
