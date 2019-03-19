import React, {useState, useEffect} from 'react';
import {Slider, Rail, Handles, Tracks} from 'react-compound-slider';
import classNames from 'classnames';
import useIdleTimeout from '../hooks/useIdleTimeout';

export const Handle = ({
  domain: [min, max],
  handle: {id, value, percent},
  getHandleProps,
}) => (
  <div
    role="slider"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    style={{left: `${percent}%`}}
    className="video_volume__handle"
    {...getHandleProps(id)}
  />
);

export const Track = ({source, target, getTrackProps}) => (
  <div
    className="video_volume__track"
    style={{
      left: `${source.percent}%`,
      width: `${target.percent - source.percent}%`,
    }}
    {...getTrackProps()}
  />
);

const VideoVolume = ({
  value,
  onUpdate,
  onSlideStart,
  onSlideEnd,
}) => {
  const [dragging, setDragging] = useState(false);
  const [idle, renewIdleTimeout] = useIdleTimeout();

  useEffect(renewIdleTimeout, [value]);

  const sliderClassNames = classNames({
    video_volume__slider: true,
    dragging,
    active: !idle,
  });

  const handleUpdate = values => {
    if (dragging) {
      onUpdate(values[0]);
    }
  };

  const handleSlideStart = values => {
    onSlideStart(values);
    setDragging(true);
  };

  const handleSlideEnd = values => {
    onSlideEnd(values);
    setDragging(false);
  };

  return (
    <Slider
      mode={1}
      step={0.01}
      className={sliderClassNames}
      domain={[0, 1]}
      onUpdate={handleUpdate}
      onSlideStart={handleSlideStart}
      onSlideEnd={handleSlideEnd}
      values={[value]}
    >
      <Rail>
        {({getRailProps}) => <div className="video_volume__rail" {...getRailProps()} />}
      </Rail>
      <Handles>
        {({handles, getHandleProps}) => (
          <div>
            {handles.map(handle => (
              <Handle
                key={handle.id}
                handle={handle}
                domain={[0, 1]}
                getHandleProps={getHandleProps}
              />
            ))}
          </div>
        )}
      </Handles>
      <Tracks right={false}>
        {({tracks, getTrackProps}) => (
          <div>
            {tracks.map(({id, source, target}) => (
              <Track
                key={id}
                source={source}
                target={target}
                getTrackProps={getTrackProps}
              />
            ))}
          </div>
        )}
      </Tracks>
    </Slider>
  );
};

export default VideoVolume;
