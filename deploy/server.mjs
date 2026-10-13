import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync,writeFileSync,statSync,realpathSync,createReadStream} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {blankLedger,validateLedger} from '../lib/ledger.ts';

const MAX_BODY=4_000_000,OWNER='self-hosted';
export function readPassword(dataDir,settings=process.env){
  if(settings.ADMIN_PASSWORD_FILE)return readFileSync(settings.ADMIN_PASSWORD_FILE,'utf8').trim();
  if(settings.ADMIN_PASSWORD)return settings.ADMIN_PASSWORD;
  const path=resolve(dataDir,'admin-password');
  if(!existsSync(path))writeFileSync(path,randomBytes(24).toString('base64url')+'\n',{mode:0o600,flag:'wx'});
  return readFileSync(path,'utf8').trim();
}
const hash=(s)=>createHash('sha256').update(s).digest();
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
export function createApp(options={}){
  const dataDir=resolve(options.dataDir||process.env.DATA_DIR||'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
  const user=options.user||process.env.ADMIN_USER||'admin';
  const password=options.password||readPassword(dataDir);
  if(password.length<16)throw Error('ADMIN_PASSWORD至少16个字符，留空可自动生成');
  if(!/^[A-Za-z0-9_.-]{1,64}$/.test(user))throw Error('ADMIN_USER仅支持字母、数字、下划线、点或短横线');
  const expected=hash(user+':'+password);
  const webDir=resolve(options.webDir||process.env.WEB_DIR||'web');
  const originSetting=options.publicOrigin??process.env.PUBLIC_ORIGIN??'';
  const publicOrigin=originSetting?new URL(originSetting).origin:'';
  const db=new DatabaseSync(resolve(dataDir,'ledger.sqlite'),{timeout:5000});
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  const schema=db.prepare('PRAGMA user_version').get().user_version;
  if(schema>1){db.close();throw Error('数据库版本较新，请勿用旧镜像打开');}
  db.exec('CREATE TABLE IF NOT EXISTS ledgers (owner TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL); PRAGMA user_version=1;');
  const failures=new Map();
  const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){req.resume();throw Object.assign(Error('数据超过4MB上限'),{status:413});}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('JSON格式无效'),{status:400});}}
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try{
      const url=new URL(req.url||'/','http://localhost');
      if(url.pathname==='/healthz'&&['GET','HEAD'].includes(req.method)){db.prepare('SELECT 1').get();send(res,200,{status:'ok'});return;}
      const ip=req.socket.remoteAddress||'unknown',now=Date.now();
      for(const[k,v]of failures)if(now-v.first>300000)failures.delete(k);
      if((failures.get(ip)?.count||0)>=20){send(res,429,{error:'登录尝试过多，5分钟后重试'},{'Retry-After':'300'});return;}
      let provided='';const auth=req.headers.authorization||'';if(auth.startsWith('Basic '))provided=Buffer.from(auth.slice(6),'base64').toString('utf8');
      if(!timingSafeEqual(hash(provided),expected)){
        if(auth){const entry=failures.get(ip)||{first:now,count:0};entry.count++;if(failures.size<10000||failures.has(ip))failures.set(ip,entry);}
        send(res,401,{error:'请使用管理员账号登录'},{'WWW-Authenticate':'Basic realm="Qingzhang", charset="UTF-8"'});return;
      }
      failures.delete(ip);
      if(url.pathname==='/api/session'&&req.method==='GET'){send(res,200,{userName:user});return;}
      if(url.pathname==='/api/ledger'){
        if(req.method==='GET'){
          const row=db.prepare('SELECT data,revision FROM ledgers WHERE owner=?').get(OWNER);
          send(res,200,{data:row?JSON.parse(row.data):blankLedger(),revision:row?.revision||0});return;
        }
        if(req.method!=='POST'){send(res,405,{error:'不支持的请求方法'},{Allow:'GET, POST'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415,{error:'须使用JSON请求'});return;}
        if(req.headers.origin){let valid=false;try{const origin=new URL(req.headers.origin);valid=publicOrigin?origin.origin===publicOrigin:['http:','https:'].includes(origin.protocol)&&origin.host===req.headers.host;}catch{}if(!valid){send(res,403,{error:'请求来源无效'});return;}}
        if(Number(req.headers['content-length'])>MAX_BODY){req.resume();send(res,413,{error:'数据超过4MB上限'});return;}
        const input=await body(req);
        try{validateLedger(input.data);if(!Number.isSafeInteger(input.revision)||input.revision<0)throw Error('版本号无效');}catch(e){send(res,400,{error:e.message});return;}
        const now=new Date().toISOString();
        const result=input.revision===0?db.prepare('INSERT INTO ledgers(owner,data,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(owner) DO NOTHING').run(OWNER,JSON.stringify(input.data),now):db.prepare('UPDATE ledgers SET data=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').run(JSON.stringify(input.data),now,OWNER,input.revision);
        if(result.changes!==1){send(res,409,{error:'其他设备已更新账套，请刷新后重新编辑，避免覆盖。'});return;}
        send(res,200,{revision:input.revision+1,savedAt:now});return;
      }
      if(url.pathname.startsWith('/api/')){send(res,404,{error:'接口不存在'});return;}
      if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'不支持的请求方法'});return;}
      let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{send(res,400,{error:'路径无效'});return;}
      if(pathname.includes('\0')||pathname.includes('\\')){send(res,400,{error:'路径无效'});return;}
      const target=resolve(webDir,'.'+(pathname==='/'?'/index.html':pathname));
      if(!target.startsWith(webDir+sep)){send(res,404,{error:'文件不存在'});return;}
      if(!existsSync(target)||!statSync(target).isFile()){send(res,404,{error:'文件不存在'});return;}
      if(!realpathSync(target).startsWith(realpathSync(webDir)+sep)){send(res,404,{error:'文件不存在'});return;}
      res.writeHead(200,{'Content-Type':MIME[extname(target)]||'application/octet-stream','Cache-Control':extname(target)==='.html'?'no-store':'public, max-age=31536000, immutable'});
      if(req.method==='HEAD')res.end();else createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'服务暂时不可用'});else res.destroy();}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;
  return{server,db,dataDir};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp(),port=Number(process.env.PORT||3000);
  app.server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Qingzhang listening on ${port}; persistent database initialized. Use deploy/read-password.mjs to view credentials.`));
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;app.server.close(()=>{app.db.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
