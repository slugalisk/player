const hirestime = require('./hirestime');
const EMA = require('./ema');
const RingBuffer = require('./RingBuffer');

class DelayBuffer extends RingBuffer {
  constructor(capacity, window) {
    super(capacity);
    this.min = Infinity;
    this.window = window;
  }

  createEmptyValue() {
    return Infinity;
  }

  getMin() {
    return this.min;
  }

  update(delay) {
    const now = Math.floor(Date.now() / this.window);

    if (now >= this.lastIndex) {
      this.advanceLastIndex(now);
      this.min = Math.min(...this.values);
    }

    if (delay < this.get(now)) {
      this.set(now, delay);
      this.min = Math.min(this.min, delay);
    }
  }
}

// rfc6817
const TARGET = 100;
const ALLOWED_INCREASE = 1;
const GAIN = 1;
const CURRENT_HISTORY = 4;
const CURRENT_HISTORY_INTERVAL = 1000;
const BASE_HISTORY = 10;
const BASE_HISTORY_INTERVAL = 60 * 1000;
const INIT_CWND = 2;
const MIN_CWND = 2;

// max safe WebRTC data channel message size
const MSS = 65535;

// rfc6298
const COEF_G = 0.1;
const COEF_K = 4;

// jacobson, v. "congestion avoidance and control"
// doi: 10.1145/52325.52356
const COEF_ALPHA = 0.125;
const COEF_BETA = 0.25;

// const MIN_WINDOW_SIZE = 10;

class LEDBAT {
  constructor(target = TARGET) {
    this.target = target;
    this.flightSize = 0;
    this.cwnd = INIT_CWND * MSS;
    this.cto = 1000;
    this.currentDelay = new DelayBuffer(CURRENT_HISTORY, CURRENT_HISTORY_INTERVAL);
    this.baseDelay = new DelayBuffer(BASE_HISTORY, BASE_HISTORY_INTERVAL);

    this.lastDataLoss = 0;
    this.lastAckTime = Infinity;
    this.rttMean = new EMA(COEF_ALPHA);
    this.rttVar = new EMA(COEF_BETA);
  }

  addDelaySample(delaySample, bytes = MSS) {
    const delaySampleMs = hirestime.toMillis(delaySample);

    this.currentDelay.update(delaySampleMs);
    this.baseDelay.update(delaySampleMs);

    const queuingDelay = this.currentDelay.getMin() - this.baseDelay.getMin();
    const offTarget = (this.target - queuingDelay) / this.target;
    this.cwnd += GAIN * offTarget * bytes * MSS / this.cwnd;

    const maxAllowedCwnd = this.flightSize + ALLOWED_INCREASE * MSS;
    this.cwnd = Math.max(Math.min(this.cwnd, maxAllowedCwnd), MIN_CWND * MSS);

    this.flightSize = Math.max(0, this.flightSize - bytes);

    this.lastAckTime = Date.now();

    this.updateCto(queuingDelay);
  }

  updateCto(queuingDelay) {
    this.rtt = queuingDelay;

    this.rttMean.update(queuingDelay);
    this.rttVar.update(Math.abs(this.rttMean.value() - queuingDelay));

    this.cto = this.rttMean.value() + Math.max(COEF_G, COEF_K * this.rttVar.value());
    if (this.cto < 1000) {
      this.cto = 1000;
    }
  }

  onDataLoss(bytes, retransmitting = false) {
    const now = Date.now();
    if (this.lastDataLoss !== 0 && now - this.lastDataLoss < this.rtt) {
      return;
    }
    this.lastDataLoss = now;

    this.cwnd = Math.min(this.cwnd, Math.max(this.cwnd / 2, MIN_CWND * MSS));

    if (!retransmitting) {
      this.flightSize = Math.max(0, this.flightSize - bytes);
    }
  }

  checkAcks() {
    if (this.flightSize > 0 && Date.now() - this.cto > this.lastAckTime) {
      this.cwnd = MSS;
      this.cto = 2 * this.cto;
    }
  }

  static computeOneWayDelay(timestamp) {
    return hirestime.since(timestamp);
  }
}

module.exports = LEDBAT;
