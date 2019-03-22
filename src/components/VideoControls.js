import React, {useState} from 'react';
import VideoVolume from './VideoVolume';
import classNames from 'classnames';
import {
  Pause,
  PlayArrow,
  VolumeOff,
  VolumeMute,
  VolumeDown,
  VolumeUp,
  Fullscreen,
  FullscreenExit,
  PictureInPictureAlt,
} from '@material-ui/icons';
import VideoProgressBar from './VideoProgressBar';
import {useDebounce} from 'react-use';

import './VideoPlayer.scss';

const Button = ({className, tooltip, icon: Icon, onClick}) => (
  <div className={classNames('button-wrap', className)}>
    <button
      data-tip={tooltip}
      onClick={onClick}
    >
      <Icon />
    </button>
  </div>
);

const PiPButton = ({supported, toggle}) => !supported ? null : (
  <Button
    className="pip"
    tooltip="Miniplayer"
    onClick={toggle}
    icon={PictureInPictureAlt}
  />
);

const FullscreenButton = ({supported, enabled, toggle}) => !supported ? null : (
  <Button
    className="fullscreen"
    tooltip={enabled ? 'Exit full screen' : 'Full screen'}
    onClick={toggle}
    icon={enabled ? FullscreenExit : Fullscreen}
  />
);

const VolumeControl = ({
  volume,
  videoControls,
  onUpdateStart,
  onUpdateEnd,
}) => {
  const volumeIcons = [
    VolumeOff,
    VolumeMute,
    VolumeDown,
    VolumeUp,
  ];
  const volumeLevel = Math.ceil(volume * (volumeIcons.length - 1));
  const VolumeIcon = volumeIcons[volumeLevel];
  const handleVolumeClick = () => volume === 0 ? videoControls.unmute() : videoControls.mute();

  return (
    <div className="volume button-wrap">
      <button
        data-tip={volume === 0 ? 'Unmute' : 'Mute'}
        onClick={handleVolumeClick}
      >
        <VolumeIcon className={`volume-level-${volumeLevel}`} />
      </button>
      <VideoVolume
        onUpdate={videoControls.setVolume}
        onSlideStart={onUpdateStart}
        onSlideEnd={onUpdateEnd}
        value={volume}
      />
    </div>
  );
};

const VideoControls = props => {
  const [active, setActive] = useState(false);
  const visible = props.visible || active;

  const [visible100, setVisible100] = useState(false);
  const [visible500, setVisible500] = useState(false);
  useDebounce(() => setVisible100(visible), 100, [visible]);
  useDebounce(() => setVisible500(visible), 500, [visible]);

  if (!visible && !visible500) {
    return null;
  }

  const {
    videoState,
    videoControls,
  } = props;

  const {playing} = videoState;

  const controlsClassName = classNames({
    video_player__controls: true,
    visible,
    visible100,
    visible500,
  });

  return (
    <div
      className={controlsClassName}
      onMouseMove={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <div className="controls_group left">
        <Button
          className="play"
          tooltip={playing === 0 ? 'Pause' : 'Play'}
          onClick={playing ? videoControls.pause : videoControls.play}
          icon={playing ? Pause : PlayArrow}
        />
        <VolumeControl
          volume={videoState.volume}
          videoControls={videoControls}
          onUpdateStart={() => setActive(true)}
          onUpdateEnd={() => setActive(false)}
        />
      </div>
      <div className="progress_bar">
        <VideoProgressBar
          videoState={videoState}
          videoControls={videoControls}
        />
      </div>
      <div className="controls_group right">
        <PiPButton
          supported={videoState.supportPiP}
          toggle={videoControls.togglePiP}
        />
        <FullscreenButton
          supported={document.fullscreenEnabled}
          enabled={props.fullscreen}
          toggle={props.toggleFullscreen}
        />
      </div>
    </div>
  );
};

export default VideoControls;
