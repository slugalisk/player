import React from 'react';
import ReactDOM from 'react-dom';
import Router from './components/Router';

import './index.css';

// if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
//   window.addEventListener('load', function() {
//     navigator.serviceWorker.register('/service-worker.js');
//   });
// }

ReactDOM.render(<Router />, document.getElementById('root'));
