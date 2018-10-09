import React, {Component} from 'react';
import muxjs from 'mux.js';
import {ChunkedReadStream} from './chunkedStream';
import './SwarmPlayer.css';

const {Buffer} = require('buffer');

const log = e => console.log(e);

class SwarmPlayer extends Component {
  constructor(props) {
    super(props);
    this.video = React.createRef();
  }

  componentDidMount() {
    const mediaSource = new MediaSource();

    this.video.current.addEventListener('error', log);
    this.video.current.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => this.handleSourceOpen(mediaSource));
  }

  handleSourceOpen = (mediaSource) => {
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="mp4a.40.5,avc1.64001F"');
    sourceBuffer.addEventListener('updatestart', log);
    sourceBuffer.addEventListener('updateend', log);
    sourceBuffer.addEventListener('error', log);

    const videoSegments = [];
    let initSet = false;

    sourceBuffer.addEventListener('updateend', () => {
      if (videoSegments.length) {
        sourceBuffer.appendBuffer(videoSegments.shift());
      }
    });

    var transmuxer = new muxjs.mp4.Transmuxer();
    transmuxer.on('data', event => {
      if (event.type === 'combined') {
        const buf = initSet
          ? event.data
          : Buffer.concat([Buffer.from(event.initSegment), Buffer.from(event.data)]);
        initSet = true;

        if (sourceBuffer.updating) {
          videoSegments.push(new Uint8Array(buf));
        } else {
          sourceBuffer.appendBuffer(new Uint8Array(buf));
        }
      } else {
        console.log('unhandled event', event.type);
      }
    });

    const stream = new ChunkedReadStream(this.props.swarm);
    stream.on('data', data => {
      data.chunks.forEach(chunk => transmuxer.push(new Uint8Array(chunk)));
      transmuxer.flush();
    });
  };

  render() {
    return (
      <video
        controls
        className="swarm-player-video"
        ref={this.video}
      />
    );
  }
}

export default SwarmPlayer;
