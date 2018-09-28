class RingBuffer {
  constructor(capacity) {
    this.setCapacity(capacity);
  }

  setCapacity(capacity) {
    this.capacity = capacity;
    this.lastIndex = capacity;
    this.values = new Array(capacity);

    for (let i = 0; i < capacity; i ++) {
      this.values[i] = this.createEmptyValue(i);
    }
  }

  advanceLastIndex(lastIndex) {
    if (this.lastIndex > lastIndex) {
      return;
    }

    for (let i = this.lastIndex; i < lastIndex; i ++) {
      const index = i % this.capacity;
      this.values[index] = this.createEmptyValue(i, this.values[index]);
    }
    this.lastIndex = lastIndex + 1;
  }

  createEmptyValue() {
    return undefined;
  }

  set(index, value) {
    this.advanceLastIndex(index);
    this.values[index % this.capacity] = value;
  }

  get(index) {
    if (index < this.lastIndex - this.capacity || index >= this.lastIndex) {
      return undefined;
    }
    return this.values[index % this.capacity];
  }

  push(value) {
    this.set(this.lastIndex, value);
  }
}

module.exports = RingBuffer;
