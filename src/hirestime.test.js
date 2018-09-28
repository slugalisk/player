import hirestime from './hirestime';

it ('since', () => {
  expect(hirestime.since([0, 0], [0, 0])).toEqual([0, 0]);
  expect(hirestime.since([0, 1], [0, 1])).toEqual([0, 0]);
  expect(hirestime.since([1, 0], [1, 0])).toEqual([0, 0]);
  expect(hirestime.since([1, 1], [1, 1])).toEqual([0, 0]);
});

it ('since borrowing', () => {
  expect(hirestime.since([0, 1], [1, 0])).toEqual([0, 999999999]);
  expect(hirestime.since([1, 0], [0, 1])).toEqual([0, -999999999]);
});
