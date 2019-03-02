import React from 'react';
import {BrowserRouter, Route, Switch} from 'react-router-dom';
import App from './App';
import Test from './Test';
import DhtGraph from './DhtGraph';

const Router = () => (
  <BrowserRouter>
    <Switch>
      <Route exact path="/" component={App} />
      <Route exact path="/test" component={Test} />
      <Route exact path="/dht-graph" component={DhtGraph} />
    </Switch>
  </BrowserRouter>
);

export default Router;
