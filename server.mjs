import http from 'node:http';
import {readFileSync, mkdirSync, chmodSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {validateCourse} from './public/model.mjs';
process.umask(0o077);
const scrypt=promisify(scryptCallback);
const root=dirname(fileURLToPath(import.meta.url));
export const hashToken=t=>createHash('sha256').update(t).digest('hex');
export async function passwordHash(password,salt=randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;
}
export function openDatabase(directory=process.env.DATA_DIR||resolve(root,'data')) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file=resolve(directory,'walkmap.sqlite'); const db=new DatabaseSync(file); chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS course_owner ON courses(owner);`);
  return db;
}
export async function addUser(db,name,password) {
  if(!/^[a-zA-Z0-9_-]{3,40}$/.test(name)||password.length<12||password.length>200) throw new Error('아이디 3–40자(영문·숫자·_·-), 비밀번호 12–200자가 필요합니다.');
  const id=randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,name,await passwordHash(password)); return id;
}
const error=(status,code,message)=>Object.assign(new Error(message),{status,code});
export function normalizePlace(item) {
  const coord=(v,limit)=>{let n=Number(v); if(Math.abs(n)>limit)n/=1e7;return n;};
  const lat=coord(item.mapy,90),lng=coord(item.mapx,180);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||(!lat&&!lng))return null;
  return {title:String(item.title||'').replace(/<[^>]*>/g,''), address:String(item.roadAddress||item.address||''),lat,lng,source:'naver-search'};
}
export async function searchPlaces(query,fetcher=fetch) {
  if(!process.env.NAVER_SEARCH_CLIENT_ID||!process.env.NAVER_SEARCH_CLIENT_SECRET)throw error(503,'SEARCH_CONFIG','장소 검색 인증 설정이 필요합니다.');
  let response;
  try {response=await fetcher('https://naverapihub.apigw.ntruss.com/search/v1/local?'+new URLSearchParams({query,display:'5',start:'1',sort:'random',format:'json'}),{
    headers:{'X-NCP-APIGW-API-KEY-ID':process.env.NAVER_SEARCH_CLIENT_ID,'X-NCP-APIGW-API-KEY':process.env.NAVER_SEARCH_CLIENT_SECRET},signal:AbortSignal.timeout(10000)});
  } catch {throw error(502,'SEARCH_NETWORK','검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');}
  if([401,403].includes(response.status))throw error(502,'SEARCH_AUTH','검색 인증 실패: API HUB의 지역 API 선택과 인증 정보를 확인해 주세요.');
  if(response.status===429)throw error(429,'SEARCH_QUOTA','검색 호출 한도를 초과했습니다. 나중에 다시 시도해 주세요.');
  if(!response.ok)throw error(502,'SEARCH_UPSTREAM','검색 서비스 오류가 발생했습니다.');
  let body;try {body=await response.json();}catch{throw error(502,'SEARCH_RESPONSE','검색 응답을 읽을 수 없습니다.');}
  if(!Array.isArray(body.items))throw error(502,'SEARCH_RESPONSE','검색 응답 형식이 올바르지 않습니다.');
  return body.items.map(normalizePlace).filter(Boolean);
}
export function createApp({db=openDatabase(), origin=process.env.APP_ORIGIN||'http://localhost:3000',fetcher=fetch}={}) {
  const production=process.env.NODE_ENV==='production';
  if(production&&!origin.startsWith('https://'))throw new Error('운영 APP_ORIGIN은 HTTPS여야 합니다.');
  const limits=new Map(); // ponytail: single process limits; shared limiter needed only for multiple instances.
  const rate=(key,max,window=60000)=>{
    const now=Date.now(); for(const [k,v]of limits)if(v.until<now)limits.delete(k);
    const v=limits.get(key)||{count:0,until:now+window};v.count++;limits.set(key,v);
    if(v.count>max)throw error(429,'RATE_LIMIT','요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  };
  const staticFiles=new Map([['/','index.html'],['/app.mjs','app.mjs'],['/model.mjs','model.mjs'],['/style.css','style.css']]);
  const server=http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://oapi.map.naver.com https://*.map.naver.net https://*.pstatic.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.pstatic.net https://*.naver.com https://*.naver.net; connect-src 'self' https://*.naver.com https://*.pstatic.net https://*.naver.net https://kr-col-ext.nelo.navercorp.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,origin),path=url.pathname;
      if(!['GET','POST','PUT','DELETE'].includes(req.method))throw error(405,'METHOD','허용되지 않는 요청입니다.');
      if(req.method!=='GET'&&req.headers.origin!==origin)throw error(403,'ORIGIN','허용되지 않는 출처입니다.');
      if(req.method==='GET'&&staticFiles.has(path)){
        const file=staticFiles.get(path),content=readFileSync(resolve(root,'public',file));
        res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');res.end(content);return;
      }
      if(path==='/favicon.ico'&&req.method==='GET'){res.writeHead(204);res.end();return;}
      if(path==='/api/health'&&req.method==='GET'){send(200,{ok:true});return;}
      const body=async()=>{
        if(!req.headers['content-type']?.startsWith('application/json'))throw error(415,'CONTENT_TYPE','JSON 형식이 필요합니다.');
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>300000)throw error(413,'SIZE','코스 데이터가 너무 큽니다.');chunks.push(chunk);}
        try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error(400,'JSON','입력 데이터를 읽을 수 없습니다.');}
      };
      if(path==='/api/login'&&req.method==='POST'){
        rate(`login-ip:${req.socket.remoteAddress}`,30,900000);
        const b=await body();if(typeof b.name!=='string'||typeof b.password!=='string'||b.name.length>40||b.password.length>200)throw error(400,'LOGIN_INPUT','로그인 입력값을 확인해 주세요.');
        rate(`login-user:${b.name}`,10,900000);
        const user=db.prepare('SELECT * FROM users WHERE name=?').get(b.name);
        const stored=user?.password||'00000000000000000000000000000000:'+ '0'.repeat(128);
        const actual=await passwordHash(b.password,stored.split(':')[0]);
        if(!timingSafeEqual(Buffer.from(actual),Buffer.from(stored))||!user)throw error(401,'LOGIN','아이디 또는 비밀번호가 올바르지 않습니다.');
        limits.delete(`login-user:${b.name}`);
        const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token),user.id,Date.now()+7*86400000);
        res.setHeader('Set-Cookie',`walkmap_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${production?'; Secure':''}`);
        send(200,{id:user.id,name:user.name});return;
      }
      const token=req.headers.cookie?.match(/(?:^|;\s*)walkmap_session=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
      const user=db.prepare('SELECT users.id,users.name FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(hashToken(token),Date.now());
      if(!user)throw error(401,'SESSION','로그인이 필요합니다. 작성 중인 내용은 유지됩니다.');
      if(path==='/api/me'&&req.method==='GET'){send(200,user);return;}
      if(path==='/api/config'&&req.method==='GET'){send(200,{mapsClientId:process.env.NAVER_MAPS_CLIENT_ID||''});return;}
      if(path==='/api/logout'&&req.method==='POST'){
        db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));res.setHeader('Set-Cookie',`walkmap_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);send(200,{ok:true});return;
      }
      if(path==='/api/search'&&req.method==='GET'){
        rate(`search:${user.id}`,30);const query=(url.searchParams.get('q')||'').trim();if(!query||query.length>100)throw error(400,'QUERY','검색어는 1–100자로 입력해 주세요.');
        send(200,{items:await searchPlaces(query,fetcher)});return;
      }
      if(path==='/api/courses'&&req.method==='GET'){
        send(200,db.prepare('SELECT data,updated FROM courses WHERE owner=? ORDER BY updated DESC').all(user.id).map(row=>({...JSON.parse(row.data),updated:row.updated})));return;
      }
      const match=path.match(/^\/api\/courses\/([a-f0-9-]{36})$/);
      if(match){
        const id=match[1];const row=db.prepare('SELECT * FROM courses WHERE id=? AND owner=?').get(id,user.id);
        if(req.method==='GET'){if(!row)throw error(404,'NOT_FOUND','코스를 찾을 수 없습니다.');send(200,JSON.parse(row.data));return;}
        if(req.method==='DELETE'){
          if(!row)throw error(404,'NOT_FOUND','코스를 찾을 수 없습니다.');
          const version=Number(req.headers['if-match']);const result=db.prepare('DELETE FROM courses WHERE id=? AND owner=? AND version=?').run(id,user.id,version);
          if(!result.changes)throw error(409,'CONFLICT','다른 창에서 수정된 코스입니다. 다시 불러온 뒤 삭제해 주세요.');send(200,{ok:true});return;
        }
        if(req.method==='PUT'){
          const raw=await body();let c;try{c=validateCourse(raw);}catch(e){throw error(400,'VALIDATION',e.message);}
          if(c.id!==id)throw error(400,'ID','코스 ID가 올바르지 않습니다.');
          const next={...c,version:c.version+1},updated=new Date().toISOString();
          if(c.version===0){
            const r=db.prepare('INSERT OR IGNORE INTO courses VALUES(?,?,?,?,?)').run(id,user.id,1,JSON.stringify(next),updated);
            if(!r.changes)throw error(409,'CONFLICT','이미 저장된 코스입니다. 현재 편집 내용을 복제해 저장할 수 있습니다.');
          }else{
            if(!row)throw error(404,'NOT_FOUND','코스가 삭제되었거나 접근할 수 없습니다. 편집 내용을 복제해 저장할 수 있습니다.');
            const r=db.prepare('UPDATE courses SET version=?,data=?,updated=? WHERE id=? AND owner=? AND version=?').run(next.version,JSON.stringify(next),updated,id,user.id,c.version);
            if(!r.changes)throw error(409,'CONFLICT','다른 창에서 수정되었습니다. 현재 내용은 유지됩니다. 복제하여 별도로 저장해 주세요.');
          }
          send(200,next);return;
        }
      }
      throw error(404,'NOT_FOUND','요청한 항목을 찾을 수 없습니다.');
    }catch(e){if(!res.headersSent)send(e.status||500,{code:e.code||'SERVER',message:e.status?e.message:'저장 또는 서버 처리에 실패했습니다. 변경사항을 유지하고 다시 시도해 주세요.'});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||3000);createApp().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`WalkMap ready on port ${port}`));
}
