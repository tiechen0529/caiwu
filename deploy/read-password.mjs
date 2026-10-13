import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const path=process.env.ADMIN_PASSWORD_FILE||resolve(process.env.DATA_DIR||'data','admin-password');
const password=process.env.ADMIN_PASSWORD_FILE?readFileSync(path,'utf8').trim():process.env.ADMIN_PASSWORD|| (existsSync(path)?readFileSync(path,'utf8').trim():'');
if(!password)throw Error('尚未生成密码，请先启动容器');
console.log(`Username: ${process.env.ADMIN_USER||'admin'}\nPassword: ${password}`);
