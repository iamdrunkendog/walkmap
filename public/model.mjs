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
export const MARKER_CATEGORIES = ['cafe', 'food', 'photo', 'seminar', 'academy', 'gallery', 'book', 'spot'];
const ALLOWED_CATEGORIES = new Set(MARKER_CATEGORIES);

export function calculateBearing(p1, p2) {
  const rad = v => v * Math.PI / 180;
  const lat1 = rad(p1.lat), lat2 = rad(p2.lat);
  const dlng = rad(p2.lng - p1.lng);
  const y = Math.sin(dlng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function segmentAngle(p1, p2) {
  return Math.atan2(-(p2.lat - p1.lat), (p2.lng - p1.lng) * Math.cos(p1.lat * Math.PI / 180)) * 180 / Math.PI;
}

export function routeArrows(points, selected = -1) {
  const arrows = [];
  for (let i = 1; i < (points || []).length; i++) {
    const p1 = points[i - 1], p2 = points[i];
    if (distance([p1, p2]) < 8) continue;
    const angle = segmentAngle(p1, p2);
    const position = {
      lat: p1.lat + (p2.lat - p1.lat) * 0.58,
      lng: p1.lng + (p2.lng - p1.lng) * 0.58
    };
    const active = selected === i - 1 || selected === i;
    arrows.push({ index: i, angle, position, active });
  }
  return arrows;
}

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
  let color = undefined;
  if (m.color !== undefined && m.color !== '') {
    color = str(m.color, 30);
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) fail();
  }
  const res = {id:str(m.id,36,true),...pos(m),name:str(m.name||m.title,100,true),category:cat,address};
  if(link) res.naverLink = link;
  if(color) res.color = color;

  if (m.labelOffsetX !== undefined) res.labelOffsetX = Math.round(number(m.labelOffsetX, -500, 500));
  if (m.labelOffsetY !== undefined) res.labelOffsetY = Math.round(number(m.labelOffsetY, -500, 500));
  if (m.labelOffset !== undefined) {
    if (!m.labelOffset || typeof m.labelOffset !== 'object' || Array.isArray(m.labelOffset)) fail();
    res.labelOffset = {
      x: Math.round(number(m.labelOffset.x, -500, 500)),
      y: Math.round(number(m.labelOffset.y, -500, 500))
    };
  }
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
    const resV = {id:str(v.id,36,true),...pos(v),name:str(v.name,100,true),stay:number(v.stay,0,1440),memo:str(v.memo,5000),link,source:'user'};
    if (v.labelOffsetX !== undefined) resV.labelOffsetX = Math.round(number(v.labelOffsetX, -500, 500));
    if (v.labelOffsetY !== undefined) resV.labelOffsetY = Math.round(number(v.labelOffsetY, -500, 500));
    if (v.labelOffset !== undefined) {
      if (!v.labelOffset || typeof v.labelOffset !== 'object' || Array.isArray(v.labelOffset)) fail();
      resV.labelOffset = {
        x: Math.round(number(v.labelOffset.x, -500, 500)),
        y: Math.round(number(v.labelOffset.y, -500, 500))
      };
    }
    return resV;
  });
  if(new Set(visits.map(v=>v.id)).size!==visits.length) fail();
  const markers=rawMarkers.map(validateMarker);
  if(new Set(markers.map(m=>m.id)).size!==markers.length) fail();

  let labelScale = undefined;
  if (c.labelScale !== undefined) {
    labelScale = number(c.labelScale, 0.5, 3.0);
  }
  let summaryLabelOffsetX = undefined, summaryLabelOffsetY = undefined;
  if (c.summaryLabelOffsetX !== undefined) summaryLabelOffsetX = Math.round(number(c.summaryLabelOffsetX, -1000, 1000));
  if (c.summaryLabelOffsetY !== undefined) summaryLabelOffsetY = Math.round(number(c.summaryLabelOffsetY, -1000, 1000));
  let showSummary = undefined;
  if (c.showSummary !== undefined) {
    if (typeof c.showSummary !== 'boolean') fail();
    showSummary = c.showSummary;
  }

  const resCourse = {id:c.id,version:c.version,name:str(c.name,100,true),region:str(c.region,100),tags:c.tags.map(v=>str(v,40,true)),speed:number(c.speed,0.5,10),points:c.points.map(pos),visits,markers};
  if (labelScale !== undefined) resCourse.labelScale = labelScale;
  if (summaryLabelOffsetX !== undefined) resCourse.summaryLabelOffsetX = summaryLabelOffsetX;
  if (summaryLabelOffsetY !== undefined) resCourse.summaryLabelOffsetY = summaryLabelOffsetY;
  if (showSummary !== undefined) resCourse.showSummary = showSummary;
  return resCourse;
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
