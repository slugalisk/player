import React, {useEffect, useRef} from 'react';
import DiagnosticMenu from './DiagnosticMenu';
import LogoButton from './LogoButton';
import useSwarmMediaSource from '../hooks/useSwarmMediaSource';
import useVideo from '../hooks/useVideo';
import useFullscreen from 'use-fullscreen';
import {Loop} from '@material-ui/icons';
import VideoControls from './VideoControls';
import useIdleTimeout from '../hooks/useIdleTimeout';

import './VideoPlayer.scss';

const SwarmPlayer = ({
  swarm,
  volumeStepSize = 0.1,
  mimeType,
  useMediaSource = useSwarmMediaSource,
}) => {
  const rootRef = useRef();
  const [controlsHidden, renewControlsTimeout, clearControlsTimeout] = useIdleTimeout();
  const [isFullscreen, toggleFullscreen] = useFullscreen();
  const [videoState, videoProps, videoControls] = useVideo();
  const [mediaSource, truncateMediaSource] = useMediaSource(swarm, {mimeType});

  useEffect(() => {
    videoControls.setSrc(URL.createObjectURL(mediaSource));
    videoControls.play();
  }, [videoProps.ref, mediaSource]);

  useEffect(() => truncateMediaSource(60), [videoState.bufferEnd]);

  const waitingSpinner = (videoState.waiting && videoState.loaded)
    ? (
      <div className="video_player__waiting_spinner">
        <Loop />
      </div>
    ) : (
      <LogoButton
        visible={!videoState.playing && !videoState.paused}
        onClick={videoControls.play}
        flicker={videoState.ended && !videoState.loaded}
        spin={videoState.waiting && videoState.loaded}
        disabled={videoState.waiting || !videoState.loaded}
        blur={true}
      />
    );

  const handleToggleFullscreen = () => toggleFullscreen(rootRef.current);

  const handleWheel = e => {
    const direction = e.deltaY < 0 ? 1 : -1;
    videoControls.setVolume(videoState.volume + direction * volumeStepSize);
    renewControlsTimeout();
  };

  return (
    <div
      className="video_player"
      onMouseMove={renewControlsTimeout}
      onMouseLeave={clearControlsTimeout}
      onDoubleClick={handleToggleFullscreen}
      onWheel={handleWheel}
      ref={rootRef}
    >
      <DiagnosticMenu swarm={swarm} />
      <video
        onClick={e => e.preventDefault()}
        className="video_player__video"
        {...videoProps}
      />
      {waitingSpinner}
      <VideoControls
        videoState={videoState}
        videoControls={videoControls}
        visible={!controlsHidden}
        fullscreen={isFullscreen}
        toggleFullscreen={handleToggleFullscreen}
      />
    </div>
  );
};

export default SwarmPlayer;
