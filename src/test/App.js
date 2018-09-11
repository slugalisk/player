import React, { Component } from 'react';
import muxjs from 'mux.js';
import './App.css';

const {Buffer} = require('buffer');

const logmeme = e => console.log(e);

class App extends Component {
  constructor(props) {
    super(props);
    this.video = React.createRef();
    this.media = [];
    this.mediaIndex = 0;
  }

  componentDidMount() {
    this.video.current.addEventListener('ended', this.playNext, false);

    const mediaSource = new MediaSource();

    const video = this.video.current;
    video.addEventListener('error', logmeme);

    video.src = URL.createObjectURL(mediaSource);

    // console.log('mediaSource attached', mediaSource.readyState);
    // mediaSource.addEventListener('sourceopen', () => console.log('soruceopen'));

    Promise
      .all((new Array(23)).fill(0).map((_, n) => fetch(`/media/${n + 1333}.ts`)))
      // .all([fetch('/media/test.mp4')])
      .then(results => Promise.all(results.map(res => res.arrayBuffer())))
      // .then(chunks => chunks.map(chunk => new Uint8Array(chunk)))
      // .then(results => Promise.all(results.map(res => res.blob())))
      .then((chunks) => {

        // video.src = URL.createObjectURL(chunks[0]);

        // const sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8, vorbis"');

        // const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="mp4a.40.2,avc1.4d400d"');
        // sourceBuffer.appendBuffer(chunks[0]);

        // create a transmuxer:
        var transmuxer = new muxjs.mp4.Transmuxer();

        const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="mp4a.40.5,avc1.64001F"');
        sourceBuffer.addEventListener('updatestart', logmeme);
        sourceBuffer.addEventListener('updateend', logmeme);
        sourceBuffer.addEventListener('error', logmeme);

        const memes = [];
        let initSet = false;

        sourceBuffer.addEventListener('updateend', () => {
          if (memes.length) {
            sourceBuffer.appendBuffer(memes.shift());
          }
        });

        // data events signal a new fMP4 segment is ready:
        transmuxer.on('data', event => {
          console.log(event);
          console.log(event.data.byteLength);

          // Tada! Now you have an MP4 that you could use with Media Source Extensions
          if (event.type === 'combined') {
            const buf = initSet
               ? event.data
               : Buffer.concat([
                  Buffer.from(event.initSegment),
                  Buffer.from(event.data),
                ]);
            initSet = true;

            if (sourceBuffer.updating) {
              memes.push(new Uint8Array(buf));
            } else {
              sourceBuffer.appendBuffer(new Uint8Array(buf));
            }

            console.log(sourceBuffer);

            // TODO: init SourceBuffer codec using video chunk inrospection
            // var parsed = muxjs.mp4.tools.inspect(buf);
            // console.log(parsed);

            // console.log(URL.createObjectURL(new Blob(event.data, {type: 'video/mp4'})));

            // parsed.info.AVCProfileIndication.toString(16);
            // parsed.info.profileCompatibility.toString(16);
            // parsed.info.levelIdc.toString(16);

          } else {
            console.log('unhandled event', event.type);
          }
        });

        let index = 0;
        chunks.forEach(chunk => {
          transmuxer.push(new Uint8Array(chunk))
          if (++ index > 5) {
            transmuxer.flush();
          }
        });
        // transmuxer.flush();
      });
  }

  playNext = () => {
    this.mediaIndex = (this.mediaIndex + 1) % this.media.length;

    const video = this.video.current;
    video.src = this.media[this.mediaIndex];
    // video.load();
    // video.play();
  }

  render() {
    return (
      <video controls ref={this.video} />
    );

    // return (
    //   <div className="idle">
    //     <div className="scanner"></div>
    //     <div className="noise"></div>
    //   </div>
    // );
  }
}

export default App;
