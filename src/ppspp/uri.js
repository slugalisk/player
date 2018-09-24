const URLSafeBase64 = require('urlsafe-base64');
const SwarmId = require('./swarmid');
const {ProtocolOptions} = require('./constants');

const protocolOptionToKey = {
  [ProtocolOptions.ContentIntegrityProtectionMethod]: 'x.im',
  [ProtocolOptions.MerkleHashTreeFunction]: 'x.hf',
  [ProtocolOptions.LiveSignatureAlgorithm]: 'x.sa',
  [ProtocolOptions.ChunkAddressingMethod]: 'x.am',
  [ProtocolOptions.ChunkSize]: 'x.cs',
}

// TODO: as (https://en.wikipedia.org/wiki/Magnet_URI_scheme#Normal_(as)) to m3u8 url?
class URI {
  constructor(swarmId, protocolOptions) {
    this.swarmId = swarmId;
    this.protocolOptions = protocolOptions;
  }

  toString() {
    const swarmId = URLSafeBase64.encode(this.swarmId.toBuffer());
    const protocolOptions = Object.entries(this.protocolOptions)
      .map(([protocolOption, value]) => `${protocolOptionToKey[protocolOption]}=${value}`)
      .join('&');
    return `magnet:?xt=urn:ppspp:${swarmId}&${protocolOptions}`;
  }

  static parse(uriString) {
    if (uriString.indexOf('magnet:') !== 0) {
      throw new Error('invalid uri: expected magnet');
    }

    const args = uriString.substring(8)
      .split('&')
      .map(queryEntry => queryEntry.split('='));

    const protocolOptions = Object.entries(protocolOptionToKey)
      .reduce((protocolOptions, [protocolOption, key]) => {
        const arg = args.find(([argKey]) => argKey === key);
        if (arg === undefined) {
          throw new Error(`invalid uri: missing ${key}`);
        }
        return {...protocolOptions, [protocolOption]: parseFloat(arg[1])};
      }, {});

    const xt = args.find(([key, value]) => key === 'xt' && value.startsWith('urn:ppspp:'));
    if (xt === undefined) {
      throw new Error('invalid uri: missing suitable xt');
    }
    const swarmId = SwarmId.from(URLSafeBase64.decode(xt[1].substring(10)));

    return new URI(swarmId, protocolOptions);
  }
}

module.exports = URI;

