import React, {useState, useRef} from 'react';
import ChatMessages from './ChatMessages';
import useChatSwarm from '../hooks/useChatSwarm';

const Chat = ({client}) => {
  const [messages, sendMessage] = useChatSwarm(client);
  const [message, setMessage] = useState('');
  const input = useRef();

  const handleSubmit = e => {
    e.preventDefault();

    sendMessage(message);
    setMessage('');
  };

  const handleChange = e => {
    setMessage(e.target.value);
  };

  return (
    <div className="chat">
      <form className="compose-form" onSubmit={handleSubmit}>
        <input
          className="message-input"
          type="text"
          placeholder="write a message..."
          onChange={handleChange}
          value={message}
        />
        <button className="send-button">Send</button>
      </form>
      <ChatMessages messages={messages} />
    </div>
  );
};

export default Chat;
