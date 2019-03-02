export default function formatByte(byte) {
  let str = '';
  for (let i = 0; i < 8; i ++) {
    str += (byte & (1 << (7 - i))) ? '1' : '0';
  }
  return str;
}
