// Test-only coordinate canvas. Never served by WalkMap. No NAVER imagery or API data.
(() => {
const callbacks=new WeakMap();
const Event={addListener(obj,name,fn){const all=callbacks.get(obj)||{};(all[name]??=[]).push(fn);callbacks.set(obj,all);return fn;},clearInstanceListeners(obj){callbacks.delete(obj);},trigger(obj,name,arg){for(const fn of callbacks.get(obj)?.[name]||[])fn(arg);}};
class LatLng{constructor(lat,lng){this.y=lat;this.x=lng;}lat(){return this.y;}lng(){return this.x;}}
class Point{constructor(x,y){this.x=x;this.y=y;}}
class LatLngBounds{constructor(){this.points=[];}extend(p){this.points.push(p);}}
class Map{
 constructor(id,options){this.el=document.getElementById(id);this.center=options.center;this.zoom=options.zoom;this.options=options;this.markers=[];window.__testMap=this;
 this.el.innerHTML='<div style="position:absolute;left:20px;bottom:8px;color:#476650;font:12px Arial">검증용 좌표판 · 실제 네이버 지도 아님</div>';
 this.el.addEventListener('click',e=>{if(e.target.closest('[data-fixture-marker]'))return;const r=this.el.getBoundingClientRect();Event.trigger(this,'click',{coord:this.fromOffset(e.clientX-r.left,e.clientY-r.top)});});
 Event.addListener(this,'resize',()=>Event.trigger(this,'idle'));
 setTimeout(()=>{Event.trigger(this,'tilesloaded');Event.trigger(this,'idle');},40);
 }
 scale(){return 256*2**this.zoom/360;}
 fromOffset(x,y){return new LatLng(this.center.lat()-(y-this.el.clientHeight/2)/this.scale()/1.25,this.center.lng()+(x-this.el.clientWidth/2)/this.scale());}
 getProjection(){return {fromCoordToOffset:p=>new Point((p.lng()-this.center.lng())*this.scale()+this.el.clientWidth/2,(this.center.lat()-p.lat())*this.scale()*1.25+this.el.clientHeight/2)};}
 getCenter(){return this.center;}panTo(p){this.center=p;Event.trigger(this,'idle');}setZoom(z){this.zoom=z;Event.trigger(this,'idle');}setOptions(o){Object.assign(this.options,o);}
 fitBounds(b){const lats=b.points.map(p=>p.lat()),lngs=b.points.map(p=>p.lng());const south=Math.min(...lats),north=Math.max(...lats),west=Math.min(...lngs),east=Math.max(...lngs);this.center=new LatLng((south+north)/2,(west+east)/2);const scale=Math.min((this.el.clientWidth-140)/Math.max(.0001,east-west),(this.el.clientHeight-260)/Math.max(.0001,(north-south)*1.25));this.zoom=Math.min(18,Math.log2(scale*360/256));Event.trigger(this,'idle');}
}
class Marker{
 constructor(o){this.o=o;this.position=o.position;this.map=o.map;this.el=document.createElement('div');this.el.dataset.fixtureMarker='true';this.el.innerHTML=o.icon.content;this.el.style.cssText=`position:absolute;z-index:${o.zIndex||1};touch-action:none;`;
 if(o.clickable===false){this.el.style.pointerEvents='none';delete this.el.dataset.fixtureMarker;}
 this.el.addEventListener('click',e=>{e.stopPropagation();if(!this.moved)Event.trigger(this,'click');this.moved=false;});
 if(o.draggable){let start=null;this.el.addEventListener('pointerdown',e=>{e.stopPropagation();start={x:e.clientX,y:e.clientY};this.el.setPointerCapture(e.pointerId);this.moved=false;});this.el.addEventListener('pointermove',e=>{if(!start)return;if(Math.abs(e.clientX-start.x)+Math.abs(e.clientY-start.y)<3)return;this.moved=true;const r=this.map.el.getBoundingClientRect();this.position=this.map.fromOffset(e.clientX-r.left,e.clientY-r.top);this.render();});this.el.addEventListener('pointerup',e=>{if(start&&this.moved)Event.trigger(this,'dragend');start=null;});}
 this.map.el.append(this.el);this.render();
 }
 render(){const p=this.map.getProjection().fromCoordToOffset(this.position),a=this.o.icon.anchor;this.el.style.left=p.x-a.x+'px';this.el.style.top=p.y-a.y+'px';}
 getPosition(){return this.position;}setMap(map){if(!map)this.el.remove();}
 getElement(){return this.el;}
}
class Polyline{constructor(o){this.el=document.createElementNS('http://www.w3.org/2000/svg','svg');this.el.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',o.path.map(p=>{const pt=o.map.getProjection().fromCoordToOffset(p);return `${pt.x},${pt.y}`;}).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',o.strokeColor);line.setAttribute('stroke-width',o.strokeWeight);line.setAttribute('stroke-linejoin','round');this.el.append(line);o.map.el.prepend(this.el);}setMap(m){if(!m)this.el.remove();}}
window.naver={maps:{Map,Marker,Polyline,LatLng,LatLngBounds,Point,Event,Position:{RIGHT_CENTER:1}}};
})();
