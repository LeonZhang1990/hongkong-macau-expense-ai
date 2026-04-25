// 一次性修复 history.json 中已存在的乱码文件名
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, 'history.json');

if (!fs.existsSync(p)) {
  console.log('no history.json');
  process.exit(0);
}

// 判断字符串是否为「latin1 解码的 UTF-8」
function isMojibake(s) {
  // 所有字符码位都 < 256，且包含高位字节
  let hasHigh = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 256) return false;
    if (c >= 0x80) hasHigh = true;
  }
  return hasHigh;
}

const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
let fixed = 0;
for (const h of arr) {
  if (h.filename && isMojibake(h.filename)) {
    try {
      const re = Buffer.from(h.filename, 'latin1').toString('utf8');
      if (!re.includes('\uFFFD')) {
        console.log('  ', JSON.stringify(h.filename), '→', JSON.stringify(re));
        h.filename = re;
        fixed++;
      }
    } catch (e) {
      console.warn('skip:', h.filename, e.message);
    }
  }
}
fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf8');
console.log(`fixed ${fixed} entries of total ${arr.length}`);

