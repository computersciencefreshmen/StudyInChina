const dir = 'quality/recovery-20261019/rapid-expansion/scholarships/central';
const url = 'https://www.chinese.cn/page/#/pcpage/project_detail';
const allowed = new Set(['www.chinese.cn', 'pmplatform.chinese.cn']);
(async()=>{
 const fs = await import('node:fs');
 const crypto = await import('node:crypto');
 const { chromium } = await import('@playwright/test');
 const sha = b => crypto.createHash('sha256').update(b).digest('hex');
 const browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:7897'}});
 const context=await browser.newContext({userAgent:'StudyInChina-Official-Verification/1.0'});
 await context.route('**/*',route=>{const r=route.request();const u=new URL(r.url());return u.protocol==='https:'&&allowed.has(u.hostname)&&['GET','HEAD'].includes(r.method())?route.continue():route.abort();});
 const page=await context.newPage();let result;
 try {
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('body').waitFor({state:'visible',timeout:10000});
  await page.getByText('国际中文教师奖学金',{exact:false}).first().waitFor({state:'visible',timeout:30000});
  const html=await page.content();const text=await page.locator('body').innerText();const anchors=await page.locator('a').evaluateAll(as=>as.map(a=>({text:a.textContent,hrefLiteral:a.getAttribute('href'),resolvedUrl:a.href})));
  fs.writeFileSync(dir+'/central-scholarship-entry.dom.html',html,{flag:'wx'});fs.writeFileSync(dir+'/central-scholarship-entry.dom.txt',text,{flag:'wx'});await page.screenshot({path:dir+'/central-scholarship-entry.png',fullPage:true});
  result={requestedUrl:url,url:page.url(),httpStatus:response.status(),retrievedAt:new Date().toISOString(),rawDomPath:dir+'/central-scholarship-entry.dom.html',rawDomSha256:sha(html),textPath:dir+'/central-scholarship-entry.dom.txt',textSha256:sha(text),anchors,method:'anonymous browser GET-only official hosts; no form input, authentication, POST, cookies or headers persisted'};
 } catch(e) {result={requestedUrl:url,outcome:'held',error:String(e.message).split('\n')[0],at:new Date().toISOString()};}
 finally {await context.close();await browser.close();}
 fs.writeFileSync(dir+'/central-scholarship-entry.dom-receipt.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({outcome:result.outcome??'captured',httpStatus:result.httpStatus,anchors:result.anchors?.length,error:result.error}));
})().catch(()=>{console.error('bounded_public_browser_capture_failed');process.exitCode=1});
