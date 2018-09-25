const {ChunkAddressingMethod} = require('./constants');

class Address {
  constructor(bin = 0, treeBounds = Address.binBounds(bin)) {
    this.bin = bin;
    [this.start, this.end] = treeBounds;
  }

  containsBin(bin) {
    return this.start <= bin && bin <= this.end;
  }

  getChunkCount() {
    return (this.end - this.start) / 2 + 1;
  }

  static from(address) {
    if (address instanceof Address) {
      return address;
    }

    switch (address.type) {
      case ChunkAddressingMethod.Bin32:
        return new Address(address.value);
      case ChunkAddressingMethod.ChunkRange32: {
        const {start, end} = address;
        return new Address((end - start) / 2, [start, end]);
      }
      default:
        throw new Error('unsupported address type');
    }
  }

  static binBounds(bin) {
    let width = 2;
    while (bin % width === width - 1) {
      width *= 2;
    }
    width /= 2;

    return [
      bin - width + 1,
      bin + width - 1,
    ];
  }
}

module.exports = Address;
