const KBucket = require('k-bucket');
const {EventEmitter} = require('events');
const arrayBufferToHex = require('array-buffer-to-hex');
const arrayEqual = require('array-equal');
const randomBytes = require('randombytes');
const LRU = require('lru-cache');
const hexToUint8Array = require('./hexToUint8Array');

const SEND_REPLICAS = 2;
const MAX_HOPS = 10;
const DEFAULT_PEER_REQUEST_COUNT = 10;

// TODO: avoid opening every available connection
// TODO: replace dropped connections
// TODO: implement get/set
// TODO: implement connection dump rpc for network debugging
// TODO: update peers with new peer lists periodically

class Client extends EventEmitter {
  constructor(id) {
    super();

    this.id = id;

    this.channels = new KBucket({
      numberOfNodesPerKBucket: 4,
      localNodeId: this.id,
    });

    this.channels.on('ping', this.handlePing.bind(this));
    this.channels.on('removed', this.handleRemoved.bind(this));
    this.channels.on('updated', this.handleUpdated.bind(this));
    this.channels.on('added', this.handleAdded.bind(this));

    this.candidates = new KBucket({
      numberOfNodesPerKBucket: 4,
      localNodeId: this.id,
    });
    this.seenIds = new LRU({max: 1024});
    this.knownRoutes = new LRU({
      max: 1024,
      maxAge: 1000 * 60,
    });
    this.callbacks = new LRU({max: 1024});

    // console.log(this.id);
  }

  handlePing(channel) {
    // might not be necessary since dropped connections are removed...
    // console.log('handlePing', channel);
  }

  handleRemoved(channel) {
    channel.channel.close();
    // console.log('handleRemoved', channel);
  }

  handleUpdated(channel) {
    // console.log('handleUpdated', channel);
  }

  handleAdded(channel) {
    // emit event?
    // console.log('handleAdded', channel);
  }

  createChannel(id, wrtcChannel) {
    const channel = new Channel(id, wrtcChannel);

    this.candidates.add(channel);

    const messages = [];
    const bufferMessages = event => messages.push(event);

    channel.channel.addEventListener('open', () => {
      this.channels.add(channel);

      channel.channel.removeEventListener('message', bufferMessages);
      channel.channel.addEventListener('message', this.handleMessage.bind(this, channel));
      messages.forEach(event => this.handleMessage(channel, event));

      this.handleOpen(channel);
    });

    channel.channel.addEventListener('message', bufferMessages);
    channel.channel.addEventListener('close', this.handleClose.bind(this, channel));
    channel.channel.addEventListener('error', this.handleError.bind(this, channel));
  }

  handleOpen({channel, id}) {
    // console.log('handleOpen', arrayBufferToHex(id));

    this.send(id, 'peers.request', this.handlePeersResponse.bind(this));
  }

  handleMessage(channel, event) {
    // console.log('handleMessage', event.data);

    const req = JSON.parse(event.data);
    const {type, id} = req;

    if (this.seenIds.get(id)) {
      // console.log('dropped seen message', id);
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

    if (type === 'peers.request') {
      this.handlePeersRequest(req, resCallback);
    } else if (type === 'ping.request') {
      resCallback();
    } else if (type === 'callback.response') {
      const reqCallback = this.callbacks.get(req.re);
      if (reqCallback) {
        reqCallback(req, resCallback);
      } else {
        // console.warn('<<< callback for %s expired', req.re);
      }
    } else {
      this.emit(`receive.${type}`, {data: req, callback: resCallback});
    }
  }

  forwardMessage(to, data) {
    // console.log('forwarding message', arrayBufferToHex(to), data);

    if (data.hops >= MAX_HOPS) {
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

  handlePeersRequest({count=DEFAULT_PEER_REQUEST_COUNT, from}, callback) {
    // console.log('handlePeersRequest');

    const ids = this.channels.closest(hexToUint8Array(from), count)
      .map(({id}) => arrayBufferToHex(id));
    callback({ids});
  }

  handlePeersResponse(res) {
    // console.log('handlePeersResponse', res.ids);

    const ids = res.ids
      .map(id => hexToUint8Array(id))
      .filter(id => {
        return this.channels.get(id) == null
          && this.candidates.get(id) == null
          && !arrayEqual(id, this.id);
      });

    // console.log('received peers', ids.map(arrayBufferToHex));

    if (ids.length) {
      this.emit('peers.discover', ids);
    }
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
    let closest = this.channels.closest(to, SEND_REPLICAS);

    const knownRoute = this.knownRoutes.get(arrayBufferToHex(to));
    if (knownRoute) {
      const channel = this.channels.get(knownRoute);
      if (channel != null) {
        closest.push(channel);
      }
    }

    if (closest.length === 0) {
      // console.warn(`closest value to ${arrayBufferToHex(to)} does not exist`);
      return;
    }

    if (arrayEqual(closest[0].id, to)) {
      closest = closest.slice(0, 1);
    }
    // console.log('send', closest.map(({id}) => arrayBufferToHex(id)), message);
    closest.forEach(({channel}) => channel.send(message));
  }
}

class Channel {
  constructor(id, channel) {
    this.id = id;
    this.channel = channel;

    // console.log('channel', this);
  }
}

class SubChannel {
  constructor(client, peerId, id=arrayBufferToHex(randomBytes(16))) {
    this.client = client;
    this.peerId = peerId;
    this.id = id;
    this.onmessage = () => {};

    this.handleMessage = this.handleMessage.bind(this);
    this.client.on('receive.subchannel.message', this.handleMessage);
  }

  handleMessage({data: {channelId, data}}) {
    // console.log('receive.subchannel.message', channelId, this.id, data)

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
    this.client.removeListener('receive.subchannel.message', this.handleMessage);
  }
}

module.exports = {
  Client,
  Channel,
  SubChannel,
};
