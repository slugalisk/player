# Contributing

## Getting Started

1. fork
2. clone recursively
3. run `./vendor/build.sh`
4. download `DB5LITEBIN` from https://lite.ip2location.com/file-download
5. unzip `IP2LOCATION-LITE-DB5.BIN.ZIP` into `./vendor/`
6. run `yarn install`
7. start super node with `npm run server`
8. start ui dev server with `npm start`
9. start permissive chrome instance with `/usr/bin/google-chrome http://localhost:3000 --user-data-dir=/tmp --unsafely-treat-insecure-origin-as-secure=http://localhost:3000 --allow-running-insecure-content`
