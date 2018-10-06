#!/bin/bash

nproc=$(getconf _NPROCESSORS_ONLN)
JOBS=${JOBS:-$nproc}

set -e

sudo apt install -y libssl-dev libpcre-3-dev zlib1g-dev

pushd `pwd`

SCRIPT=`realpath $0`
BASE_DIR=`dirname $SCRIPT`

cd "$BASE_DIR/nginx"
./auto/configure \
  --sbin-path="$BASE_DIR/run/sbin/nginx" \
  --modules-path="$BASE_DIR/run/modules" \
  --conf-path="$BASE_DIR/run/nginx.conf" \
  --error-log-path="$BASE_DIR/run/error-log" \
  --pid-path="$BASE_DIR/run/nginx.pid" \
  --lock-path="$BASE_DIR/run/lock" \
  --http-log-path="$BASE_DIR/run/http-log" \
  --http-client-body-temp-path="$BASE_DIR/run/http-client-body-temp" \
  --http-proxy-temp-path="$BASE_DIR/run/http-proxy-temp" \
  --http-fastcgi-temp-path="$BASE_DIR/run/http-fastcgi-temp" \
  --http-uwsgi-temp-path="$BASE_DIR/run/http-uwsgi-temp" \
  --http-scgi-temp-path="$BASE_DIR/run/http-scgi-temp" \
  --with-http_ssl_module \
  --with-stream \
  --add-module=../nginx-rtmp-module
make -j $JOBS

popd
