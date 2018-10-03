import BitArray from './bitarray';

it('set', () => {
  const b = new BitArray(64);

  b.set(42);
  expect(b.toValueArray()).toEqual([42]);

  b.set(55);
  expect(b.toValueArray()).toEqual([42, 55]);

  b.set(100);
  expect(b.toValueArray()).toEqual([42, 55, 100]);

  b.set(118);
  expect(b.toValueArray()).toEqual([55, 100, 118]);

  b.set(119);
  expect(b.toValueArray()).toEqual([100, 118, 119]);
});

it('unset', () => {
  const b = new BitArray(64);

  b.setRange(42, 45);
  b.unset(43);
  expect(b.toValueArray()).toEqual([42, 44]);
});

it('setRange', () => {
  const b = new BitArray(64);

  b.setRange(40, 50);
  expect(b.toValueArray()).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);

  b.setRange(100, 110);
  expect(b.toValueArray()).toEqual([47, 48, 49, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
});

it('setRangeSingle', () => {
  const b = new BitArray(1221);
  b.setRange(3671, 3672);
  expect(b.get(3671)).toEqual(true);
});

it ('get', () => {
  const b = new BitArray(64);

  b.set(1);
  expect(b.get(1)).toEqual(true);
  expect(b.get(-1)).toEqual(false);
  expect(b.get(100000)).toEqual(false);

  b.set(100000);
  expect(b.get(1)).toEqual(false);
  expect(b.get(-1)).toEqual(false);
  expect(b.get(99999)).toEqual(false);
  expect(b.get(100000)).toEqual(true);
});

it ('min', () => {
  const b = new BitArray(64);

  b.set(1);
  // expect(b.min()).toEqual(1);

  b.set(100);
  // expect(b.min()).toEqual(100);

  b.set(64);
  expect(b.min()).toEqual(64);

  b.set(63);
  // expect(b.min()).toEqual(63);
});

it ('max', () => {
  const b = new BitArray(64);

  b.set(1);
  expect(b.max()).toEqual(1);

  b.set(100000);
  expect(b.max()).toEqual(100000);
});

it ('getIndexValue', () => {
  const b = new BitArray(64);

  expect(b.getIndexValue(0, 0)).toEqual(0);
  expect(b.getIndexValue(8, 0)).toEqual(64);
  expect(b.getIndexValue(8, 1)).toEqual(65);

  b.set(100);

  expect(b.getIndexValue(0, 0)).toEqual(64);
  expect(b.getIndexValue(8, 0)).toEqual(128);
  expect(b.getIndexValue(8, 1)).toEqual(129);
});
