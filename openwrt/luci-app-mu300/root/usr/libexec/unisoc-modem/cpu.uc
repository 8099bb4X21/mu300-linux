// Standard cpufreq policy controls only; never writes voltage or thermal knobs.
import * as fs from 'fs';
const ROOT=getenv('MU300_CPU_SYS') || '/sys/devices/system/cpu/cpufreq';
const CONFIG=getenv('MU300_CPU_CONFIG') || '/etc/unisoc-modem/cpu.json';
let failed_write=null;
function read(id,key) { return trim(fs.readfile(ROOT+'/'+id+'/'+key) || ''); }
function words(s) { return length(trim(s)) ? split(trim(s), /\s+/) : []; }
function number(id,key) { let v=read(id,key); return match(v,/^[0-9]+$/)?int(v):null; }
function policies() {
    let out=[];
    for(let id in sort(fs.lsdir(ROOT) || [])) {
        if(!match(id,/^policy[0-9]+$/)) continue;
        let p={id,cpus:read(id,'affected_cpus'),driver:read(id,'scaling_driver'),
            governors:words(read(id,'scaling_available_governors')),governor:read(id,'scaling_governor'),
            min:number(id,'scaling_min_freq'),max:number(id,'scaling_max_freq'),
            hardware_min:number(id,'cpuinfo_min_freq'),hardware_max:number(id,'cpuinfo_max_freq'),
            current:number(id,'scaling_cur_freq'),frequencies:map(words(read(id,'scaling_available_frequencies')),v=>int(v))};
        p.writable=!!length(p.governors) && p.min!=null && p.max!=null && p.hardware_min!=null && p.hardware_max!=null;
        push(out,p);
    }
    return out;
}
function saved() {
    try { return json(fs.readfile(CONFIG) || 'null'); } catch(e) { return null; }
}
function write(id,key,value) {
    let s=''+value;
    if(read(id,key)==s) return true;
    let written=fs.writefile(ROOT+'/'+id+'/'+key,s+'\n'), actual=read(id,key);
    // cpufreq QoS queues policy work; successful sysfs write is acceptance,
    // not completion. Confirm the queued update without reissuing the write.
    // Only explicit setting changes use this bounded, sleeping confirmation.
    for(let n=0; written==length(s)+1 && actual!=s && n<10; n++) {
        sleep(10); actual=read(id,key);
    }
    let ok=written==length(s)+1 && actual==s;
    if(!ok && !failed_write) failed_write={policy:id,field:key,requested:s,actual,written};
    return ok;
}
function set(p,c) {
    // Raise max before min, or lower min before max, to avoid transient EINVAL.
    if(c.min>number(p.id,'scaling_max_freq')) {
        if(!write(p.id,'scaling_max_freq',c.max) || !write(p.id,'scaling_min_freq',c.min)) return false;
    } else {
        if(!write(p.id,'scaling_min_freq',c.min) || !write(p.id,'scaling_max_freq',c.max)) return false;
    }
    return write(p.id,'scaling_governor',c.governor);
}
function apply(input) {
    let current=policies(), byid={}, seen={};
    for(let p in current) byid[p.id]=p;
    if(type(input)!='object' || type(input.persist)!='bool' || type(input.changes)!='array' || !length(input.changes) || length(input.changes)>32)
        return {ok:0,error:'CPU 配置无效'};
    for(let c in input.changes) {
        let p=byid[c?.id];
        if(!p?.writable || seen[c.id] || c.cpus!=p.cpus || type(c.min)!='int' || type(c.max)!='int' ||
           c.min>c.max || c.min<p.hardware_min || c.max>p.hardware_max || index(p.governors,c.governor)<0 ||
           (length(p.frequencies) && (index(p.frequencies,c.min)<0 || index(p.frequencies,c.max)<0)))
            return {ok:0,error:'CPU 配置无效'};
        seen[c.id]=true;
    }
    let changed=[], error=null, rollback=true;
    for(let c in input.changes) {
        let p=byid[c.id]; push(changed,p);
        if(!set(p,c)) { error='CPU 配置回读不一致'; break; }
    }
    if(!error && input.persist) {
        let text=sprintf('%J\n',{version:1,persist:true,changes:input.changes}), tmp=CONFIG+'.new';
        if(fs.writefile(tmp,text)!=length(text) || !fs.chmod(tmp,384) || !fs.rename(tmp,CONFIG)) {
            fs.unlink(tmp); error='无法保存 CPU 设置';
        }
    } else if(!error && !input.persist && fs.stat(CONFIG) && !fs.unlink(CONFIG)) error='无法保存 CPU 设置';
    if(error) {
        for(let p in reverse(changed)) if(!set(p,p)) rollback=false;
        return {ok:0,error,rollback,failed_write};
    }
    return {ok:1,policies:policies(),persist:input.persist};
}
let action=ARGV[0] || 'get', result;
try {
    if(action=='get') result={ok:1,policies:policies(),persist:saved()?.persist===true};
    else if(action=='forget') result=(!fs.stat(CONFIG) || fs.unlink(CONFIG)) ? {ok:1,persist:false} : {ok:0,error:'无法保存 CPU 设置'};
    else if(action=='boot') {
        let config=saved();
        result=!fs.stat(CONFIG)?{ok:1,skipped:true}:config?.version==1?apply(config):{ok:0,error:'CPU 配置无效'};
    } else if(action=='apply') {
        let text=fs.stdin.read(16385);
        result=length(text)>16384?{ok:0,error:'CPU 配置无效'}:apply(json(text));
    } else result={ok:0,error:'CPU 配置无效'};
} catch(e) { result={ok:0,error:'CPU 配置无效'}; }
print(sprintf('%J\n',result));
exit(result.ok?0:1);
