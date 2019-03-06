import KBucket from 'k-bucket';
import {EventEmitter} from 'events';
import arrayBufferToHex from 'array-buffer-to-hex';
import arrayEqual from 'array-equal';
import randomBytes from 'randombytes';
import LRU from 'lru-cache';
import hexToUint8Array from './hexToUint8Array';
import idx from 'idx';

const SEND_REPLICAS = 2;
const MAX_HOPS = 10;
const DEFAULT_PEER_REQUEST_COUNT = 10;
const NUMBER_OF_NODES_PER_BUCKET = 2;

// TODO: implement get/set
// TODO: implement connection dump rpc for network debugging

export class Client extends EventEmitter {
  constructor(id) {
    super();
    this.setMaxListeners(Infinity);

    this.id = id;

    // managed/unmanaged?
    this.channels = new KBucket({
      numberOfNodesPerKBucket: NUMBER_OF_NODES_PER_BUCKET,
      localNodeId: this.id,
    });
    this.allChannels = new KBucket({
      numberOfNodesPerKBucket: 100,
      localNodeId: this.id,
    });

    this.channels.on('ping', this.handlePing.bind(this));
    this.channels.on('removed', this.handleRemoved.bind(this));
    this.channels.on('updated', this.handleUpdated.bind(this));
    this.channels.on('added', this.handleAdded.bind(this));

    this.knownPeerIds = {};
    this.channelMap = {};

    this.seenIds = new LRU({max: 1024});
    this.knownRoutes = new LRU({
      max: 1024,
      maxAge: 1000 * 60,
    });
    this.callbacks = new LRU({max: 1024});

    this.on('receive.peers.request', this.handlePeersRequest.bind(this));
    this.on('receive.ping.request', this.handlePingRequest.bind(this));
    this.on('receive.trace.request', this.handleTraceRequest.bind(this));
    this.on('receive.callback.response', this.handleCallbackResponse.bind(this));

    this.startPeerRequests();
  }

  close() {
    this.stopPeerRequests();
    this.channels.toArray().forEach(({id}) => this.removeChannel(id));
    this.emit('close');
  }

  startPeerRequests() {
    let index = 0;
    let ids = Object.keys(this.knownPeerIds);

    const next = () => {
      for (let retry = 0; retry <= ids.length; retry ++) {
        if (index >= ids.length) {
          index = 0;
          ids = Object.keys(this.knownPeerIds);
        }

        const id = ids[index];
        index ++;

        if (id) {
          return id;
        }
      }
    };

    this.peerRequestIvl = setInterval(() => {
      const id = next();
      if (id) {
        this.sendPeerRequest(hexToUint8Array(id));
      }
    }, 5000);
  }

  stopPeerRequests() {
    clearInterval(this.peerRequestIvl);
  }

  handlePing(channels, newChannel) {
    // console.log('ping', channels, newChannel);
    const PING_TIMEOUT = 10000;

    const validateChannel = channel => {
      const readyState = idx(channel, _ => _.conn.readyState);
      return readyState === 1 || readyState === 'open';
    };

    channels.forEach(channel => {
      const {id} = channel;

      if (validateChannel(channel)) {
        this.addChannel(channel);
        return;
      }

      setTimeout(() => {
        const channel = this.getChannel(id);
        if (validateChannel(channel)) {
          this.addChannel(channel);
          return;
        }

        this.removeChannel(id);
        this.addChannel(newChannel);
      }, PING_TIMEOUT);
    });
  }

  addChannel(channel) {
    this.channels.add(channel);
    this.allChannels.add(channel);
  }

  removeChannel(id) {
    this.channels.remove(id);
    this.allChannels.remove(id);
    delete this.channelMap[arrayBufferToHex(id)];
  }

  getChannel(id) {
    return this.channelMap[arrayBufferToHex(id)];
  }

  handleRemoved(channel) {
    // console.log('remove', arrayBufferToHex(channel.id));
    // console.trace();
    if (channel.conn) {
      channel.conn.close();
    }
    // console.log('handleRemoved', arrayBufferToHex(channel.id));
  }

  handleUpdated(oldChannel, newChannel) {
    // console.log('update', {oldChannel, newChannel});
    // console.log('handleUpdated', arrayBufferToHex(channel.id));
  }

  handleAdded(channel) {
    if (channel.conn === undefined) {
      // console.log('peers.discover', arrayBufferToHex(this.id), arrayBufferToHex(channel.id), this.channels.count());
      this.emit('peers.discover', channel.id);
    }
    // console.log('add');
    // emit event?
    // console.log('handleAdded', arrayBufferToHex(channel.id));
  }

  createChannel(id, conn) {
    const channel = new Channel(id, conn);

    this.channelMap[arrayBufferToHex(id)] = channel;

    const messages = [];
    const bufferMessages = event => messages.push(event);
    const handleMessage = this.handleMessage.bind(this, channel);

    // let requestPeersIvl = setInterval(() => this.sendPeerRequest(id), 30000);

    const handleOpen = () => {
      // console.log('opened', arrayBufferToHex(channel.id));
      this.addChannel(channel);

      conn.removeEventListener('message', bufferMessages);
      conn.addEventListener('message', handleMessage);
      messages.forEach(handleMessage);

      this.sendPeerRequest(id);
      setTimeout(() => this.sendPeerRequest(id), 1000);
    };

    const handleClose = () => {
      // clearInterval(requestPeersIvl);
      conn.removeEventListener('message', bufferMessages);
      conn.removeEventListener('message', handleMessage);
      conn.removeEventListener('open', handleOpen);
      conn.removeEventListener('close', handleClose);
      this.handleClose(channel);
    };

    conn.addEventListener('message', bufferMessages);
    conn.addEventListener('open', handleOpen, {once: true});
    conn.addEventListener('close', handleClose, {once: true});
  }

  handleMessage(channel, event) {
    // console.log('handleMessage', event.data);

    const req = JSON.parse(event.data);
    const {type, id} = req;

    if (req.trace) {
      req.trace.push(arrayBufferToHex(this.id));
      // console.log('TRACE', req);
    }

    if (this.seenIds.get(id)) {
      // console.log('discarding seen message', id);
      // if (req.trace) {
      //   console.log('DROPPED', req);
      // }
      return;
    }
    this.seenIds.set(id, true);

    if (!this.getChannel(channel.id)) {
      console.warn('receiving channel is not known to dht', arrayBufferToHex(channel.id));
    }

    this.knownRoutes.set(req.from, channel.id);
    // this.knownRoutes.set(req.from, arrayBufferToHex(channel.id));

    const to = hexToUint8Array(req.to);
    if (!arrayEqual(to, this.id)) {
      this.forwardMessage(to, req);
      return;
    }

    // if (req.trace) {
    //   console.log('DELIVERED', req);
    // }

    const resCallback = (res={}, callback=null) => {
      const from = hexToUint8Array(req.from);
      const data = {re: id, ...res};
      this.send(from, 'callback.response', data, callback);
    };

    // console.log(`emit receive.${type}`, req);
    this.emit(`receive.${type}`, {data: req, callback: resCallback});
  }

  forwardMessage(to, data) {
    // console.log('forwarding message', arrayBufferToHex(to), data);

    if (data.hops >= MAX_HOPS) {
      // console.log('discarding message with too many hops', data.id);
      return;
    }
    data.hops ++;

    this.sendRaw(to, JSON.stringify(data), data.trace);
  }

  handleClose({id}) {
    // console.warn('handleClose', arrayBufferToHex(id));
    // console.trace();
    this.removeChannel(id);
    delete this.channelMap[arrayBufferToHex(id)];
  }

  sendPing(to, callback=()=>{}) {
    this.send(to, 'ping.request', {}, callback);
  }

  handlePingRequest({data, callback}) {
    // console.log('PING', data);
    callback({});
  }

  handleTraceRequest({data, callback}) {
    callback(data);
  }

  handleCallbackResponse({data, callback}) {
    const reqCallback = this.callbacks.get(data.re);
    if (reqCallback) {
      reqCallback(data, callback);
    } else {
      // console.warn('<<< callback for %s expired', data.re);
    }
  }

  sendPeerRequest(to, count=DEFAULT_PEER_REQUEST_COUNT) {
    const timeout = setTimeout(() => {
      delete this.knownPeerIds[arrayBufferToHex(to)];
    }, 5000);
    this.send(to, 'peers.request', {count}, res => {
      clearTimeout(timeout);
      this.handlePeersResponse(res);
    });
  }

  handlePeersRequest({data: {count=DEFAULT_PEER_REQUEST_COUNT, from}, callback}) {
    // console.log('handlePeersRequest');

    const fromId = hexToUint8Array(from);

    const ids = this.allChannels.closest(fromId)
      .filter(({conn}) => conn != null)
      .filter(({id}) => !arrayEqual(id, this.id) && !arrayEqual(id, fromId))
      .map(({id}) => arrayBufferToHex(id))
      .slice(0, count);
    callback({ids});
  }

  handlePeersResponse(res) {
    // console.log('handlePeersResponse', res.ids);

    res.ids
      .map(id => hexToUint8Array(id))
      .filter(id => !arrayEqual(id, this.id))
      .filter(id => {
        const channel = this.getChannel(id);
        return channel == null || channel.conn == null;
      })
      .forEach(id => {
        // TODO: store peer provenance so we can ignore bad actors?
        this.knownPeerIds[arrayBufferToHex(id)] = true;
        this.addChannel(new Channel(id));
      });
  }

  send(to, type, data={}, callback=null) {
    if (typeof data === 'function') {
      callback = data;
      data = {};
    }

    const id = arrayBufferToHex(randomBytes(16));
    this.seenIds.set(id, true);

    if (callback != null) {
      this.callbacks.set(id, callback);
    }

    const message = JSON.stringify({
      id,
      type,
      from: arrayBufferToHex(this.id),
      to: arrayBufferToHex(to),
      trace: [arrayBufferToHex(this.id)],
      hops: 0,
      ...data,
    });

    // console.log('formatMessage', message);

    this.sendRaw(to, message);
  }

  sendRaw(to, message, trace=[]) {
    let closest = this.allChannels.closest(to)
      .filter(({conn}) => conn != null)
      .filter(({idHex}) => trace.indexOf(idHex) === -1)
      .slice(0, SEND_REPLICAS);

    const knownRoute = this.knownRoutes.get(arrayBufferToHex(to));
    if (knownRoute) {
      const channel = this.getChannel(knownRoute);
      // const channel = this.allChannels.get(knownRoute);
      if (channel != null && channel.conn != null) {
        closest.push(channel);
      }
    }

    if (closest.length === 0) {
      // console.warn(`closest value to ${arrayBufferToHex(to)} does not exist, dropping`, message);
      return;
    }

    if (arrayEqual(closest[0].id, to)) {
      closest = closest.slice(0, 1);
    }
    // console.log('send', closest.map(({id}) => arrayBufferToHex(id)), message);
    // console.log(closest.length, closest.filter(({conn}) => !!conn).length, message);
    closest.forEach(({id, conn}) => {
      try {
        conn.send(message);
      } catch (e) {
        console.log('probably a race', e);
        // this.removeChannel(id);
      }
    });
  }
}

export class Channel {
  constructor(id, conn) {
    this.id = id;
    this.idHex = arrayBufferToHex(id);
    this.vectorClock = Date.now();
    this.lastPing = Date.now();
    this.conn = conn;

    // console.log('channel', this);
  }
}

export class SubChannel {
  constructor(client, peerId, id=arrayBufferToHex(randomBytes(16))) {
    // console.log('subchannel created', id);
    this.client = client;
    this.peerId = peerId;
    this.id = id;
    this.readyState = SubChannel.ReadyStates.OPEN;
    this.onmessage = () => {};

    this.handleMessage = this.handleMessage.bind(this);
    this.client.on('receive.subchannel.message', this.handleMessage);
  }

  handleMessage({data: {channelId, data}}) {
    // console.log('receive.subchannel.message', channelId, this.id, data);

    if (channelId === this.id) {
      this.onmessage({data});
    }
  }

  send(data) {
    this.client.send(
      this.peerId,
      'subchannel.message',
      {
        channelId: this.id,
        data: data,
      },
    );
  }

  close() {
    this.readyState = SubChannel.ReadyStates.CLOSED;
    this.client.removeListener('receive.subchannel.message', this.handleMessage);
  }
}

SubChannel.ReadyStates = {
  OPEN: 1,
  CLOSED: 3,
};
