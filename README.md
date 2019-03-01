# distributed livestream wip

## Getting Started

#### Running the sandbox UI

1. fork
2. clone recursively
    ```
    git clone --recursive https://github.com/slugalisk/player.git
    ```
3. install the js dependencies
    ```
    yarn install
    ```
4. start ui dev server with
    ```
    yarn start
    ```
5. open `https://localhost:3000/test`

#### Running the ingest server

1. build nginx with nginx-rtmp-module
   ```
   ./vendor/build.sh
   ```
2. download `DB5LITEBIN` from https://lite.ip2location.com/file-download
3. unzip `IP2LOCATION-LITE-DB5.BIN.ZIP` into `./vendor/`
4. start super node with `yarn run server`

## Sources

The implementation is based on:

* https://tools.ietf.org/html/rfc7574
* https://repository.tudelft.nl/islandora/object/uuid:80ebec52-2323-4fe0-bf7e-92b594c03d3f/datastream/OBJ/download
* http://www.watersprings.org/pub/id/draft-zhang-ppsp-usage-08.txt
