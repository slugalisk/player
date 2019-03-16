export default class RingBuffer {
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

    let firstEmptyIndex = this.lastIndex;
    if (lastIndex - firstEmptyIndex > this.capacity) {
      firstEmptyIndex = lastIndex - this.capacity;
    }
    for (let i = firstEmptyIndex; i <= lastIndex; i ++) {
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

  push(value) {
    this.set(this.lastIndex, value);
  }

  get firstIndex() {
    return this.lastIndex - this.capacity;
  }

  get(index) {
    if (index < this.firstIndex || index >= this.lastIndex) {
      return this.createEmptyValue(index);
    }
    return this.values[index % this.capacity];
  }
}
