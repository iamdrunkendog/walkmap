import {emptyCourse,History,clone,timings,duplicate,validateCourse,courseSignature} from './model.mjs';
import {
  watchAuthState,
  loginWithUsername,
  loginWithGoogle,
  logoutUser,
  fetchCourses,
  fetchCourse,
  saveCourse,
  deleteCourse,
  searchPlaces,
  getMapsClientId,
  isConfigured
} from './firebase.mjs';

const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null, course=emptyCourse(), history=new History(course), savedSignature='',baseVersion=0;
let map=null, overlays=[], mode='pan', drawing=null, selected=-1, visitsEditing=null, markerEditing=null, currentTab='visits';
let saving=false, pendingDraft=null, library=[], mapReady=false, mapFailed=false, toastTimer, draftWarning=false;
const signature=courseSignature;
const dirty=()=>signature(course)!==savedSignature;
const toast=message=>{clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500);};
const CATEGORY_MAP={
  cafe:{label:'카페',icon:'☕'},
  food:{label:'식당',icon:'🍽'},
  photo:{label:'포토스팟',icon:'📷'},
  seminar:{label:'세미나실',icon:'🏛'},
  spot:{label:'참고장소',icon:'⚐'}
};
function inferCategory(text){
  const t=String(text||'').toLowerCase();
  if(/카페|커피|디저트|베이커리|cafe|coffee|tea|bakery/.test(t))return 'cafe';
  if(/식당|음식점|맛집|밥|요리|레스토랑|pub|bar|food|restaurant/.test(t))return 'food';
  if(/사진|포토|전망|야경|뷰|스냅|풍경|view|photo|spot/.test(t))return 'photo';
  if(/세미나|회의|스터디|워크숍|강의|미팅|seminar|meeting|study/.test(t))return 'seminar';
  return 'spot';
}

function draftKey(){return `walkmap:draft:${user?.id||'anonymous'}`;}
function persistDraft(){
  if(!user||pendingDraft)return;
  try{if(dirty())localStorage.setItem(draftKey(),JSON.stringify({course,baseVersion,savedSignature}));else localStorage.removeItem(draftKey());}
  catch{if(!draftWarning){toast('브라우저 임시저장을 사용할 수 없습니다. 창을 닫기 전에 서버에 저장해 주세요.');draftWarning=true;}}
}
function status(){const changed=dirty();$('save-state').textContent=saving?'저장 중…':changed?'미저장 변경':baseVersion?'서버 저장됨':'새 코스';$('save-state').classList.toggle('dirty',changed);$('save').disabled=saving||Boolean(drawing);$('undo').disabled=!history.past.length;$('redo').disabled=!history.future.length;$('delete-course').disabled=!baseVersion;}
function metrics(){const t=timings(course);$('distance').innerHTML=`${(t.meters/1000).toFixed(2)} <small>km</small>`;for(const [id,value]of [['walk-time',t.walk],['stay-time',t.stay],['total-time',t.total]])$(id).innerHTML=`${Math.ceil(value)} <small>분</small>`;
  $('visit-count').textContent=(course.visits||[]).length;$('marker-count').textContent=(course.markers||[]).length;$('point-count').textContent=`${course.points.length}개`;
  $('endpoints').textContent=course.points.length>1?`출발 → 도착 · 편집점 ${course.points.length}개 · 방문 ${(course.visits||[]).length}곳 · 참고 ${(course.markers||[]).length}곳`:'출발점과 도착점을 그려 주세요';
}
function commit(next,render=true){if(saving)return;if(pendingDraft){toast('먼저 이전 임시저장을 복원하거나 버려 주세요.');renderFields();return;}course=next;history.set(course);persistDraft();status();metrics();if(render){renderFields();renderVisits();renderMarkers();renderPoints();renderMap();}}
function mutate(fn){const next=clone(course);fn(next);commit(next);}
function renderFields(){for(const [id,value] of [['course-name',course.name],['region',course.region],['tags',course.tags.join(', ')],['speed',course.speed]])$(id).value=value;}
function renderVisits(){
  $('visits-empty').hidden=Boolean((course.visits||[]).length);
  $('visits').innerHTML=(course.visits||[]).map((v,i)=>`<li class="visit-card"><span class="visit-number">${String(i+1).padStart(2,'0')}</span><div class="visit-card-content"><h3>${esc(v.name)}</h3><span class="tag">체류 ${v.stay}분</span>${v.memo?`<p>${esc(v.memo)}</p>`:''}<div class="visit-actions"><button data-edit="${i}">수정</button><button data-locate="${i}">지도에서 보기</button><button data-reposition="${i}">위치 변경</button>${v.link?`<a href="${esc(v.link)}" target="_blank" rel="noopener noreferrer">상세정보 ↗</a>`:''}</div></div></li>`).join('');
  $('visits').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editVisit(Number(b.dataset.edit)));
  $('visits').querySelectorAll('[data-locate]').forEach(b=>b.onclick=()=>{focus(course.visits[Number(b.dataset.locate)]);$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('visits').querySelectorAll('[data-reposition]').forEach(b=>b.onclick=()=>{if(!mapReady)return toast('지도 연결 후 위치를 변경할 수 있습니다.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');mode=`visit-move:${b.dataset.reposition}`;renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});});
}
function renderMarkers(){
  const markers=course.markers||[];
  $('markers-empty').hidden=Boolean(markers.length);
  $('markers').innerHTML=markers.map((m,i)=>{
    const cat=CATEGORY_MAP[m.category]||{label:m.category||'참고장소',icon:'⚐'};
    return `<li class="marker-card ${esc(m.category||'spot')}"><div class="marker-card-header"><span class="marker-badge">${cat.icon} ${esc(cat.label)}</span><strong class="marker-title">${esc(m.name)}</strong></div>${m.address?`<p class="marker-address muted small">${esc(m.address)}</p>`:''}<div class="marker-actions"><button data-marker-edit="${i}">수정</button><button data-marker-locate="${i}">지도에서 보기</button><button data-marker-reposition="${i}">위치 변경</button><button data-marker-delete="${i}" class="danger">삭제</button>${m.naverLink?`<a href="${esc(m.naverLink)}" target="_blank" rel="noopener noreferrer">검색 출처 ↗</a>`:''}</div></li>`;
  }).join('');
  $('markers').querySelectorAll('[data-marker-edit]').forEach(b=>b.onclick=()=>editMarker(Number(b.dataset.markerEdit)));
  $('markers').querySelectorAll('[data-marker-locate]').forEach(b=>b.onclick=()=>{focus((course.markers||[])[Number(b.dataset.markerLocate)]);$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('markers').querySelectorAll('[data-marker-reposition]').forEach(b=>b.onclick=()=>{if(!mapReady)return toast('지도 연결 후 위치를 변경할 수 있습니다.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');mode=`marker-move:${b.dataset.markerReposition}`;renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('markers').querySelectorAll('[data-marker-delete]').forEach(b=>b.onclick=()=>removeMarker(Number(b.dataset.markerDelete)));
}
function removeMarker(i){
  if(confirm('이 참고 마커를 삭제할까요? 실행 취소로 복구할 수 있습니다.')){
    mutate(c=>{c.markers=c.markers||[];c.markers.splice(i,1);});
  }
}
function renderPoints(){
  $('points').innerHTML=course.points.map((p,i)=>`<div class="point-row${selected===i?' selected':''}"><button data-select="${i}">${i===0?'● 출발':i===course.points.length-1?'◉ 도착':`○ 편집점 ${i+1}`}</button>${selected===i?`<div class="point-coords"><label>위도<input data-lat type="number" step="0.0000001" value="${p.lat}" min="-90" max="90"></label><label>경도<input data-lng type="number" step="0.0000001" value="${p.lng}" min="-180" max="180"></label><button data-apply="${i}">이동</button><button data-delete="${i}" class="danger">삭제</button></div>`:''}</div>`).join('');
  $('points').querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.select);focus(course.points[selected]);renderPoints();renderMap();renderSelection();});
  $('points').querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>{const p=b.parentElement,lat=Number(p.querySelector('[data-lat]').value),lng=Number(p.querySelector('[data-lng]').value);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return toast('유효한 위도·경도를 입력해 주세요.');mutate(c=>c.points[Number(b.dataset.apply)]={lat,lng});});
  $('points').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removePoint(Number(b.dataset.delete)));
}
function selectTab(tab){currentTab=tab;for(const t of ['visits','markers','route']){$(`tab-${t}`).setAttribute('aria-selected',String(tab===t));$(`${t}-panel`).hidden=tab!==t;}}
function renderSelection(){ $('selection').hidden=selected<0||selected>=course.points.length;if(!$('selection').hidden)$('selection-label').textContent=`편집점 ${selected+1} · 끌어서 이동`;}
function renderMode(){
  $('pan').classList.toggle('active',mode==='pan');$('draw').classList.toggle('active',mode==='draw');$('draw').hidden=Boolean(drawing);$('finish').hidden=!drawing;$('cancel').hidden=!(drawing||mode.startsWith('visit')||mode.startsWith('marker'));
  $('mode-hint').textContent=mode==='draw'?'그리기 모드 · 지도를 클릭해 점 추가 · 완료하면 확정':mode.startsWith('visit')?'방문 위치 선택 · 지도에서 원하는 위치를 클릭하세요':mode.startsWith('marker')?'참고 마커 위치 선택 · 지도에서 원하는 위치를 클릭하세요':'지도 이동 모드 · 경로 점을 끌어 이동할 수 있어요';
  for(const id of ['course-name','region','tags','speed','duplicate','visit-add','marker-add'])$(id).disabled=Boolean(drawing);
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
function pickMarkerPosition(p){
  if(mode==='marker'){mode='pan';renderMode();editMarker(-1,p);return true;}
  if(mode.startsWith('marker-move:')){const i=Number(mode.split(':')[1]);mode='pan';mutate(c=>Object.assign((c.markers=c.markers||[])[i],p));renderMode();return true;}
  return false;
}
function renderMap(){
  if(!mapReady)return;overlays.forEach(o=>{naver.maps.Event.clearInstanceListeners(o);o.setMap(null);});overlays=[];
  const N=naver.maps, pos=p=>new N.LatLng(p.lat,p.lng);
  if(course.points.length>1)overlays.push(new N.Polyline({map,path:course.points.map(pos),strokeColor:'#E32219',strokeWeight:4,strokeOpacity:.9,clickable:false}));
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
  (course.visits||[]).forEach((v,i)=>{
    const pixel=map.getProjection().fromCoordToOffset(pos(v));
    const width=Math.min(220,75+v.name.length*12),rect={x:Math.max(8,Math.min(pixel.x,$('map').clientWidth-width-8)),y:pixel.y<55?pixel.y+18:pixel.y-42,w:width,h:36};
    const collision=occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y);
    if(!collision)occupied.push(rect);
    const content=collision?`<div class="visit-dot" title="${esc(v.name)} · ${v.stay}분">${i+1}</div>`:`<div class="visit-map" style="width:${width}px" title="${esc(v.name)} · ${v.stay}분"><b>${i+1}</b><span>${esc(v.name)}</span><em>${v.stay}분</em></div>`;
    const marker=new N.Marker({map,position:pos(v),zIndex:200+i,icon:{content,anchor:new N.Point(collision?12:pixel.x-rect.x,collision?12:pixel.y-rect.y)}});overlays.push(marker);N.Event.addListener(marker,'click',()=>editVisit(i));
  });
  (course.markers||[]).forEach((m,i)=>{
    const cat=CATEGORY_MAP[m.category]||{label:m.category||'참고장소',icon:'⚐'};
    const content=`<div class="course-ref-marker ${esc(m.category||'spot')}${markerEditing?.index===i?' selected':''}" title="${esc(m.name)} · ${esc(cat.label)}"><span class="ref-icon">${cat.icon}</span><span class="ref-name">${esc(m.name)}</span></div>`;
    const marker=new N.Marker({map,position:pos(m),zIndex:150+i,icon:{content,anchor:new N.Point(12,12)}});overlays.push(marker);
    N.Event.addListener(marker,'click',()=>{if(pickMarkerPosition(m)||pickVisitPosition(m))return;selectTab('markers');editMarker(i);});
  });
  renderSelection();
}
async function initMap(){
  if(map){naver.maps.Event.trigger(map,'resize');renderMap();return;}
  const mapsClientId=getMapsClientId();
  if(!mapsClientId){$('map-status').textContent='지도 인증 설정이 필요합니다. NAVER_MAPS_CLIENT_ID를 설정해 주세요.';return;}
  const fail=message=>{mapFailed=true;mapReady=false;$('map-status').hidden=false;$('map-status').classList.add('error');$('map-status').textContent=message;};
  window.addEventListener('error',e=>{if(e.target?.tagName==='SCRIPT'&&/\.map\.naver\.net\//.test(e.target.src||''))fail('지도 배경 연결 실패 · 네트워크 보안 정책 또는 인증서 문제로 지도 리소스를 불러오지 못했습니다.');},true);
  window.navermap_authFailure=()=>fail('지도 인증 실패 · Maps의 Dynamic Map 선택과 허용 URL을 확인해 주세요. 현재 주소: '+location.origin);
  const loaded=()=>{
    if(mapFailed)return;
    try{map=new naver.maps.Map('map',{center:new naver.maps.LatLng(37.5773,126.981),zoom:15,zoomControl:true,zoomControlOptions:{position:naver.maps.Position.RIGHT_CENTER},mapDataControl:true,scaleControl:true,logoControl:true});let tilesSeen=false;naver.maps.Event.addListener(map,'tilesloaded',()=>{if(mapFailed)return;tilesSeen=true;mapReady=true;$('map-status').hidden=true;renderMap();});setTimeout(()=>{if(!tilesSeen&&!mapFailed)fail('지도 배경을 불러오지 못했습니다. 네트워크 보안 정책·인증서와 네이버 지도 리소스 연결을 확인해 주세요.');},15000);
      naver.maps.Event.addListener(map,'click',e=>{
        if(saving)return;const p={lat:e.coord.lat(),lng:e.coord.lng()};
        if(mode==='draw'){if(course.points.length>=2000)return toast('편집점은 최대 2,000개입니다.');mutate(c=>c.points.push(p));}
        else if(!pickMarkerPosition(p))pickVisitPosition(p);
      });
      naver.maps.Event.addListener(map,'idle',renderMap);new ResizeObserver(()=>{naver.maps.Event.trigger(map,'resize');}).observe($('map'));renderMap();renderMode();fit();
    }catch(e){console.error('지도 초기화 오류:', e.name, e.message);fail('지도를 초기화할 수 없습니다. 페이지를 새로고침해 주세요.');}
  };
  if(window.naver?.maps){loaded();return;}
  const s=document.createElement('script');s.src='https://oapi.map.naver.com/openapi/v3/maps.js?'+new URLSearchParams({ncpKeyId:mapsClientId});s.onload=loaded;s.onerror=()=>fail('지도 로딩 실패 · 네트워크 연결 또는 지도 서비스 호출 한도와 Dynamic Map 설정을 확인해 주세요.');document.head.append(s);
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
function editMarker(index,position){
  if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
  markerEditing={index,position};const m=index>=0?(course.markers||[])[index]:{name:'',category:'cafe',address:'',naverLink:''};const f=$('marker-form');
  for(const key of ['name','category','address'])f.elements[key].value=m[key]||'';f.elements.naverLink.value=m.naverLink||'';
  $('marker-remove').hidden=index<0;$('marker-dialog-title').textContent=index<0?'새로운 참고 마커':'참고 마커 수정';$('marker-dialog').showModal();
}
$('marker-form').onsubmit=e=>{
  e.preventDefault();const form=e.target,index=markerEditing.index;
  const link=form.elements.naverLink.value.trim();
  const m={
    ...(index>=0?course.markers[index]:{...markerEditing.position,id:crypto.randomUUID()}),
    name:form.elements.name.value.trim(),
    category:form.elements.category.value,
    address:form.elements.address.value.trim()
  };
  if(link)m.naverLink=link;else delete m.naverLink;
  try{
    const next=clone(course);next.markers=next.markers||[];
    if(index>=0)next.markers[index]=m;else next.markers.push(m);
    validateCourse(next);commit(next);markerEditing=null;$('marker-dialog').close();
  }catch(e){toast(e.message);}
};
$('marker-remove').onclick=()=>{removeMarker(markerEditing.index);markerEditing=null;$('marker-dialog').close();};
$('marker-close').onclick=()=>{if(confirm('마커 편집을 닫을까요? 적용하지 않은 입력은 저장되지 않습니다.')){markerEditing=null;$('marker-dialog').close();}};
$('marker-dialog').addEventListener('cancel',e=>{e.preventDefault();$('marker-close').click();});
$('marker-add').onclick=()=>{
  if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');
  if(!mapReady)return toast('지도 연결 후 위치를 선택해 주세요.');
  if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
  if((course.markers||[]).length>=100)return toast('참고 마커는 최대 100개입니다.');
  mode='marker';renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});
};
$('pan').onclick=()=>{if(drawing)return toast('진행 중인 그리기를 완료하거나 취소해 주세요.');mode='pan';renderMode();};
$('draw').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(!mapReady)return toast('지도가 연결된 뒤 경로를 그릴 수 있습니다.');drawing={course:clone(course),past:clone(history.past),future:clone(history.future)};mode='draw';selected=-1;selectTab('route');renderMode();renderMap();};
$('finish').onclick=()=>{drawing=null;mode='pan';renderMode();persistDraft();};
$('cancel').onclick=()=>{if(drawing){course=drawing.course;history.current=clone(course);history.past=drawing.past;history.future=drawing.future;drawing=null;renderAll();persistDraft();}mode='pan';renderMode();};
$('undo').onclick=()=>{course=history.undo();selected=-1;renderAll();persistDraft();};$('redo').onclick=()=>{course=history.redo();selected=-1;renderAll();persistDraft();};
$('fit').onclick=fit;$('selection-delete').onclick=()=>removePoint(selected);$('selection-close').onclick=()=>{selected=-1;renderSelection();renderPoints();};
for(const t of ['visits','markers','route'])$(`tab-${t}`).onclick=()=>selectTab(t);
for(const [id,key]of [['course-name','name'],['region','region'],['tags','tags']])$(id).addEventListener('input',e=>{const next=clone(course);next[key]=key==='tags'?e.target.value.split(',').map(s=>s.trim()).filter(Boolean):e.target.value;commit(next,false);});
$('speed').oninput=e=>{const n=Number(e.target.value);if(n>=.5&&n<=10){const next=clone(course);next.speed=n;commit(next,false);}};
$('speed').onchange=()=>{if(!$('speed').checkValidity()){toast('보행속도는 0.5–10 km/h로 입력해 주세요.');$('speed').value=course.speed;}};
function renderAll(){renderFields();renderVisits();renderMarkers();renderPoints();metrics();status();renderMap();renderSelection();}
function canLeave(){if(pendingDraft){toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');return false;}if(saving){toast('저장 중입니다. 잠시 기다려 주세요.');return false;}if(drawing){toast('그리기를 완료하거나 취소해 주세요.');return false;}return !dirty()||confirm('저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동할까요?');}
function loadCourse(c){course=clone(c);course.markers=course.markers||[];baseVersion=c.version;savedSignature=signature(course);history.reset(course);selected=-1;mode='pan';drawing=null;pendingDraft=null;$('draft-banner').hidden=true;renderAll();renderMode();persistDraft();fit();}
$('new-course').onclick=()=>{if(canLeave()){loadCourse(emptyCourse());toast('새 코스를 만들었습니다.');}};
$('save').onclick=async()=>{
  if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');
  if(drawing)return toast('그리기를 먼저 완료해 주세요.');
  if(!user)return toast('로그인이 필요합니다.');
  let sent;
  try{sent=validateCourse({...course,version:baseVersion});}catch(e){return toast(e.message);}
  saving=true;status();$('app').inert=true;
  try{
    const result=await saveCourse(user.id,sent,baseVersion);
    baseVersion=result.version;course.version=result.version;history.current.version=result.version;savedSignature=signature(result);
    persistDraft();toast('서버에 코스를 저장했습니다.');
  }
  catch(e){toast(e.message);persistDraft();}
  finally{saving=false;$('app').inert=false;status();}
};
$('duplicate').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(drawing)return toast('그리기를 먼저 완료해 주세요.');course=duplicate(course);course.markers=course.markers||[];baseVersion=0;savedSignature='';history.reset(course);persistDraft();renderAll();toast('독립된 복사본을 만들었습니다. 저장하면 새 코스로 등록됩니다.');};
$('delete-course').onclick=async()=>{
  if(!baseVersion||!user)return;
  if(drawing)return toast('그리기를 먼저 완료해 주세요.');
  if(!confirm(`“${course.name}” 코스를 서버에서 삭제할까요?${dirty()?' 미저장 변경사항도 버려집니다.':''} 이 작업은 되돌릴 수 없습니다.`))return;
  try{
    await deleteCourse(user.id,course.id,baseVersion);
    loadCourse(emptyCourse());toast('코스를 삭제했습니다.');
  }catch(e){toast(e.message);}
};
function renderLibrary(){
  const q=$('library-query').value.trim().toLowerCase();
  const items=library.filter(c=>[c.name,c.region,...c.tags].join(' ').toLowerCase().includes(q));
  $('course-list').innerHTML=items.map(c=>`<button class="library-card" data-id="${c.id}"><strong>${esc(c.name)}</strong><small>${esc(c.region||'지역 미입력')} ${c.tags.map(t=>'#'+esc(t)).join(' ')}<br>${(timings(c).meters/1000).toFixed(2)} km · 방문 ${(c.visits||[]).length}곳 · 마커 ${(c.markers||[]).length}개 · ${Math.ceil(timings(c).total)}분</small></button>`).join('');
  $('library-status').textContent=items.length?`${items.length}개의 코스`:'조건에 맞는 코스가 없습니다.';
  $('course-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{
    if(!canLeave())return;
    try{
      const c=await fetchCourse(user.id,b.dataset.id);
      loadCourse(c);$('library').close();
    }catch(e){$('library-status').textContent=e.message;}
  });
}
$('library-open').onclick=async()=>{
  if(!user)return;
  $('library').showModal();$('library-status').textContent='코스를 불러오는 중…';$('course-list').replaceChildren();
  try{library=await fetchCourses(user.id);renderLibrary();}catch(e){$('library-status').textContent=e.message;}
};
$('library-close').onclick=()=>$('library').close();
$('library-query').oninput=renderLibrary;
$('draft-restore').onclick=()=>{if(!pendingDraft)return;try{course=validateCourse(pendingDraft.course);baseVersion=pendingDraft.baseVersion;savedSignature=pendingDraft.savedSignature;history.reset(course);pendingDraft=null;$('draft-banner').hidden=true;renderAll();fit();toast('이 기기의 편집 내용을 복원했습니다. 서버 저장을 눌러 확정하세요.');}catch{toast('임시저장 형식을 읽을 수 없습니다.');}};
$('draft-discard').onclick=()=>{if(confirm('이 기기의 임시저장을 삭제할까요?')){pendingDraft=null;localStorage.removeItem(draftKey());$('draft-banner').hidden=true;}};
$('search-close').onclick=()=>{$('search-state').hidden=true;$('search-results').replaceChildren();};
function saveSearchAsMarker(p){
  course.markers=course.markers||[];
  if(course.markers.length>=100)return toast('참고 마커는 최대 100개까지 저장할 수 있습니다.');
  const existingIndex=course.markers.findIndex(m=>m.name===p.title&&Math.abs(m.lat-p.lat)<0.0001&&Math.abs(m.lng-p.lng)<0.0001);
  const cat=inferCategory(p.category||p.title);
  const link=(p.link&&typeof p.link==='string'&&p.link.startsWith('https://'))?p.link:'';
  mutate(c=>{
    c.markers=c.markers||[];
    if(existingIndex>=0){
      c.markers[existingIndex]={
        ...c.markers[existingIndex],
        name:p.title,
        address:p.address||'',
        lat:p.lat,
        lng:p.lng,
        ...(link?{naverLink:link}:{})
      };
    }else{
      const m={
        id:crypto.randomUUID(),
        name:p.title,
        category:cat,
        address:p.address||'',
        lat:p.lat,
        lng:p.lng
      };
      if(link)m.naverLink=link;
      c.markers.push(m);
    }
  });
  focus(p);selectTab('markers');
  toast(`“${p.title}” 참고 마커로 저장했습니다.`);
}
$('search-form').onsubmit=async e=>{
  e.preventDefault();const q=$('search-query').value.trim();if(!q)return;$('search-button').disabled=true;$('search-state').hidden=false;$('search-state').textContent='장소를 검색하는 중…';$('search-results').replaceChildren();
  try{
    const items=await searchPlaces(q);
    $('search-state').textContent=items.length?'네이버 검색 결과 · 위치 이동 또는 마커로 저장할 수 있습니다.':'검색 결과가 없습니다. 지역명과 장소명을 함께 입력해 보세요.';
    items.forEach(p=>{
      const row=document.createElement('div');row.className='search-item result';
      row.innerHTML=`<div class="search-item-info" role="button" tabindex="0" title="지도 위치로 이동"><strong>${esc(p.title)}</strong><small>${esc(p.address)}</small></div><div class="search-item-actions"><button type="button" class="search-pan-btn" title="지도 위치로 이동">이동</button><button type="button" class="search-save-btn primary" title="현재 코스에 참고 마커로 저장">마커로 저장</button></div>`;
      const pan=()=>{if(!mapReady)return toast('지도 연결을 먼저 확인해 주세요.');focus(p);map.setZoom(17);toast('선택한 위치로 이동했습니다.');};
      row.querySelector('.search-item-info').onclick=pan;
      row.querySelector('.search-pan-btn').onclick=pan;
      row.querySelector('.search-save-btn').onclick=e=>{e.stopPropagation();if(!mapReady)return toast('지도 연결을 먼저 확인해 주세요.');saveSearchAsMarker(p);};
      row.onclick=e=>{if(!e.target.closest('button'))pan();};
      $('search-results').append(row);
    });
  }catch(e){$('search-state').textContent=e.message;}finally{$('search-button').disabled=false;}
};
async function signedIn(u){
  const loading=$('auth-loading');if(loading)loading.hidden=true;
  const sameUser=Boolean(user&&user.id===u.id);
  user=u;
  $('login-screen').hidden=true;$('app').hidden=false;$('login-form').reset();$('login-error').textContent='';
  if(!sameUser){
    course=emptyCourse();baseVersion=0;savedSignature=signature(course);history.reset(course);drawing=null;mode='pan';selected=-1;pendingDraft=null;
    $('search-results').replaceChildren();$('search-state').hidden=true;$('search-query').value='';
    try{pendingDraft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{}$('draft-banner').hidden=!pendingDraft;renderAll();renderMode();try{await initMap();}catch(e){toast(e.message);}
  }
}
$('login-form').onsubmit=async e=>{
  e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('login-error').textContent='';
  try{
    const username=e.target.elements.username.value;
    const password=e.target.elements.password.value;
    const signedUser=await loginWithUsername(username,password);
    await signedIn(signedUser);
  }catch(e){$('login-error').textContent=e.message;}finally{b.disabled=false;}
};
$('google-login').onclick=async()=>{
  const b=$('google-login');b.disabled=true;$('login-error').textContent='';
  try{const signedUser=await loginWithGoogle();if(signedUser)await signedIn(signedUser);}
  catch(e){$('login-error').textContent=e.message;}
  finally{b.disabled=false;}
};
$('logout').onclick=async()=>{
  if(!canLeave())return;
  try{
    if(user)localStorage.removeItem(draftKey());
    user=null;course=emptyCourse();renderAll();
    await logoutUser();
    const loading=$('auth-loading');if(loading)loading.hidden=true;
    $('app').hidden=true;$('login-screen').hidden=false;
  }catch(e){toast(e.message);}
};
window.addEventListener('beforeunload',e=>{if(user&&dirty()){persistDraft();e.preventDefault();e.returnValue='';}});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(user&&!saving)$('save').click();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();if(user&&!saving)$(e.shiftKey?'redo':'undo').click();}});

watchAuthState(async (activeUser)=>{
  const loading=$('auth-loading');if(loading)loading.hidden=true;
  if(activeUser){
    await signedIn(activeUser);
  }else{
    user=null;
    $('login-screen').hidden=false;
    $('app').hidden=true;
    $('login-error').textContent='';
  }
});
