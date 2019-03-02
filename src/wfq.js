export class Flow {
  constructor() {
    this.lastVirtualFinish = 0;
    this.nextVirtualFinish = Infinity;
    this.queue = [];
  }

  computeWeight() {
    return 1;
  }
}

export class Queue {
  constructor(rate) {
    this.rate = rate;
    this.totalQueueSize = 0;
    this.flows = [];
  }

  addFlow(flow) {
    return this.flows.push(flow);
  }

  removeFlow(flow) {
    const index = this.flows.indexOf(flow);
    if (index !== -1) {
      this.flows.splice(index, 1);
    }
  }

  enqueue(flow, size, value) {
    const weight = flow.computeWeight(this);
    const rate = this.rate / weight;
    const virtualFinish = Math.max(Date.now(), flow.lastVirtualFinish) + size / rate;

    flow.queue.push({
      virtualFinish,
      size,
      value,
    });
    flow.lastVirtualFinish = virtualFinish;
    if (flow.queue.length === 1) {
      flow.nextVirtualFinish = virtualFinish;
    }
  }

  getNextScheduledFlow() {
    let minVirtualFinish = Infinity;
    let flow = null;
    for (let i = 0; i < this.flows.length; i ++) {
      if (this.flows[i].nextVirtualFinish < minVirtualFinish) {
        flow = this.flows[i];
        minVirtualFinish = flow.nextVirtualFinish;
      }
    }

    return flow;
  }

  peek() {
    const flow = this.getNextScheduledFlow();

    if (flow === null) {
      return null;
    }

    return {
      flow,
      task: flow.queue[0],
    };
  }

  dequeue() {
    const flow = this.getNextScheduledFlow();

    if (flow === null) {
      return null;
    }

    const task = flow.queue.shift();

    flow.nextVirtualFinish = flow.queue.length !== 0
      ? flow.queue[0].virtualFinish
      : Infinity;

    return {flow, task};
  }
}

export default {
  Queue,
  Flow,
};
