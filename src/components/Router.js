import React, {Suspense, lazy} from 'react';
import {HashRouter, Redirect, Route, Switch} from 'react-router-dom';
import App from './App';
import PlayButton from './PlayButton';

const Test = lazy(() => import('./Test'));
const DhtGraph = lazy(() => import('./DhtGraph'));

console.log({App, Test, DhtGraph});

const Router = () => (
  <HashRouter>
    <Suspense fallback={<PlayButton disabled={true} flicker={true} blur />}>
      <Switch>
        <Route exact path="/test" component={props => <Test {...props} />} />
        <Route exact path="/dht-graph" component={props => <DhtGraph {...props} />} />
        <Route exact path="/:name([\w\-]*)" component={App} />
        <Redirect to="/" />
      </Switch>
    </Suspense>
  </HashRouter>
);

export default Router;
