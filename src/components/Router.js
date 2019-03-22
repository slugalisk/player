import React, {Suspense, lazy} from 'react';
import {HashRouter, Redirect, Route, Switch} from 'react-router-dom';
import App from './App';
import LogoButton from './LogoButton';

const LocalSwarm = lazy(() => import('./LocalSwarm'));
const DhtGraph = lazy(() => import('./DhtGraph'));
const MediaDeviceTest = lazy(() => import('./MediaDeviceTest'));

const Router = () => (
  <HashRouter>
    <Suspense fallback={<LogoButton disabled={true} flicker={true} blur />}>
      <Switch>
        <Route exact path="/test/local-swarm" component={props => <LocalSwarm {...props} />} />
        <Route exact path="/test/dht-graph" component={props => <DhtGraph {...props} />} />
        <Route exact path="/test/media-device" component={props => <MediaDeviceTest {...props} />} />
        <Route exact path="/:name([\w\-]*)" component={App} />
        <Redirect to="/" />
      </Switch>
    </Suspense>
  </HashRouter>
);

export default Router;
