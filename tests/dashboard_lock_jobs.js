'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '../openwrt/luci-app-mu300');
const common = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/mu300/common.js'), 'utf8');
let lang = 'zh', now = 0, serial = 0, calls = 0, response;
const timers = new Map();
const set = (fn, ms) => { let id=++serial; timers.set(id,{fn,at:now+ms}); return id; };
const clear = id => timers.delete(id);
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
async function advance(ms) {
    const end = now+ms;
    for (;;) {
        const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next) break;
        now=next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now=end; await flush();
}
const M = new Function('rpc','baseclass','L','document','navigator','setTimeout','clearTimeout', common)(
    {declare:o=>o.method==='lock_status' ? id=>{ calls++; return response(id); } : ()=>{}},
    {extend:x=>x}, {env:{get lang(){return lang;}}}, {}, {}, set, clear);
const start = {ok:1,id:'abcdefghij'};
async function main() {
    // No wall-clock comparisons: even a huge client/device date difference is irrelevant.
    const oldDate = Date.now;
    Date.now = () => { throw Error('wall clock used'); };
    let resolveRequest, completed = false;
    response = () => new Promise(r=>{resolveRequest=r;});
    const pending = M.waitLockJob(start).then(()=>{completed=true;});
    await advance(5000); assert.equal(calls,1); assert.equal(completed,false);
    resolveRequest({...start,state:'running',ok:0}); await flush();
    await advance(1000); assert.equal(calls,2);
    resolveRequest({...start,state:'done'}); await pending;
    assert.equal(completed,true); assert.equal(timers.size,0);
    for (const result of [null, {...start,state:'error',error:'模组拒绝了设置'},
        {...start,state:'done',ok:0}, {...start,id:'different',state:'done'}, {...start,state:'unknown'}]) {
        response = async()=>result;
        await assert.rejects(M.waitLockJob(start)); assert.equal(timers.size,0);
    }
    response = async()=>{throw Error('offline');};
    await assert.rejects(M.waitLockJob(start), /无法查询操作结果/);
    response = async()=>({...start,state:'queued',ok:0});
    let error;
    M.waitLockJob(start).catch(e=>{error=e;});
    await advance(241000); assert.match(error.message,/应用超时/); assert.equal(timers.size,0);
    let active=true;
    M.waitLockJob(start,()=>active).catch(e=>{error=e;}); await flush(); active=false;
    let before=calls; await advance(1000); assert.equal(calls,before); assert.equal(timers.size,0);
    Date.now = oldDate;
    // All newly emitted backend error messages are translated in both locales.
    let messages = ['已应用并核对模组状态','等待模组能力数据','正在确认设置结果…'];
    for (const file of ['lock-apply.sh','lock-jobs.sh']) {
        const src=fs.readFileSync(path.join(root,'root/usr/libexec/unisoc-modem',file),'utf8');
        messages.push(...[...src.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)]
            .map(m=>m[1]).filter(s=>!s.includes('{')));
    }
    const locks = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/view/mu300/locks.js'), 'utf8');
    messages.push('清除全部蜂窝锁定', '清除当前 SIM 全部锁定', '清除 SIM %s 的全部锁定？', '确认清除',
        '查看卡槽已改变，请重新确认操作', '当前 SIM 的全部锁定已清除，已核对并清理保存配置',
        '正在后台应用 清除当前 SIM 全部锁定 …（SFUN 重启 + 重新驻网，约半分钟）');
    messages.push(...[...locks.matchAll(/(?:<div class="mud-note">|message: ')([^<'\n]*清除[^<'\n]*)/g)].map(m=>m[1]));
    for (lang of ['en','tr']) for (const text of messages)
        assert(!/[\u3400-\u9fff]/.test(M.translate(text)),lang+': '+text);
    // Execute the actual page handlers with a minimal DOM: don't clear a
    // modem in a browser test, but do check confirmation, SIM scope and busy.
    let selected=1, confirm, modal, requests=[], finishJob, failJob, notes=[];
    const elements=new Map();
    const pageRoot={isConnected:true, querySelectorAll:()=>[], querySelector:selector=>{
        if(!elements.has(selector)) elements.set(selector, {
            classList:{toggle:()=>{}}, addEventListener:()=>{}, querySelectorAll:()=>[], children:[]
        });
        return elements.get(selector);
    }};
    const fakeM={selectedSlot:()=>selected, translate:M.translate, esc:s=>s,
        confirmBox:(title,message,options)=>{
            modal={title,message,options}; return new Promise(r=>{confirm=r;});
        }, busy:(button,on)=>{button.busy=on;},
        callLockSet:(kind,val)=>{requests.push({kind,val,slot:selected}); return Promise.resolve({...start,kind});},
        waitLockJob:()=>new Promise((resolve,reject)=>{finishJob=resolve;failJob=reject;})};
    const page = new Function('view','R','M','L',locks)(
        {extend:x=>x},{poll:()=>()=>{}},fakeM,{resolveDefault:x=>Promise.resolve(x)});
    page.refresh=()=>Promise.resolve();
    page.note=(text,type)=>notes.push({text,type});
    page.wire(pageRoot);
    const reset=elements.get('#mud-lock-reset');
    lang='en'; reset.onclick();
    assert.equal(modal.title,'Clear all locks for SIM 2?');
    assert.equal(modal.options.danger,true);
    assert.equal(modal.options.okText,'确认清除');
    confirm(false); await flush(); assert.equal(requests.length,0);
    reset.onclick(); selected=0; confirm(true); await flush();
    assert.equal(requests.length,0); assert.match(notes.at(-1).text,/查看卡槽已改变/);
    selected=1; reset.onclick(); confirm(true); await flush();
    assert.deepEqual(requests,[{kind:'reset',val:'auto',slot:1}]);
    assert.equal(reset.busy,true); assert.equal(page._applying,true);
    reset.onclick(); confirm(true); await flush(); assert.equal(requests.length,1);
    finishJob({...start,kind:'reset'}); await flush();
    assert.equal(reset.busy,false); assert.equal(page._applying,false);
    assert.equal(notes.at(-1).type,'success'); assert.match(notes.at(-1).text,/全部锁定已清除/);
    reset.onclick(); confirm(true); await flush();
    failJob(Error('readback mismatch')); await flush();
    assert.equal(reset.busy,false); assert.equal(page._applying,false);
    assert.equal(notes.at(-1).type,'error'); assert.match(notes.at(-1).text,/readback mismatch/);
    reset.onclick(); page._disposed=true; confirm(true); await flush();
    assert.equal(requests.length,2);
    console.log('Lock jobs: verified completion, failures, clock skew, single-flight, timeout, dispose and i18n OK');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
