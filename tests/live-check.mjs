// Read-only live SDK/API diagnostics. No TLS exceptions, credential output or tile downloads.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.WALKMAP_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.WALKMAP_CHROME?{executablePath:process.env.WALKMAP_CHROME}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),responses=[],failures=[];
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3000';
page.on('response',r=>{const u=new URL(r.url());if(u.hostname==='oapi.map.naver.com')responses.push({host:u.hostname,path:u.pathname,status:r.status()});});
page.on('requestfailed',r=>{const u=new URL(r.url());failures.push({host:u.hostname,error:r.failure().errorText});});
try{
 mkdirSync('docs/screenshots',{recursive:true});await page.goto(origin);await page.screenshot({path:'docs/screenshots/login.png',fullPage:true});
 const password=process.env.WALKMAP_TEST_PASSWORD||readFileSync('data/initial-login.txt','utf8').match(/비밀번호: (.+)/)[1];
 await page.locator('[name=username]').fill(process.env.WALKMAP_TEST_USERNAME||'walkmap');await page.locator('[name=password]').fill(password);await page.getByRole('button',{name:'로그인 →',exact:true}).click();await page.locator('#app').waitFor({state:'visible'});
 await page.waitForTimeout(16000);
 const tiles=await page.locator('#map img').evaluateAll(images=>images.filter(i=>i.naturalWidth>100&&i.naturalHeight>100).length);
 const report={date:new Date().toISOString(),origin,responses,failures,mapBackgroundImageCount:tiles,mapMessage:await page.locator('#map-status').textContent(),mapMessageVisible:await page.locator('#map-status').isVisible(),tlsBypass:false};
 await page.screenshot({path:'docs/screenshots/live-map-status.png',fullPage:true});writeFileSync('docs/live-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
