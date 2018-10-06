class EMA {
  constructor(alpha) {
    this.mean = 0;
    this.alpha = alpha;
    this.weight = 1;
  }

  update(value) {
    this.mean = this.alpha * value + (1 - this.alpha) * this.mean;
    this.weight *= this.alpha;
  }

  set(value) {
    this.mean = value;
    this.weight = 0;
  }

  isEmpty() {
    return this.weight === 1;
  }

  value() {
    return this.mean / (1 - this.weight);
  }
}

module.exports = EMA;
