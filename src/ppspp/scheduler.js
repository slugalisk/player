import BitArray from '../bitarray';
import Address from './address';
import wfq from '../wfq';
import EMA from '../ema';
import LEDBAT from '../ledbat';
import RingBuffer from '../RingBuffer';
import fenwick from 'fenwick-tree';
import binSearch from '../binSearch';
// import TinyQeueue from 'tinyqueue';

export class AvailabilityMap {
  constructor(capacity) {
    this.values = new BitArray(capacity);
  }

  // TODO: ignore very large discard windows from remote peers...
  setCapacity(capacity) {
    this.values.resize(capacity);
  }

  set(address, value) {
    this.values.setRange(address.start / 2, address.end / 2 + 1, value);
  }

  get({start, end = start}) {
    for (let i = start; i <= end; i += 2) {
      if (!this.values.get(i / 2)) {
        return false;
      }
    }
    return true;
  }

  min() {
    return this.values.min() * 2;
  }

  max() {
    return this.values.max() * 2;
  }
}

export class BinRingBuffer extends RingBuffer {
  advanceLastBin(bin) {
    super.advanceLastIndex(bin / 2);
  }

  setRange({start}, values) {
    for (let i = 0; i < values.length; i ++) {
      super.set(start / 2 + i, values[i]);
    }
  }

  set({bin}, value) {
    super.set(bin / 2, value);
  }

  get({bin}) {
    return super.get(bin / 2);
  }

  forEach(callback) {
    for (let i = this.lastIndex - this.capacity; i < this.lastIndex; i ++) {
      if (callback(this.get(i), i * 2) === false) {
        break;
      }
    }
  }
}

export class ScarcityMap {
  constructor(capacity) {
    this.capacity = Math.pow(2, Math.ceil(Math.log2(capacity)));
    this.left = new Uint32Array(this.capacity).fill(0);
    this.right = new Uint32Array(this.capacity).fill(0);
    this.leftOffset = 0;
    this.leftTotal = 0;
    this.rightTotal = 0;
  }

  get rightOffset() {
    return this.leftOffset + this.capacity;
  }

  get rolloverThreshold() {
    return this.leftOffset + this.capacity * 2;
  }

  get purgeThreshold() {
    return this.leftOffset + this.capacity * 3;
  }

  update(index, value) {
    if (index > this.purgeThreshold) {
      this.leftOffset = index;
      this.left.fill(0);
      this.right.fill(0);
      this.leftTotal = this.rightTotal = 0;
    }

    if (index > this.rolloverThreshold) {
      this.leftOffset += this.capacity;
      [this.left, this.right] = [this.left, this.right];
      this.right.fill(0);
      this.leftTotal = this.rightTotal;
      this.rightTotal = 0;
    }

    if (index >= this.rightOffset) {
      fenwick.update(this.right, index - this.rightOffset, value);
      this.rightTotal += value;
    } else if (index >= this.leftOffset) {
      fenwick.update(this.left, index - this.leftOffset, value);
      this.leftTotal += value;
    }
  }

  query(index) {
    if (index >= this.rolloverThreshold) {
      return this.leftTotal + this.rightTotal;
    } else if (index >= this.rightOffset) {
      return this.leftTotal + fenwick.query(this.right, index - this.rightOffset);
    } else if (index >= this.leftOffset) {
      return fenwick.query(this.left, index - this.leftOffset);
    }
    return 0;
  }

  queryRange(start, end) {
    return this.query(end) - this.query(start - 1);
  }

  findSmallValue(fuzz = 0) {
    const index = binSearch(
      this.rolloverThreshold - this.leftOffset,
      (mid, left, right) => {
        const leftSum = this.queryRange(left, mid - 1);
        const rightSum = this.queryRange(mid, right);

        if (leftSum === rightSum) return 0;
        if (leftSum === 0) return 1;
        if (rightSum === 0) return -1;
        return (rightSum - leftSum) * (Math.random() < fuzz ? -1 : 1);
      },
    );

    return index * 2;
  }
}

export class BinScarcityMap {
  constructor(capacity) {
    this.map = new ScarcityMap(capacity);
  }

  update({bin}, value) {
    this.map.update(bin / 2, value);
  }

  findBin() {
    return this.map.findSmallValue(0.02) * 2;
  }
}

export class RateMeter {
  constructor(windowMs, sampleWindowMs = 100) {
    this.firstSampleWindow = Math.floor(Date.now() / sampleWindowMs);
    this.lastSampleWindow = this.firstSampleWindow;
    this.windowMs = windowMs;
    this.sampleWindowMs = sampleWindowMs;
    this.sum = 0;
    this.values = new Array(Math.ceil(windowMs / sampleWindowMs));

    this.values.fill(0);
  }

  adjustSampleWindow() {
    const sampleWindow = Math.floor(Date.now() / this.sampleWindowMs);

    for (let i = this.lastSampleWindow + 1; i <= sampleWindow; i ++) {
      const index = i % this.values.length;
      this.sum -= this.values[index];
      this.values[index] = 0;
    }
    this.lastSampleWindow = sampleWindow;
  }

  update(value) {
    this.adjustSampleWindow();
    this.sum += value;
    this.values[this.lastSampleWindow % this.values.length] += value;
  }

  value() {
    this.adjustSampleWindow();
    const accumulatedMs = Math.min(
      (this.lastSampleWindow - this.firstSampleWindow) * this.sampleWindowMs,
      this.windowMs,
    );
    return this.sum / accumulatedMs;
  }
}

export class ChunkRateMeter extends RateMeter {
  constructor(windowMs = 15000) {
    super(windowMs);
    this.lastEndBin = 0;
  }

  update({start, end}) {
    if (this.lastHeadBin === 0) {
      super.update((end - start) / 2);
    } else if (end > this.lastEndBin) {
      super.update((end - this.lastEndBin) / 2);
      this.lastEndBin = end;
    }
  }
}

export class RequestFlow extends wfq.Flow {
  constructor(id) {
    super();
    this.id = id;
    this.queueSize = 0;
  }

  computeWeight(queue) {
    return this.queueSize / queue.totalQueueSize;
  }
}

export class RequestQueue extends wfq.Queue {
  constructor(rate) {
    super(rate);
    this.totalQueueSize = 0;
  }

  enqueue(flow, size, value) {
    this.totalQueueSize += size;
    flow.queueSize += size;
    super.enqueue(flow, size, value);
  }

  cancel(flow, filter) {
    flow.queue = flow.queue.filter(task => {
      const remove = filter(task.value);

      if (remove) {
        this.totalQueueSize -= task.size;
        flow.queueSize -= task.size;
      }

      return !remove;
    });
  }

  dequeue() {
    const result = super.dequeue();
    if (result === null) {
      return null;
    }

    this.totalQueueSize -= result.task.size;
    result.flow.queueSize -= result.task.size;

    return result;
  }
}

export class SchedulerChunkState {
  constructor(bin) {
    this.bin = bin;
    this.reset();
  }

  reset() {
    this.availableCopies = 0;
    this.requestTime = [0, 0];
    this.requestPeerId = 0;

    this.requested = false;
    this.received = false;
    this.verified = false;
  }
}

export class SchedulerChunkRequestMap {
  constructor() {
    this.valueByBin = {};
    this.head = undefined;
    this.tail = undefined;
    this.length = 0;
  }

  insert(address) {
    const now = Date.now();

    for (let i = address.start; i <= address.end; i += 2) {
      const value = {
        address: new Address(i, [i, i]),
        createdAt: now,
        next: undefined,
        prev: undefined,
      };
      this.valueByBin[i] = value;

      if (this.head === undefined) {
        this.head = value;
      } else {
        this.tail.next = value;
      }
      value.prev = this.tail;
      this.tail = value;

      this.length ++;
    }
  }

  get({bin}) {
    return this.valueByBin[bin];
  }

  remove({bin}) {
    const value = this.valueByBin[bin];
    if (value === undefined) {
      return;
    }
    delete this.valueByBin[bin];

    if (this.head === value) {
      this.head = value.next;
    }
    if (this.tail === value) {
      this.tail = value.prev;
    }
    if (value.prev !== undefined) {
      value.prev.next = value.next;
    }
    if (value.next !== undefined) {
      value.next.prev = value.prev;
    }

    this.length --;
  }

  peek() {
    return this.head;
  }

  pop() {
    if (this.head === undefined) {
      return;
    }
    const value = this.head;

    this.head = value.next;
    if (this.tail === value) {
      this.tail = value.prev;
    }
    if (value.next !== undefined) {
      value.next.prev = undefined;
    }

    delete this.valueByBin[value.address.bin];

    this.length --;

    return value;
  }
}

export class SchedulerChunkMap extends BinRingBuffer {
  createEmptyValue(bin, value) {
    if (value === undefined) {
      return new SchedulerChunkState(bin);
    }

    // put the peer map here and when we advance the bin meme update
    // the availability map here

    value.reset();
    return value;
  }
}

export class SchedulerPeerState {
  constructor(peer, requestFlow) {
    this.peer = peer;
    this.requestFlow = requestFlow;
    this.availableChunks = new AvailabilityMap();

    this.ledbat = new LEDBAT();

    // this.rttMean = new EMA(0.125);
    // this.rttVar = new EMA(0.25);

    this.rttMean = new EMA(0.05);
    this.rttVar = new EMA(0.05);

    this.chunkIntervalMean = new EMA(0.25);
    this.chunkRate = new RateMeter(15000);
    this.wasteRate = new RateMeter(15000);
    this.lastChunkTime = null;

    this.requestTimes = new BinRingBuffer();

    this.requestedChunks = new SchedulerChunkRequestMap();
    this.sentRequests = new SchedulerChunkRequestMap();

    this.timeouts = 0;
    this.validChunks = 0;
    this.invalidChunks = 0;

    this.requestQueue = [];

    this.sentChunks = new AvailabilityMap();
    this.receivedChunks = new AvailabilityMap();
  }
}

export class Scheduler {
  constructor(chunkSize, clientOptions) {
    const {
      liveDiscardWindow,
      uploadRateLimit,
    } = clientOptions;

    this.chunkSize = chunkSize;
    this.liveDiscardWindow = liveDiscardWindow;

    this.peerStates = {};
    // this.chunkStates = new SchedulerChunkMap(liveDiscardWindow);
    this.loadedChunks = new AvailabilityMap(liveDiscardWindow);
    this.peerCount = 0;

    this.chunkRate = new ChunkRateMeter();

    this.requestQueue = new RequestQueue(uploadRateLimit / 1000);

    this.timers = {};

    this.lastExportedBin = -Infinity;
    this.lastCompletedBin = -Infinity;
    this.requestedChunks = new AvailabilityMap(liveDiscardWindow);

    // this.scarcityMap = new BinScarcityMap(liveDiscardWindow);
    // this.binQueue = new TinyQeueue([], (a, b) => {
    //   return a.bin - b.bin;
    // });

    // TODO: up/down regulate when we're downloading slower or faster than the
    // stream's average bit rate?
    this.priorityBinThreshold = 4;
    // window.setUrgencyThreshold = v => this.priorityBinThreshold = v;

    this.totalSends = 0;
    this.totalRequests = 0;
    this.totalRequestsReceived = 0;
    this.totalReceived = 0;
    this.totalAdded = 0;
    this.totalCancelled = 0;
    this.ackUnknownSend = 0;
    this.totalDroppedRequests = 0;
    this.sendDelay = new EMA(0.05);
    // setInterval(this.debug.bind(this), 1000);

    this.nextSendTime = 0;
    this.nextSendTimeout = 0;
  }

  debug() {
    console.log('---');
    Object.values(this.peerStates).forEach((peerState) => {
      if (!peerState.peer.isReady()) {
        return;
      }

      let cto = peerState.ledbat.cto / (peerState.ledbat.cwnd / this.chunkSize);
      const timeout = Math.min(cto, 1000);

      const availableChunks = peerState.availableChunks;

      const firstLoadedChunk = this.loadedChunks.min();
      const firstRequestedChunk = this.requestedChunks.min();
      const startBin = Math.max(
        availableChunks.min(),
        isFinite(firstLoadedChunk) ? firstLoadedChunk : -Infinity,
        isFinite(firstRequestedChunk) ? firstLoadedChunk : -Infinity,
        this.lastCompletedBin,
      );
      const lastAvailableBin = Math.min(availableChunks.max(), startBin + this.liveDiscardWindow * 2);

      const planFor = Math.min(1000, peerState.ledbat.rttMean.value() * 4);

      const dip = peerState.chunkIntervalMean.value() || 0;
      const firstPlanPick = dip === 0 ? 1 : Math.max(1, planFor / dip);
      const cwnd = firstPlanPick - peerState.sentRequests.length;

      console.log(JSON.stringify({
        peer_remoteId: peerState.peer.remoteId,
        peer_localId: peerState.peer.localId,
        sentRequests: peerState.sentRequests.length,
        swift_rtt: peerState.rttMean.value(),
        swift_rttvar: peerState.rttVar.value(),
        swift_chunkIntervalMean: peerState.chunkIntervalMean.value(),
        chunkRate: peerState.chunkRate.value(),
        wasteRate: peerState.wasteRate.value(),
        swift_cwnd: cwnd,
        ledbat_cwnd: peerState.ledbat.cwnd,
        ledbat_cto: peerState.ledbat.cto,
        ledbat_currentDelay: peerState.ledbat.currentDelay.getMin(),
        ledbat_baseDelay: peerState.ledbat.baseDelay.getMin(),
        ledbat_rttMean: peerState.ledbat.rttMean.value(),
        ledbat_rttVar: peerState.ledbat.rttVar.value(),
        ledbat_rtt: peerState.ledbat.rtt,
        ledbat_flightSize: peerState.ledbat.flightSize,
        // requestedChunks: peerState.requestedChunks,
        timeouts: peerState.timeouts,
        validChunks: peerState.validChunks,
        invalidChunks: peerState.invalidChunks,
        timeout: timeout,
        picker_startBin: startBin,
        picker_lastAvailableBin: lastAvailableBin,
      }, true, 2));
    });

    console.log(JSON.stringify({
      totalSends: this.totalSends,
      totalRequests: this.totalRequests,
      totalRequestsReceived: this.totalRequestsReceived,
      totalDroppedRequests: this.totalDroppedRequests,
      totalReceived: this.totalReceived,
      totalAdded: this.totalAdded,
      totalCancelled: this.totalCancelled,
      ackUnknownSend: this.ackUnknownSend,
      minIncompleteBin: this.lastCompletedBin,
      sendDelay: this.sendDelay.value(),
      picker_firstLoadedChunk: this.loadedChunks.min(),
      picker_firstRequestedChunk: this.requestedChunks.min(),
      chunkRate: this.chunkRate.value(),
    }, true, 2));
    // this.totalSends = 0;
    // this.totalRequests = 0;
    // this.totalRequestsReceived = 0;
    // this.totalReceived = 0;
    // // this.ackUnknownSend = 0;
    // this.totalAdded = 0;
    // this.totalCancelled = 0;
    // this.totalDroppedRequests = 0;
  }

  update(peerState, update) {
    if (!peerState.peer.isReady()) {
      this.timers[peerState.localId] = setTimeout(update, 1000);
      return;
    }

    const {
      availableChunks,
      ledbat,
      sentRequests,
    } = peerState;

    const now = Date.now();
    // const planFor = ledbat.rttMean.value();
    // const planFor = ledbat.rttMean.value() * 2 + ledbat.rttVar.value() * 4;
    const planFor = Math.max(1000, ledbat.rttMean.value() * 4);
    const timeoutThreshold = now - Math.min(1000, ledbat.cto) * 2;

    const dip = peerState.chunkIntervalMean.value() || 0;
    const firstPlanPick = dip === 0 ? 1 : Math.max(1, planFor / dip);
    const cwnd = firstPlanPick - sentRequests.length;

    const cancelledRequests = [];
    while (sentRequests.peek() !== undefined
      && sentRequests.peek().createdAt < timeoutThreshold) {
      cancelledRequests.push(sentRequests.pop());
    }

    if (cancelledRequests.length > 0) {
      this.totalCancelled += cancelledRequests.length;
      cancelledRequests.forEach(({address}) => {
        this.requestedChunks.set(address, false);
        sentRequests.remove(address);
      });

      ledbat.onDataLoss(cancelledRequests.length * this.chunkSize);
      // console.log(cancelledRequests);
    }

    ledbat.digestDelaySamples();

    const requestAddresses = [];

    const startBin = Math.max(
      this.loadedChunks.values.offset * 2 + 2,
      this.requestedChunks.values.offset * 2 + 2,
      availableChunks.min(),
      this.lastCompletedBin,
    );
    const endBin = Math.min(
      startBin + this.liveDiscardWindow * 2,
      availableChunks.max(),
    );
    const priorityBinThreshold = this.lastCompletedBin + this.priorityBinThreshold;

    for (let i = startBin; i < endBin && requestAddresses.length < cwnd; i += 2) {
      const address = new Address(i, [i, i]);
      if (!this.loadedChunks.get(address)
        && !this.requestedChunks.get(address)
        && availableChunks.get(address)) {

        if (address.bin < priorityBinThreshold || Math.random() < 0.1) {
          requestAddresses.push(address);
          sentRequests.insert(address);
          this.requestedChunks.set(address);
        }
      }
    }

    if (this.lastCompletedBin === -Infinity && requestAddresses.length !== 0) {
      const firstRequestedBin = requestAddresses[0].bin;
      this.lastCompletedBin = firstRequestedBin;
      this.lastExportedBin = firstRequestedBin - 2;
    }

    if (cancelledRequests.length !== 0) {
      cancelledRequests.forEach(({address}) => {
        this.requestedChunks.set(address, false);
        peerState.peer.sendCancel(address);
      });
    }

    if (requestAddresses.length !== 0) {
      this.totalRequests += requestAddresses.length;
      peerState.peer.sendRequest(...requestAddresses);

      requestAddresses.forEach(address => {
        if (peerState.requestTimes.get(address) === undefined) {
          peerState.requestTimes.set(address, now);
        }
      });
    }

    while (ledbat.flightSize < ledbat.cwnd && peerState.requestQueue.length) {
      const requestedAddress = peerState.requestQueue.shift();
      if (requestedAddress !== undefined) {
        const requestedChunk = peerState.requestedChunks.get(requestedAddress);
        if (requestedChunk !== undefined) {
          requestedChunk.sentAt = now;
          peerState.ledbat.addSent(this.chunkSize);
          peerState.peer.sendChunk(requestedAddress);
          this.totalSends ++;
        }
      }

      peerState.sentChunks.set(requestedAddress);

      // TODO: volunteer bin we have and they don't?
    }

    peerState.peer.flush();
    let sendInterval = Math.min(1000, (ledbat.rttMean.value() || 0) / (ledbat.cwnd / this.chunkSize));
    this.timers[peerState.localId] = setTimeout(update, sendInterval);
  }

  addPeer(peer) {
    const {localId} = peer;

    const requestFlow = new RequestFlow(localId);
    this.requestQueue.addFlow(requestFlow);

    const peerState = new SchedulerPeerState(peer, requestFlow);
    this.peerStates[localId] = peerState;

    const update = () => this.update(peerState, update);
    this.timers[localId] = setTimeout(update, 1000);
  }

  removePeer({localId}) {
    const peerState = this.peerStates[localId];
    if (peerState === undefined) {
      return;
    }

    const {
      requestFlow,
      sentRequests,
    } = peerState;

    this.requestQueue.removeFlow(requestFlow);

    this.totalCancelled += sentRequests.length;
    while (sentRequests.length) {
      const {address} = sentRequests.pop();
      this.requestedChunks.set(address, false);
    }

    delete this.peerStates[localId];

    clearTimeout(this.timers[localId]);
  }

  getPeerState({localId}) {
    return this.peerStates[localId];
  }

  getRecentChunks() {
    // TODO: how to pick this... maybe remote discard window size?
    // const startBin = this.loadedChunks.max();
    // const startBin = this.loadedChunks.max() - 32;
    const startBin = this.lastCompletedBin;

    // bail if no chunks have been loaded yet
    if (!isFinite(startBin)) {
      return [];
    }

    const bins = [];

    const endBin = this.loadedChunks.max();
    for (let i = startBin; i <= endBin; i += 2) {
      const address = new Address(i);
      if (this.loadedChunks.get(address)) {
        bins.push(address);
      }
    }

    return bins;
  }

  setLiveDiscardWindow(peer, liveDiscardWindow) {
    this.getPeerState(peer).availableChunks.setCapacity(liveDiscardWindow);
    this.getPeerState(peer).requestTimes.setCapacity(liveDiscardWindow);

    this.getPeerState(peer).sentChunks.setCapacity(liveDiscardWindow);
    this.getPeerState(peer).receivedChunks.setCapacity(liveDiscardWindow);
  }

  markChunkReceived(peer, address, delaySample) {
    const now = Date.now();

    this.totalReceived ++;

    const peerState = this.getPeerState(peer);
    if (peerState === undefined) {
      return;
    }

    if (this.loadedChunks.get(address)) {
      peerState.wasteRate.update(1);
    }

    const request = peerState.sentRequests.get(address);
    if (request === undefined) {
      return;
    }

    if (peerState.lastChunkTime !== null) {
      const chunkInterval = now - peerState.lastChunkTime;
      peerState.chunkIntervalMean.update(chunkInterval);
    }
    peerState.lastChunkTime = now;
    if (!this.loadedChunks.get(address)) {
      peerState.chunkRate.update(1);
    }

    const requestTime = peerState.requestTimes.get(address);
    if (requestTime !== undefined) {
      peerState.ledbat.addRttSample(now - requestTime);
    }

    // peerState.rttMean.update(rtt);
    // peerState.rttVar.update(Math.abs(rtt - peerState.rttMean.value()));

    // TODO: double check LEDBAT to make sure we shouldn't be doing
    // something here

    peerState.sentRequests.remove(address);
  }

  markChunkVerified(peer, address) {
    // this.chunkStates.get(address).verified = true;
    this.getPeerState(peer).validChunks ++;
    this.getPeerState(peer).receivedChunks.set(address);

    // this.chunkStates.advanceLastBin(address.end);

    this.chunkRate.update(address);
    this.loadedChunks.set(address);

    for (let i = this.lastCompletedBin; this.loadedChunks.get(new Address(i, [i, i])); i += 2) {
      this.lastCompletedBin = i;
    }

    Object.values(this.peerStates).forEach(({availableChunks, peer}) => {
      if (!availableChunks.get(address) && peer.isReady()) {
        peer.sendHave(address);
      }
    });
  }

  getNewCompleteBins() {
    const nextExportedBin = this.lastExportedBin + 2;
    if (nextExportedBin <= this.lastCompletedBin) {
      this.lastExportedBin = this.lastCompletedBin;
      return [nextExportedBin, this.lastCompletedBin];
    }
  }

  markChunkRejected(peer, address) {
    this.requestedChunks.set(address, false);
    this.getPeerState(peer).invalidChunks ++;
  }

  // mark an address available from a peer (HAVE)
  markChunkAvailable(peer, address) {
    for (let i = address.start; i <= address.end; i += 2) {
      const address = new Address(i, [i, i]);

      // this.binQueue.push(address);
      // this.scarcityMap.update(address, 1);

      if (!this.getPeerState(peer).availableChunks.get(address)) {
        this.totalAdded ++;
      }
    }

    this.getPeerState(peer).availableChunks.set(address);
  }

  // mark an address where chunks have been manually added ie. by an injector
  markChunksLoaded(address) {
    this.loadedChunks.set(address);
    this.lastCompletedBin = address.start;

    Object.values(this.peerStates).forEach(({availableChunks, peer}) => {
      if (!availableChunks.get(address) && peer.isReady()) {
        peer.sendHave(address);
      }
    });
  }

  markSendAcked(peer, address, delaySample) {
    const peerState = this.getPeerState(peer);

    peerState.ledbat.addDelaySample(delaySample, this.chunkSize);

    const sentChunk = peerState.requestedChunks.get(address);
    if (sentChunk === undefined) {
      this.ackUnknownSend ++;
      return;
    }

    // TODO: is this necessary?
    if (sentChunk.sentAt) {
      peerState.ledbat.addRttSample(Date.now() - sentChunk.sentAt);
    }

    peerState.requestedChunks.remove(address);
  }

  enqueueRequest(peer, address) {
    const peerState = this.getPeerState(peer);

    for (let i = address.start; i <= address.end; i += 2) {
      this.totalRequestsReceived ++;
      peerState.requestQueue.push(new Address(i, [i, i]));
    }

    peerState.requestedChunks.insert(address);
  }

  cancelRequest(peer, address) {
    const peerState = this.getPeerState(peer);
    const requestedChunk = peerState.requestedChunks.get(address);
    if (requestedChunk && requestedChunk.sentAt) {
      peerState.ledbat.onDataLoss(this.chunkSize);
    }
    peerState.requestedChunks.remove(address);

    // this.requestQueue.cancel(
    //   this.getPeerState(peer).requestFlow,
    //   ({bin}) => address.containsBin(bin),
    // );
  }
}
