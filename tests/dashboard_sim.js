'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const dir=path.resolve(__dirname,'../openwrt/luci-app-mu300/htdocs/luci-static/resources');
const store=new Map(), session={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
let called=[];
const common=new Function('rpc','baseclass','L','document','navigator','sessionStorage',fs.readFileSync(dir+'/mu300/common.js','utf8'))(
    {declare:o=>(...args)=>{called.push([o.method,args]); return Promise.resolve({});}},
    {extend:o=>o},{env:{lang:'en'}},{},{},session);
assert.equal(common.selectedSlot(),'0');
common.selectViewedSlot(1); assert.equal(common.selectedSlot(),'1');
assert.equal(common.selectViewedSlot(2),false); assert.equal(common.selectedSlot(),'1');
common.callAt('AT'); common.selectViewedSlot(0);
assert.deepEqual(called[0],['at',['AT','1']]);

function element(tag) {return {tag,children:[],style:{},isConnected:true,append(...n){this.children.push(...n);}};}
function find(root,tag){return root.tag===tag?root:root.children.map(n=>find(n,tag)).find(Boolean);}
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
(async()=>{
    for(const outcome of ['cancel','error','done']) {
        common.selectViewedSlot('0'); let requests=0;
        const M={injectCss(){},localizeMenu(){},translate:s=>s,selectViewedSlot:common.selectViewedSlot,
            confirmBox:()=>Promise.resolve(outcome!=='cancel'),busy:(b,v)=>b.busy=v,toast:()=>({close(){}})};
        const rpc={declare:o=>()=>{
            if(o.method==='data_sim_set'){requests++;return Promise.resolve({ok:1,id:'abcdefghij'});}
            if(o.method==='data_sim_status')return Promise.resolve({id:'abcdefghij',state:outcome,ok:outcome==='done',error:'rejected'});
            return Promise.resolve({ok:1,saved_sim:1,actual_sim:1,data_connected:false});
        }};
        const view=new Function('view','rpc','poll','M','document',fs.readFileSync(dir+'/view/mu300/sim.js','utf8'))(
            {extend:o=>o},rpc,{add(){},remove(){}},M,{createElement:element});
        const root=view.render([{slots:2},{ok:1,ready:true,saved_sim:0,actual_sim:0}]);
        find(root,'select').value='1';find(root,'button').onclick();await tick();
        assert.equal(common.selectedSlot(),outcome==='done'?'1':'0',outcome);
        assert.equal(requests,outcome==='cancel'?0:1);
        assert(!view.busy && !find(root,'button').busy,outcome+' left loading active');
        view.unload();
    }
    console.log('SIM UI: success follows selected data SIM; failure/cancel stay put; scoped RPC captures slot');
})().catch(e=>{console.error(e);process.exitCode=1;});
