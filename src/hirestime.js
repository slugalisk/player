module.exports = () => {
  if (typeof process !== 'undefined' && process.hrtime) {
    return process.hrtime();
  }

  if (typeof window !== 'undefined' && window.performance) {
    const { navigationStart } = performance.timing;
    const now = performance.now();

    return [
      Math.floor((navigationStart + now) / 1e3),
      Math.round(((navigationStart / 1e3 % 1) + (now / 1e3 % 1)) * 1e9),
    ];
  }

  throw new Error('unable to find suitable time source');
};
