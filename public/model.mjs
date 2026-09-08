export const clone = value => structuredClone(value);
export function emptyCourse() {
  return {id: crypto.randomUUID(), version: 0, name: '새로운 산책 코스', region: '', tags: [], speed: 4, points: [], visits: [], markers: []};
}
export function distance(points) {
  const rad = v => v * Math.PI / 180;
  return points.slice(1).reduce((sum, p, i) => {
    const a = points[i], dlat = rad(p.lat-a.lat), dlng = rad(p.lng-a.lng);
    const h = Math.sin(dlat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(p.lat))*Math.sin(dlng/2)**2;
    return sum + 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }, 0);
}
export function timings(course) {
  const meters = distance(course.points), walk = meters / (course.speed*1000) * 60;
  const stay = (course.visits || []).reduce((sum, v) => sum + v.stay, 0);
  return {meters, walk, stay, total: walk + stay};
}
export class History {
  constructor(value) { this.reset(value); }
  reset(value) { this.current = clone(value); this.past=[]; this.future=[]; }
  set(value) {
    if (JSON.stringify(value) === JSON.stringify(this.current)) return;
    this.past.push(clone(this.current)); if (this.past.length > 100) this.past.shift();
    this.current=clone(value); this.future=[];
  }
  undo() { if(this.past.length){this.future.push(this.current);this.current=this.past.pop();} return clone(this.current); }
  redo() { if(this.future.length){this.past.push(this.current);this.current=this.future.pop();} return clone(this.current); }
}
export function duplicate(course) {
  return {...clone(course), id: crypto.randomUUID(), version: 0, name: `${course.name} (복사)`,
    visits: (course.visits || []).map(v => ({...clone(v), id:crypto.randomUUID()})),
    markers: (course.markers || []).map(m => ({...clone(m), id:crypto.randomUUID()}))};
}
export const MARKER_CATEGORIES = ['cafe', 'food', 'photo', 'seminar', 'spot'];
const ALLOWED_CATEGORIES = new Set(MARKER_CATEGORIES);

export function validateMarker(m) {
  const fail = () => { throw new Error('코스 입력값을 확인해 주세요.'); };
  const str = (v, max, required=false) => {if(typeof v!=='string'||v.length>max||(required&&!v.trim())) fail(); return v;};
  const number = (v,min,max) => {if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max) fail(); return v;};
  const pos = p => ({lat:number(p.lat,-90,90),lng:number(p.lng,-180,180)});

  if(!m || typeof m !== 'object' || Array.isArray(m)) fail();
  const cat = m.category === undefined ? 'spot' : str(m.category, 40, true);
  if (!ALLOWED_CATEGORIES.has(cat)) fail();
  const address = m.address === undefined ? '' : str(m.address, 200);
  let link = '';
  if (m.naverLink !== undefined && m.naverLink !== '') {
    link = str(m.naverLink, 2000);
    try { const u = new URL(link); if (u.protocol !== 'https:' || u.username || u.password) fail(); } catch { fail(); }
  }
  const res = {id:str(m.id,36,true),...pos(m),name:str(m.name||m.title,100,true),category:cat,address};
  if(link) res.naverLink = link;
  return res;
}

export function validateCourse(c) {
  const fail = () => { throw new Error('코스 입력값을 확인해 주세요.'); };
  const str = (v, max, required=false) => {if(typeof v!=='string'||v.length>max||(required&&!v.trim())) fail(); return v;};
  const number = (v,min,max) => {if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max) fail(); return v;};
  const pos = p => ({lat:number(p.lat,-90,90),lng:number(p.lng,-180,180)});
  if(!c || !/^[0-9a-f-]{36}$/.test(c.id)||!Number.isSafeInteger(c.version)||c.version<0) fail();
  if(!Array.isArray(c.points)||c.points.length>2000||!Array.isArray(c.visits)||c.visits.length>100||!Array.isArray(c.tags)||c.tags.length>20) fail();
  const rawMarkers = c.markers === undefined ? [] : c.markers;
  if(!Array.isArray(rawMarkers)||rawMarkers.length>100) fail();
  const visits=c.visits.map(v=>{
    if(v.source!=='user') fail();
    const link=str(v.link,2000);
    if(link) {try {const u=new URL(link); if(u.protocol!=='https:'||u.username||u.password) fail();}catch{fail();}}
    return {id:str(v.id,36,true),...pos(v),name:str(v.name,100,true),stay:number(v.stay,0,1440),memo:str(v.memo,5000),link,source:'user'};
  });
  if(new Set(visits.map(v=>v.id)).size!==visits.length) fail();
  const markers=rawMarkers.map(validateMarker);
  if(new Set(markers.map(m=>m.id)).size!==markers.length) fail();
  return {id:c.id,version:c.version,name:str(c.name,100,true),region:str(c.region,100),tags:c.tags.map(v=>str(v,40,true)),speed:number(c.speed,0.5,10),points:c.points.map(pos),visits,markers};
}

export function courseSignature(course) {
  return JSON.stringify(course, (key,value) => {
    if(key==='version'||key==='updated')return undefined;
    if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]]));
    return value;
  });
}

export function usernameToEmail(username, domain = 'walkmap.internal') {
  const clean = String(username || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return clean;
  if (!/^[a-z0-9_-]{3,40}$/.test(clean)) {
    throw new Error('아이디는 3–40자의 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.');
  }
  return `${clean}@${domain}`;
}

export function emailToUsername(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '';
  return email.split('@')[0];
}
