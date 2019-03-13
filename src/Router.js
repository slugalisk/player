import React from 'react';
import {HashRouter, Redirect, Route, Switch} from 'react-router-dom';
import App from './App';
import Test from './Test';
import DhtGraph from './DhtGraph';

const Router = () => (
  <HashRouter>
    <Switch>
      <Route exact path="/test" component={Test} />
      <Route exact path="/dht-graph" component={DhtGraph} />
      <Route exact path="/:name([\w\-]*)" component={App} />
    </Switch>
  </HashRouter>
);

export default Router;
