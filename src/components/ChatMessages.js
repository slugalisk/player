import React from 'react';
import moment from 'moment';

const Messages = ({messages}) => {
  const items = messages.map(({time, message, id}) => (
    <li className="message" key={id}>
      <span className="timestamp" title={time}>{moment(time).format('HH:mm:ss')}</span>
      <span className="text">{message}</span>
    </li>
  )).reverse();

  return (
    <ul className="messages">
      {items}
    </ul>
  );
};

export default Messages;
