export default function formatByte(byte) {
  return formatWord(byte, 8);
}

export function formatWord(word, size) {
  let str = '';
  for (let i = 0; i < size; i ++) {
    str += (word & (1 << (size - 1 - i))) ? '1' : '0';
  }
  return str;
}
