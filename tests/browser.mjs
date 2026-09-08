// Optional browser verification: npm install --no-save playwright, or set WALKMAP_PLAYWRIGHT to its module URL.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.WALKMAP_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.WALKMAP_CHROME?{executablePath:process.env.WALKMAP_CHROME}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3000';
const fixture=readFileSync(new URL('./map-fixture.js',import.meta.url),'utf8');
await page.route('https://oapi.map.naver.com/openapi/v3/maps.js*',r=>r.fulfill({contentType:'text/javascript',body:fixture}));
const initial=process.env.WALKMAP_TEST_PASSWORD?null:readFileSync('data/initial-login.txt','utf8');
const password=process.env.WALKMAP_TEST_PASSWORD||initial.match(/비밀번호: (.+)/)[1];
const step=message=>{checks.push(message);console.log('PASS '+message);};
const savedCourses=()=>page.evaluate(async()=>await(await fetch('/api/courses')).json());
async function clickMap(x,y){const box=await page.locator('#map').boundingBox();await page.mouse.click(box.x+x,box.y+y);}
async function save(){const response=page.waitForResponse(r=>r.url().includes('/api/courses/')&&r.request().method()==='PUT');await page.locator('#save').click();const r=await response;assert.equal(r.status(),200);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='서버 저장됨');}
try{
 await page.goto(origin);await page.locator('[name=username]').fill(process.env.WALKMAP_TEST_USERNAME||'walkmap');await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'로그인 →',exact:true}).click();await page.locator('#app').waitFor({state:'visible'});await page.waitForFunction(()=>window.__testMap);
 if(await page.locator('#draft-banner').isVisible())await page.locator('#draft-discard').click();await page.locator('#map-status').waitFor({state:'hidden'});
 let searches=0;page.on('request',r=>{if(r.url().includes('/api/search?'))searches++;});
 await page.locator('#search-query').fill('경복궁');const searchResponse=page.waitForResponse(r=>r.url().includes('/api/search?'));await page.locator('#search-button').click();assert.equal((await searchResponse).status(),200);await page.locator('.result').first().waitFor();const before=await page.evaluate(()=>({lat:__testMap.center.lat(),lng:__testMap.center.lng()}));await page.locator('.result').first().click();const after=await page.evaluate(()=>({lat:__testMap.center.lat(),lng:__testMap.center.lng()}));assert.notDeepEqual(before,after);assert.equal(searches,1);step('실제 API HUB 검색 → 선택 위치 이동 (배경 SDK만 테스트 좌표판)');
 await page.locator('#course-name').fill('서촌 빛과 골목 산책 · 검증 예시');await page.locator('#region').fill('서울 종로구');await page.locator('#tags').fill('포토워크, 골목, 검증용');
 await page.locator('#draw').click();for(const [x,y] of [[200,340],[370,320],[390,440],[620,460]])await clickMap(x,y);await page.locator('#finish').click();assert.equal(await page.locator('.point-row').count(),4);
 const initialDistance=await page.locator('#distance').textContent();
 await page.locator('.insert-marker').nth(1).click();assert.equal(await page.locator('.point-row').count(),5);
 const marker=await page.locator('.route-marker').nth(1).boundingBox();await page.mouse.move(marker.x+8,marker.y+8);await page.mouse.down();await page.mouse.move(marker.x+65,marker.y-65,{steps:8});await page.mouse.up();
 assert.notEqual(await page.locator('#distance').textContent(),initialDistance);const movedDistance=await page.locator('#distance').textContent();
 await page.locator('.route-marker').nth(1).click();await page.locator('#selection-delete').click();assert.equal(await page.locator('.point-row').count(),4);await page.locator('#undo').click();assert.equal(await page.locator('.point-row').count(),5);assert.equal(await page.locator('#distance').textContent(),movedDistance);await page.locator('#redo').click();assert.equal(await page.locator('.point-row').count(),4);await page.locator('#undo').click();
 step('여러 점 작성·중간 삽입·끌기 이동·삭제·실행 취소·다시 실행 및 거리 복원');
 await page.locator('#draw').click();await clickMap(740,480);await page.locator('#cancel').click();assert.equal(await page.locator('.point-row').count(),5);step('그리기 취소 시 이전 경로 복원');
 await page.locator('#tab-visits').click();
 for(const [i,name,stay,x,y] of [[0,'출발 · 골목 입구',10,200,340],[1,'빛과 그림자 촬영',25,395,435],[2,'마지막 프레임',15,620,460]]){
  await page.locator('#visit-add').click();await clickMap(x,y);const f=page.locator('#visit-form');await f.locator('[name=name]').fill(name);await f.locator('[name=stay]').fill(String(stay));await f.locator('[name=memo]').fill(i===1?'빛의 방향을 보며 잠시 머무르기. 직접 작성한 검증 메모.':'직접 작성한 검증용 방문 장소입니다.');if(i===1)await f.locator('[name=link]').fill('https://map.naver.com/');await f.getByRole('button',{name:'적용',exact:true}).click();
 }
 assert.equal(await page.locator('#visit-count').textContent(),'3');assert.match(await page.locator('#stay-time').textContent(),/^50 /);const walk1=await page.locator('#walk-time').textContent();await page.locator('#speed').fill('2');await page.locator('#speed').blur();assert.notEqual(await page.locator('#walk-time').textContent(),walk1);await page.locator('#speed').fill('4');await page.locator('#speed').blur();
 // Reorder and re-open to check data binding.
 await page.locator('[data-edit="2"]').click();await page.locator('#visit-form [name=order]').fill('2');await page.locator('#visit-form').getByRole('button',{name:'적용',exact:true}).click();assert.match(await page.locator('.visit-card').nth(1).textContent(),/마지막 프레임/);
 step('방문 3곳·체류 50분·메모·링크·순서·속도에 따른 전체 시간 갱신');
 await save();let courses=await savedCourses(),original=courses.find(c=>c.name==='서촌 빛과 골목 산책 · 검증 예시');assert.ok(original);const id=original.id;
 await page.reload();await page.locator('#app').waitFor({state:'visible'});await page.locator('#library-open').click();await page.locator('#library-query').fill('골목');await page.locator(`[data-id="${id}"]`).click();await page.locator("#library").waitFor({state:"hidden"});assert.equal(await page.locator('#course-name').inputValue(),original.name);assert.equal(await page.locator('.visit-card').count(),3);assert.deepEqual((await savedCourses()).find(c=>c.id===id),original);
 step('서버 저장 → 새로고침 → 목록 검색·불러오기 및 경로·방문 정보 일치');
 await page.locator('#duplicate').click();await page.locator('#course-name').fill('복사본 · 원본 보존 검증');await page.locator('[data-edit="0"]').click();await page.locator('#visit-form [name=memo]').fill('복사본에만 있는 메모');await page.locator('#visit-form').getByRole('button',{name:'적용',exact:true}).click();await save();courses=await savedCourses();assert.deepEqual(courses.find(c=>c.id===id),original);const copy=courses.find(c=>c.name==='복사본 · 원본 보존 검증');assert.notEqual(copy.id,id);assert.equal(copy.visits[0].memo,'복사본에만 있는 메모');step('복제 후 수정·저장 시 원본 보존');
 // Explicit fixture failures; upstream errors are never represented as live observations.
 for(const [code,message]of [['SEARCH_AUTH','검색 인증 실패: 테스트 오류'],['SEARCH_QUOTA','검색 호출 한도를 초과했습니다.']]){
  await page.route('**/api/search?*',r=>r.fulfill({status:code==='SEARCH_QUOTA'?429:502,contentType:'application/json',body:JSON.stringify({code,message})}));await page.locator('#search-query').fill('검증');await page.locator('#search-button').click();await page.waitForFunction(m=>document.querySelector('#search-state').textContent===m,message);await page.unroute('**/api/search?*');
 }
 await page.route('**/api/search?*',r=>r.fulfill({contentType:'application/json',body:'{"items":[]}'}));await page.locator('#search-button').click();await page.waitForFunction(()=>document.querySelector('#search-state').textContent.includes('검색 결과가 없습니다'));await page.unroute('**/api/search?*');
 await page.locator('#course-name').fill('저장 실패 후 복원할 변경');
 await page.route('**/api/courses/*',r=>r.request().method()==='PUT'?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'SERVER',message:'검증용 저장 실패 · 변경사항 유지'})}):r.continue());await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('검증용 저장 실패'));assert.equal(await page.locator('#course-name').inputValue(),'저장 실패 후 복원할 변경');assert.equal(await page.locator('#save-state').textContent(),'미저장 변경');await page.unroute('**/api/courses/*');
 await page.reload();await page.locator('#draft-restore').waitFor({state:'visible'});await page.locator('#draft-restore').click();assert.equal(await page.locator('#course-name').inputValue(),'저장 실패 후 복원할 변경');assert.equal(await page.locator('.visit-card').count(),3);await save();step('인증 실패·호출 한도·결과 없음·저장 실패 및 새로고침 후 임시저장 복원 (오류 주입)');
 const anonymous=await browser.newContext();const outsider=await anonymous.request.get(origin+'/api/courses');assert.equal(outsider.status(),401);await anonymous.close();step('비로그인 브라우저의 코스 API 접근 차단');
 await page.locator('#library-open').click();await page.locator('#library-query').fill('');await page.locator(`[data-id="${id}"]`).click();await page.locator("#library").waitFor({state:"hidden"});await page.locator('#search-query').fill('');await page.locator('#search-state').evaluate(e=>e.hidden=true);await page.locator('#fit').click();await page.locator('#map-status').waitFor({state:'hidden'});await page.waitForTimeout(300);
 mkdirSync('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/desktop-fixture.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('#fit').click();await page.waitForTimeout(200);assert.ok(await page.locator('#map').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/screenshots/mobile-fixture.png',fullPage:true});await page.locator('#visits').scrollIntoViewIfNeeded();assert.equal(await page.locator('.visit-card').count(),3);step('390px 휴대폰 화면 지도·방문 목록 열람, 가로 넘침 없음');
 assert.deepEqual(errors,[]);step('브라우저 런타임 오류 없음');
 writeFileSync('docs/browser-results.json',JSON.stringify({date:new Date().toISOString(),map:'test-only coordinate canvas; real tile host blocked by Fortinet',search:'live NAVER API HUB',checks,errors},null,2));
}catch(e){mkdirSync('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/browser-failure.png',fullPage:true});throw e;}finally{await browser.close();}
