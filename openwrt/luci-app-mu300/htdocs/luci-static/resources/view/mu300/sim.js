'use strict';
'require view';
'require rpc';
'require poll';
'require mu300.common as M';

var get=rpc.declare({object:'mu300dash',method:'data_sim_get',nobatch:true,expect:{'':{}}});
var start=rpc.declare({object:'mu300dash',method:'data_sim_set',params:['target'],nobatch:true,expect:{'':{}}});
var status=rpc.declare({object:'mu300dash',method:'data_sim_status',params:['id'],nobatch:true,expect:{'':{}}});
var errors={dual_sim_unavailable:'当前配置不支持双卡切换',invalid_sim:'SIM 卡槽无效',modem_busy:'另一项模组操作正在执行',sim_read_failed:'无法核验当前上网卡',sim_not_ready:'目标 SIM 尚未就绪',data_disconnect_failed:'旧数据连接未停止，已取消切换',sim_switch_failed_restored:'切换失败，已恢复原上网卡',sim_rollback_failed:'切换失败且恢复不完整，请检查 SIM 和信号',storage_failed:'设置保存失败'};
errors.dual_boot_required='双卡尚未共同初始化，请重启后检查状态';
function message(s){return M.translate(errors[s]||s);}
function el(tag,text,cls) { var n=document.createElement(tag); if(text!=null)n.textContent=text; if(cls)n.className=cls; return n; }
function card(n) { return n===0||n===1 ? 'SIM '+(n+1) : M.translate('未连接'); }
return view.extend({
    load:function() { return Promise.all([M.callSimGet(),get()]); },
    render:function(data) {
        M.injectCss(); M.localizeMenu();
        var self=this, root=this.root=el('div',null,'mud');
        root.append(el('h2',M.translate('SIM 卡管理')));
        var panel=el('section',null,'mud-card'); root.append(panel);
        var actual=el('p'), saved=el('p'), connection=el('p'), select=el('select'), button=el('button',M.translate('切换上网卡'),'mud-btn on');
        panel.append(actual,saved,connection);
        [0,1].forEach(function(n) { var o=el('option',card(n)); o.value=n; select.append(o); });
        var row=el('div'); row.style.cssText='display:flex;gap:12px;flex-wrap:wrap;align-items:center';
        var label=el('label',M.translate('默认上网卡')+' '); label.append(select); row.append(label,button); panel.append(row);
        panel.append(el('p',M.translate('切换会短暂中断蜂窝网络，成功后作为开机默认上网卡；不会切换 USB 或 Wi-Fi。'),'mud-note'));
        panel.append(el('p',M.translate('欠费或无信号不影响选卡；数据连接失败不会自动切回。'),'mud-note'));
        function paint(r,initial) {
            actual.textContent=M.translate('当前上网卡')+'：'+card(r.actual_sim);
            saved.textContent=M.translate('开机默认')+'：'+card(r.saved_sim);
            connection.textContent=M.translate('数据连接')+'：'+M.translate(r.data_connected?'已连接':'未连接');
            if(initial)select.value=r.saved_sim===1?'1':'0';
        }
        paint(data[1],true);
        button.disabled=select.disabled=data[0].slots!==2 || !data[1].ok || data[1].ready===false;
        if(button.disabled)panel.append(el('p',message(data[1].ready===false && data[0].slots===2?'dual_boot_required':'dual_sim_unavailable'),'mud-note'));
        function wait(id) {
            return new Promise(function(resolve,reject) {
                self.cancelWait=function(){reject(new Error('页面已关闭'));};
                var deadline=performance.now()+240000;
                function next() {
                    if(!root.isConnected)return reject(new Error('页面已关闭'));
                    if(performance.now()>deadline)return reject(new Error('应用超时，请刷新确认模组状态'));
                    status(id).then(function(r) {
                        if(r.id!==id || r.state==='error')return reject(new Error(r.error||'网络设置执行失败'));
                        if(r.state==='done' && r.ok)return resolve(r);
                        self.timer=setTimeout(next,1000);
                    }).catch(reject);
                }
                next();
            });
        }
        button.onclick=function() {
            if(self.busy)return;
            var target=select.value; self.busy=true;
            M.confirmBox('切换上网卡？',M.translate('目标卡槽')+'：'+card(Number(target)),{danger:true}).then(function(yes) {
                if(!yes || !root.isConnected)return;
                M.busy(button,true); select.disabled=true;
                var toast=M.toast('正在切换上网卡…',{type:'busy',timeout:0});
                return start(target).then(function(r) {
                    if(!r.ok || !r.id)throw new Error(r.error||'网络设置提交失败');
                    return wait(r.id);
                }).then(function() { M.selectViewedSlot(target); M.toast('上网卡切换完成',{type:'success'}); })
                  .catch(function(e) { if(root.isConnected)M.toast(message(e.message),{type:'error'}); })
                  .finally(function() { toast.close(); M.busy(button,false); select.disabled=false; if(root.isConnected)return get().then(function(r){if(root.isConnected)paint(r,true);}).catch(function(){}); });
            }).finally(function(){self.busy=false;});
        };
        this.refresh=function() {
            if(document.hidden||!root.isConnected||self.busy||self.inflight)return Promise.resolve();
            self.inflight=true;
            return get().then(function(r){if(root.isConnected)paint(r,false);}).catch(function(){}).finally(function(){self.inflight=false;});
        };
        poll.add(this.refresh,2);
        return root;
    },
    unload:function(){poll.remove(this.refresh); clearTimeout(this.timer); if(this.cancelWait)this.cancelWait();},
    handleSaveApply:null,handleSave:null,handleReset:null
});
