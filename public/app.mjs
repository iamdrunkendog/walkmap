import {emptyCourse,History,clone,timings,distance,calculateBearing,duplicate,validateCourse,courseSignature,routeArrows} from './model.mjs';
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
const CATEGORY_ICONS={
  cafe:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h7.5v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5z"/><path d="M10.5 6.5h1.5a1.5 1.5 0 0 1 0 3h-1.5"/><path d="M5 2.5v1.2"/><path d="M8 2.5v1.2"/></svg>',
  food:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2.5v3.2a1.3 1.3 0 0 0 2.6 0V2.5"/><path d="M4.8 5.7v7.8"/><path d="M11 2.5v11"/><path d="M11 2.5a2.2 2.2 0 0 1 2.2 2.2v2.5H11"/></svg>',
  photo:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h1.8l1-1.5h3.4l1 1.5h1.8A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-6z"/><circle cx="8" cy="8.5" r="2.2"/></svg>',
  seminar:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="7.5" rx="1"/><path d="M5 5.2h6"/><path d="M5 7.2h3.5"/><path d="M8 10v3.5"/><path d="M5.5 13.5h5"/></svg>',
  academy:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="8 2.5, 14.5 5.5, 8 8.5, 1.5 5.5"/><path d="M4.5 7.2v3.3c0 1.2 1.6 2.5 3.5 2.5s3.5-1.3 3.5-2.5V7.2"/><path d="M13.5 6.2v4.5"/></svg>',
  gallery:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="5.8" cy="5.8" r="1.1" fill="currentColor"/><path d="M3.2 12l3.4-3.8 2.2 2.4 1.8-1.8 2.4 3.2"/></svg>',
  book:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.2v8.8"/><path d="M8 4.2c-1.8-1.2-4.2-1.2-6 0v8.4c1.8-.9 4.2-.9 6 0"/><path d="M8 4.2c1.8-1.2 4.2-1.2 6 0v8.4c-1.8-.9-4.2-.9-6 0"/></svg>',
  spot:'<svg class="cat-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2v12"/><path d="M3.5 3h8l-2 3 2 3h-8"/></svg>'
};
const CATEGORY_MAP={
  cafe:{label:'카페',icon:CATEGORY_ICONS.cafe},
  food:{label:'식당',icon:CATEGORY_ICONS.food},
  photo:{label:'포토스팟',icon:CATEGORY_ICONS.photo},
  seminar:{label:'세미나실',icon:CATEGORY_ICONS.seminar},
  academy:{label:'교육·학원',icon:CATEGORY_ICONS.academy},
  gallery:{label:'전시·갤러리',icon:CATEGORY_ICONS.gallery},
  book:{label:'서점·도서관',icon:CATEGORY_ICONS.book},
  spot:{label:'참고장소',icon:CATEGORY_ICONS.spot}
};
function inferCategory(text){
  const t=String(text||'').toLowerCase();
  if(/카페|커피|디저트|베이커리|cafe|coffee|tea|bakery/.test(t))return 'cafe';
  if(/식당|음식점|맛집|밥|요리|레스토랑|pub|bar|food|restaurant/.test(t))return 'food';
  if(/사진|포토|전망|야경|뷰|스냅|풍경|view|photo/.test(t))return 'photo';
  if(/세미나|회의|스터디|워크숍|강의실|미팅|seminar|meeting/.test(t))return 'seminar';
  if(/학원|아카데미|교육|학교|강습|수업|클래스|체험|academy|school|class/.test(t))return 'academy';
  if(/갤러리|전시|미술관|박물관|아트|gallery|museum|exhibit|art/.test(t))return 'gallery';
  if(/서점|책방|도서관|북카페|문고|book|library|bookstore/.test(t))return 'book';
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
function setupLabelDrag(labelEl, leaderEl, pinEl, getInitial, onSave, onEdit){
  if(typeof pinEl === 'function'){
    onEdit = onSave;
    onSave = getInitial;
    getInitial = pinEl;
    pinEl = null;
  }
  if(!pinEl){
    pinEl = labelEl?.parentElement?.querySelector('.geo-pin') || null;
  }
  let startX=0, startY=0, initX=0, initY=0, isDragging=false, currentX=0, currentY=0, wasDragged=false, editTriggered=false;

  const restoreMapDraggable=()=>{
    if(map)map.setOptions({draggable:mode!=='draw'});
  };

  if(pinEl && typeof pinEl.addEventListener === 'function'){
    pinEl.addEventListener('pointerdown', e=>e.stopPropagation());
    pinEl.addEventListener('mousedown', e=>e.stopPropagation());
    pinEl.addEventListener('touchstart', e=>e.stopPropagation(), {passive:true});
    pinEl.addEventListener('click', e=>{
      e.stopPropagation();
      onEdit?.();
    });
  }

  // Prevent map gestures/panning from triggering on label interaction
  labelEl.addEventListener('mousedown', e=>{
    e.stopPropagation();
  });
  labelEl.addEventListener('touchstart', e=>{
    e.stopPropagation();
  }, {passive:false});
  labelEl.addEventListener('touchmove', e=>{
    if(isDragging){
      e.stopPropagation();
      e.preventDefault();
    }
  }, {passive:false});

  labelEl.addEventListener('pointerdown', e=>{
    if(e.button!==0)return;
    if(mode.startsWith('visit')||mode.startsWith('marker'))return;
    e.stopPropagation();
    startX=e.clientX;
    startY=e.clientY;
    const init=getInitial();
    initX=init.x;
    initY=init.y;
    currentX=initX;
    currentY=initY;
    isDragging=false;
    wasDragged=false;
    editTriggered=false;
    if(map)map.setOptions({draggable:false});
    try{labelEl.setPointerCapture(e.pointerId);}catch{}
  });

  labelEl.addEventListener('pointermove', e=>{
    if(!labelEl.hasPointerCapture(e.pointerId))return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    if(!isDragging&&Math.hypot(dx,dy)>4){
      isDragging=true;
      wasDragged=true;
      labelEl.classList.add('dragging');
      if(map)map.setOptions({draggable:false});
    }
    if(!isDragging)return;
    e.stopPropagation();
    e.preventDefault();
    currentX=Math.round(Math.max(-400, Math.min(400, initX+dx)));
    currentY=Math.round(Math.max(-400, Math.min(400, initY+dy)));
    labelEl.style.left=`${currentX}px`;
    labelEl.style.top=`${currentY}px`;
    const dist=Math.hypot(currentX, currentY);
    if(dist>=12){
      if(leaderEl){
        leaderEl.style.display='block';
        leaderEl.querySelectorAll('line').forEach(l=>{
          l.setAttribute('x2',String(currentX));
          l.setAttribute('y2',String(currentY));
        });
        leaderEl.querySelectorAll('.leader-halo-c2, .leader-dot-c2, .halo-c2, .dot-c2').forEach(c=>{
          c.setAttribute('cx',String(currentX));
          c.setAttribute('cy',String(currentY));
        });
      }
      if(pinEl?.style)pinEl.style.display='grid';
      labelEl.classList.add('detached');
    }else{
      if(leaderEl)leaderEl.style.display='none';
      if(pinEl?.style)pinEl.style.display='none';
      labelEl.classList.remove('detached');
    }
  });

  const onEnd=e=>{
    if(!labelEl.hasPointerCapture(e.pointerId))return;
    try{labelEl.releasePointerCapture(e.pointerId);}catch{}
    restoreMapDraggable();
    labelEl.classList.remove('dragging');
    const totalMove = Math.hypot(e.clientX-startX, e.clientY-startY);
    if(isDragging || totalMove > 4){
      isDragging=false;
      setTimeout(()=>{wasDragged=false;},150);
      const dist=Math.hypot(currentX, currentY);
      if(dist<12)onSave(0, 0);
      else onSave(currentX, currentY);
    }else{
      isDragging=false;
      editTriggered=true;
      onEdit?.();
    }
  };

  labelEl.addEventListener('pointerup', onEnd);
  labelEl.addEventListener('pointercancel', onEnd);
  labelEl.addEventListener('lostpointercapture', ()=>{
    restoreMapDraggable();
    labelEl.classList.remove('dragging');
    isDragging=false;
  });

  labelEl.addEventListener('click', e=>{
    e.stopPropagation();
    if(wasDragged||editTriggered)return;
    onEdit?.();
  });
}

function renderVisits(){
  $('visits-empty').hidden=Boolean((course.visits||[]).length);
  $('visits').innerHTML=(course.visits||[]).map((v,i)=>{
    const hasOffset = v.labelOffsetX !== undefined || v.labelOffsetY !== undefined || v.labelOffset !== undefined;
    return `<li class="visit-card"><span class="visit-number">${String(i+1).padStart(2,'0')}</span><div class="visit-card-content"><h3>${esc(v.name)}</h3><span class="tag">체류 ${v.stay}분</span>${v.memo?`<p>${esc(v.memo)}</p>`:''}<div class="visit-actions"><button data-edit="${i}">수정</button><button data-locate="${i}">지도에서 보기</button><button data-reposition="${i}">위치 변경</button>${hasOffset?`<button data-reset-visit-label="${i}" class="text-button">라벨 초기화</button>`:''}${v.link?`<a href="${esc(v.link)}" target="_blank" rel="noopener noreferrer">상세정보 ↗</a>`:''}</div></div></li>`;
  }).join('');
  $('visits').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editVisit(Number(b.dataset.edit)));
  $('visits').querySelectorAll('[data-locate]').forEach(b=>b.onclick=()=>{focus(course.visits[Number(b.dataset.locate)]);$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('visits').querySelectorAll('[data-reposition]').forEach(b=>b.onclick=()=>{if(!mapReady)return toast('지도 연결 후 위치를 변경할 수 있습니다.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');mode=`visit-move:${b.dataset.reposition}`;renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('visits').querySelectorAll('[data-reset-visit-label]').forEach(b=>b.onclick=()=>{
    const idx=Number(b.dataset.resetVisitLabel);
    mutate(c=>{delete c.visits[idx].labelOffsetX;delete c.visits[idx].labelOffsetY;delete c.visits[idx].labelOffset;});
    toast('방문 라벨 위치를 기본 위치로 초기화했습니다.');
  });
}
function renderMarkers(){
  const markers=course.markers||[];
  $('markers-empty').hidden=Boolean(markers.length);
  $('markers').innerHTML=markers.map((m,i)=>{
    const cat=CATEGORY_MAP[m.category]||{label:m.category||'참고장소',icon:CATEGORY_ICONS.spot};
    const hasOffset = m.labelOffsetX !== undefined || m.labelOffsetY !== undefined || m.labelOffset !== undefined;
    const isEditingThis = markerEditing?.index === i;
    const mColor = m.color || '#E32219';
    return `<li class="marker-card ${esc(m.category||'spot')}${isEditingThis?' selected':''}"><div class="marker-card-header"><span class="marker-badge" style="border-left:3px solid ${esc(mColor)};"><span class="marker-color-dot" style="background:${esc(mColor)};"></span>${cat.icon} ${esc(cat.label)}</span><strong class="marker-title">${esc(m.name)}</strong></div>${m.address?`<p class="marker-address muted small">${esc(m.address)}</p>`:''}<div class="marker-actions"><button data-marker-edit="${i}">수정</button><button data-marker-locate="${i}">지도에서 보기</button><button data-marker-reposition="${i}">위치 변경</button>${hasOffset?`<button data-reset-marker-label="${i}" class="text-button">라벨 초기화</button>`:''}<button data-marker-delete="${i}" class="danger">삭제</button>${m.naverLink?`<a href="${esc(m.naverLink)}" target="_blank" rel="noopener noreferrer">검색 출처 ↗</a>`:''}</div></li>`;
  }).join('');
  $('markers').querySelectorAll('[data-marker-edit]').forEach(b=>b.onclick=()=>editMarker(Number(b.dataset.markerEdit)));
  $('markers').querySelectorAll('[data-marker-locate]').forEach(b=>b.onclick=()=>{focus((course.markers||[])[Number(b.dataset.markerLocate)]);$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('markers').querySelectorAll('[data-marker-reposition]').forEach(b=>b.onclick=()=>{if(!mapReady)return toast('지도 연결 후 위치를 변경할 수 있습니다.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');mode=`marker-move:${b.dataset.markerReposition}`;renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});});
  $('markers').querySelectorAll('[data-reset-marker-label]').forEach(b=>b.onclick=()=>{
    const idx=Number(b.dataset.resetMarkerLabel);
    mutate(c=>{delete (c.markers=c.markers||[])[idx].labelOffsetX;delete c.markers[idx].labelOffsetY;delete c.markers[idx].labelOffset;});
    toast('마커 라벨 위치를 기본 위치로 초기화했습니다.');
  });
  $('markers').querySelectorAll('[data-marker-delete]').forEach(b=>b.onclick=()=>removeMarker(Number(b.dataset.markerDelete)));
}
function removeMarker(i){
  if(confirm('이 참고 마커를 삭제할까요? 실행 취소로 복구할 수 있습니다.')){
    mutate(c=>{c.markers=c.markers||[];c.markers.splice(i,1);});
  }
}
function renderPoints(){
  $('points').innerHTML=course.points.map((p,i)=>`<div class="point-row${selected===i?' selected':''}"><button data-select="${i}">${i===0?'<b class="endpoint-bold start">● 출발</b>':i===course.points.length-1?'<b class="endpoint-bold end">◉ 도착</b>':`○ 편집점 ${i+1}`}</button>${selected===i?`<div class="point-coords"><label>위도<input data-lat type="number" step="0.0000001" value="${p.lat}" min="-90" max="90"></label><label>경도<input data-lng type="number" step="0.0000001" value="${p.lng}" min="-180" max="180"></label><button data-apply="${i}">이동</button><button data-delete="${i}" class="danger">삭제</button></div>`:''}</div>`).join('');
  $('points').querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.select);focus(course.points[selected]);renderPoints();renderMap();renderSelection();});
  $('points').querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>{const p=b.parentElement,lat=Number(p.querySelector('[data-lat]').value),lng=Number(p.querySelector('[data-lng]').value);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return toast('유효한 위도·경도를 입력해 주세요.');mutate(c=>c.points[Number(b.dataset.apply)]={lat,lng});});
  $('points').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removePoint(Number(b.dataset.delete)));
}
function selectTab(tab){currentTab=tab;for(const t of ['visits','markers','route']){$(`tab-${t}`).setAttribute('aria-selected',String(tab===t));$(`${t}-panel`).hidden=tab!==t;}}
function renderSelection(){
  $('selection').hidden=selected<0||selected>=course.points.length;
  if(!$('selection').hidden){
    $('selection-label').textContent=mode==='draw'?`편집점 ${selected+1} · 끌어서 이동`:`편집점 ${selected+1} (경로 편집 모드에서 끌어 이동)`;
  }
}
function renderMode(){
  const isRouteEditing=mode==='draw';
  $('pan').classList.toggle('active',mode==='pan');
  $('pan').setAttribute('aria-pressed',String(mode==='pan'));
  $('draw').classList.toggle('active',isRouteEditing);
  $('draw').setAttribute('aria-pressed',String(isRouteEditing));
  $('draw').hidden=Boolean(drawing);
  $('draw').textContent=course.points.length>0?'⌁ 경로 편집':'⌁ 그리기 시작';
  $('finish').hidden=!drawing;
  $('cancel').hidden=!(drawing||mode.startsWith('visit')||mode.startsWith('marker'));
  $('mode-hint').textContent=isRouteEditing?'경로 편집 모드 · 지도를 클릭해 점 추가 · 점을 끌어 이동하거나 ＋로 중간 삽입':mode.startsWith('visit')?'방문 위치 선택 · 지도에서 원하는 위치를 클릭하세요':mode.startsWith('marker')?'참고 마커 위치 선택 · 지도에서 원하는 위치를 클릭하세요':'지도 이동 모드 · 지도를 움직여 코스를 둘러보세요 (경로 수정: ‘경로 편집’ 선택)';
  if($('route-mode-banner')){
    $('route-mode-banner').classList.toggle('editing',isRouteEditing);
    $('route-edit-btn').textContent=isRouteEditing?'✓ 편집 완료':'⌁ 경로 편집 시작';
    $('route-mode-desc').textContent=isRouteEditing?'지도 클릭: 점 추가 · 점 끌기: 이동 · ＋: 중간 삽입':'편집 모드에서 점 끌기 및 ＋ 중간 삽입이 가능합니다.';
  }
  if($('toggle-summary')){
    const summaryVisible=course.points.length>0&&(course.showSummary!==false);
    $('toggle-summary').classList.toggle('active',summaryVisible);
    $('toggle-summary').setAttribute('aria-pressed',String(summaryVisible));
    $('toggle-summary').title=summaryVisible?'경로 요약 창 닫기':'경로 요약 창 열기';
  }
  for(const id of ['course-name','region','tags','speed','duplicate','visit-add','marker-add'])$(id).disabled=Boolean(drawing);
  if(map)map.setOptions({disableDoubleClickZoom:isRouteEditing,draggable:mode!=='draw'});status();
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
  const isRouteEditing=mode==='draw';

  if(course.points.length>1){
    overlays.push(new N.Polyline({map,path:course.points.map(pos),strokeColor:'#E32219',strokeWeight:4,strokeOpacity:.9,clickable:false}));
  }

  // Feature 2: Direction arrows along segments (White arrow with red outline and tail)
  const arrows = routeArrows(course.points, selected);
  arrows.forEach(arr=>{
    const strokeWidth = arr.active ? '2.2' : '1.6';
    const arrowContent=`<div class="route-arrow ${arr.active?'active selected':''}" style="transform: rotate(${Math.round(arr.angle)}deg);" aria-label="진행 방향 (${arr.index}번 → ${arr.index+1}번)" title="진행 방향 (${arr.index}번 → ${arr.index+1}번)"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M 2.5 6.5 L 9.5 6.5 L 9.5 3 L 16 9 L 9.5 15 L 9.5 11.5 L 2.5 11.5 Z" fill="#FFFFFF" stroke="#E32219" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/></svg></div>`;
    const arrowMarker=new N.Marker({map,position:pos(arr.position),zIndex:80,clickable:false,icon:{content:arrowContent,anchor:new N.Point(9,9)}});
    overlays.push(arrowMarker);
  });

  course.points.forEach((p,i)=>{
    const endpoint=i===0||i===course.points.length-1;
    const content=endpoint
      ?`<div class="endpoint-marker ${i?'end':''} ${isRouteEditing?'draggable':''}" title="${i?'도착점':'출발점'}${isRouteEditing?' (끌어서 이동)':''}"><strong>${i?'도착':'출발'}</strong></div>`
      :`<div class="route-marker ${selected===i?'selected':''} ${isRouteEditing?'draggable':''}" title="편집점 ${i+1}${isRouteEditing?' (끌어서 이동)':''}"></div>`;
    const marker=new N.Marker({map,position:pos(p),draggable:isRouteEditing,zIndex:endpoint?120:100,icon:{content,anchor:new N.Point(endpoint ? 25 : 8, endpoint ? 15 : 8)}});
    overlays.push(marker);
    N.Event.addListener(marker,'click',()=>{
      if(pickVisitPosition(p)||pickMarkerPosition(p))return;
      selected=i;
      selectTab('route');
      renderPoints();
      renderSelection();
      renderMap();
    });
    if(isRouteEditing){
      N.Event.addListener(marker,'dragend',()=>{
        const ll=marker.getPosition();
        mutate(c=>c.points[i]={lat:ll.lat(),lng:ll.lng()});
      });
    }

    // Feature 1: Intermediate + controls ONLY active and shown during route edit mode
    if(isRouteEditing&&i>0){
      const a=course.points[i-1], b=p;
      const mid={lat:(a.lat+b.lat)/2,lng:(a.lng+b.lng)/2};
      const m=new N.Marker({map,position:pos(mid),zIndex:90,icon:{content:'<div class="insert-marker" title="중간 점 삽입">+</div>',anchor:new N.Point(9,9)}});
      overlays.push(m);
      N.Event.addListener(m,'click',()=>{if(pickVisitPosition(mid))return;selected=i;mutate(c=>c.points.splice(i,0,mid));selectTab('route');renderSelection();});
    }
  });

  // Feature 3: Visits with detachable pin-to-label connectors
  (course.visits||[]).forEach((v,i)=>{
    const isDetached=v.labelOffsetX!==undefined||v.labelOffsetY!==undefined||v.labelOffset!==undefined;
    const lx=v.labelOffsetX!==undefined?v.labelOffsetX:(v.labelOffset?.x??0);
    const ly=v.labelOffsetY!==undefined?v.labelOffsetY:(v.labelOffset?.y??-30);
    const width=Math.min(260, 85 + v.name.length * 14);

    const content=`<div class="marker-wrap" style="position:relative;width:0;height:0;"><div class="geo-pin visit-pin" title="${esc(v.name)} · ${v.stay}분"><span>${i+1}</span></div><svg class="pin-leader" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:5;${isDetached?'':'display:none;'};--leader-color:#E32219;"><line class="leader-halo" x1="0" y1="0" x2="${lx}" y2="${ly}"/><line class="leader-dash" x1="0" y1="0" x2="${lx}" y2="${ly}"/><circle class="leader-halo-c1" cx="0" cy="0" r="4.5"/><circle class="leader-dot-c1" cx="0" cy="0" r="2.8"/><circle class="leader-halo-c2" cx="${lx}" cy="${ly}" r="4"/><circle class="leader-dot-c2" cx="${lx}" cy="${ly}" r="2.4"/></svg><div class="visit-map detachable-label ${isDetached?'detached':''}" style="position:absolute;left:${lx}px;top:${ly}px;width:${width}px;" title="${esc(v.name)} · ${v.stay}분 (라벨을 끌어서 분리)"><b>${i+1}</b><span>${esc(v.name)}</span><em>${v.stay}분</em></div></div>`;

    const marker=new N.Marker({map,position:pos(v),zIndex:200+i,icon:{content,anchor:new N.Point(0,0)}});
    overlays.push(marker);

    const el=marker.getElement?marker.getElement():marker.el;
    if(el){
      const pinEl=el.querySelector('.geo-pin');
      const labelEl=el.querySelector('.detachable-label');
      const leaderEl=el.querySelector('.pin-leader');
      if(labelEl&&leaderEl){
        setupLabelDrag(labelEl,leaderEl,pinEl,()=>({
          x:lx,
          y:ly
        }),(newX,newY)=>{
          mutate(c=>{
            if(newX===undefined){delete c.visits[i].labelOffsetX;delete c.visits[i].labelOffsetY;delete c.visits[i].labelOffset;}
            else{c.visits[i].labelOffsetX=newX;c.visits[i].labelOffsetY=newY;delete c.visits[i].labelOffset;}
          });
          toast(newX===undefined?'방문 라벨이 기본 위치로 연결되었습니다.':'방문 라벨 위치를 이동했습니다.');
        },()=>editVisit(i));
      }
    }
    N.Event.addListener(marker,'click',()=>editVisit(i));
  });

  // Feature 3: Reference markers with detachable pin-to-label connectors and customizable color
  (course.markers||[]).forEach((m,i)=>{
    const cat=CATEGORY_MAP[m.category]||{label:m.category||'참고장소',icon:CATEGORY_ICONS.spot};
    const isDetached=m.labelOffsetX!==undefined||m.labelOffsetY!==undefined||m.labelOffset!==undefined;
    const lx=m.labelOffsetX!==undefined?m.labelOffsetX:(m.labelOffset?.x??0);
    const ly=m.labelOffsetY!==undefined?m.labelOffsetY:(m.labelOffset?.y??-26);
    const isEditingThis=markerEditing?.index===i;
    const markerColor=m.color||'#E32219';

    const content=`<div class="marker-wrap" style="position:relative;width:0;height:0;"><div class="geo-pin marker-pin ${esc(m.category||'spot')}${isEditingThis?' selected':''}" style="background:${markerColor};border-color:${markerColor};" title="${esc(m.name)} · ${esc(cat.label)}"><span>${cat.icon}</span></div><svg class="pin-leader" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:5;${isDetached?'':'display:none;'};--leader-color:${markerColor};"><line class="leader-halo" x1="0" y1="0" x2="${lx}" y2="${ly}"/><line class="leader-dash" x1="0" y1="0" x2="${lx}" y2="${ly}"/><circle class="leader-halo-c1" cx="0" cy="0" r="4.5"/><circle class="leader-dot-c1" cx="0" cy="0" r="2.8"/><circle class="leader-halo-c2" cx="${lx}" cy="${ly}" r="4"/><circle class="leader-dot-c2" cx="${lx}" cy="${ly}" r="2.4"/></svg><div class="course-ref-marker detachable-label ${isDetached?'detached':''} ${esc(m.category||'spot')}${isEditingThis?' selected':''}" style="position:absolute;left:${lx}px;top:${ly}px;--ref-border-color:${markerColor};" title="${esc(m.name)} · ${esc(cat.label)} (라벨을 끌어서 분리)"><span class="ref-icon">${cat.icon}</span><span class="ref-name">${esc(m.name)}</span></div></div>`;

    const marker=new N.Marker({map,position:pos(m),zIndex:150+i,icon:{content,anchor:new N.Point(0,0)}});
    overlays.push(marker);

    const el=marker.getElement?marker.getElement():marker.el;
    if(el){
      const pinEl=el.querySelector('.geo-pin');
      const labelEl=el.querySelector('.detachable-label');
      const leaderEl=el.querySelector('.pin-leader');
      if(labelEl&&leaderEl){
        setupLabelDrag(labelEl,leaderEl,pinEl,()=>({
          x:lx,
          y:ly
        }),(newX,newY)=>{
          mutate(c=>{
            c.markers=c.markers||[];
            if(newX===undefined){delete c.markers[i].labelOffsetX;delete c.markers[i].labelOffsetY;delete c.markers[i].labelOffset;}
            else{c.markers[i].labelOffsetX=newX;c.markers[i].labelOffsetY=newY;delete c.markers[i].labelOffset;}
          });
          toast(newX===undefined?'마커 라벨이 기본 위치로 연결되었습니다.':'마커 라벨 위치를 이동했습니다.');
        },()=>{
          if(pickMarkerPosition(m)||pickVisitPosition(m))return;
          selectTab('markers');
          editMarker(i);
        });
      }
    }
    N.Event.addListener(marker,'click',()=>{
      if(pickMarkerPosition(m)||pickVisitPosition(m))return;
      selectTab('markers');
      editMarker(i);
    });
  });

  // Feature 4: Movable Route Summary Window on destination point (can be closed and reopened)
  if(course.points.length>=1 && course.showSummary !== false){
    const dest=course.points[course.points.length-1];
    const t=timings(course);
    const destDetached=course.summaryLabelOffsetX!==undefined||course.summaryLabelOffsetY!==undefined;
    const slx=course.summaryLabelOffsetX!==undefined?course.summaryLabelOffsetX:40;
    const sly=course.summaryLabelOffsetY!==undefined?course.summaryLabelOffsetY:-75;

    // Leader line SVG is in its own marker at zIndex: 95 so it stays BEHIND the arrival endpoint marker (zIndex: 120)
    const leaderContent=`<div class="marker-wrap" style="position:relative;width:0;height:0;"><svg class="pin-leader dest-leader" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;${destDetached?'':'display:none;'};--leader-color:#E32219;"><line class="leader-halo" x1="0" y1="0" x2="${slx}" y2="${sly}"/><line class="leader-dash" x1="0" y1="0" x2="${slx}" y2="${sly}"/><circle class="leader-halo-c1" cx="0" cy="0" r="4.5"/><circle class="leader-dot-c1" cx="0" cy="0" r="2.8"/><circle class="leader-halo-c2" cx="${slx}" cy="${sly}" r="4"/><circle class="leader-dot-c2" cx="${slx}" cy="${sly}" r="2.4"/></svg></div>`;
    const summaryLeaderMarker=new N.Marker({map,position:pos(dest),zIndex:95,clickable:false,icon:{content:leaderContent,anchor:new N.Point(0,0)}});
    overlays.push(summaryLeaderMarker);

    // Route Summary Card window at zIndex: 350
    const cardContent=`<div class="marker-wrap" style="position:relative;width:0;height:0;"><div class="dest-summary-card detachable-label ${destDetached?'detached':''}" style="position:absolute;left:${slx}px;top:${sly}px;" title="경로 요약 창 (드래그하여 위치 이동)"><div class="dest-summary-header"><span class="dest-badge">🏁 경로 요약</span><div class="dest-header-actions"><span class="dest-drag-handle" title="드래그하여 이동">⋮⋮</span><button type="button" class="dest-summary-close" aria-label="경로 요약 닫기" title="경로 요약 닫기">✕</button></div></div><div class="dest-summary-grid"><div class="dest-metric-item"><span class="dest-metric-label">총거리</span><strong class="dest-metric-val">${(t.meters/1000).toFixed(2)}km</strong></div><div class="dest-metric-item"><span class="dest-metric-label">보행시간</span><strong class="dest-metric-val">${Math.ceil(t.walk)}분</strong></div><div class="dest-metric-item"><span class="dest-metric-label">방문체류</span><strong class="dest-metric-val">${Math.ceil(t.stay)}분</strong></div><div class="dest-metric-item total"><span class="dest-metric-label">전체예상</span><strong class="dest-metric-val">${Math.ceil(t.total)}분</strong></div></div></div></div>`;
    const summaryCardMarker=new N.Marker({map,position:pos(dest),zIndex:350,icon:{content:cardContent,anchor:new N.Point(0,0)}});
    overlays.push(summaryCardMarker);

    const sLeaderEl=(summaryLeaderMarker.getElement?summaryLeaderMarker.getElement():summaryLeaderMarker.el)?.querySelector('.dest-leader');
    const sCardEl=(summaryCardMarker.getElement?summaryCardMarker.getElement():summaryCardMarker.el)?.querySelector('.dest-summary-card');

    if(sCardEl&&sLeaderEl){
      const closeBtn=sCardEl.querySelector('.dest-summary-close');
      if(closeBtn){
        const stopProp=e=>e.stopPropagation();
        closeBtn.addEventListener('mousedown',stopProp);
        closeBtn.addEventListener('pointerdown',stopProp);
        closeBtn.addEventListener('click',e=>{
          e.stopPropagation();
          mutate(c=>{c.showSummary=false;});
          renderMode();
          toast('경로 요약 창을 닫았습니다. 상단 [🏁 요약] 버튼으로 다시 열 수 있습니다.');
        });
      }

      setupLabelDrag(sCardEl,sLeaderEl,null,()=>({
        x:slx,
        y:sly
      }),(newX,newY)=>{
        mutate(c=>{
          if(newX===undefined){
            delete c.summaryLabelOffsetX;
            delete c.summaryLabelOffsetY;
          }else{
            c.summaryLabelOffsetX=newX;
            c.summaryLabelOffsetY=newY;
          }
        });
        toast(newX===undefined?'경로 요약 창 위치를 기본 위치로 복원했습니다.':'경로 요약 창 위치를 이동했습니다.');
      },()=>{
        toast('경로 요약: 드래그하여 지도의 원하는 위치로 이동할 수 있습니다.');
      });
    }
  }

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
  const s=document.createElement('script');s.src='https://oapi.map.naver.com/openapi/v3/maps.js?'+new URLSearchParams({ncpKeyId:mapsClientId,submodules:'geocoder'});s.onload=loaded;s.onerror=()=>fail('지도 로딩 실패 · 네트워크 연결 또는 지도 서비스 호출 한도와 Dynamic Map 설정을 확인해 주세요.');document.head.append(s);
  setTimeout(()=>{if(!map&&!mapFailed)fail('지도 응답이 지연됩니다. 네트워크 연결과 Maps 허용 URL을 확인한 뒤 새로고침해 주세요.');},20000);
}
function editVisit(index,position){
  if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
  if($('visit-dialog')?.open)return;
  visitsEditing={index,position};const v=index>=0?course.visits[index]:{name:'',stay:15,memo:'',link:''};const f=$('visit-form');
  for(const key of ['name','stay','memo','link'])f.elements[key].value=v[key];f.elements.order.value=index>=0?index+1:course.visits.length+1;f.elements.order.max=course.visits.length+(index<0?1:0);$('visit-remove').hidden=index<0;$('visit-dialog-title').textContent=index<0?'새로운 방문 장소':'방문 장소 수정';
  if($('visit-label-offset-field'))$('visit-label-offset-field').hidden=!(v.labelOffsetX!==undefined&&v.labelOffsetY!==undefined);
  $('visit-dialog').showModal();
}
$('visit-label-reset').onclick=()=>{
  if(visitsEditing&&visitsEditing.index>=0){
    mutate(c=>{
      delete c.visits[visitsEditing.index].labelOffsetX;
      delete c.visits[visitsEditing.index].labelOffsetY;
      delete c.visits[visitsEditing.index].labelOffset;
    });
    toast('방문 라벨 위치를 기본 위치로 초기화했습니다.');
  }
  if($('visit-label-offset-field'))$('visit-label-offset-field').hidden=true;
};
$('visit-form').onsubmit=e=>{
  e.preventDefault();const form=e.target,index=visitsEditing.index,order=Number(form.elements.order.value)-1;
  const existingV=index>=0?course.visits[index]:null;
  const v={...(index>=0?course.visits[index]:{...visitsEditing.position,id:crypto.randomUUID(),source:'user'}),name:form.elements.name.value.trim(),stay:Number(form.elements.stay.value),memo:form.elements.memo.value,link:form.elements.link.value.trim()};
  if(existingV&&existingV.labelOffsetX!==undefined&&!$('visit-label-offset-field').hidden){
    v.labelOffsetX=existingV.labelOffsetX;
    v.labelOffsetY=existingV.labelOffsetY;
  }else{
    delete v.labelOffsetX;
    delete v.labelOffsetY;
    delete v.labelOffset;
  }
  try{const next=clone(course);if(index>=0)next.visits.splice(index,1);next.visits.splice(order,0,v);validateCourse(next);commit(next);$('visit-dialog').close();}catch(e){toast(e.message);}
};
$('visit-remove').onclick=()=>{if(confirm('이 방문 장소를 삭제할까요? 실행 취소로 복구할 수 있습니다.')){mutate(c=>c.visits.splice(visitsEditing.index,1));$('visit-dialog').close();}};
$('visit-close').onclick=()=>{if(confirm('장소 편집을 닫을까요? 적용하지 않은 입력은 저장되지 않습니다.'))$('visit-dialog').close();};
$('visit-dialog').addEventListener('cancel',e=>{e.preventDefault();$('visit-close').click();});
$('visit-add').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(!mapReady)return toast('지도 연결 후 위치를 선택해 주세요.');if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');if(course.visits.length>=100)return toast('방문 장소는 최대 100개입니다.');mode='visit';renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});};
function updateMarkerCategoryIndicator(cat){
  const el=$('marker-category-icon');
  if(!el)return;
  const currentCat=cat||$('marker-category-select')?.value||'cafe';
  el.innerHTML=CATEGORY_ICONS[currentCat]||CATEGORY_ICONS.spot;
  el.className=`category-icon-indicator ${currentCat}`;
}
function updateMarkerColorIndicator(col){
  const selectedColor=(col||$('marker-color-input')?.value||'#E32219').toLowerCase();
  if($('marker-color-input'))$('marker-color-input').value=selectedColor;
  if($('marker-color-custom'))$('marker-color-custom').value=selectedColor.length===7?selectedColor:'#E32219';
  document.querySelectorAll('#marker-color-swatches .color-swatch-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.color.toLowerCase()===selectedColor);
  });
}
function editMarker(index,position){
  if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
  if($('marker-dialog')?.open)return;
  markerEditing={index,position};const m=index>=0?(course.markers||[])[index]:{name:'',category:'cafe',address:'',naverLink:'',color:'#E32219'};const f=$('marker-form');
  for(const key of ['name','category','address'])f.elements[key].value=m[key]||'';f.elements.naverLink.value=m.naverLink||'';
  updateMarkerCategoryIndicator(f.elements.category.value);
  updateMarkerColorIndicator(m.color||'#E32219');
  $('marker-remove').hidden=index<0;$('marker-dialog-title').textContent=index<0?'새로운 참고 마커':'참고 마커 수정';
  if($('marker-label-offset-field'))$('marker-label-offset-field').hidden=!(m.labelOffsetX!==undefined&&m.labelOffsetY!==undefined);
  renderMap();
  $('marker-dialog').showModal();
}
if($('marker-category-select'))$('marker-category-select').onchange=()=>updateMarkerCategoryIndicator();
if($('marker-color-swatches')){
  $('marker-color-swatches').querySelectorAll('.color-swatch-btn').forEach(btn=>{
    btn.onclick=()=>updateMarkerColorIndicator(btn.dataset.color);
  });
}
if($('marker-color-custom')){
  $('marker-color-custom').oninput=e=>updateMarkerColorIndicator(e.target.value);
}
$('marker-label-reset').onclick=()=>{
  if(markerEditing&&markerEditing.index>=0){
    mutate(c=>{
      delete (c.markers=c.markers||[])[markerEditing.index].labelOffsetX;
      delete c.markers[markerEditing.index].labelOffsetY;
      delete c.markers[markerEditing.index].labelOffset;
    });
    toast('마커 라벨 위치를 기본 위치로 초기화했습니다.');
  }
  if($('marker-label-offset-field'))$('marker-label-offset-field').hidden=true;
};
$('marker-form').onsubmit=e=>{
  e.preventDefault();const form=e.target,index=markerEditing.index;
  const link=form.elements.naverLink.value.trim();
  const color=form.elements.color?.value||'#E32219';
  const existingM=index>=0?(course.markers||[])[index]:null;
  const m={
    ...(index>=0?course.markers[index]:{...markerEditing.position,id:crypto.randomUUID()}),
    name:form.elements.name.value.trim(),
    category:form.elements.category.value,
    color,
    address:form.elements.address.value.trim()
  };
  if(link)m.naverLink=link;else delete m.naverLink;
  if(existingM&&existingM.labelOffsetX!==undefined&&!$('marker-label-offset-field').hidden){
    m.labelOffsetX=existingM.labelOffsetX;
    m.labelOffsetY=existingM.labelOffsetY;
  }else{
    delete m.labelOffsetX;
    delete m.labelOffsetY;
    delete m.labelOffset;
  }
  try{
    const next=clone(course);next.markers=next.markers||[];
    if(index>=0)next.markers[index]=m;else next.markers.push(m);
    validateCourse(next);commit(next);markerEditing=null;$('marker-dialog').close();
  }catch(e){toast(e.message);}
};
$('marker-remove').onclick=()=>{removeMarker(markerEditing.index);markerEditing=null;$('marker-dialog').close();};
$('marker-close').onclick=()=>{if(confirm('마커 편집을 닫을까요? 적용하지 않은 입력은 저장되지 않습니다.')){markerEditing=null;$('marker-dialog').close();renderMap();}};
$('marker-dialog').addEventListener('close',()=>{if(markerEditing){markerEditing=null;renderMap();}});
$('marker-dialog').addEventListener('cancel',e=>{e.preventDefault();$('marker-close').click();});
$('marker-add').onclick=()=>{
  if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');
  if(!mapReady)return toast('지도 연결 후 위치를 선택해 주세요.');
  if(drawing)return toast('경로 그리기를 먼저 완료해 주세요.');
  if((course.markers||[]).length>=100)return toast('참고 마커는 최대 100개입니다.');
  mode='marker';renderMode();$('map').scrollIntoView({behavior:'smooth',block:'center'});
};
$('pan').onclick=()=>{if(drawing)return toast('진행 중인 그리기를 완료하거나 취소해 주세요.');mode='pan';renderMode();renderMap();};
$('draw').onclick=()=>{if(pendingDraft)return toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');if(!mapReady)return toast('지도가 연결된 뒤 경로를 그릴 수 있습니다.');drawing={course:clone(course),past:clone(history.past),future:clone(history.future)};mode='draw';selected=-1;selectTab('route');renderMode();renderMap();$('finish')?.focus();};
$('finish').onclick=()=>{drawing=null;mode='pan';renderMode();renderMap();persistDraft();$('draw')?.focus();};
$('cancel').onclick=()=>{if(drawing){course=drawing.course;history.current=clone(course);history.past=drawing.past;history.future=drawing.future;drawing=null;renderAll();persistDraft();}mode='pan';renderMode();renderMap();$('draw')?.focus();};
$('undo').onclick=()=>{course=history.undo();selected=-1;renderAll();persistDraft();};$('redo').onclick=()=>{course=history.redo();selected=-1;renderAll();persistDraft();};
$('fit').onclick=fit;
if($('toggle-summary'))$('toggle-summary').onclick=()=>{
  if(!course.points.length)return toast('경로에 점이 추가된 후 경로 요약을 볼 수 있습니다.');
  const nextState=course.showSummary===false;
  mutate(c=>{c.showSummary=nextState;});
  renderMode();
  toast(nextState?'경로 요약 창을 열었습니다.':'경로 요약 창을 닫았습니다.');
};
$('selection-delete').onclick=()=>removePoint(selected);$('selection-close').onclick=()=>{selected=-1;renderSelection();renderPoints();};
for(const t of ['visits','markers','route'])$(`tab-${t}`).onclick=()=>selectTab(t);
for(const [id,key]of [['course-name','name'],['region','region'],['tags','tags']])$(id).addEventListener('input',e=>{const next=clone(course);next[key]=key==='tags'?e.target.value.split(',').map(s=>s.trim()).filter(Boolean):e.target.value;commit(next,false);});
$('speed').oninput=e=>{const n=Number(e.target.value);if(n>=.5&&n<=10){const next=clone(course);next.speed=n;commit(next,false);}};
$('speed').onchange=()=>{if(!$('speed').checkValidity()){toast('보행속도는 0.5–10 km/h로 입력해 주세요.');$('speed').value=course.speed;}};
function renderAll(){renderFields();renderVisits();renderMarkers();renderPoints();metrics();status();renderMap();renderSelection();}
function canLeave(){if(pendingDraft){toast('이전 임시저장을 먼저 복원하거나 버려 주세요.');return false;}if(saving){toast('저장 중입니다. 잠시 기다려 주세요.');return false;}if(drawing){toast('그리기를 완료하거나 취소해 주세요.');return false;}return !dirty()||confirm('저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동할까요?');}
function loadCourse(c){course=clone(c);course.markers=course.markers||[];baseVersion=c.version;savedSignature=signature(course);history.reset(course);selected=-1;mode='pan';drawing=null;pendingDraft=null;$('draft-banner').hidden=true;if(c.labelScale)setLabelScale(c.labelScale);renderAll();renderMode();persistDraft();fit();}
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
function geocodeAddress(query, centerCoord){
  return new Promise(resolve=>{
    if(!window.naver?.maps?.Service?.geocode){resolve([]);return;}
    const timer=setTimeout(()=>resolve([]),4000);
    const N=window.naver.maps;
    const params={query};
    if(centerCoord)params.coordinate=new N.LatLng(centerCoord.lat,centerCoord.lng);
    try{
      N.Service.geocode(params,(status,response)=>{
        clearTimeout(timer);
        if((status!==200&&status!=='OK')||!response?.v2?.addresses?.length){resolve([]);return;}
        const list=response.v2.addresses.map(addr=>{
          const lat=Number(addr.y),lng=Number(addr.x);
          if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
          const road=addr.roadAddress||'', jibun=addr.jibunAddress||'';
          const title=road||jibun||query;
          const address=(jibun&&jibun!==title)?jibun:road;
          return {
            title,
            address:address||title,
            lat,
            lng,
            category:'주소',
            isAddress:true,
            source:'naver-address'
          };
        }).filter(Boolean);
        resolve(list);
      });
    }catch{clearTimeout(timer);resolve([]);}
  });
}

function reverseGeocodeRegion(centerCoord){
  return new Promise(resolve=>{
    if(!window.naver?.maps?.Service?.reverseGeocode||!centerCoord){resolve(null);return;}
    const timer=setTimeout(()=>resolve(null),3000);
    const N=window.naver.maps;
    try{
      N.Service.reverseGeocode({coords:new N.LatLng(centerCoord.lat,centerCoord.lng)},(status,response)=>{
        clearTimeout(timer);
        if((status!==200&&status!=='OK')||!response?.v2?.results?.length){resolve(null);return;}
        const r=response.v2.results[0]?.region;
        if(!r){resolve(null);return;}
        const sido=r.area1?.name||'';
        const sigugun=r.area2?.name||'';
        const dong=r.area3?.name||'';
        resolve({sido,sigugun,dong,name:[sigugun,dong].filter(Boolean).join(' ')||sigugun||sido});
      });
    }catch{clearTimeout(timer);resolve(null);}
  });
}

$('search-form').onsubmit=async e=>{
  e.preventDefault();const q=$('search-query').value.trim();if(!q)return;$('search-button').disabled=true;$('search-state').hidden=false;$('search-state').textContent='현재 지도 위치를 기준으로 검색하는 중…';$('search-results').replaceChildren();
  const center=mapReady&&map?{lat:map.getCenter().lat(),lng:map.getCenter().lng()}:null;
  let searchTimeoutTimer;
  const searchTimeoutPromise=new Promise((_,reject)=>{
    searchTimeoutTimer=setTimeout(()=>reject(new Error('검색 요청 시간이 초과되었습니다.')),8000);
  });
  try{
    await Promise.race([
      (async()=>{
        const [addrResults, centerRegion]=await Promise.all([
          geocodeAddress(q, center),
          reverseGeocodeRegion(center)
        ]);

        const queries=[q];
        const regionName=centerRegion?.name||course.region;
        if(regionName&&!q.includes(regionName)&&(!centerRegion?.sido||!q.includes(centerRegion.sido))){
          queries.unshift(`${regionName} ${q}`);
        }

        const placeResults=[];
        const errors=[];
        for(const searchQ of queries){
          try{
            const res=await searchPlaces(searchQ);
            if(Array.isArray(res)){
              for(const item of res){
                if(!placeResults.some(p=>Math.abs(p.lat-item.lat)<0.0002&&Math.abs(p.lng-item.lng)<0.0002)){
                  placeResults.push(item);
                }
              }
            }
          }catch(err){errors.push(err);}
          if(placeResults.length>=3&&searchQ!==q)break;
        }

        const combined=[];
        for(const a of addrResults)combined.push(a);
        for(const p of placeResults){
          if(!combined.some(c=>Math.abs(c.lat-p.lat)<0.0002&&Math.abs(c.lng-p.lng)<0.0002)){
            combined.push(p);
          }
        }

        if(!combined.length&&errors.length&&!addrResults.length){
          throw errors[0];
        }

        if(center){
          combined.forEach(item=>{
            const d=distance([center,item]);
            item.distMeters=d;
            item.distText=d<1000?`${Math.round(d)}m`:`${(d/1000).toFixed(1)}km`;
          });
          combined.sort((a,b)=>(a.distMeters??Infinity)-(b.distMeters??Infinity));
        }

        if(!combined.length){
          $('search-state').textContent='검색 결과가 없습니다. 도로명/지번 주소 또는 장소명을 확인해 주세요.';
          return;
        }

        $('search-state').textContent=`검색 결과 ${combined.length}건 · 현재 지도 위치에서 가까운 순서로 정렬되었습니다.`;
        combined.forEach(p=>{
          const row=document.createElement('div');row.className='search-item result';
          const badgeClass=p.isAddress?'address':'place';
          const badgeLabel=p.isAddress?'주소':(p.category||'장소');
          const distHtml=p.distText?`<span class="search-item-dist">${esc(p.distText)}</span>`:'';

          row.innerHTML=`
            <div class="search-item-info" role="button" tabindex="0" title="지도 위치로 이동">
              <div class="search-item-title-row">
                <span class="search-item-badge ${badgeClass}">${esc(badgeLabel)}</span>
                <strong>${esc(p.title)}</strong>
                ${distHtml}
              </div>
              <small>${esc(p.address)}</small>
            </div>
            <div class="search-item-actions">
              <button type="button" class="search-pan-btn" title="지도 위치로 이동">이동</button>
              <button type="button" class="search-save-btn primary" title="현재 코스에 참고 마커로 저장">마커로 저장</button>
            </div>
          `;

          const pan=()=>{
            if(!mapReady)return toast('지도 연결을 먼저 확인해 주세요.');
            focus(p);
            map.setZoom(17);
            toast(`“${p.title}” 위치로 이동했습니다.`);
          };
          row.querySelector('.search-item-info').onclick=pan;
          row.querySelector('.search-pan-btn').onclick=pan;
          row.querySelector('.search-save-btn').onclick=e=>{
            e.stopPropagation();
            if(!mapReady)return toast('지도 연결을 먼저 확인해 주세요.');
            saveSearchAsMarker(p);
          };
          row.onclick=e=>{if(!e.target.closest('button'))pan();};
          $('search-results').append(row);
        });
      })(),
      searchTimeoutPromise
    ]);
  }catch(e){$('search-state').textContent=e.message||'검색 중 오류가 발생했습니다.';}finally{clearTimeout(searchTimeoutTimer);$('search-button').disabled=false;}
};

// Label font size batch adjustment control
const LABEL_SCALES=[0.8, 0.9, 1.0, 1.15, 1.3, 1.5];
let currentScale=Number(localStorage.getItem('walkmap_label_scale'))||1.0;
function setLabelScale(scale, saveToCourse=false){
  currentScale=Math.min(2.0,Math.max(0.7,Number(scale)||1.0));
  document.documentElement.style.setProperty('--map-label-scale',String(currentScale));
  if($('label-size-val'))$('label-size-val').textContent=`${Math.round(currentScale*100)}%`;
  try{localStorage.setItem('walkmap_label_scale',String(currentScale));}catch{}
  if(saveToCourse&&course){
    mutate(c=>{c.labelScale=currentScale;});
  }
}
if($('label-size-dec'))$('label-size-dec').onclick=()=>{
  const idx=LABEL_SCALES.findIndex(s=>s>=currentScale-0.02);
  const prev=idx>0?LABEL_SCALES[idx-1]:LABEL_SCALES[0];
  setLabelScale(prev,true);
  toast(`라벨 크기: ${Math.round(prev*100)}%`);
};
if($('label-size-inc'))$('label-size-inc').onclick=()=>{
  const idx=LABEL_SCALES.findIndex(s=>s>currentScale+0.02);
  const next=idx>=0?LABEL_SCALES[idx]:LABEL_SCALES[LABEL_SCALES.length-1];
  setLabelScale(next,true);
  toast(`라벨 크기: ${Math.round(next*100)}%`);
};
if($('label-size-reset'))$('label-size-reset').onclick=()=>{
  setLabelScale(1.0,true);
  toast('라벨 크기를 100%로 초기화했습니다.');
};
setLabelScale(currentScale);
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
if($('route-edit-btn')){$('route-edit-btn').onclick=()=>{if(mode==='draw')$('finish').click();else $('draw').click();};}
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(mode==='draw'){e.preventDefault();$('finish').click();}
    else if(mode.startsWith('visit')||mode.startsWith('marker')){e.preventDefault();mode='pan';renderMode();toast('위치 선택을 취소했습니다.');}
  }
  if(e.key==='Enter'&&mode==='draw'&&!['INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName)){
    e.preventDefault();$('finish').click();
  }
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(user&&!saving)$('save').click();}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();if(user&&!saving)$(e.shiftKey?'redo':'undo').click();}
});

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
