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

class BitArray {
  constructor(size = 0) {
    this.offset = 0;
    this.resize(size);
  }

  // TODO: copy old values..?
  resize(size) {
    this.size = size;
    this.values = new Uint8Array(Math.ceil(size / 8));
  }

  adjustOffset(index) {
    const {offset} = this;
    const distance = (index - offset) - this.size;
    if (distance <= 0) {
      return;
    }

    this.offset += distance;
    this.unsafelySetRange(offset + 1, offset + distance, false);
  }

  getByteIndex(index) {
    return Math.floor(index / 8) % this.values.length
  }

  setRange(start, end, value = true) {
    if (end <= this.offset) {
      return;
    }
    start = Math.max(start, this.offset);

    this.adjustOffset(end);
    this.unsafelySetRange(start, end, value);
  }

  unsafelySetRange(start, end, value = true) {
    if (end - start >= this.size) {
      this.values.fill(value ? 255 : 0);
      return;
    }

    const startByteIndex = this.getByteIndex(start);
    const endByteIndex = this.getByteIndex(end);

    if (startByteIndex > endByteIndex) {
      const ringSize = this.values.length * 8;
      this.setRange(Math.floor(end / ringSize) * ringSize, end, value);
      this.setRange(start, Math.ceil(start / ringSize) * ringSize - 1, value);
      return;
    }

    let startMask = createMask(8 - (start % 8));
    let endMask = 255 ^ createMask(8 - (end % 8));

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
    const mask = 1 << (7 - (index % 8));
    this.values[byteIndex] = applyMask(this.values[byteIndex], mask, value)
  }

  unset(index) {
    this.set(index, false);
  }

  get(index) {
    if (index <= this.offset || index > this.offset + this.size) {
      return false;
    }

    const byteIndex = this.getByteIndex(index);
    const mask = 1 << (7 - (index % 8));
    return (this.values[byteIndex] & mask) !== 0
  }

  toValueArray() {
    const values = [];
    for (let i = 1; i <= this.size; i ++) {
      if (this.get(this.offset + i)) {
        values.push(this.offset + i);
      }
    }
    return values;
  }
}

module.exports = BitArray;
