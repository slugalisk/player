const crypto = require('crypto');

const data = new Uint8Array(256);
for (let i = 0; i < 256; i ++) {
    data[i] = Math.floor(Math.random() * 256);
}

const hash = crypto.createHash('SHA1');
hash.update(data);

console.log(hash.digest());