const invert = require('lodash.invert');
const URLSafeBase64 = require('urlsafe-base64');
const SwarmId = require('./swarmid');
const {ProtocolOptions} = require('./constants');

const protocolOptionToKey = {
  [ProtocolOptions.ContentIntegrityProtectionMethod]: 'cipm',
  [ProtocolOptions.MerkleHashTreeFunction]: 'mhtf',
  [ProtocolOptions.LiveSignatureAlgorithm]: 'lsa',
  [ProtocolOptions.ChunkAddressingMethod]: 'cam',
  [ProtocolOptions.ChunkSize]: 'cs',
}
const keyToProtocolOption = invert(protocolOptionToKey);

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
    return `ppspp://${swarmId}?${protocolOptions}`;
  }

  static parse(uriString) {
    if (uriString.indexOf('ppspp://') !== 0) {
      throw new Error('invalid protocol expected ppspp://');
    }

    const queryIndex = uriString.indexOf('?');
    const swarmId = SwarmId.from(URLSafeBase64.decode(uriString.substring(8, queryIndex)));
    const protocolOptions = uriString.substring(queryIndex + 1)
      .split('&')
      .reduce((options, queryEntry) => {
        const [key, value] = queryEntry.split('=');
        options[keyToProtocolOption[key]] = parseFloat(value);
        return options;
      }, {});

    return new URI(swarmId, protocolOptions);
  }
}

module.exports = URI;

