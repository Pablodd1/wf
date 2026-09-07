'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {CdpBrowserSession}=require('../../tests/staging-browser-smoke.test.cjs');

async function main(){
 const url=new URL(process.env.VERCEL_PREVIEW_URL);
 assert.match(url.hostname,/^wf-astra-disposable-20260906-[a-z0-9]+-pablos-projects-0f79dff2\.vercel\.app$/);
 const state=JSON.parse(fs.readFileSync(process.env.VERCEL_PREVIEW_BROWSER_STATE_FILE,'utf8'));
 assert.ok(state.cookies.length);assert.ok(state.cookies.every(cookie=>cookie.domain===url.hostname));
 const account=JSON.parse(fs.readFileSync(process.env.DISPOSABLE_ACCOUNT_FILE,'utf8'));assert.equal(account.synthetic_only,true);
 assert.match(account.email,/^wf-disposable-.*@example\.invalid$/);
 const browser=new CdpBrowserSession();
 const report={status:'RUNNING',recorded_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,host:url.hostname,checks:[]};
 const output=path.dirname(process.env.DISPOSABLE_REPORT_PATH);
 const evaluate=async(expression)=>{
  const response=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(response.exceptionDetails)throw new Error('Browser workflow evaluation failed');
  return response.result.value;
 };
 const open=async(route)=>{
  await browser.navigate('about:blank');await browser.waitForState('location.href === "about:blank"');
  await browser.navigate(url.origin+'/#'+route);await browser.waitForSelector('#root');
 };
 const fill=async(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 try{
  await browser.launch();await browser.send('Network.setCookies',{cookies:state.cookies});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await open('/dealer/account/settings');
  await browser.waitForState('document.body.innerText.includes("Sign in to access your dealer account.")');
  assert.equal(await evaluate('Boolean(document.querySelector("select[name=display_currency]"))'),false);
  await open('/dealer');await browser.waitForSelector('input[type=password]');
  await browser.waitForState('document.querySelector("button[type=submit]")?.disabled === false');
  await fill('input[type=email]',account.email);await fill('input[type=password]',account.password);
  await evaluate('document.querySelector("input[type=password]").form.requestSubmit()');
  await browser.waitForState('location.hash.includes("/dealer/workspace")',30000);
  await open('/dealer/account/settings');await browser.waitForSelector('select[name=display_currency]',30000);
  const originalCurrency=await evaluate('document.querySelector("select[name=display_currency]").value');
  const changedCurrency=originalCurrency==='HKD'?'USD':'HKD';
  await evaluate(`document.querySelector("select[name=display_currency]").value=${JSON.stringify(changedCurrency)};document.querySelector("select[name=display_currency]").form.requestSubmit()`);
  await browser.waitForState('document.querySelector("[role=status]")?.textContent === "Changes saved."',30000);
  await open('/dealer/account/settings');await browser.waitForSelector('select[name=display_currency]',30000);
  assert.equal(await evaluate('document.querySelector("select[name=display_currency]").value'),changedCurrency);
  await evaluate(`document.querySelector("select[name=display_currency]").value=${JSON.stringify(originalCurrency)};document.querySelector("select[name=display_currency]").form.requestSubmit()`);
  await browser.waitForState('document.querySelector("[role=status]")?.textContent === "Changes saved."',30000);
  fs.writeFileSync(path.join(output,'browser-account-settings.png'),Buffer.from(await browser.captureScreenshot(),'base64'));
  await open('/dealer/account/listings');await browser.waitForState('document.body.textContent.includes("Published") && document.body.textContent.includes("Not available")',30000);
  report.checks.push('Real browser login and settings save survive a full document reload; original preference restored; unknown activity years stay unavailable');
  await open('/reference-check/'+account.dealer_id);
  await browser.waitForState('document.querySelector("h1")?.textContent.includes("RC50-BROWSER-SYNTHETIC") === true',30000);
  await browser.waitForState('document.body.innerText.includes("1 verified linked posts")',30000);
  assert.equal(await evaluate('document.body.textContent.includes("Published linked listings")'),true);
  fs.writeFileSync(path.join(output,'browser-dealer-profile-desktop.png'),Buffer.from(await browser.captureScreenshot(),'base64'));
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await open('/reference-check/'+account.dealer_id);
  await browser.waitForState('document.body.innerText.includes("1 verified linked posts")',30000);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  fs.writeFileSync(path.join(output,'browser-dealer-profile-mobile.png'),Buffer.from(await browser.captureScreenshot(),'base64'));
  report.checks.push('Approved dealer profile displays exact published activity on desktop and mobile without horizontal overflow');
  assert.equal(await evaluate('fetch("/api/dealer-auth",{method:"DELETE"}).then(response=>response.status)'),200);
  await open('/dealer/account/settings');await browser.waitForState('document.body.innerText.includes("Sign in to access your dealer account.")');
  assert.equal(await evaluate('Boolean(document.querySelector("select[name=display_currency]"))'),false);
  report.checks.push('Browser logout removes account access and hides the settings form');
  report.expected_unauthenticated_requests=browser.networkErrors.filter(item=>item.status===401&&item.url.endsWith('/api/dealer-workspace')).length;
  const unexpected=browser.networkErrors.filter(item=>!(item.status===401&&item.url.endsWith('/api/dealer-workspace')));
  assert.equal(unexpected.length,0,'No unexpected failed network request in the account browser flow');
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message};process.exitCode=1;}
 finally{browser.close();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('DISPOSABLE_BROWSER_ACCOUNT_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
