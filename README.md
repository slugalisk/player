# distributed livestream wip

## Getting Started

1. fork
2. clone recursively
3. run `./vendor/build.sh`
4. download `DB5LITEBIN` from https://lite.ip2location.com/file-download
5. unzip `IP2LOCATION-LITE-DB5.BIN.ZIP` into `./vendor/`
6. run `yarn install`
7. patch broken wrtc module (https://github.com/zeit/pkg/issues/364#issuecomment-443608978)
8. start super node with `npm run server`
9. start ui dev server with `npm start`
10. start permissive chrome instance with `/usr/bin/google-chrome http://localhost:3000 --user-data-dir=/tmp --unsafely-treat-insecure-origin-as-secure=http://localhost:3000 --allow-running-insecure-content`

## Sources

The implementation is based on:

* https://tools.ietf.org/html/rfc7574
* https://repository.tudelft.nl/islandora/object/uuid:80ebec52-2323-4fe0-bf7e-92b594c03d3f/datastream/OBJ/download
* http://www.watersprings.org/pub/id/draft-zhang-ppsp-usage-08.txt
