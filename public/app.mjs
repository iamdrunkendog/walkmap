import {emptyCourse,History,clone,timings,duplicate,validateCourse,courseSignature} from './model.mjs';
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null, course=emptyCourse(), history=new History(course), savedSignature='',baseVersion=0;
let map=null, overlays=[], mode='pan', drawing=null, selected=-1, visitsEditing=null, currentTab='visits';
let saving=false, pendingDraft=null, library=[], mapReady=false, mapFailed=false, toastTimer, draftWarning=false;
const signature=courseSignature;
const dirty=()=>signature(course)!==savedSignature;
const toast=message=>{clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500);};
async function api(path,options={}){
  let r;try{r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});}catch{throw new Error('서버 연결에 실패했습니다. 변경사항은 유지됩니다. 다시 시도해 주세요.');}
  let data;try{data=await r.json();}catch{throw new Error('서버 응답을 읽을 수 없습니다. 변경사항은 유지됩니다.');}
  if(!r.ok){if(r.status===401&&path!=='/api/login'){persistDraft();$('login-screen').hidden=false;$('app').hidden=true;$('login-error').textContent='세션이 만료되었습니다. 다시 로그인하면 임시저장을 복원할 수 있어요.';}throw Object.assign(new Error(data.message),{code:data.code});}return data;
}
function draftKey(){return `walkmap:draft:${user.id}`;}
function persistDraft(){
  if(!user||pendingDraft)return;
  try{if(dirty())localStorage.setItem(draftKey(),JSON.stringify({course,baseVersion,savedSignature}));else localStorage.removeItem(draftKey());}
  catch{if(!draftWarning){toast('브라우저 임시저장을 사용할 수 없습니다. 창을 닫기 전에 서버에 저장해 주세요.');draftWarning=true;}}
}
function status(){const changed=dirty();$('save-state').textContent=saving?'저장 중…':changed?'미저장 변경':baseVersion?'서버 저장됨':'새 코스';$('save-state').classList.toggle('dirty',changed);$('save').disabled=saving||!!drawing;$('undo').disabled=!history.past.length;$('redo').disabled=!history.future.length;$('delete-course').disabled=!baseVersion;}
function metrics(){const t=timings(course);$('distance').innerHTML=`${(t.meters/1000).toFixed(2)} <small>km</small>`;for(const [id,value]of [['walk-time',t.walk],['stay-time',t.stay],['total-time',t.total]])$(id).innerHTML=`${Math.ceil(value)} <small>분</small>`;
  $('visit-count').textContent=course.visits.length;$('point-count').textContent=`${course.points.length}개`;
  $('endpoints').textContent=course.points.length>1?`출발 → 도착 · 편집점 ${course.points.length}개 · 방문 ${course.visits.length}곳`:'출발점과 도착점을 그려 주세요';
}
function commit(next,render=true){if(saving)return;if(pendingDraft){toast('먼저 이전 임시저장을 복원하거나 버려 주세요.');renderFields();return;}course=next;history.set(course);persistDraft();status();metrics();if(render){renderFields();renderVisits();renderPoints();renderMap();}}
function mutate(fn){const next=clone(course);fn(next);commit(next);}
function renderFields(){for(const [id,value] of [['course-name',course.name],['region',course.region],['tags',course.tags.join(', ')],['speed',course.speed]])$(id).value=value;}
function renderVisits(){
  $('visits-empty').hidden=!!course.visits.length;
  $('visits').innerHTML=course.visits.map((v,i)=>`<li class="visit-card"><span class="visit-number">${String(i+1).padStart(2,'0')}</span><div class="visit-card-content"><h3>${esc(v.name)}</h3><span class="tag">체류 ${v.stay}분</span>${v.memo?`<p>${esc(v.memo)}</p>`:''}<div class="visit-actions"><button data-edit="${i}">수정</button><button data-locate="${i}">지도에서 보기</button><button data-reposition="${i}">위치 변경</button>${v.link?`<a href="${esc(v.link)}" target="_blank" rel="noopener noreferrer">상세정보 ↗</a>`:''}</div></div></li>`).join('');
  $('visits').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editVisit(Number(b.dataset.edit)));
  $('visits').querySelectorAll('[data-locate]').forEach(b=>b.onclick=()=>{focus(course.visits[Number(b.dataset.locate)]);$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('visits').querySelectorAll('[data-reposition]').forEach(b=>b.onclick=()=>{if(!mapReady)return toast('지도 연결 후 위치를 변경할 수 있습니다.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');mode=`visit-move:${b.dataset.reposition}`;renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});});
}
function renderPoints(){
 $('points').innerHTML=course.points.map((p,i)=>`<div class="point-row"><button data-select="${i}">${i===0?'● 출발':i===course.points.length-1?'◉ 도착':`○ 편집점 ${i+1}`}</button>${selected===i?`<div class="point-coords"><label>위도<input data-lat type="number" step="0.0000001" value="${p.lat}" min="-90" max="90"></label><label>경도<input data-lng type="number" step="0.0000001" value="${p.lng}" min="-180" max="180"></label><button data-apply="${i}">이동</button><button data-delete="${i}" class="danger">삭제</button></div>`:''}</div>`).join('');
 $('points').querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.select);focus(course.points[selected]);renderPoints();renderMap();renderSelection();});
 $('points').querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>{const p=b.parentElement,lat=Number(p.querySelector('[data-lat]').value),lng=Number(p.querySelector('[data-lng]').value);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return toast('유효한 위도·경도를 입력해 주세요.');mutate(c=>c.points[Number(b.dataset.apply)]={lat,lng});});
 $('points').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removePoint(Number(b.dataset.delete)));
}
function selectTab(tab){currentTab=tab;for(const t of ['visits','route']){$(`tab-${t}`).setAttribute('aria-selected',String(tab===t));$(`${t}-panel`).hidden=tab!==t;}}
function renderSelection(){ $('selection').hidden=selected<0||selected>=course.points.length;if(!$('selection').hidden)$('selection-label').textContent=`편집점 ${selected+1} · 끌어서 이동`;}
function renderMode(){
  $('pan').classList.toggle('active',mode==='pan');$('draw').classList.toggle('active',mode==='draw');$('draw').hidden=!!drawing;$('finish').hidden=!drawing;$('cancel').hidden=!(drawing||mode.startsWith('visit'));
  $('mode-hint').textContent=mode==='draw'?'그리기 모드 · 지도를 클릭해 점 추가 · 완료하면 확정':mode.startsWith('visit')?'방문 위치 선택 · 지도에서 원하는 위치를 클릭하세요':'지도 이동 모드 · 경로 점을 끌어 이동할 수 있어요';
  for(const id of ['course-name','region','tags','speed','duplicate','visit-add'])$(id).disabled=!!drawing;
  if(map)map.setOptions({disableDoubleClickZoom:mode==='draw',draggable:mode!=='draw'});status();
}
function removePoint(i){mutate(c=>c.points.splice(i,1));selected=-1;renderPoints();renderMap();renderSelection();}
function focus(p){if(mapReady&&p)map.panTo(new naver.maps.LatLng(p.lat,p.lng));}
function fit(){if(!mapReady||!course.points.length)return; if(course.points.length===1)return focus(course.points[0]);const bounds=new naver.maps.LatLngBounds();course.points.forEach(p=>bounds.extend(new naver.maps.LatLng(p.lat,p.lng)));map.fitBounds(bounds,{top:160,right:70,bottom:100,left:70});}
function pickVisitPosition(p){
 if(mode==='visit'){mode='pan';renderMode();editVisit(-1,p);return true;}
 if(mode.startsWith('visit-move:')){const i=Number(mode.split(':')[1]);mode='pan';mutate(c=>Object.assign(c.visits[i],p));renderMode();return true;}
 return false;
}
function renderMap(){
 if(!mapReady)return;overlays.forEach(o=>{naver.maps.Event.clearInstanceListeners(o);o.setMap(null);});overlays=[];
 const N=naver.maps, pos=p=>new N.LatLng(p.lat,p.lng);
 if(course.points.length>1)overlays.push(new N.Polyline({map,path:course.points.map(pos),strokeColor:'#24755e',strokeWeight:5,strokeOpacity:.9,clickable:false}));
 course.points.forEach((p,i)=>{
  const endpoint=i===0||i===course.points.length-1;
  const content=endpoint?`<div class="endpoint-marker ${i?'end':''}">${i?'도착':'출발'}</div>`:`<div class="route-marker ${selected===i?'selected':''}"></div>`;
  const marker=new N.Marker({map,position:pos(p),draggable:true,zIndex:100,icon:{content,anchor:new N.Point(endpoint?24:8,endpoint?14:8)}});overlays.push(marker);
  N.Event.addListener(marker,'click',()=>{if(pickVisitPosition(p))return;selected=i;selectTab('route');renderPoints();renderSelection();});
  N.Event.addListener(marker,'dragend',()=>{const ll=marker.getPosition();mutate(c=>c.points[i]={lat:ll.lat(),lng:ll.lng()});});
  if(i>0){const a=course.points[i-1],mid={lat:(a.lat+p.lat)/2,lng:(a.lng+p.lng)/2};const m=new N.Marker({map,position:pos(mid),zIndex:90,icon:{content:'<div class="insert-marker" title="중간 점 삽입">+</div>',anchor:new N.Point(9,9)}});overlays.push(m);
   N.Event.addListener(m,'click',()=>{if(pickVisitPosition(mid))return;selected=i;mutate(c=>c.points.splice(i,0,mid));selectTab('route');renderSelection();});}
 });
 const occupied=[];
 course.visits.forEach((v,i)=>{
   const pixel=map.getProjection().fromCoordToOffset(pos(v));
   const width=Math.min(220,75+v.name.length*12),rect={x:Math.max(8,Math.min(pixel.x,$('map').clientWidth-width-8)),y:pixel.y<55?pixel.y+18:pixel.y-42,w:width,h:36};
   const collision=occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y);
   if(!collision)occupied.push(rect);
   const content=collision?`<div class="visit-dot" title="${esc(v.name)} · ${v.stay}분">${i+1}</div>`:`<div class="visit-map" style="width:${width}px" title="${esc(v.name)} · ${v.stay}분"><b>${i+1}</b><span>${esc(v.name)}</span><em>${v.stay}분</em></div>`;
   const marker=new N.Marker({map,position:pos(v),zIndex:200+i,icon:{content,anchor:new N.Point(collision?12:pixel.x-rect.x,collision?12:pixel.y-rect.y)}});overlays.push(marker);N.Event.addListener(marker,'click',()=>editVisit(i));
 });renderSelection();
}
async function initMap(){
  if(map){naver.maps.Event.trigger(map,'resize');renderMap();return;}
  const config=await api('/api/config');
  if(!config.mapsClientId){$('map-status').textContent='지도 인증 설정이 필요합니다. NAVER_MAPS_CLIENT_ID를 설정해 주세요.';return;}
  const fail=message=>{mapFailed=true;mapReady=false;$('map-status').hidden=false;$('map-status').classList.add('error');$('map-status').textContent=message;};
  window.addEventListener('error',e=>{if(e.target?.tagName==='SCRIPT'&&/\.map\.naver\.net\//.test(e.target.src||''))fail('지도 배경 연결 실패 · 네트워크 보안 정책 또는 인증서 문제로 지도 리소스를 불러오지 못했습니다.');},true);
  window.navermap_authFailure=()=>fail('지도 인증 실패 · Maps의 Dynamic Map 선택과 허용 URL을 확인해 주세요. 현재 주소: '+location.origin);
  const loaded=()=>{
   if(mapFailed)return;
   try{map=new naver.maps.Map('map',{center:new naver.maps.LatLng(37.5773,126.981),zoom:15,zoomControl:true,zoomControlOptions:{position:naver.maps.Position.RIGHT_CENTER},mapDataControl:true,scaleControl:true,logoControl:true});let tilesSeen=false;naver.maps.Event.addListener(map,'tilesloaded',()=>{if(mapFailed)return;tilesSeen=true;mapReady=true;$('map-status').hidden=true;renderMap();});setTimeout(()=>{if(!tilesSeen&&!mapFailed)fail('지도 배경을 불러오지 못했습니다. 네트워크 보안 정책·인증서와 네이버 지도 리소스 연결을 확인해 주세요.');},15000);
    naver.maps.Event.addListener(map,'click',e=>{
     if(saving)return;const p={lat:e.coord.lat(),lng:e.coord.lng()};
     if(mode==='draw'){if(course.points.length>=2000)return toast('편집점은 최대 2,000개입니다.');mutate(c=>c.points.push(p));}
     else pickVisitPosition(p);
    });
    naver.maps.Event.addListener(map,'idle',renderMap);new ResizeObserver(()=>{naver.maps.Event.trigger(map,'resize');}).observe($('map'));renderMap();renderMode();fit();
   }catch(e){console.error('지도 초기화 오류:', e.name, e.message);fail('지도를 초기화할 수 없습니다. 페이지를 새로고침해 주세요.');}
  };
  if(window.naver?.maps){loaded();return;}
  const s=document.createElement('script');s.src='https://oapi.map.naver.com/openapi/v3/maps.js?'+new URLSearchParams({ncpKeyId:config.mapsClientId});s.onload=loaded;s.onerror=()=>fail('지도 로딩 실패 · 네트워크 연결 또는 지도 서비스 호출 한도와 Dynamic Map 설정을 확인해 주세요.');document.head.append(s);
  setTimeout(()=>{if(!map&&!mapFailed)fail('지도 응답이 지연됩니다. 네트워크 연결과 Maps 허용 URL을 확인한 뒤 새로고침해 주세요.');},20000);
}
function editVisit(index,position){
 if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
 visitsEditing={index,position};const v=index>=0?course.visits[index]:{name:'',stay:15,memo:'',link:''};const f=$('visit-form');
 for(const key of ['name','stay','memo','link'])f.elements[key].value=v[key];f.elements.order.value=index>=0?index+1:course.visits.length+1;f.elements.order.max=course.visits.length+(index<0?1:0);$('visit-remove').hidden=index<0;$('visit-dialog-title').textContent=index<0?'새로운 방문 장소':'방문 장소 수정';$('visit-dialog').showModal();
}
$('visit-form').onsubmit=e=>{
 e.preventDefault();const form=e.target,index=visitsEditing.index,order=Number(form.elements.order.value)-1;
 const v={...(index>=0?course.visits[index]:{...visitsEditing.position,id:crypto.randomUUID(),source:'user'}),name:form.elements.name.value.trim(),stay:Number(form.elements.stay.value),memo:form.elements.memo.value,link:form.elements.link.value.trim()};
 try{const next=clone(course);if(index>=0)next.visits.splice(index,1);next.visits.splice(order,0,v);validateCourse(next);commit(next);$('visit-dialog').close();}catch(e){toast(e.message);}
};
$('visit-remove').onclick=()=>{if(confirm('이 방문 장소를 삭제할까요? 실행 취소로 복구할 수 있습니다.')){mutate(c=>c.visits.splice(visitsEditing.index,1));$('visit-dialog').close();}};
$('visit-close').onclick=()=>{if(confirm('장소 편집을 닫을까요? 적용하지 않은 입력은 저장되지 않습니다.'))$('visit-dialog').close();};
$('visit-dialog').addEventListener('cancel',e=>{e.preventDefault();$('visit-close').click();});
$('visit-add').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(!mapReady)return toast('지도 연결 후 위치를 선택해 주세요.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');if(course.visits.length>=100)return toast('방문 장소는 최대 100개입니다.');mode='visit';renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});};
$('pan').onclick=()=>{if(drawing)return toast('진행 중인 그리기를 완료하거나 취소해 주세요.');mode='pan';renderMode();};
$('draw').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(!mapReady)return toast('지도가 연결된 뒤 경로를 그릴 수 있습니다.');drawing={course:clone(course),past:clone(history.past),future:clone(history.future)};mode='draw';selected=-1;selectTab('route');renderMode();renderMap();};
$('finish').onclick=()=>{drawing=null;mode='pan';renderMode();persistDraft();};
$('cancel').onclick=()=>{if(drawing){course=drawing.course;history.current=clone(course);history.past=drawing.past;history.future=drawing.future;drawing=null;renderAll();persistDraft();}mode='pan';renderMode();};
$('undo').onclick=()=>{course=history.undo();selected=-1;renderAll();persistDraft();};$('redo').onclick=()=>{course=history.redo();selected=-1;renderAll();persistDraft();};
$('fit').onclick=fit;$('selection-delete').onclick=()=>removePoint(selected);$('selection-close').onclick=()=>{selected=-1;renderSelection();renderPoints();};
for(const t of ['visits','route'])$(`tab-${t}`).onclick=()=>selectTab(t);
for(const [id,key]of [['course-name','name'],['region','region'],['tags','tags']])$(id).addEventListener('input',e=>{const next=clone(course);next[key]=key==='tags'?e.target.value.split(',').map(s=>s.trim()).filter(Boolean):e.target.value;commit(next,false);});
$('speed').oninput=e=>{const n=Number(e.target.value);if(n>=.5&&n<=10){const next=clone(course);next.speed=n;commit(next,false);}};
$('speed').onchange=()=>{if(!$('speed').checkValidity()){toast('보행속도는 0.5–10 km/h로 입력해 주세요.');$('speed').value=course.speed;}};
function renderAll(){renderFields();renderVisits();renderPoints();metrics();status();renderMap();renderSelection();}
function canLeave(){if(pendingDraft){toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');return false;}if(saving){toast('저장 중입니다. 잠시 기다려 주세요.');return false;}if(drawing){toast('그리기를 완료하거나 취소해 주세요.');return false;}return !dirty()||confirm('저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동할까요?');}
function loadCourse(c){course=clone(c);baseVersion=c.version;savedSignature=signature(c);history.reset(c);selected=-1;mode='pan';drawing=null;pendingDraft=null;$('draft-banner').hidden=true;renderAll();renderMode();persistDraft();fit();}
$('new-course').onclick=()=>{if(canLeave()){loadCourse(emptyCourse());toast('새 코스를 만들었습니다.');}};
$('save').onclick=async()=>{
 if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');
 if(drawing)return toast('그리기를 먼저 완료해 주세요.');let sent;
 try{sent=validateCourse({...course,version:baseVersion});}catch(e){return toast(e.message);}
 saving=true;status();$('app').inert=true;
 try{const result=await api(`/api/courses/${course.id}`,{method:'PUT',body:JSON.stringify(sent)});baseVersion=result.version;course.version=result.version;history.current.version=result.version;savedSignature=signature(result);persistDraft();toast('서버에 코스를 저장했습니다.');}
 catch(e){toast(e.message);persistDraft();}
 finally{saving=false;$('app').inert=false;status();}
};
$('duplicate').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(drawing)return toast('그리기를 먼저 완료해 주세요.');course=duplicate(course);baseVersion=0;savedSignature='';history.reset(course);persistDraft();renderAll();toast('독립된 복사본을 만들었습니다. 저장하면 새 코스로 등록됩니다.');};
$('delete-course').onclick=async()=>{if(!baseVersion)return;if(drawing)return toast('그리기를 먼저 완료해 주세요.');if(!confirm(`“${course.name}” 코스를 서버에서 삭제할까요?${dirty()?' 미저장 변경사항도 버려집니다.':''} 이 작업은 되돌릴 수 없습니다.`))return;
 try{await api(`/api/courses/${course.id}`,{method:'DELETE',headers:{'If-Match':String(baseVersion)}});loadCourse(emptyCourse());toast('코스를 삭제했습니다.');}catch(e){toast(e.message);}
};
function renderLibrary(){const q=$('library-query').value.trim().toLowerCase();const items=library.filter(c=>[c.name,c.region,...c.tags].join(' ').toLowerCase().includes(q));$('course-list').innerHTML=items.map(c=>`<button class="library-card" data-id="${c.id}"><strong>${esc(c.name)}</strong><small>${esc(c.region||'지역 미입력')} ${c.tags.map(t=>'#'+esc(t)).join(' ')}<br>${(timings(c).meters/1000).toFixed(2)} km · 방문 ${c.visits.length}곳 · ${Math.ceil(timings(c).total)}분</small></button>`).join('');$('library-status').textContent=items.length?`${items.length}개의 코스`:'조건에 맞는 코스가 없습니다.';$('course-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{if(!canLeave())return;try{const c=await api(`/api/courses/${b.dataset.id}`);loadCourse(c);$('library').close();}catch(e){$('library-status').textContent=e.message;}});}
$('library-open').onclick=async()=>{$('library').showModal();$('library-status').textContent='코스를 불러오는 중…';$('course-list').replaceChildren();try{library=await api('/api/courses');renderLibrary();}catch(e){$('library-status').textContent=e.message;}};$('library-close').onclick=()=>$('library').close();$('library-query').oninput=renderLibrary;
$('draft-restore').onclick=()=>{if(!pendingDraft)return;try{course=validateCourse(pendingDraft.course);baseVersion=pendingDraft.baseVersion;savedSignature=pendingDraft.savedSignature;history.reset(course);pendingDraft=null;$('draft-banner').hidden=true;renderAll();fit();toast('이 기기의 편집 내용을 복원했습니다. 서버 저장을 눌러 확정하세요.');}catch{toast('임시저장 형식을 읽을 수 없습니다.');}};
$('draft-discard').onclick=()=>{if(confirm('이 기기의 임시저장을 삭제할까요?')){pendingDraft=null;localStorage.removeItem(draftKey());$('draft-banner').hidden=true;}};
$('search-close').onclick=()=>{$('search-state').hidden=true;$('search-results').replaceChildren();};
$('search-form').onsubmit=async e=>{
 e.preventDefault();const q=$('search-query').value.trim();if(!q)return;$('search-button').disabled=true;$('search-state').hidden=false;$('search-state').textContent='장소를 검색하는 중…';$('search-results').replaceChildren();
 try{const {items}=await api('/api/search?q='+encodeURIComponent(q));$('search-state').textContent=items.length?'네이버 검색 결과 · 선택하면 지도만 이동합니다.':'검색 결과가 없습니다. 지역명과 장소명을 함께 입력해 보세요.';
 items.forEach(p=>{const b=document.createElement('button');b.className='result';b.innerHTML=`${esc(p.title)}<small>${esc(p.address)}</small>`;b.onclick=()=>{if(!mapReady)return toast('지도 연결을 먼저 확인해 주세요.');focus(p);map.setZoom(17);$('search-results').replaceChildren();$('search-state').hidden=true;toast('선택한 위치로 이동했습니다. 방문 장소는 지도에서 직접 추가하세요.');};$('search-results').append(b);});
 }catch(e){$('search-state').textContent=e.message;}finally{$('search-button').disabled=false;}
};
async function signedIn(u){
 user=u;course=emptyCourse();baseVersion=0;savedSignature=signature(course);history.reset(course);drawing=null;mode='pan';selected=-1;pendingDraft=null;
 $('login-screen').hidden=true;$('app').hidden=false;$('login-form').reset();$('login-error').textContent='';$('search-results').replaceChildren();$('search-state').hidden=true;$('search-query').value='';
 try{pendingDraft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{}$('draft-banner').hidden=!pendingDraft;renderAll();renderMode();try{await initMap();}catch(e){toast(e.message);}
}
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('login-error').textContent='';try{await signedIn(await api('/api/login',{method:'POST',body:JSON.stringify({name:e.target.elements.username.value,password:e.target.elements.password.value})}));}catch(e){$('login-error').textContent=e.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{if(!canLeave())return;try{await api('/api/logout',{method:'POST'});localStorage.removeItem(draftKey());user=null;course=emptyCourse();renderAll();$('app').hidden=true;$('login-screen').hidden=false;}catch(e){toast(e.message);}};
window.addEventListener('beforeunload',e=>{if(user&&dirty()){persistDraft();e.preventDefault();e.returnValue='';}});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(user&&!saving)$('save').click();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();if(user&&!saving)$(e.shiftKey?'redo':'undo').click();}});
try{await signedIn(await api('/api/me'));}catch{$('login-screen').hidden=false;$('app').hidden=true;$('login-error').textContent='';}
