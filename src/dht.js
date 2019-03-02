import KBucket from 'k-bucket';
import {EventEmitter} from 'events';
import arrayBufferToHex from 'array-buffer-to-hex';
import arrayEqual from 'array-equal';
import randomBytes from 'randombytes';
import LRU from 'lru-cache';
import hexToUint8Array from './hexToUint8Array';

const SEND_REPLICAS = 2;
const MAX_HOPS = 10;
const DEFAULT_PEER_REQUEST_COUNT = 5;
const NUMBER_OF_NODES_PER_BUCKET = 15;

// TODO: replace dropped connections
// TODO: implement get/set
// TODO: implement connection dump rpc for network debugging
// TODO: update peers with new peer lists periodically

export class Client extends EventEmitter {
  constructor(id) {
    super();
    this.setMaxListeners(Infinity);

    this.id = id;

    this.channels = new KBucket({
      numberOfNodesPerKBucket: NUMBER_OF_NODES_PER_BUCKET,
      localNodeId: this.id,
    });

    this.channels.on('ping', this.handlePing.bind(this));
    this.channels.on('removed', this.handleRemoved.bind(this));
    this.channels.on('updated', this.handleUpdated.bind(this));
    this.channels.on('added', this.handleAdded.bind(this));

    this.seenIds = new LRU({max: 1024});
    this.knownRoutes = new LRU({
      max: 1024,
      maxAge: 1000 * 60,
    });
    this.callbacks = new LRU({max: 1024});

    this.on('receive.peers.request', this.handlePeersRequest.bind(this));
    this.on('receive.ping.request', this.handlePingRequest.bind(this));
    this.on('receive.callback.response', this.handleCallbackResponse.bind(this));
  }

  handlePing(channels, newChannel) {
    // console.log('ping', channels, newChannel);
    const PING_TIMEOUT = 1000;
    const CONNECT_TIMEOUT = 1000;

    channels.forEach(channel => {
      const {id} = channel;

      // console.log('>>> conn exists, pinging');
      // TODO: maybe keep track of how recently we pinged? debounce
      const replaceChannel = () => {
        // console.log('>>> ping timeout');
        this.channels.remove(id);
        this.channels.add(newChannel);
      };

      // TODO: connection up/down getter
      if (channel.conn == null) {
        // console.log('>>> channel undefined, waiting to see if it gets replaced');
        setTimeout(() => {
          const channel = this.channels.get(id);
          if (channel != null && channel.conn != null) {
            this.channels.add(channel);
            return;
          }
          replaceChannel();
        }, CONNECT_TIMEOUT);

        return;
      }

      // console.log('ping', arrayBufferToHex(id));
      const replaceChannelTimeout = setTimeout(replaceChannel, PING_TIMEOUT);
      const clearReplaceChannelTimeout = () => {
        // console.log('>>> clear timeout');
        clearTimeout(replaceChannelTimeout);
        this.channels.add(channel);
      };
      this.send(id, 'ping.request', {}, clearReplaceChannelTimeout);
    });
  }

  handleRemoved(channel) {
    // console.log('remove', arrayBufferToHex(channel.id));
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

    // console.log('create channel');
    // this.candidates.add(channel);

    const messages = [];
    const bufferMessages = event => messages.push(event);

    conn.addEventListener('open', () => {
      this.channels.add(channel);

      conn.removeEventListener('message', bufferMessages);
      conn.addEventListener('message', this.handleMessage.bind(this, channel));
      messages.forEach(event => this.handleMessage(channel, event));

      this.send(id, 'peers.request', {}, this.handlePeersResponse.bind(this));
    });

    conn.addEventListener('message', bufferMessages);
    conn.addEventListener('close', this.handleClose.bind(this, channel));
    conn.addEventListener('error', this.handleError.bind(this, channel));
  }

  handleMessage(channel, event) {
    // console.log('handleMessage', event.data);

    const req = JSON.parse(event.data);
    const {type, id} = req;

    if (this.seenIds.get(id)) {
      // console.log('discarding seen message', id);
      return;
    }
    this.seenIds.set(id, true);

    this.knownRoutes.set(req.from, channel.id);

    const to = hexToUint8Array(req.to);
    if (!arrayEqual(to, this.id)) {
      this.forwardMessage(to, req);
      return;
    }

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

    this.sendRaw(to, JSON.stringify(data));
  }

  handleClose({id}) {
    // console.warn('handleClose', arrayBufferToHex(id));
    this.channels.remove(id);
    this.candidates.remove(id);
  }

  handleError(error) {
    // console.log('error', error);
  }

  handlePingRequest({callback}) {
    callback();
  }

  handleCallbackResponse({data, callback}) {
    const reqCallback = this.callbacks.get(data.re);
    if (reqCallback) {
      reqCallback(data, callback);
    } else {
      // console.warn('<<< callback for %s expired', data.re);
    }
  }

  handlePeersRequest({data: {count=DEFAULT_PEER_REQUEST_COUNT, from}, callback}) {
    // console.log('handlePeersRequest');

    const ids = this.channels.closest(hexToUint8Array(from), count)
      .map(({id}) => arrayBufferToHex(id));
    callback({ids});
  }

  handlePeersResponse(res) {
    // console.log('handlePeersResponse', res.ids);

    res.ids
      .map(id => hexToUint8Array(id))
      .filter(id => this.channels.get(id) == null && !arrayEqual(id, this.id))
      .forEach(id => this.channels.add(new Channel(id)));
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
      hops: 0,
      ...data,
    });

    // console.log('formatMessage', message);

    this.sendRaw(to, message);
  }

  sendRaw(to, message) {
    let closest = this.channels.closest(to)
      .filter(({conn}) => conn != null)
      .slice(0, SEND_REPLICAS);

    const knownRoute = this.knownRoutes.get(arrayBufferToHex(to));
    if (knownRoute) {
      const channel = this.channels.get(knownRoute);
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
    closest.forEach(({conn}) => conn.send(message));
  }
}

export class Channel {
  constructor(id, conn) {
    this.id = id;
    this.vectorClock = Date.now();
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
