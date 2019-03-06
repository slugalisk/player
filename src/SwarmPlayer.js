import React, {Component} from 'react';
import muxjs from 'mux.js';
import {ChunkedFragmentedReadStream} from './chunkedStream';
import DiagnosticMenu from './DiagnosticMenu';
import {Buffer} from 'buffer';

import './SwarmPlayer.css';

const log = e => console.log(e);

export default class SwarmPlayer extends Component {
  constructor(props) {
    super(props);
    this.video = React.createRef();
  }

  componentDidMount() {
    const mediaSource = new MediaSource();

    this.video.current.addEventListener('error', log);
    this.video.current.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => this.handleSourceOpen(mediaSource));

    this.video.current.play();
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

    const stream = new ChunkedFragmentedReadStream(this.props.swarm);
    stream.on('start', data => transmuxer.push(new Uint8Array(data)));
    stream.on('data', data => transmuxer.push(new Uint8Array(data)));
    stream.on('end', data => {
      transmuxer.push(new Uint8Array(data));
      transmuxer.flush();
    });
  };

  render() {
    return (
      <React.Fragment>
        <DiagnosticMenu swarm={this.props.swarm} />
        <video
          className="swarm-player-video"
          ref={this.video}
        />
      </React.Fragment>
    );
  }
}
