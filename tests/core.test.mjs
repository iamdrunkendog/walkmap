import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyCourse,History,distance,timings,duplicate,validateCourse,validateMarker,courseSignature,segmentAngle,routeArrows,MARKER_CATEGORIES} from '../public/model.mjs';
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
 assert.notEqual(courseSignature(c),courseSignature({...c,markers:[{id:crypto.randomUUID(),name:'카페',category:'cafe',address:'',lat:37,lng:127}]}));
});

test('course reference markers: validation, backward compatibility migration, allowlist & duplicate independence',()=>{
 const mId=crypto.randomUUID();
 const m={id:mId,name:'느티나무 카페',category:'cafe',address:'서울 종로구 삼청로 10',lat:37.58,lng:126.98,naverLink:'https://place.naver.com/12345'};
 const c={...emptyCourse(),markers:[m]};
 const validated=validateCourse(c);
 assert.deepEqual(validated.markers,[m]);
 assert.deepEqual(validateMarker(m),m);
 assert.throws(()=>validateMarker(null));
 assert.throws(()=>validateMarker({...m,name:''}));
 assert.throws(()=>validateMarker({...m,category:'unknown'}));
 assert.throws(()=>validateMarker({...m,lat:95}));
 assert.throws(()=>validateMarker({...m,lng:-185}));
 assert.throws(()=>validateMarker({...m,naverLink:'http://insecure.test'}));

 // Migration: old course without markers defaults to empty array
 const oldCourse={id:crypto.randomUUID(),version:0,name:'옛날 코스',region:'',tags:[],speed:4,points:[],visits:[]};
 delete oldCourse.markers;
 const migrated=validateCourse(oldCourse);
 assert.deepEqual(migrated.markers,[]);

 // Allowlist: raw API / unexpected fields stripped
 const withRaw={...m,rawResponse:{foo:'bar'},description:'불필요',extraField:999};
 const cleaned=validateCourse({...emptyCourse(),markers:[withRaw]});
 assert.deepEqual(cleaned.markers,[m]);
 assert.equal(cleaned.markers[0].rawResponse,undefined);
 assert.equal(cleaned.markers[0].description,undefined);

 // Duplicate independence
 const dup=duplicate(validated);
 assert.equal(dup.markers.length,1);
 assert.notEqual(dup.markers[0].id,mId);
 assert.equal(dup.markers[0].name,m.name);
 dup.markers[0].name='수정된 마커';
 assert.equal(validated.markers[0].name,'느티나무 카페');

 // Validation limits & rejections
 assert.throws(()=>validateCourse({...c,markers:[null]}));
 assert.throws(()=>validateCourse({...c,markers:[['nested']]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,name:''}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,name:'   '}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,lat:91}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,lng:181}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,lat:NaN}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,category:'hospital'}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,category:123}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,address:'a'.repeat(201)}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,address:123}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,naverLink:123}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,naverLink:'javascript:alert(1)'}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,naverLink:'http://insecure.test'}]}));
 assert.throws(()=>validateCourse({...c,markers:[{...m,naverLink:'https://user:pass@evil.com'}]}));
 assert.throws(()=>validateCourse({...c,markers:[m,{...m}]})); // duplicate marker ID
 assert.throws(()=>validateCourse({...c,markers:Array.from({length:101},()=>({...m,id:crypto.randomUUID()}))})); // > 100
 for(const cat of ['cafe','food','photo','seminar','academy','gallery','book','spot']){
  assert.equal(validateCourse({...c,markers:[{...m,category:cat}]}).markers[0].category,cat);
  assert.equal(validateMarker({...m,category:cat}).category,cat);
 }
 assert.deepEqual(MARKER_CATEGORIES,['cafe','food','photo','seminar','academy','gallery','book','spot']);

 // Marker color validation
 assert.equal(validateMarker({...m,color:'#E32219'}).color,'#E32219');
 assert.equal(validateMarker({...m,color:'#1976D2'}).color,'#1976D2');
 assert.equal(validateMarker({...m,color:'#fff'}).color,'#fff');
 assert.throws(()=>validateMarker({...m,color:'blue'}));
 assert.throws(()=>validateMarker({...m,color:'invalid-hex'}));
 assert.throws(()=>validateMarker({...m,color:'#1234567890'}));
});

test('normalizePlace extracts safe https link and sanitized category',()=>{
 const p=normalizePlace({
  title:'<b>북촌</b> 카페',
  roadAddress:'서울 종로구 북촌로',
  category:'음식점><b>카페</b>,디저트',
  link:'https://place.naver.com/restaurant/12345',
  mapx:'1269820000',
  mapy:'375810000'
 });
 assert.deepEqual(p,{
  title:'북촌 카페',
  address:'서울 종로구 북촌로',
  category:'음식점>카페,디저트',
  link:'https://place.naver.com/restaurant/12345',
  lat:37.581,
  lng:126.982,
  source:'naver-search'
 });

 const badLink=normalizePlace({
  title:'장소',
  mapx:'1269820000',
  mapy:'375810000',
  link:'javascript:alert(1)'
 });
 assert.equal(badLink.link,undefined);
});

test('detachable pin label offsets: validation, bounds enforcement, round-trip and backward compatibility', () => {
  const mId = crypto.randomUUID(), vId = crypto.randomUUID();
  const validMarker = {
    id: mId,
    name: '갤러리 카페',
    category: 'cafe',
    address: '서울 종로구 삼청로 10',
    lat: 37.58,
    lng: 126.98,
    labelOffsetX: 45,
    labelOffsetY: -60
  };
  assert.deepEqual(validateMarker(validMarker), validMarker);

  // Round-trip with labelOffset object
  const markerWithObj = {
    id: mId,
    name: '갤러리 카페',
    category: 'cafe',
    address: '서울 종로구 삼청로 10',
    lat: 37.58,
    lng: 126.98,
    labelOffset: { x: 30, y: -40 }
  };
  assert.deepEqual(validateMarker(markerWithObj), markerWithObj);

  // Bounds enforcement (-500 to 500)
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetX: 501 }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetX: -501 }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetY: 501 }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetY: -501 }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetX: NaN }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetX: Infinity }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffsetX: '40' }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffset: { x: 600, y: 0 } }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffset: null }));
  assert.throws(() => validateMarker({ ...validMarker, labelOffset: 'invalid' }));

  // Rounding finite float values to integer offsets
  const roundedMarker = validateMarker({ ...validMarker, labelOffsetX: 42.7, labelOffsetY: -19.2 });
  assert.equal(roundedMarker.labelOffsetX, 43);
  assert.equal(roundedMarker.labelOffsetY, -19);

  // Visits in validateCourse
  const c = emptyCourse();
  c.visits = [{
    id: vId,
    lat: 37.58,
    lng: 126.98,
    name: '포토스팟',
    stay: 20,
    memo: '',
    link: '',
    source: 'user',
    labelOffsetX: -120,
    labelOffsetY: 85
  }];
  c.markers = [validMarker];

  const valCourse = validateCourse(c);
  assert.equal(valCourse.visits[0].labelOffsetX, -120);
  assert.equal(valCourse.visits[0].labelOffsetY, 85);
  assert.equal(valCourse.markers[0].labelOffsetX, 45);
  assert.equal(valCourse.markers[0].labelOffsetY, -60);

  // Visit bounds & type rejection
  assert.throws(() => validateCourse({
    ...c,
    visits: [{ ...c.visits[0], labelOffsetX: 501 }]
  }));
  assert.throws(() => validateCourse({
    ...c,
    visits: [{ ...c.visits[0], labelOffsetY: -501 }]
  }));
  assert.throws(() => validateCourse({
    ...c,
    visits: [{ ...c.visits[0], labelOffsetX: 'bad' }]
  }));

  // Backward compatibility: old visits and markers without offsets validate cleanly
  const legacyVisit = { id: crypto.randomUUID(), lat: 37.5, lng: 127.0, name: '과거 장소', stay: 10, memo: '', link: '', source: 'user' };
  const legacyMarker = { id: crypto.randomUUID(), lat: 37.5, lng: 127.0, name: '과거 마커', category: 'spot' };
  const legacyCourse = { ...emptyCourse(), visits: [legacyVisit], markers: [legacyMarker] };
  const validatedLegacy = validateCourse(legacyCourse);
  assert.equal(validatedLegacy.visits[0].labelOffsetX, undefined);
  assert.equal(validatedLegacy.visits[0].labelOffsetY, undefined);
  assert.equal(validatedLegacy.markers[0].labelOffsetX, undefined);
  assert.equal(validatedLegacy.markers[0].labelOffsetY, undefined);

  // Duplicate course preserves label offsets
  const dup = duplicate(valCourse);
  assert.equal(dup.visits[0].labelOffsetX, -120);
  assert.equal(dup.visits[0].labelOffsetY, 85);
  assert.equal(dup.markers[0].labelOffsetX, 45);
  assert.equal(dup.markers[0].labelOffsetY, -60);

  // Course summary label offsets & label scale
  const courseWithSummary = validateCourse({
    ...valCourse,
    labelScale: 1.2,
    summaryLabelOffsetX: 50,
    summaryLabelOffsetY: -80
  });
  assert.equal(courseWithSummary.labelScale, 1.2);
  assert.equal(courseWithSummary.summaryLabelOffsetX, 50);
  assert.equal(courseWithSummary.summaryLabelOffsetY, -80);
  assert.throws(() => validateCourse({ ...valCourse, labelScale: 0.1 }));
  assert.throws(() => validateCourse({ ...valCourse, summaryLabelOffsetX: 1200 }));
  assert.throws(() => validateCourse({ ...valCourse, summaryLabelOffsetY: -1200 }));

  // Signature captures label offset changes
  const sigOriginal = courseSignature(valCourse);
  const modifiedCourse = structuredClone(valCourse);
  modifiedCourse.visits[0].labelOffsetX = -100;
  assert.notEqual(sigOriginal, courseSignature(modifiedCourse));
});

test('route direction calculation, angles, forward positioning and short-segment skipping', () => {
  // Segment going East: lat same, lng increases => 0 degrees
  const pEast1 = { lat: 37.5, lng: 127.0 }, pEast2 = { lat: 37.5, lng: 127.01 };
  assert.ok(Math.abs(segmentAngle(pEast1, pEast2) - 0) < 0.1);

  // Segment going South: lat decreases, lng same => 90 degrees
  const pSouth1 = { lat: 37.51, lng: 127.0 }, pSouth2 = { lat: 37.5, lng: 127.0 };
  assert.ok(Math.abs(segmentAngle(pSouth1, pSouth2) - 90) < 0.1);

  // Segment going North: lat increases, lng same => -90 degrees
  const pNorth1 = { lat: 37.5, lng: 127.0 }, pNorth2 = { lat: 37.51, lng: 127.0 };
  assert.ok(Math.abs(segmentAngle(pNorth1, pNorth2) - (-90)) < 0.1);

  // Segment going West: lat same, lng decreases => 180 (or -180) degrees
  const pWest1 = { lat: 37.5, lng: 127.01 }, pWest2 = { lat: 37.5, lng: 127.0 };
  assert.ok(Math.abs(Math.abs(segmentAngle(pWest1, pWest2)) - 180) < 0.1);

  // routeArrows helper: checks distance < 8m skip, 58% forward position, active segment selection
  const p1 = { lat: 37.570, lng: 126.970 };
  const p2 = { lat: 37.575, lng: 126.975 }; // ~650m
  const pVeryClose = { lat: 37.5750001, lng: 126.9750001 }; // < 1 meter

  const arrows = routeArrows([p1, p2, pVeryClose], 1);
  assert.equal(arrows.length, 1, 'Short segment < 8m must be skipped');
  const arrow = arrows[0];
  assert.equal(arrow.index, 1);
  // Position must be at 58% from p1 to p2
  const expectedLat = p1.lat + (p2.lat - p1.lat) * 0.58;
  const expectedLng = p1.lng + (p2.lng - p1.lng) * 0.58;
  assert.ok(Math.abs(arrow.position.lat - expectedLat) < 0.00001);
  assert.ok(Math.abs(arrow.position.lng - expectedLng) < 0.00001);
  // Selected is 1, which touches segment (p1=0, p2=1), so active must be true
  assert.equal(arrow.active, true);

  // When selected is unrelated (-1), active is false
  const inactiveArrows = routeArrows([p1, p2], -1);
  assert.equal(inactiveArrows[0].active, false);
});
