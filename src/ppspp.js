const { EventEmitter } = require('events');

class Client {
  constructor() {
    this.channels = [];
  }

  addChannel(channel) {
    this.channels.push(channel);
  }
}

class Channel extends EventEmitter {
  constructor(channel) {
    super();

    this.channel = channel;
    this.channel.onopen = this.handleOpen.bind(this);
    this.channel.onmessage = this.handleMessage.bind(this);
    this.channel.onclose = this.handleClose.bind(this);
    this.channel.onerror = err => console.log('channel error:', err);
  }

  handleOpen(event) {
    console.log(event);
  }

  handleMessage(msg) {
    console.log(msg)
  }

  handleClose() {
    console.log('close');
  }
}


module.exports = {
  Client,
  Channel,
};
