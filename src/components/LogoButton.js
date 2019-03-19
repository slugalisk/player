import React, {useEffect, useState} from 'react';
import classNames from 'classnames';
import {useHover} from 'use-events';
import {useDebounce} from 'react-use';

import './LogoButton.scss';

const LogoButton = ({
  spin = false,
  flicker = false,
  pulse = false,
  disabled = false,
  visible = true,
  blur = false,
  error = false,
  onClick = null,
  idleTimeout = 2000,
}) => {
  const [currentVisibility, setCurrentVisibility] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setCurrentVisibility(visible), 300);
    return () => clearTimeout(timeout);
  }, [visible]);

  const [hovering, hoverEventHandlers] = useHover();
  const [mouseIdle, setMouseIdle] = useState('');

  useDebounce(() => setMouseIdle(hovering), idleTimeout, [hovering]);
  useEffect(() => {
    if (!hovering) {
      setMouseIdle(false);
    }
  }, [hovering]);

  const hidden = !visible && !currentVisibility;

  const hoverClasses = classNames({
    logo_button_wrap: true,
    hovering: mouseIdle,
    hidden,
    disabled,
  });

  const buttonClasses = classNames({
    logo_button: true,
    clickable: onClick != null && !disabled,
    exiting: !visible && currentVisibility,
    hidden,
    spin,
    flicker,
    pulse,
    blur,
    error,
    disabled,
  });

  return (
    <div className={hoverClasses}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 926 926"
        className={buttonClasses}
        onClick={disabled ? undefined : onClick}
        {...hoverEventHandlers}
      >
        <g className="background">
          <circle cx="463" cy="463" r="463"/>
        </g>
        <g className="network">
          <circle cx="327" cy="229" r="139"/>
          <circle cx="732" cy="463" r="139"/>
          <circle cx="327" cy="697" r="139"/>
          <polygon points="854 463 269 125 269 801 854 463"/>
        </g>
        <g className="button">
          <path d="M658,524c23-13,23-36,0-50L457,358c-23-13-43-2-43,25V616c0,27,19,38,43,25Z" transform="translate(-45 -36)"/>
        </g>
      </svg>
    </div>
  );
};

export default LogoButton;
