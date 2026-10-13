import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const data=resolve(process.env.DATA_DIR||'data');mkdirSync(resolve(data,'backups'),{recursive:true});
const file=resolve(data,'backups',`ledger-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(resolve(data,'ledger.sqlite'),{readOnly:true});
try{await backup(db,file);console.log(file);}finally{db.close();}
