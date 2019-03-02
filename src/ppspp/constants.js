import invert from 'lodash.invert';

export const MaxChannelId = 0xffffffff;

export const ProtocolOptions = {
  Version: 0,
  MinimumVersion: 1,
  SwarmIdentifier: 2,
  ContentIntegrityProtectionMethod: 3,
  MerkleHashTreeFunction: 4,
  LiveSignatureAlgorithm: 5,
  ChunkAddressingMethod: 6,
  LiveDiscardWindow: 7,
  SupportedMessages: 8,
  ChunkSize: 9,
  EndOption: 255,
};

export const Version = {
  RFC7574: 1,
};

export const ContentIntegrityProtectionMethod = {
  None: 0,
  MerkleHashTree: 1,
  SignAll: 2,
  UnifiedMerkleTree: 3,
};

export const MerkleHashTreeFunction = {
  SHA1: 0,
  SHA224: 1,
  SHA256: 2,
  SHA384: 3,
  SHA512: 4,
};

export const LiveSignatureAlgorithm = {
  RSASHA1: 5,
  RSASHA256: 8,
  ECDSAP256SHA256: 13,
  ECDSAP384SHA384: 14,
};

export const ChunkAddressingMethod = {
  Bin32: 0,
  ByteRange64: 1,
  ChunkRange32: 2,
  Bin64: 3,
  ChunkRange64: 4,
};

export const VariableChunkSize = 0xffffffff;

export const MessageTypes = {
  HANDSHAKE: 0,
  DATA: 1,
  ACK: 2,
  HAVE: 3,
  INTEGRITY: 4,
  PEX_RESv4: 5,
  PEX_REQ: 6,
  SIGNED_INTEGRITY: 7,
  REQUEST: 8,
  CANCEL: 9,
  CHOKE: 10,
  UNCHOKE: 11,
  PEX_RESv6: 12,
  PEX_REScert: 13,
};

[
  ProtocolOptions,
  Version,
  ContentIntegrityProtectionMethod,
  MerkleHashTreeFunction,
  LiveSignatureAlgorithm,
  ChunkAddressingMethod,
  MessageTypes,
].forEach(enumType => {
  const names = invert(enumType);
  enumType.name = value => names[value] || 'UNDEFINED';
});
