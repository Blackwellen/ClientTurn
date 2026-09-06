import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.PLAYWRIGHT_MODULE;
if(!modulePath)throw new Error('Set PLAYWRIGHT_MODULE to installed playwright index.mjs');
const {chromium}=await import(pathToFileURL(modulePath).href);
const qa=readFileSync('QA.local.md','utf8');
const email=qa.match(/Email:\s*`([^`]+)`/)?.[1];const password=qa.match(/Password:\s*`([^`]+)`/)?.[1];
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const origin=process.env.QA_ORIGIN||'http://localhost:3100';
try{
 await page.goto(`${origin}/login`);
 await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill(password);
 await page.getByRole('button',{name:/sign in/i}).click();await page.waitForURL(/\/(app|onboarding)/,{timeout:30000});
 mkdirSync('.qa-artifacts',{recursive:true});
 for(const route of ['agents','agents/new','inbox','settings?section=connections']){
  await page.goto(`${origin}/app/${route}`);await page.waitForLoadState('networkidle');
  const text=await page.locator('main').innerText();
  if(/Application error|could not be loaded/i.test(text))throw new Error(`Surface error: ${route}`);
  await page.screenshot({path:`.qa-artifacts/${route.replaceAll(/[^a-z]/g,'-')}.png`,fullPage:true});
  console.log(`Desktop render: ${route}`);
 }
 await page.getByRole('button',{name:'Open ClientTurn support'}).click();
 await page.getByRole('button',{name:'Help',exact:true}).click();
 await page.getByRole('textbox',{name:'Search help articles'}).fill('agent');
 await page.getByRole('button',{name:'Create your first sourcing agent'}).click();
 await page.getByRole('heading',{name:'Create your first sourcing agent'}).waitFor();
 await page.screenshot({path:'.qa-artifacts/support.png'});
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/app/agents`);await page.waitForLoadState('networkidle');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Mobile overflow');
 await page.screenshot({path:'.qa-artifacts/agents-mobile.png',fullPage:true});
 console.log('Support search and mobile layout passed');if(errors.length)throw new Error(errors.join('\n'));
}catch(e){console.log('QA failure route:',new URL(page.url()).pathname);console.log('Browser errors:',errors);console.log((await page.locator('body').innerText()).slice(0,1200));await page.screenshot({path:'.qa-artifacts/failure.png'});throw e;}finally{await browser.close();}
