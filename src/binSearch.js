export default function binSearch(max, comparator) {
  let left = 0;
  let right = max;

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    const order = comparator(mid, left, right);

    if (order < 0) {
      left = mid + 1;
    } else if (order > 0) {
      right = mid - 1;
    } else {
      return mid;
    }
  }
  return -(left + 1);
}
