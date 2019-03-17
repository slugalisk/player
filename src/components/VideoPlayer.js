import React, {useEffect, useRef, useState} from 'react';
import DiagnosticMenu from './DiagnosticMenu';
import PlayButton from './PlayButton';
import useSwarmMediaSource from '../hooks/useSwarmMediaSource';
import useVideo from '../hooks/useVideo';
import {useDebounce} from 'react-use';
import useFullscreen from 'use-fullscreen';
import {Loop} from '@material-ui/icons';
import VideoControls from './VideoControls';

import './VideoPlayer.scss';

const SwarmPlayer = ({swarm, indexSwarm}) => {
  const [videoState, videoProps, videoControls] = useVideo();
  const mediaSource = useSwarmMediaSource(swarm);

  useEffect(() => {
    if (videoProps.ref.current != null && mediaSource != null) {
      videoProps.ref.current.src = URL.createObjectURL(mediaSource);
      videoControls.play();
    }
  }, [videoProps.ref, mediaSource]);

  const [controlsVisible, setControlsVisible] = useState(false);
  const [lastActive, setLastActive] = useState(false);

  useDebounce(() => setControlsVisible(false), 5000, [lastActive]);

  const handleMouseMove = () => {
    setControlsVisible(true);
    setLastActive(Date.now());
  };

  const handleMouseOut = () => setControlsVisible(false);

  const ref = useRef();
  const [isFullscreen, toggleFullscreen] = useFullscreen();

  const playButton = (videoState.waiting && videoState.loaded) ? (
    <div className="swarm_player__waiting_spinner">
      <Loop />
    </div>
  ) : (
    <PlayButton
      visible={!videoState.playing}
      onClick={videoControls.play}
      flicker={videoState.ended && !videoState.loaded}
      spin={videoState.waiting && videoState.loaded}
      disabled={videoState.waiting || !videoState.loaded}
      blur={true}
    />
  );

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseOut={handleMouseOut}
      ref={ref}
    >
      {/* <DiagnosticMenu swarm={indexSwarm} containerClass="diagnostic-menu--indent-1" /> */}
      <DiagnosticMenu swarm={swarm} />
      <video
        onClick={e => e.preventDefault()}
        className="swarm_player__video"
        {...videoProps}
      />
      {playButton}
      <VideoControls
        {...videoState}
        {...videoControls}
        visible={controlsVisible}
        fullscreen={isFullscreen}
        toggleFullscreen={() => toggleFullscreen(ref.current)}
      />
    </div>
  );
};

export default SwarmPlayer;
