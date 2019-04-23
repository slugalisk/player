FROM node:10.15.3-alpine

WORKDIR /vendor

# Install nginx dependencies
RUN apk add pcre-dev openssl-dev zlib-dev

# Install nginx
RUN set -x \
    && apk add --no-cache --virtual .build-dependencies \
        git \
        autoconf \
        g++ \
        make \
    && git clone --branch release-1.15.12 https://github.com/nginx/nginx.git \
    && git clone https://github.com/slugalisk/nginx-rtmp-module.git \
    && cd nginx \
    && ./auto/configure \
        --with-http_ssl_module \
        --with-stream \
        --add-module=../nginx-rtmp-module \
        --conf-path=/vendor/nginx.conf \
    && make -j$(getconf _NPROCESSORS_ONLN) \
    && make install \
    && cd .. \
    && apk del .build-dependencies

ENV PATH="/usr/local/nginx/sbin:${PATH}"

WORKDIR /app

# Install app
COPY . .

RUN set -x \
    && apk add --no-cache --virtual .build-dependencies \
        autoconf \
        automake \
        g++ \
        gcc \
        libtool \
        make \
        python \
    && npm install -g yarn \
    && yarn install \
    && PUBLIC_URL=/ yarn run build \
    && yarn install --production --ignore-scripts --prefer-offline --force \
    && apk del .build-dependencies

# Copy default nginx config
COPY vendor/run/nginx.conf /vendor/nginx.conf

EXPOSE 1935 8080
ENTRYPOINT [ "yarn", "run" ]
CMD [ "server" ]
