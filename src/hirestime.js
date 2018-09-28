function now() {
  if (typeof process !== 'undefined' && process.hrtime) {
    const now = process.hrtime();
    return [
      Math.floor(Date.now() / 1000),
      now[1],
    ];
  }

  if (typeof window !== 'undefined' && window.performance) {
    const {navigationStart} = performance.timing;
    const now = performance.now();

    return [
      Math.floor((navigationStart + now) / 1e3),
      Math.round((((navigationStart / 1e3 % 1) + (now / 1e3 % 1)) % 1) * 1e9),
    ];
  }

  throw new Error('unable to find suitable time source');
}

function sub(a, b) {
  const delta = [
    a[0] - b[0],
    a[1] - b[1],
  ];

  if (delta[0] > 0 && delta[1] < 0) {
    delta[0] --;
    delta[1] += 1e9;
  }
  if (delta[0] < 0 && delta[1] > 0) {
    delta[0] ++;
    delta[1] -= 1e9;
  }

  return delta;
}

function since(timestamp) {
  return sub(now(), timestamp);
}

function toNanos(timestamp) {
  return timestamp[0] * 1e9 + timestamp[1];
}

function toMillis(timestamp) {
  return timestamp[0] * 1e3 + Math.round(timestamp[1] / 1e6);
}

const InfinityTimestamp = [Infinity, Infinity];

function min(...timestamps) {
  let current = InfinityTimestamp;
  for (let i = 0; i < timestamps.length; i ++) {
    const candidate = timestamps[i];
    if (candidate[0] < current[0] || (candidate[0] === current[0] && candidate[1] < current[1])) {
      current = candidate;
    }
  }
  return current;
}

module.exports = {
  now,
  sub,
  since,
  toMillis,
  toNanos,
  min,
  Infinity: InfinityTimestamp,
};
