function bounds(index) {
  let width = 2;
  while (index % width === width - 1) {
    width *= 2;
  }
  width /= 2;

  return [
    index - width + 1,
    index + width - 1,
  ];
}

module.exports = {
  bounds,
};
