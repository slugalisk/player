const BitArray = require('../bitarray');
const Address = require('./address');
const wfq = require('../wfq');
const EMA = require('../ema');
const LEDBAT = require('../ledbat');
const RingBuffer = require('../RingBuffer');

class AvailabilityMap {
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

  get({start, end}) {
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

class BinRingBuffer extends RingBuffer {
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

class RateMeter {
  constructor(windowMs, sampleWindowMs = 100) {
    this.firstSampleWindow = Math.floor(Date.now() / sampleWindowMs);
    this.lastSampleWindow = this.firstSampleWindow;
    this.windowMs = windowMs;
    this.sampleWindowMs = sampleWindowMs;
    this.sum = 0;
    this.values = new Array(Math.ceil(windowMs / sampleWindowMs));

    this.values.fill(0);
  }

  update(value) {
    const sampleWindow = Math.floor(Date.now() / this.sampleWindowMs);

    for (let i = this.lastSampleWindow + 1; i <= sampleWindow; i ++) {
      const index = i % this.values.length;
      this.sum -= this.values[index];
      this.values[index] = 0;
    }
    this.lastSampleWindow = sampleWindow;

    this.sum += value;
    this.values[sampleWindow % this.values.length] += value;
  }

  value() {
    const accumulatedMs = Math.min(
      (this.lastSampleWindow - this.firstSampleWindow) * this.sampleWindowMs,
      this.windowMs,
    );
    return this.sum / accumulatedMs;
  }
}

class ChunkRateMeter extends RateMeter {
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

class RequestFlow extends wfq.Flow {
  constructor(id) {
    super();
    this.id = id;
    this.queueSize = 0;
  }

  computeWeight(queue) {
    return this.queueSize / queue.totalQueueSize;
  }
}

class RequestQueue extends wfq.Queue {
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

class SchedulerChunkState {
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

class SchedulerChunkRequestMap {
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
        address: new Address(i),
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

class SchedulerChunkMap extends BinRingBuffer {
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

class SchedulerPeerState {
  constructor(peer, requestFlow) {
    this.peer = peer;
    this.requestFlow = requestFlow;
    this.availableChunks = new AvailabilityMap();

    this.ledbat = new LEDBAT();

    // this.rttMean = new EMA(0.125);
    // this.rttVar = new EMA(0.25);

    // this.chunkIntervalMean = new EMA(0.25);

    this.rttMean = new EMA(0.05);
    this.rttVar = new EMA(0.05);

    this.chunkIntervalMean = new EMA(0.25);
    this.lastChunkTime = null;

    this.requestedChunks = new SchedulerChunkRequestMap();
    this.sentRequests = new SchedulerChunkRequestMap();

    this.timeouts = 0;
    this.validChunks = 0;
    this.invalidChunks = 0;

    this.requestQueue = [];
    this.lastDataOutTime = 0;
  }
}

class Scheduler {
  constructor(chunkSize, clientOptions) {
    const {
      liveDiscardWindow,
      uploadRateLimit,
    } = clientOptions;

    this.chunkSize = chunkSize;
    this.liveDiscardWindow = liveDiscardWindow;

    // where are we in the buffer

    // how rare is a chunk
    // how urgently is a chunk needed

    // high/mid/low priority time bands

    // high performance/reliability peers
    // expected performance per peer

    // request timeout/cancel
    // send timeout/cancel?

    this.peerStates = {};
    this.chunkStates = new SchedulerChunkMap(liveDiscardWindow);
    this.loadedChunks = new AvailabilityMap(liveDiscardWindow);
    this.peerCount = 0;
    // this.windowStart = 0;
    // this.windowEnd = 0;
    this.chunkRate = new ChunkRateMeter();
    // average stream bit rate
    // position in available window
    // position in theoretical window

    // how do we know what range we want urgently...? we sort of need to
    // know the video bitrate...

    // do we just want to look at have range * chunk size / time?

    this.finishedUpToBin = 0;
    this.lastAvailableBin = 0;

    // minimum needed bin

    this.requestQueue = new RequestQueue(uploadRateLimit / 1000);

    // this.update = this.update.bind(this);
    // setTimeout(this.update, 0);

    this.timers = {};

    this.minIncompleteBin = -Infinity;
    this.requestedChunks = new AvailabilityMap(liveDiscardWindow);

    // this.updateMemes();

    this.totalSends = 0;
    this.totalRequests = 0;
    this.totalRequestsReceived = 0;
    this.totalReceived = 0;
    this.totalAdded = 0;
    this.totalCancelled = 0;
    this.ackUnknownSend = 0;
    this.sendDelay = new EMA(0.05);
    setInterval(this.debug.bind(this), 1000);

    this.nextSendTime = 0;
    this.nextSendTimeout = 0;
  }

  debug() {
    console.log('---');
    Object.values(this.peerStates).forEach((peerState) => {
      let cto = peerState.ledbat.cto / (peerState.ledbat.cwnd / this.chunkSize);
      const timeout = Math.ceil(Math.min(cto, 1000));

      const availableChunks = peerState.availableChunks;

      const firstLoadedChunk = this.loadedChunks.min();
      const firstRequestedChunk = this.requestedChunks.min();
      const startBin = Math.max(
        availableChunks.min(),
        isFinite(firstLoadedChunk) ? firstLoadedChunk : -Infinity,
        isFinite(firstRequestedChunk) ? firstLoadedChunk : -Infinity,
        this.minIncompleteBin,
      );
      const lastAvailableBin = Math.min(availableChunks.max(), startBin + this.liveDiscardWindow * 2);

      let totalBothHave = 0;
      let totalTheyHave = 0;
      let totalWeHave = 0;
      let totalWeWant = 0;
      let totalWeRequested = 0;
      for (let i = availableChunks.min(); i <= availableChunks.max(); i += 2) {
        const address = new Address(i);
        const theyHave = availableChunks.get(address);
        const weHave = this.loadedChunks.get(address);
        const weRequested = this.requestedChunks.get(address);

        if (theyHave && weHave) {
          totalBothHave ++;
        }
        if (theyHave && !weHave) {
          totalWeWant ++;
        }
        if (theyHave) {
          totalTheyHave ++;
        }
        if (weHave) {
          totalWeHave ++;
        }
        if (weRequested) {
          totalWeRequested ++;
        }
      }

      const planFor = Math.min(1000, peerState.rttMean.value() * 4);

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
        swift_cwnd: cwnd,
        totals_totalBothHave: totalBothHave,
        totals_totalTheyHave: totalTheyHave,
        totals_totalWeWant: totalWeWant,
        totals_totalWeHave: totalWeHave,
        totals_totalWeRequested: totalWeRequested,
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
      totalReceived: this.totalReceived,
      totalAdded: this.totalAdded,
      totalCancelled: this.totalCancelled,
      ackUnknownSend: this.ackUnknownSend,
      minIncompleteBin: this.minIncompleteBin,
      sendDelay: this.sendDelay.value(),
      picker_firstLoadedChunk: this.loadedChunks.min(),
      picker_firstRequestedChunk: this.requestedChunks.min(),
    }, true, 2));
    this.totalSends = 0;
    this.totalRequests = 0;
    this.totalRequestsReceived = 0;
    this.totalReceived = 0;
    // this.ackUnknownSend = 0;
    this.totalAdded = 0;
    this.totalCancelled = 0;
  }

  start() {
    // this.updateIvl = setInterval(this.update.bind(this), 150);

  }

  stop() {
    // clearInterval(this.updateIvl);
  }

  scoreBin(bin) {

  }

  // updateMemes() {
  //   const firstAvailableChunk = Math.min(
  //     ...Object.values(this.peerStates)
  //       .map(({availableChunks}) => availableChunks.min()),
  //   );
  //   if (firstAvailableChunk === Infinity) {
  //     return;
  //   }

  //   console.log(firstAvailableChunk);

  //   setTimeout(() => this.updateMemes(), 1000);
  // }

  update(peerState) {
    if (!peerState.peer.isReady()) {
      this.timers[peerState.localId] = setTimeout(() => this.update(peerState), 1000);
      return;
    }

    const {
      availableChunks,
      ledbat,
      sentRequests,
    } = peerState;

    ledbat.digestDelaySamples();

    // const firstLoadedChunk = this.loadedChunks.min();
    // // const firstRequestedChunk = this.requestedChunks.min();
    // const startBin = Math.max(
    //   availableChunks.min(),
    //   isFinite(firstLoadedChunk) ? firstLoadedChunk : -Infinity,
    //   // isFinite(firstRequestedChunk) ? firstLoadedChunk : -Infinity,
    //   this.minIncompleteBin,
    // );
    // const lastAvailableBin = Math.min(availableChunks.max(), startBin + this.liveDiscardWindow * 2);

    // console.log(startBin, lastAvailableBin);

    // const requestAddresses = [];
    // for (let i = startBin; i < lastAvailableBin; i += 2) {
    //   const address = new Address(i);
    //   if (!this.loadedChunks.get(address)
    //     && !this.requestedChunks.get(address)
    //     && availableChunks.get(address)) {

    //     requestAddresses.push(address);
    //     sentRequests.insert(address);
    //     this.requestedChunks.set(address);

    //     // if (requestAddresses.length * this.chunkSize >= ledbat.cwnd) {
    //     //   break;
    //     // }
    //   }
    // }

    // const now = Date.now();
    // let removed = 0;

    // console.log({removed});

    const planFor = Math.min(1000, ledbat.rttMean.value() * 4);
    const timeoutThreshold = Date.now() - planFor * 2;

    const cancelledRequests = [];
    while (true) {
      const next = sentRequests.peek();
      if (next === undefined || next.createdAt > timeoutThreshold) {
        break;
      }
      cancelledRequests.push(sentRequests.pop());
    }

    if (cancelledRequests.length > 0) {
      this.totalCancelled += cancelledRequests.length;
      // ledbat.onDataLoss(cancelledRequests.length * this.chunkSize);
      cancelledRequests.forEach(({address}) => sentRequests.remove(address));
    }

    const dip = peerState.chunkIntervalMean.value() || 0;
    const firstPlanPick = dip === 0 ? 1 : Math.max(1, planFor / dip);

    const cwnd = firstPlanPick - sentRequests.length;

    const startBin = Math.max(
      this.loadedChunks.values.offset * 2 + 2,
      this.requestedChunks.values.offset * 2 + 2,
      availableChunks.min(),
      this.minIncompleteBin,
    );
    const endBin = Math.min(
      startBin + this.liveDiscardWindow * 2,
      availableChunks.max(),
    );
    const requestAddresses = [];
    for (let i = startBin; i < endBin; i += 2) {
      const address = new Address(i);
      if (!this.loadedChunks.get(address)
        && !this.requestedChunks.get(address)
        && availableChunks.get(address)) {

        requestAddresses.push(address);
        sentRequests.insert(address);
        this.requestedChunks.set(address);

        if (requestAddresses.length >= cwnd) {
          break;
        }
      }
    }

    if (cancelledRequests.length > 0) {
      cancelledRequests.forEach(({address}) => {
        this.requestedChunks.set(address, false);
        peerState.peer.sendCancel(address);
      });
    }

    if (this.minIncompleteBin === -Infinity && requestAddresses.length !== 0) {
      this.minIncompleteBin = requestAddresses[0].bin;
    }

    if (requestAddresses.length !== 0) {
      this.totalRequests += requestAddresses.length;
      peerState.peer.sendRequest(...requestAddresses);
    }

    let sendInterval = (ledbat.rttMean.value() || 0) / (ledbat.cwnd / this.chunkSize);
    const luft = sendInterval * 4;
    const now = Date.now();

    // TODO: retry/abort send
    // if (ledbat.flightSize < ledbat.cwnd && peerState.lastDataOutTime + sendInterval <= now + luft) {

    if (peerState.lastDataOutTime + sendInterval <= now + luft) {
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
      peerState.lastDataOutTime = now;
    }

    peerState.peer.flush();

    const timeout = Math.min(ledbat.rttMean.value() / (ledbat.cwnd / this.chunkSize), 1000);
    this.timers[peerState.localId] = setTimeout(() => this.update(peerState), timeout);
  }

  // scheduleSend(reschedule = false) {
  //   const request = this.requestQueue.peek();
  //   if (request === null) {
  //     this.nextSendTimeout = 0;
  //     return;
  //   }

  //   const {virtualFinish} = request.task;
  //   if (!reschedule && virtualFinish > this.nextSendTime && this.nextSendTimeout !== 0) {
  //     return;
  //   }
  //   clearTimeout(this.nextSendTimeout);

  //   const delay = Math.min(10, Math.max(0, Math.max(Date.now(), this.nextSendTime) - virtualFinish));
  //   this.sendDelay.update(delay);
  //   this.nextSendTimeout = setTimeout(() => this.doSend(), delay);
  //   this.nextSendTime = virtualFinish;
  // }

  // doSend() {
  //   const request = this.requestQueue.dequeue();
  //   if (request === null) {
  //     return;
  //   }

  //   const peerState = this.peerStates[request.flow.id];
  //   const requestedChunk = peerState.requestedChunks.get(request.task.value);
  //   if (peerState !== undefined && requestedChunk !== undefined) {
  //     requestedChunk.sentAt = Date.now();
  //     peerState.ledbat.addSent(this.chunkSize);
  //     this.totalSends ++;

  //     peerState.peer.sendChunk(request.task.value);
  //   }

  //   this.scheduleSend(true);
  // }

  addPeer(peer) {
    const {localId} = peer;

    const requestFlow = new RequestFlow(localId);
    this.requestQueue.addFlow(requestFlow);

    const peerState = new SchedulerPeerState(peer, requestFlow);
    this.peerStates[localId] = peerState;

    this.timers[localId] = setTimeout(() => this.update(peerState), 1000);
    // if (++ this.peerCount === 1) {
    //   this.start();
    // }
  }

  removePeer({localId}) {
    const peerState = this.peerStates[localId];
    if (peerState === undefined) {
      return;
    }

    const {requestFlow} = peerState;
    this.requestQueue.removeFlow(requestFlow);

    delete this.peerStates[localId];

    // if (-- this.peerCount === 0) {
    //   this.stop();
    // }
    clearTimeout(this.timers[localId]);
  }

  getPeerState({localId}) {
    return this.peerStates[localId];
  }

  setLiveDiscardWindow(peer, liveDiscardWindow) {
    this.getPeerState(peer).availableChunks.setCapacity(liveDiscardWindow);
  }

  markChunkReceived(peer, address, delaySample) {
    this.totalReceived ++;

    const peerState = this.getPeerState(peer);
    if (peerState === undefined) {
      return;
    }
    const request = peerState.sentRequests.get(address);
    if (request === undefined) {
      return;
    }

    const now = Date.now();
    if (peerState.lastChunkTime !== null) {
      const chunkInterval = now - peerState.lastChunkTime;
      peerState.chunkIntervalMean.update(chunkInterval);
    }
    peerState.lastChunkTime = now;

    const rtt = now - request.createdAt;
    if (isNaN(rtt)) {
      debugger;
    } else {
      peerState.ledbat.addRttSample(rtt);
      // peerState.rttMean.update(rtt);
      // peerState.rttVar.update(Math.abs(rtt - peerState.rttMean.value()));
    }

    // TODO: double check LEDBAT to make sure we shouldn't be doing
    // something here

    peerState.sentRequests.remove(address);
  }

  markChunkVerified(peer, address) {
    // this.chunkStates.get(address).verified = true;
    this.getPeerState(peer).validChunks ++;

    // this.chunkStates.advanceLastBin(address.end);

    this.chunkRate.update(address);
    this.loadedChunks.set(address);

    for (let i = this.minIncompleteBin; this.loadedChunks.get(new Address(i)); i += 2) {
      this.minIncompleteBin = i;
      // console.log(i, this.loadedChunks.get(new Address(i)));
    }

    Object.values(this.peerStates).forEach(({availableChunks, peer}) => {
      if (!availableChunks.get(address) && peer.isReady()) {
        peer.sendHave(address);
      }
    });
  }

  markChunkRejected(peer, address) {
    this.reschedule(address);
    this.getPeerState(peer).invalidChunks ++;
  }

  markChunkAvailable(peer, address) {
    for (let i = address.start; i <= address.end; i += 2) {
      if (!this.getPeerState(peer).availableChunks.get(new Address(i))) {
        this.totalAdded ++;
      }
    }

    this.getPeerState(peer).availableChunks.set(address);
  }

  markChunksLoaded(address) {
    this.chunkStates.advanceLastBin(address.end);
    this.loadedChunks.set(address);

    Object.values(this.peerStates).forEach(({availableChunks, peer}) => {
      if (!availableChunks.get(address) && peer.isReady()) {
        peer.sendHave(address);
      }
    });
  }

  markSendAcked(peer, address, delaySample) {
    // TODO: is this an address we sent to this peer?

    const peerState = this.getPeerState(peer);
    const sentChunk = peerState.requestedChunks.get(address);
    if (sentChunk === undefined) {
      this.ackUnknownSend ++;
      return;
    }

    const rtt = Date.now() - sentChunk.sentAt;

    peerState.ledbat.addRttSample(rtt);
    peerState.ledbat.addDelaySample(delaySample, this.chunkSize);

    peerState.requestedChunks.remove(address);
  }

  enqueueRequest(peer, address) {
    // this.totalRequestsReceived ++;
    // this.requestQueue.enqueue(
    //   this.getPeerState(peer).requestFlow,
    //   this.chunkSize * (address.end - address.start + 1),
    //   address,
    // );

    for (let i = address.start; i <= address.end; i += 2) {
      this.totalRequestsReceived ++;
      // this.requestQueue.enqueue(
      //   this.getPeerState(peer).requestFlow,
      //   this.chunkSize,
      //   new Address(i),
      // );
      this.getPeerState(peer).requestQueue.push(new Address(i));
    }

    const {requestedChunks} = this.getPeerState(peer);
    requestedChunks.insert(address);
    // this.scheduleSend();
  }

  cancelRequest(peer, address) {
    this.requestQueue.cancel(
      this.getPeerState(peer).requestFlow,
      ({bin}) => address.containsBin(bin),
    );
  }
}

module.exports = {
  AvailabilityMap,
  BinRingBuffer,
  RateMeter,
  ChunkRateMeter,
  RequestFlow,
  RequestQueue,
  SchedulerChunkState,
  SchedulerChunkRequestMap,
  SchedulerChunkMap,
  SchedulerPeerState,
  Scheduler,
};
