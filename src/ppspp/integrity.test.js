/* globals it expect */

const integrity = require('./integrity');
const crypto = require('crypto');
const Address = require('./address');
const SwarmId = require('./swarmid');
const {
  createEncoding,
  createChunkAddressFieldType,
  createIntegrityHashFieldType,
  createLiveSignatureFieldType,
} = require('./encoding');

const {
  ChunkAddressingMethod,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  MessageTypes,
  LiveSignatureAlgorithm,
} = require('./constants');

it ('search', async () => {
  const remoteId = 1;

  const chunkAddressingMethod = ChunkAddressingMethod.Bin32;
  const merkleHashTreeFunction = MerkleHashTreeFunction.SHA256;
  const liveSignatureAlgorithm = LiveSignatureAlgorithm.ECDSAP256SHA256;
  // const liveSignatureAlgorithm = LiveSignatureAlgorithm.RSASHA256;

  const {
    privateKey,
    swarmId,
  } = await integrity.generateKeyPair(liveSignatureAlgorithm);

  const verifierFactory = integrity.createContentIntegrityVerifierFactory(
    ContentIntegrityProtectionMethod.UnifiedMerkleTree,
    integrity.createMerkleHashTreeFunction(merkleHashTreeFunction),
    integrity.createLiveSignatureVerifyFunction(liveSignatureAlgorithm, swarmId),
    integrity.createLiveSignatureSignFunction(liveSignatureAlgorithm, privateKey),
  );

  const data = Buffer.alloc(1.25 * 1024 * 1024);
  crypto.randomFillSync(data);

  const chunkSize = 8 * 1024;
  const chunkCount = data.length / chunkSize;
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i ++) {
    chunks[i] = data.slice(i * chunkSize, i * chunkSize + chunkSize);
  }

  await verifierFactory.appendSubtree(chunks);
  await verifierFactory.appendSubtree(chunks);

  // console.log(verifierFactory);

  const bin = 4;
  const address = new Address(bin);
  const chunk = chunks[bin / 2];

  // const verifier = verifierFactory.createVerifier(address);
  // console.log(verifier);


  // return verifier.verifyChunk(new Address(bin), chunk)
  //   .then(() => console.log('success'))
  //   .catch(e => console.log('error', e));

  // console.log(verifierFactory.getConstituentSignatures(new Address(bin)));

  const encoding = createEncoding();
  encoding.setChunkAddressFieldType(createChunkAddressFieldType(chunkAddressingMethod, chunkSize));
  encoding.setIntegrityHashFieldType(createIntegrityHashFieldType(merkleHashTreeFunction));
  encoding.setLiveSignatureFieldType(createLiveSignatureFieldType(liveSignatureAlgorithm, swarmId));

  const messages = [];
  verifierFactory.getConstituentSignatures(address)
    .reverse()
    .forEach(({bin, signature}, i) => {
      const address = encoding.ChunkAddress.from(new Address(bin));

      messages.push(new encoding.IntegrityMessage(
        address,
        new encoding.IntegrityHash(signature.getHash()),
      ));

      if (i === 0) {
        messages.push(new encoding.SignedIntegrityMessage(
          address,
          new encoding.Timestamp(),
          new encoding.LiveSignature(signature.getSignatureHash()),
        ));
      }
    });

  messages.push(new encoding.DataMessage(encoding.ChunkAddress.from(address), chunk));

  const datagram = new encoding.Datagram(remoteId, messages);
  const buffer = datagram.toBuffer();

  // console.log(buffer);

  const remoteSwarmId = SwarmId.from(swarmId.toBuffer());

  const remoteVerifierFactory = integrity.createContentIntegrityVerifierFactory(
    ContentIntegrityProtectionMethod.UnifiedMerkleTree,
    integrity.createMerkleHashTreeFunction(merkleHashTreeFunction),
    integrity.createLiveSignatureVerifyFunction(liveSignatureAlgorithm, remoteSwarmId),
  );

  let remoteVerifier = null;
  const createRemoteVerifier = address => {
    if (remoteVerifier === null) {
      remoteVerifier = remoteVerifierFactory.createVerifier(address);
    }
    return remoteVerifier;
  };

  const remoteDatagram = new encoding.Datagram();
  remoteDatagram.read(buffer);
  remoteDatagram.messages.toArray();

  // console.log(remoteDatagram);

  remoteDatagram.messages.toArray().forEach(message => {
    // console.log(message);

    switch (message.type) {
      case MessageTypes.INTEGRITY: {
        const address = Address.from(message.address);
        createRemoteVerifier(address).setHash(address, message.hash.value);
        break;
      }
      case MessageTypes.SIGNED_INTEGRITY: {
        const address = Address.from(message.address);
        createRemoteVerifier(address).setHashSignature(address, message.signature.value);
        break;
      }
      case MessageTypes.DATA: {
        const address = Address.from(message.address);
        createRemoteVerifier(address)
          .verifyChunk(address, message.data)
          .then(() => console.log('success'))
          .catch(() => console.log('failure :('));
        break;
      }
    }
  });
});
