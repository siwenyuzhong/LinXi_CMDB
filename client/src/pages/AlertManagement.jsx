import React, {useState, useEffect, useCallback} from 'react';
import {Navigate, useNavigate, useSearchParams} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getMonitorApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';
import AppSidebar from '../components/AppSidebar';
import feishuIcon from '../img/feishu.png';
import dingtalkIcon from '../img/dingding.png';

let _apiBase = '';
loadConfig().then(() => { _apiBase = getMonitorApiBase(); });
function api(path) { return _apiBase + path; }

export default function AlertManagement() {
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [events, setEvents] = useState([]);
    const [eventsTotal, setEventsTotal] = useState(0);
    const [eventsNextOffset, setEventsNextOffset] = useState(200);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [presets, setPresets] = useState([]);
    const [notifyConfigs, setNotifyConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const tab = (rawTab === 'items' || rawTab === 'events') ? rawTab : 'items';
    const setTab = (t) => setSearchParams({tab: t}, {replace: true});
    const [showForm, setShowForm] = useState(false);
    const [showTemplate, setShowTemplate] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const NOTIFY_TYPES = [
        {key: 'email', label: '邮件', icon: <i className="bi bi-envelope" style={{color: '#3b82f6'}}/>, color: '#3b82f6'},
        {key: 'wechat', label: '企业微信', icon: <i className="bi bi-wechat" style={{color: '#22c55e'}}/>, color: '#22c55e'},
        {key: 'feishu', label: '飞书', icon: <img src={feishuIcon} alt="飞书" style={{width: 12, height: 12}}/>, color: '#3370FF'},
        {key: 'dingtalk', label: '钉钉', icon: <img src={dingtalkIcon} alt="钉钉" style={{width: 12, height: 12}}/>, color: '#0089FF'},
    ];
    const typeMap = Object.fromEntries(NOTIFY_TYPES.map(t => [t.key, t]));
    const [form, setForm] = useState({name: '', target_host: '', target_port: '', check_interval: 60, enabled: true, notify_channels: [], alert_message: '', repeat_notify: true});

    useEffect(() => {
        loadConfig().then(() => {
            const cmdbBase = getCmdbApiBase();
            if (!cmdbBase) return;
            const token = getStoredAuthToken();
            fetch(`${cmdbBase}/api/check-permission?resource_type=alert-management&resource_id=*&permission=alert-management:read`, {
                headers: token ? {Authorization: `Bearer ${token}`} : {},
            }).then(r => r.json()).then(data => {
                if (!data.allowed) {
                    alert('⚠️ 权限不足：无权限访问告警管理');
                    navigate('/platform-config');
                }
            }).catch(() => {
                alert('⚠️ 权限不足：无权限访问告警管理');
                navigate('/platform-config');
            });
        });
    }, [navigate]);

    const fetchItems = useCallback(async () => {
        try {
            const resp = await fetch(api(`/api/monitor-items?t=${Date.now()}`));
            if (resp.ok) {
                const data = await resp.json();
                setItems(data.items || []);
            }
        } catch (err) {
            console.error('获取监控项失败:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchEvents = useCallback(async (append = false) => {
        try {
            setEventsLoading(true);
            const offset = append ? events.length : 0;
            const resp = await fetch(api(`/api/alert-events?t=${Date.now()}&offset=${offset}&limit=200`));
            if (resp.ok) {
                const data = await resp.json();
                const loaded = data.items || [];
                if (append) {
                    setEvents(prev => [...prev, ...loaded]);
                } else {
                    setEvents(loaded);
                }
                setEventsTotal(data.total || 0);
                setEventsNextOffset(offset + loaded.length);
            }
        } catch (err) {
            console.error('获取告警事件失败:', err);
        } finally {
            setEventsLoading(false);
        }
    }, [events.length]);

    const fetchNotifyConfigs = useCallback(async () => {
        try {
            const url = api(`/api/monitor/notification-configs?t=${Date.now()}`);
            console.log('fetchNotifyConfigs url:', url);
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                console.log('fetchNotifyConfigs data:', data);
                setNotifyConfigs(data.items || []);
            } else {
                console.error('fetchNotifyConfigs status:', resp.status);
            }
        } catch (err) {
            console.error('获取通知配置失败:', err);
        }
    }, []);

    const fetchPresets = useCallback(async () => {
        try {
            const resp = await fetch(api(`/api/monitor/presets?t=${Date.now()}`));
            if (resp.ok) {
                const data = await resp.json();
                setPresets(data.items || []);
            }
        } catch (err) {
            console.error('获取预设失败:', err);
        }
    }, []);

    useEffect(() => {
        fetchItems();
        fetchEvents();
        fetchPresets();
        fetchNotifyConfigs();
        const interval = setInterval(fetchEvents, 5000);
        return () => clearInterval(interval);
    }, [fetchItems, fetchEvents, fetchPresets, fetchNotifyConfigs]);

    const handleSave = async () => {
        if (!form.name || !form.target_host || !form.target_port) {
            alert('请填写完整信息');
            return;
        }
        const payload = {
            name: form.name,
            target_host: form.target_host,
            target_port: parseInt(form.target_port),
            check_interval: parseInt(form.check_interval) || 60,
            enabled: form.enabled,
            notify_channels: form.notify_channels,
            alert_message: form.alert_message,
            repeat_notify: form.repeat_notify,
            created_by: user?.username || '',
        };
        try {
            const method = editingItem ? 'PUT' : 'POST';
            const url = editingItem
                ? api(`/api/monitor-items/${editingItem.id}`)
                : api('/api/monitor-items');
            const resp = await fetch(url, {
                method,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                alert(`保存失败: ${err.error || resp.statusText}`);
                return;
            }
            await fetchItems();
            setShowForm(false);
            setEditingItem(null);
            resetForm();
        } catch (err) {
            alert('保存失败');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('确定要删除该监控项吗？')) return;
        try {
            await fetch(api(`/api/monitor-items/${id}`), {method: 'DELETE'});
            await fetchItems();
        } catch (err) {
            console.error('删除失败:', err);
        }
    };

    const handleResolve = async (id) => {
        try {
            await fetch(api(`/api/alert-events/${id}/resolve`), {method: 'PUT'});
            await fetchEvents();
        } catch (err) {
            console.error('确认失败:', err);
        }
    };

    const handleEdit = (item) => {
        const ch = item.notify_channels || [];
        const hasTypeNames = ch.some(c => typeMap[c]);
        const notify_channels = hasTypeNames
            ? notifyConfigs.filter(c => ch.includes(c.config_type)).map(c => c.name)
            : ch;
        setForm({
            name: item.name,
            target_host: item.target_host,
            target_port: String(item.target_port),
            check_interval: item.check_interval,
            enabled: item.enabled,
            notify_channels,
            alert_message: item.alert_message || '',
            repeat_notify: item.repeat_notify !== false,
        });
        setEditingItem(item);
        setShowForm(true);
    };

    const resetForm = () => {
        setForm({name: '', target_host: '', target_port: '', check_interval: 60, enabled: true, notify_channels: [], alert_message: '', repeat_notify: true});
    };

    const applyPreset = (p) => {
        setForm({name: p.name, target_host: p.host, target_port: String(p.port), check_interval: 60, enabled: true, notify_channels: [], alert_message: '', repeat_notify: true});
    };

    const toggleItemEnabled = async (item) => {
        await fetch(api(`/api/monitor-items/${item.id}`), {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled: !item.enabled}),
        });
        await fetchItems();
    };

    if (!user) return <Navigate to="/login" replace/>;

    const unresolvedCount = events.filter(e => e.status !== 'resolved').length;
    const downCount = events.filter(e => e.alert_type === 'down' && e.status !== 'resolved').length;

    const eventStatusStyle = (status) => {
        if (status === 'resolved') return {color: '#22c55e', label: '已恢复'};
        return {color: '#ef4444', label: '未恢复'};
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="平台配置"
                subtitle="告警管理"
                brandIcon="bi bi-shield-exclamation"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={logout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page" style={{overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
                <div style={{background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, padding: 28, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexShrink: 0}}>
                        <div>
                            <h2 style={{margin: '0 0 8px', fontSize: 18}}>
                                <i className="bi bi-shield-exclamation"/> 告警管理
                            </h2>
                            <p style={{margin: 0, color: 'var(--text-3)', fontSize: 14}}>
                                端口监控与告警通知，实时检测服务状态
                            </p>
                        </div>
                        <button className="btn" onClick={() => navigate('/platform-config')}
                                style={{display: 'flex', alignItems: 'center', gap: 4}}>
                            <i className="bi bi-arrow-left"/> 返回平台配置
                        </button>
                    </div>

                    <div style={{display: 'flex', gap: 16, marginBottom: 24, flexShrink: 0}}>
                        <div style={{flex: 1, background: 'var(--surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--border-2)'}}>
                            <div style={{fontSize: 13, color: 'var(--text-3)', marginBottom: 4}}>监控项</div>
                            <div style={{fontSize: 28, fontWeight: 600}}>{items.length}</div>
                        </div>
                        <div style={{flex: 1, background: '#450a0a', borderRadius: 10, padding: 16, border: '1px solid #7f1d1d'}}>
                            <div style={{fontSize: 13, color: '#fca5a5', marginBottom: 4}}>当前告警</div>
                            <div style={{fontSize: 28, fontWeight: 600, color: '#fca5a5'}}>{downCount}</div>
                        </div>
                        <div style={{flex: 1, background: '#052e16', borderRadius: 10, padding: 16, border: '1px solid #166534'}}>
                            <div style={{fontSize: 13, color: '#86efac', marginBottom: 4}}>已恢复</div>
                            <div style={{fontSize: 28, fontWeight: 600, color: '#86efac'}}>{events.filter(e => e.status === 'resolved').length}</div>
                        </div>
                    </div>

                    <div style={{display: 'flex', gap: 8, marginBottom: 0, borderBottom: '1px solid var(--border-2)', padding: '12px 0', flexShrink: 0}}>
                        <button className="btn" onClick={() => setTab('items')}
                                style={tab === 'items' ? {background: 'var(--accent)', color: '#fff'} : {}}>
                            <i className="bi bi-list-ul"/> 监控项
                        </button>
                        <button className="btn" onClick={() => setTab('events')}
                                style={tab === 'events' ? {background: unresolvedCount > 0 ? '#dc2626' : 'var(--accent)', color: '#fff'} : {}}>
                            <i className="bi bi-bell"/> 告警事件 {unresolvedCount > 0 && `(${unresolvedCount})`}
                        </button>
                        <div style={{flex: 1}}/>
                        {tab === 'items' && (
                            <button className="btn btn-default" onClick={() => {setShowForm(!showForm); setEditingItem(null); if (!showForm) resetForm();}}>
                                <i className="bi bi-plus-circle"/> 添加监控
                            </button>
                        )}
                    </div>

                    <div style={{flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 12}}>
                    {tab === 'items' && (
                        <div>
                            {showForm && (
                                <div style={{
                                    background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                                    borderRadius: 10, padding: 16, marginBottom: 16,
                                }}>
                                    <h4 style={{margin: '0 0 16px', fontSize: 14}}>
                                        {editingItem ? '编辑监控项' : '添加监控项'}
                                    </h4>

                                    {presets.length > 0 && !editingItem && (
                                        <div style={{marginBottom: 16}}>
                                            <label style={{display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--text-3)'}}>快速选择预设</label>
                                            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                                                {presets.map(p => (
                                                    <button key={p.name} className="btn" onClick={() => applyPreset(p)}
                                                            style={{fontSize: 12, padding: '4px 10px'}}>
                                                        {p.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{marginBottom: 12}}>
                                        <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                                            名称 <span style={{color: '#ef4444'}}>*</span>
                                        </label>
                                        <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                                               placeholder="例如：AI Assistant Server"
                                               style={{width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box'}}/>
                                    </div>
                                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12}}>
                                        <div>
                                            <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                                                主机地址 <span style={{color: '#ef4444'}}>*</span>
                                            </label>
                                            <input value={form.target_host} onChange={e => setForm({...form, target_host: e.target.value})}
                                                   placeholder="127.0.0.1"
                                                   style={{width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box'}}/>
                                        </div>
                                        <div>
                                            <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                                                端口 <span style={{color: '#ef4444'}}>*</span>
                                            </label>
                                            <input type="number" value={form.target_port} onChange={e => setForm({...form, target_port: e.target.value})}
                                                   placeholder="5003"
                                                   style={{width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box'}}/>
                                        </div>
                                    </div>
                                    <div style={{display: 'flex', gap: 24, marginBottom: 16, alignItems: 'center'}}>
                                        <div>
                                            <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                                                检查间隔（秒）
                                            </label>
                                            <input type="number" value={form.check_interval} onChange={e => setForm({...form, check_interval: e.target.value})}
                                                   style={{width: 120, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box'}}/>
                                        </div>
                                        <div>
                                            <label style={{display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-3)'}}>
                                                重复发送告警
                                            </label>
                                            <label style={{position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer'}}>
                                                <input type="checkbox" checked={form.repeat_notify}
                                                       onChange={e => setForm({...form, repeat_notify: e.target.checked})}
                                                       style={{opacity: 0, width: 0, height: 0}}/>
                                                <span style={{
                                                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                                    backgroundColor: form.repeat_notify ? '#22c55e' : '#6b7280',
                                                    borderRadius: 22, transition: '0.3s',
                                                }}>
                                                    <span style={{
                                                        position: 'absolute', height: 16, width: 16,
                                                        left: form.repeat_notify ? 20 : 3, bottom: 3,
                                                        backgroundColor: 'white', borderRadius: '50%', transition: '0.3s',
                                                    }}/>
                                                </span>
                                            </label>
                                            <span style={{marginLeft: 8, fontSize: 12, color: 'var(--text-3)'}}>
                                                {form.repeat_notify ? '未恢复则每次检查都发' : '仅发一次'}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{marginBottom: 16}}>
                                        <label style={{display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-3)'}}>
                                            告警通知方式 <span style={{fontSize: 12, color: 'var(--text-3)', fontWeight: 400}}>（不选则不发送通知）</span>
                                        </label>
                                        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                                            {notifyConfigs.length === 0 ? (
                                                <span style={{fontSize: 12, color: 'var(--text-3)'}}>加载中...</span>
                                            ) : (() => {
                                                const grouped = {};
                                                for (const c of notifyConfigs) {
                                                    if (!grouped[c.config_type]) grouped[c.config_type] = [];
                                                    grouped[c.config_type].push(c);
                                                }
                                                const els = [];
                                                for (const [type, cfgs] of Object.entries(grouped)) {
                                                    const t = typeMap[type];
                                                    els.push(
                                                        <div key={type}>
                                                            <div style={{fontSize: 12, color: 'var(--text-3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6}}>
                                                                {t && <span style={{display: 'flex', alignItems: 'center'}}>{t.icon}</span>}
                                                                {t ? t.label : type}
                                                            </div>
                                                            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 20}}>
                                                                {cfgs.map(cfg => {
                                                                    const active = form.notify_channels.includes(cfg.name);
                                                                    const color = t ? t.color : '#6366f1';
                                                                    return (
                                                                        <label key={cfg.name} style={{
                                                                            display: 'flex', alignItems: 'center', gap: 6,
                                                                            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                                                                            border: `1px solid ${active ? color : 'var(--border-2)'}`,
                                                                            background: active ? color + '15' : 'var(--surface)',
                                                                            fontSize: 12, userSelect: 'none',
                                                                        }}>
                                                                            <input type="checkbox" checked={active}
                                                                                   onChange={() => {
                                                                                       const next = active
                                                                                           ? form.notify_channels.filter(c => c !== cfg.name)
                                                                                           : [...form.notify_channels, cfg.name];
                                                                                       setForm({...form, notify_channels: next});
                                                                                   }}
                                                                                   style={{margin: 0}}/>
                                                                            {cfg.name}
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return els;
                                            })()}
                                        </div>
                                    </div>

                                    <div style={{marginBottom: 16}}>
                                        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                                            <label style={{fontSize: 13, color: 'var(--text-3)'}}>
                                                自定义告警内容 <span style={{fontSize: 12, color: 'var(--text-3)', fontWeight: 400}}>（留空使用默认消息）</span>
                                            </label>
                                            <button onClick={() => setShowTemplate(true)}
                                                    style={{padding: '0 5px', fontSize: 10, lineHeight: '18px', cursor: 'pointer', border: '1px solid var(--border-2)', borderRadius: 3, background: 'var(--surface)', color: 'var(--text)'}}>
                                                <i className="bi bi-eye"/> 默认消息模版
                                            </button>
                                        </div>
                                        <textarea value={form.alert_message}
                                                  onChange={e => setForm({...form, alert_message: e.target.value})}
                                                  placeholder={'可用变量: {name} {host} {port} {alert_type} {time} {user}\n例如: [{time}] {user} 服务 {name} ({host}:{port}) 异常'}
                                                  style={{width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box', minHeight: 64, resize: 'vertical', fontFamily: 'inherit'}}
                                        />
                                    </div>

                                    {showTemplate && (
                                        <div style={{position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                            <div onClick={() => setShowTemplate(false)} style={{position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)'}}/>
                                            <div style={{position: 'relative', background: 'var(--surface)', borderRadius: 8, padding: 24, minWidth: 380, maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.2)'}}>
                                                <div style={{fontSize: 14, fontWeight: 500, marginBottom: 12}}>默认消息模板</div>
                                                <pre style={{margin: 0, padding: 12, background: 'var(--bg)', borderRadius: 6, fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text)'}}>{`服务名称：{name}
服务地址：{host}:{port}
告警等级：{alert_type}
告警内容：端口异常，请检查！
告警事件：{time}
告警人：{user}`}</pre>
                                                <button onClick={() => {navigator.clipboard.writeText(`服务名称：{name}\n服务地址：{host}:{port}\n告警等级：{alert_type}\n告警内容：端口异常，请检查！\n告警事件：{time}\n告警人：{user}`).then(() => setShowTemplate(false));}}
                                                        style={{marginTop: 12, padding: '6px 16px', fontSize: 13, cursor: 'pointer', border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)', color: 'var(--text)', display: 'block', marginLeft: 'auto', marginRight: 'auto'}}>
                                                    <i className="bi bi-clipboard"/> 一键复制
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{display: 'flex', gap: 8}}>
                                        <button className="btn btn-default" onClick={handleSave}>
                                            <i className="bi bi-check-circle"/> 保存
                                        </button>
                                        <button className="btn" onClick={() => {setShowForm(false); setEditingItem(null);}}>
                                            取消
                                        </button>
                                    </div>
                                </div>
                            )}

                            {items.length === 0 && !showForm ? (
                                <div style={{padding: 40, textAlign: 'center', color: 'var(--text-3)', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border-2)'}}>
                                    <div style={{fontSize: 48, marginBottom: 16, opacity: 0.5}}><i className="bi bi-hdd-stack"/></div>
                                    <p style={{margin: '0 0 8px', fontSize: 14}}>暂无监控项</p>
                                    <p style={{margin: 0, fontSize: 13}}>点击"添加监控"按钮创建端口监控</p>
                                </div>
                            ) : (
                                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                                    {items.map(item => (
                                        <div key={item.id} style={{
                                            background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                                            borderRadius: 10, padding: 14, opacity: item.enabled ? 1 : 0.6,
                                        }}>
                                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                                                    <label style={{position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer'}}>
                                                        <input type="checkbox" checked={item.enabled}
                                                               onChange={() => toggleItemEnabled(item)}
                                                               style={{opacity: 0, width: 0, height: 0}}/>
                                                        <span style={{
                                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                                            backgroundColor: item.enabled ? '#22c55e' : '#6b7280',
                                                            borderRadius: 22, transition: '0.3s',
                                                        }}>
                                                            <span style={{
                                                                position: 'absolute', height: 16, width: 16,
                                                                left: item.enabled ? 20 : 3, bottom: 3,
                                                                backgroundColor: 'white', borderRadius: '50%', transition: '0.3s',
                                                            }}/>
                                                        </span>
                                                    </label>
                                                    <div>
                                                        <div style={{fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8}}>
                                                            {item.name}
                                                            <span style={{fontSize: 12, color: 'var(--text-3)', fontWeight: 400}}>
                                                                {item.target_host}:{item.target_port}
                                                            </span>
                                                            <span style={{fontSize: 11, color: 'var(--text-3)'}}>
                                                                每{item.check_interval}s
                                                            </span>
                                                        </div>
                                                        <div style={{display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap'}}>
                                                            {(item.notify_channels || []).map(ch => {
                                                                const t = NOTIFY_TYPES.find(nt => nt.key === ch);
                                                                const cfg = notifyConfigs.find(c => c.name === ch);
                                                                const label = cfg ? cfg.name : (t ? t.label : ch);
                                                                const color = t ? t.color : '#6366f1';
                                                                return (
                                                                    <span key={ch} style={{
                                                                        fontSize: 11, padding: '1px 6px', borderRadius: 4,
                                                                        background: color + '20', color: color,
                                                                    }}>
                                                                        {label}
                                                                    </span>
                                                                );
                                                            })}
                                                            {item.repeat_notify !== false && (
                                                                <span style={{
                                                                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                                                                    background: '#22c55e20', color: '#22c55e',
                                                                }}>
                                                                    重复告警
                                                                </span>
                                                            )}
                                                            {item.repeat_notify === false && (
                                                                <span style={{
                                                                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                                                                    background: '#6b728020', color: '#6b7280',
                                                                }}>
                                                                    单次告警
                                                                </span>
                                                            )}
                                                            {item.alert_message && (
                                                                <span style={{
                                                                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                                                                    background: '#8b5cf620', color: '#8b5cf6',
                                                                }}>
                                                                    自定义消息
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{display: 'flex', gap: 8}}>
                                                    <button className="btn" style={{padding: '4px 12px', fontSize: 12}}
                                                            onClick={() => handleEdit(item)}>编辑</button>
                                                    <button className="btn" style={{padding: '4px 12px', fontSize: 12, color: '#ef4444'}}
                                                            onClick={() => handleDelete(item.id)}>删除</button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'events' && (
                        <div>
                            {events.length === 0 ? (
                                <div style={{padding: 40, textAlign: 'center', color: 'var(--text-3)'}}>
                                    <div style={{fontSize: 48, marginBottom: 16, opacity: 0.5}}><i className="bi bi-check-circle"/></div>
                                    <p style={{margin: 0, fontSize: 14}}>暂无告警事件</p>
                                </div>
                            ) : (
                                <>
                                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                                    {events.map(e => {
                                        const st = eventStatusStyle(e.status);
                                        return (
                                            <div key={e.id} style={{
                                                background: 'var(--surface-2)', border: `1px solid ${e.status === 'resolved' ? '#166534' : '#7f1d1d'}`,
                                                borderRadius: 10, padding: 14,
                                            }}>
                                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                                                        <span style={{
                                                            width: 10, height: 10, borderRadius: '50%',
                                                            background: e.status === 'resolved' ? '#22c55e' : '#ef4444',
                                                            display: 'inline-block', flexShrink: 0,
                                                        }}/>
                                                        <div>
                                                            <div style={{fontSize: 13, fontWeight: 500}}>
                                                                {e.message}
                                                            </div>
                                                            <div style={{fontSize: 11, color: 'var(--text-3)', marginTop: 2}}>
                                                                {e.created_at?.replace('T', ' ').substring(0, 19)}
                                                                {e.resolved_at && ` | 恢复于 ${e.resolved_at.replace('T', ' ').substring(0, 19)}`}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                                        <span style={{fontSize: 11, padding: '2px 8px', borderRadius: 4, background: st.color + '20', color: st.color}}>
                                                            {st.label}
                                                        </span>
                                                        {e.status !== 'resolved' && (
                                                            <button className="btn" style={{padding: '4px 10px', fontSize: 11}}
                                                                    onClick={() => handleResolve(e.id)}>
                                                                确认
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {events.length < eventsTotal && (
                                    <div style={{textAlign: 'center', padding: '16px 0'}}>
                                        <button className="btn" onClick={() => fetchEvents(true)} disabled={eventsLoading}
                                                style={{padding: '8px 32px', fontSize: 13}}>
                                            {eventsLoading ? <span className="spin"><i className="bi bi-arrow-repeat"/></span> : <i className="bi bi-plus-circle"/>}
                                            {' '}加载更多（{events.length}/{eventsTotal}）
                                        </button>
                                    </div>
                                )}
                                </>
                            )}
                        </div>
                    )}
                    </div>
                </div>
            </div>
        </div>
    );
}
