function createMask(bits) {
  let mask = 0;
  for (let i = 0; i < bits; i ++) {
    mask = (mask << 1) | 1;
  }
  return mask;
}

function applyMask(byte, mask, value) {
  if (value) {
    return byte | mask;
  }
  return byte & (255 ^ mask);
}

export default class BitArray {
  constructor(capacity = 0) {
    this.offset = 0;
    this.resize(capacity);
  }

  // TODO: copy old values..?
  resize(capacity) {
    this.capacity = capacity;
    this.values = new Uint8Array(Math.ceil(capacity / 8));
  }

  adjustOffset(index) {
    const {offset} = this;
    const distance = (index - offset) - this.capacity;
    if (distance <= 0) {
      return;
    }

    this.offset += distance;
    this.unsafelySetRange(offset + 1, offset + distance + 1, false);
  }

  getByteIndex(index) {
    return Math.floor(index / 8) % this.values.length;
  }

  getBitIndex(index) {
    return index % 8;
  }

  getIndexValue(byteIndex, bitIndex) {
    const byteOffset = this.offset % (this.values.length * 8);
    const offset = byteIndex < byteOffset
      ? this.offset + (this.values.length * 8) - byteOffset
      : this.offset;
    return offset + (byteIndex * 8 + bitIndex);
  }

  setRange(start, end, value = true) {
    if (end - start === 1) {
      this.set(start, value);
      return;
    }

    if (end <= this.offset) {
      return;
    }
    start = Math.max(start, this.offset);

    this.adjustOffset(end);
    this.unsafelySetRange(start, end, value);
  }

  unsafelySetRange(start, end, value = true, fillEndByte = false) {
    if (end - start >= this.capacity) {
      this.values.fill(value ? 255 : 0);
      return;
    }

    const startByteIndex = this.getByteIndex(start);
    const endByteIndex = this.getByteIndex(end);
    const startBitIndex = this.getBitIndex(start);
    const endBitIndex = this.getBitIndex(end);

    if (startByteIndex > endByteIndex) {
      this.unsafelySetIndexRange(startByteIndex, startBitIndex, this.capacity, 0, value);
      this.unsafelySetIndexRange(0, 0, endByteIndex, endBitIndex, value);
      return;
    }

    this.unsafelySetIndexRange(startByteIndex, startBitIndex, endByteIndex, endBitIndex, value);
  }

  unsafelySetIndexRange(startByteIndex, startBitIndex, endByteIndex, endBitIndex, value) {
    let startMask = createMask(8 - startBitIndex);
    let endMask = 255 ^ createMask(8 - endBitIndex);

    if (startByteIndex === endByteIndex) {
      const mask = startMask & endMask;
      this.values[startByteIndex] = applyMask(this.values[startByteIndex], mask, value);
      return;
    }

    this.values[startByteIndex] = applyMask(this.values[startByteIndex], startMask, value);
    this.values[endByteIndex] = applyMask(this.values[endByteIndex], endMask, value);

    if (endByteIndex - startByteIndex > 1) {
      this.values.fill(value ? 255 : 0, startByteIndex + 1, endByteIndex);
    }
  }

  unsetRange(start, end) {
    this.setRange(start, end, false);
  }

  set(index, value = true) {
    if (index < this.offset) {
      return;
    }

    this.adjustOffset(index);

    const byteIndex = this.getByteIndex(index);
    const mask = 1 << (7 - this.getBitIndex(index));
    this.values[byteIndex] = applyMask(this.values[byteIndex], mask, value);
  }

  unset(index) {
    this.set(index, false);
  }

  get(index) {
    if (index <= this.offset || index > this.offset + this.capacity) {
      return false;
    }

    const byteIndex = this.getByteIndex(index);
    const mask = 1 << (7 - this.getBitIndex(index));
    return (this.values[byteIndex] & mask) !== 0;
  }

  toValueArray() {
    const values = [];
    for (let i = 1; i <= this.capacity; i ++) {
      if (this.get(this.offset + i)) {
        values.push(this.offset + i);
      }
    }
    return values;
  }

  min() {
    for (let i = this.offset; i <= this.offset + this.values.length * 8; i += 8) {
      if (this.values[this.getByteIndex(i)] !== 0) {
        const firstBit = Math.floor(i / 8) * 8;
        for (let j = firstBit; j < firstBit + 8; j ++) {
          if (this.get(j)) {
            return j;
          }
        }
      }
    }
    return Infinity;
  }

  max() {
    for (let i = this.values.length * 8 + this.offset; i >= this.offset; i -= 8) {
      if (this.values[this.getByteIndex(i)] !== 0) {
        const lastBit = Math.ceil((i + 1) / 8) * 8;
        for (let j = lastBit; j > lastBit - 8; j --) {
          if (this.get(j)) {
            return j;
          }
        }
      }
    }
    return -Infinity;
  }
}
