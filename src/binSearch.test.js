import binSearch from './binSearch';

it ('search', () => {
  const values = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];

  expect(binSearch(values.length, i => values[i] - 2)).toEqual(2);
  expect(binSearch(values.length, i => values[i] - 13)).toEqual(6);
  expect(binSearch(values.length, i => values[i] - 55)).toEqual(9);
});
