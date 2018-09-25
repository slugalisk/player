// const Buffer = require('buffer');
import SwarmId from './swarmid';
import {LiveSignatureAlgorithm} from './constants';

it ('encode/decode', () => {
  const key = Buffer.from(new Uint8Array(0x00, 0x01, 0x01, 0x01, 0x02, 0x00, 0x9e, 0x0d, 0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0xef, 0xbf, 0xbd, 0x48, 0xef, 0xbf, 0xbd, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0xef, 0xbf, 0xbd, 0x48, 0xef, 0xbf, 0xbd, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42));
  const a = new SwarmId(LiveSignatureAlgorithm.ECDSAP256SHA256, key);

  expect(a).toEqual(SwarmId.from(a.toBuffer()));
  expect(SwarmId.from(a.toBuffer()).toBuffer()).toEqual(a.toBuffer());
});
