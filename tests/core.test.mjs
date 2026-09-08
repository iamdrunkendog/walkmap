import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyCourse,History,distance,timings,duplicate,validateCourse,courseSignature} from '../public/model.mjs';
import {createApp,openDatabase,addUser,normalizePlace,searchPlaces} from '../server.mjs';

test('route edit / insert / move / delete / undo / redo restores exact points and distances',()=>{
 const c=emptyCourse(),h=new History(c);c.points=[{lat:37.57,lng:126.97},{lat:37.58,lng:126.98}];h.set(c);
 const original=structuredClone(c),length=distance(c.points);assert.ok(length>1400&&length<1500);
 c.points.splice(1,0,{lat:37.57,lng:126.98});h.set(c);assert.ok(distance(c.points)>length);
 c.points[1].lat=37.575;h.set(c);const moved=structuredClone(c);c.points.splice(1,1);h.set(c);
 assert.deepEqual(h.undo(),moved);assert.deepEqual(h.redo(),c);h.undo();h.undo();assert.deepEqual(h.undo(),original);
 assert.equal(distance(h.current.points),length);
});
test('visit time, copy independence and storage allowlist reject unsafe data',()=>{
 const c=emptyCourse();c.points=[{lat:37,lng:127},{lat:37.01,lng:127}];c.visits=[{id:crypto.randomUUID(),lat:37,lng:127,name:'직접 입력',stay:30,memo:'촬영 메모',link:'https://naver.me/example',source:'user'}];
 assert.equal(timings(c).stay,30);assert.equal(timings(c).total,timings(c).walk+30);
 const copy=duplicate(c);copy.visits[0].memo='별도 메모';copy.points[0].lat=36;assert.equal(c.visits[0].memo,'촬영 메모');assert.equal(c.points[0].lat,37);assert.notEqual(copy.id,c.id);
 assert.deepEqual(validateCourse({...c,apiResults:[{title:'external'}]}),c);
 for(const bad of [{...c,speed:0},{...c,points:[{lat:NaN,lng:127}]},{...c,visits:[{...c.visits[0],source:'naver-search'}]},{...c,visits:[{...c.visits[0],link:'javascript:alert(1)'}]}])assert.throws(()=>validateCourse(bad));
});
test('API HUB coordinates and distinct auth / quota / empty / network states',async()=>{
 assert.deepEqual(normalizePlace({title:'<b>장소</b>',mapx:'1269780000',mapy:'375700000'}),{title:'장소',address:'',lat:37.57,lng:126.978,source:'naver-search'});
 assert.equal(normalizePlace({mapx:'bad',mapy:'0'}),null);
 process.env.NAVER_SEARCH_CLIENT_ID='fixture-id';process.env.NAVER_SEARCH_CLIENT_SECRET='fixture-secret';
 for(const [status,code]of [[401,'SEARCH_AUTH'],[403,'SEARCH_AUTH'],[429,'SEARCH_QUOTA'],[500,'SEARCH_UPSTREAM']])await assert.rejects(()=>searchPlaces('test',async()=>new Response('{}',{status})),e=>e.code===code);
 await assert.rejects(()=>searchPlaces('test',async()=>{throw Error();}),e=>e.code==='SEARCH_NETWORK');
 assert.deepEqual(await searchPlaces('test',async(url,options)=>{assert.equal(new URL(url).pathname,'/search/v1/local');assert.ok(options.headers['X-NCP-APIGW-API-KEY']);assert.equal(new URL(url).searchParams.get('display'),'5');return Response.json({items:[]});}),[]);
});
test('server persistence, sessions, ownership, conflict protection and duplicate survival',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'walkmap-test-'));let db=openDatabase(dir),server=createApp({db,origin:'http://localhost:3399'});
 await addUser(db,'alice','alice-password-123');await addUser(db,'bob','bob-password-123');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let url=`http://127.0.0.1:${server.address().port}`;
 const req=(path,method='GET',body,cookie,extra={})=>fetch(url+path,{method,headers:{Origin:'http://localhost:3399','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await req('/api/courses')).status,401);
  assert.equal((await req('/api/login','POST',{name:'alice',password:'wrong'})).status,401);
  assert.equal((await req('/api/login','POST',{name:'alice',password:'alice-password-123'},null,{Origin:'https://evil.test'})).status,403);
  const login=await req('/api/login','POST',{name:'alice',password:'alice-password-123'}),cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const bLogin=await req('/api/login','POST',{name:'bob',password:'bob-password-123'}),bCookie=bLogin.headers.get('set-cookie').split(';')[0];
  const c=emptyCourse();c.name='서울 산책';c.region='종로';c.tags=['사진'];c.points=[{lat:37.57,lng:126.98},{lat:37.58,lng:126.98}];c.visits=[{id:crypto.randomUUID(),lat:37.574,lng:126.98,name:'촬영',stay:20,memo:'그늘에서 모이기',link:'https://naver.me/example',source:'user'}];
  const saved=await (await req('/api/courses/'+c.id,'PUT',c,cookie)).json();assert.equal(saved.version,1);
  assert.equal((await req('/api/courses/'+c.id,'GET',null,bCookie)).status,404);
  assert.equal((await req('/api/courses/'+c.id,'PUT',saved,bCookie)).status,404);
  assert.equal((await req('/api/courses/'+c.id,'DELETE',null,bCookie,{'If-Match':'1'})).status,404);
  assert.equal((await req('/api/courses','GET',null,bCookie)).status,200);assert.deepEqual(await(await req('/api/courses','GET',null,bCookie)).json(),[]);
  assert.equal((await req('/api/courses/'+c.id,'PUT',c,cookie)).status,409);
  const copy=duplicate(saved);copy.visits[0].memo='독립 메모';assert.equal((await req('/api/courses/'+copy.id,'PUT',copy,cookie)).status,200);
  assert.deepEqual(await(await req('/api/courses/'+c.id,'GET',null,cookie)).json(),saved);
  assert.equal((await req('/api/courses/'+c.id,'PUT',{...saved,speed:-1},cookie)).status,400);
  assert.equal((await req('/.env','GET',null,cookie)).status,404);
  const config=await(await req('/api/config','GET',null,cookie)).json();assert.deepEqual(Object.keys(config),['mapsClientId']);
  await new Promise(r=>server.close(r));db.close();db=openDatabase(dir);server=createApp({db,origin:'http://localhost:3399'});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await(await req('/api/courses/'+c.id,'GET',null,cookie)).json(),saved);
  assert.equal((await req('/api/courses/'+c.id,'DELETE',null,cookie,{'If-Match':'0'})).status,409);
  assert.equal((await req('/api/courses/'+c.id,'DELETE',null,cookie,{'If-Match':'1'})).status,200);
  assert.equal((await req('/api/courses/'+copy.id,'GET',null,cookie)).status,200);
  await req('/api/logout','POST',{},cookie);assert.equal((await req('/api/courses','GET',null,cookie)).status,401);
 }finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('save signature ignores property order, server revision and metadata, but catches content changes',()=>{
 const c=emptyCourse();c.visits=[{name:'직접 작성',id:crypto.randomUUID(),source:'user',lat:37,lng:127,memo:'원문',link:'',stay:15}];
 assert.equal(courseSignature(c),courseSignature({...validateCourse(c),version:2,updated:'now'}));
 assert.notEqual(courseSignature(c),courseSignature({...c,visits:[{...c.visits[0],memo:'수정'}]}));
});
