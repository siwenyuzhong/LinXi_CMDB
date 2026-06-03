import React, {useState, useEffect, useCallback} from 'react';
import {Navigate, useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';
import AppSidebar from '../components/AppSidebar';
import feishuIcon from '../img/feishu.png';
import dingtalkIcon from '../img/dingding.png';

const NOTIFICATION_TYPES = [
    {
        key: 'email',
        icon: <i className="bi bi-envelope"></i>,
        name: '邮件通知',
        description: '通过SMTP邮件服务发送告警通知',
        color: '#3b82f6',
    },
    {
        key: 'wechat',
        icon: <i className="bi bi-wechat"></i>,
        name: '企业微信',
        description: '通过企业微信群机器人发送告警通知',
        color: '#22c55e',
    },
    {
        key: 'feishu',
        icon: <img src={feishuIcon} alt="飞书" style={{width: 32, height: 32}}/>,
        name: '飞书通知',
        description: '通过飞书群机器人发送告警通知',
        color: '#3370FF',
    },
    {
        key: 'dingtalk',
        icon: <img src={dingtalkIcon} alt="钉钉" style={{width: 32, height: 32}}/>,
        name: '钉钉通知',
        description: '通过钉钉群机器人发送告警通知',
        color: '#0089FF',
    },
];

const EMAIL_FIELDS = [
    {key: 'smtp_host', label: 'SMTP服务器', placeholder: 'smtp.example.com', required: true},
    {key: 'smtp_port', label: 'SMTP端口', placeholder: '465', type: 'number'},
    {key: 'smtp_user', label: '发件人邮箱', placeholder: 'alert@example.com', required: true},
    {key: 'smtp_password', label: '邮箱密码/授权码', placeholder: '请输入密码或授权码', type: 'password', required: true},
    {key: 'smtp_ssl', label: '启用SSL', type: 'switch'},
    {key: 'recipients', label: '收件人邮箱', placeholder: '多个邮箱用逗号分隔', required: true},
];

const WEBHOOK_FIELDS = [
    {key: 'webhook_url', label: 'Webhook地址', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx', required: true},
    {key: 'webhook_secret', label: '签名密钥（可选）', placeholder: 'SECxxx', type: 'password'},
];

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function ConfigItemForm({type, item, onSave, onCancel}) {
    const fields = type === 'email' ? EMAIL_FIELDS : WEBHOOK_FIELDS;
    const [formData, setFormData] = useState({
        id: item?.id || generateId(),
        name: item?.name || '',
        enabled: item?.enabled ?? true,
        config: item?.config || {},
    });

    const handleSave = () => {
        if (!formData.name.trim()) {
            alert('请输入配置名称');
            return;
        }
        onSave(formData);
    };

    return (
        <div style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
        }}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8}}>
                <h4 style={{margin: 0, fontSize: 14}}>
                    {item ? '编辑配置' : '添加配置'}
                </h4>
                <label style={{position: 'relative', display: 'inline-block', width: 44, height: 24}}>
                    <input
                        type="checkbox"
                        checked={formData.enabled}
                        onChange={e => setFormData({...formData, enabled: e.target.checked})}
                        style={{opacity: 0, width: 0, height: 0}}
                    />
                    <span style={{
                        position: 'absolute',
                        cursor: 'pointer',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: formData.enabled ? '#22c55e' : '#6b7280',
                        transition: '0.3s',
                        borderRadius: 24,
                    }}>
                        <span style={{
                            position: 'absolute',
                            content: '',
                            height: 18,
                            width: 18,
                            left: formData.enabled ? 22 : 3,
                            bottom: 3,
                            backgroundColor: 'white',
                            transition: '0.3s',
                            borderRadius: '50%',
                        }}/>
                    </span>
                </label>
            </div>

            <div style={{marginBottom: 16}}>
                <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                    配置名称 <span style={{color: '#ef4444'}}>*</span>
                </label>
                <input
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="例如：生产环境告警通知"
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border-2)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        fontSize: 14,
                        boxSizing: 'border-box',
                    }}
                />
            </div>

            {fields.map(field => (
                <div key={field.key} style={{marginBottom: 16}}>
                    <label style={{display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)'}}>
                        {field.label}
                        {field.required && <span style={{color: '#ef4444', marginLeft: 4}}>*</span>}
                    </label>
                    {field.type === 'switch' ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <label style={{position: 'relative', display: 'inline-block', width: 44, height: 24}}>
                                <input
                                    type="checkbox"
                                    checked={formData.config[field.key] || false}
                                    onChange={e => setFormData({
                                        ...formData,
                                        config: {...formData.config, [field.key]: e.target.checked},
                                    })}
                                    style={{opacity: 0, width: 0, height: 0}}
                                />
                                <span style={{
                                    position: 'absolute',
                                    cursor: 'pointer',
                                    top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: formData.config[field.key] ? '#3b82f6' : '#6b7280',
                                    transition: '0.3s',
                                    borderRadius: 24,
                                }}>
                                    <span style={{
                                        position: 'absolute',
                                        content: '',
                                        height: 18,
                                        width: 18,
                                        left: formData.config[field.key] ? 22 : 3,
                                        bottom: 3,
                                        backgroundColor: 'white',
                                        transition: '0.3s',
                                        borderRadius: '50%',
                                    }}/>
                                </span>
                            </label>
                            <span style={{fontSize: 13, color: 'var(--text-3)'}}>
                                {formData.config[field.key] ? '已启用' : '未启用'}
                            </span>
                        </div>
                    ) : (
                        <input
                            type={field.type || 'text'}
                            value={formData.config[field.key] || ''}
                            onChange={e => setFormData({
                                ...formData,
                                config: {...formData.config, [field.key]: field.type === 'number' ? (parseInt(e.target.value) || '') : e.target.value},
                            })}
                            placeholder={field.placeholder}
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                borderRadius: 6,
                                border: '1px solid var(--border-2)',
                                background: 'var(--surface)',
                                color: 'var(--text)',
                                fontSize: 14,
                                boxSizing: 'border-box',
                            }}
                        />
                    )}
                </div>
            ))}

            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <button className="btn btn-default" onClick={handleSave}>
                    <i className="bi bi-check-circle"/> 保存
                </button>
                <button className="btn" onClick={onCancel}>
                    取消
                </button>
            </div>
        </div>
    );
}

export default function NotificationConfig() {
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const navigate = useNavigate();
    const [cmdbBase, setCmdbBase] = useState('');
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeType, setActiveType] = useState(null);
    const [editingItem, setEditingItem] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [testing, setTesting] = useState(null);

    useEffect(() => {
        loadConfig().then(() => setCmdbBase(getCmdbApiBase()));
    }, []);

    const authHeaders = () => {
        const t = getStoredAuthToken();
        return t ? {'Authorization': `Bearer ${t}`} : {};
    };

    const fetchConfigs = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            // 添加时间戳参数避免缓存
            const resp = await fetch(`${cmdbBase}/api/notification-configs?t=${Date.now()}`, {
                headers: authHeaders()
            });
            if (resp.ok) {
                const data = await resp.json();
                console.log('[通知配置] 获取到的数据:', data);
                setConfigs(data.items || data || []);
            }
        } catch (err) {
            console.error('获取通知配置失败:', err);
        } finally {
            setLoading(false);
        }
    }, [cmdbBase]);

    useEffect(() => {
        if (cmdbBase) fetchConfigs();
    }, [cmdbBase, fetchConfigs]);

    useEffect(() => {
        console.log('[通知配置] 当前配置列表:', configs);
    }, [configs]);

    const getConfig = (type) => {
        const found = configs.find(c => c.config_type === type);
        console.log(`[通知配置] getConfig(${type}):`, found);
        return found;
    };

    const handleSaveItem = async (item) => {
        if (!cmdbBase || !activeType) return;

        const cfg = getConfig(activeType);
        const items = cfg?.config?.items || [];
        const existingIndex = items.findIndex(i => i.id === item.id);

        let newItems;
        if (existingIndex >= 0) {
            newItems = [...items];
            newItems[existingIndex] = item;
        } else {
            newItems = [...items, item];
        }

        const payload = {
            config_type: activeType,
            name: NOTIFICATION_TYPES.find(t => t.key === activeType)?.name || activeType,
            enabled: newItems.some(i => i.enabled),
            config: {items: newItems},
        };

        console.log('[通知配置] 保存请求:', {method: cfg ? 'PUT' : 'POST', payload});

        try {
            const method = cfg ? 'PUT' : 'POST';
            const url = cfg
                ? `${cmdbBase}/api/notification-configs/${cfg.id}`
                : `${cmdbBase}/api/notification-configs`;

            const resp = await fetch(url, {
                method,
                headers: {'Content-Type': 'application/json', ...authHeaders()},
                body: JSON.stringify(payload),
            });

            console.log('[通知配置] 保存响应:', resp.status, resp.ok);

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                console.error('[通知配置] 保存失败:', errData);
                alert(`保存失败: ${errData.error || resp.statusText}`);
                return;
            }

            await fetchConfigs();
            setEditingItem(null);
            setShowAddForm(false);
        } catch (err) {
            console.error('保存失败:', err);
            alert('保存失败');
        }
    };

    const handleDeleteItem = async (itemId) => {
        if (!confirm('确定要删除该配置吗？')) return;
        if (!cmdbBase || !activeType) return;

        const cfg = getConfig(activeType);
        if (!cfg) return;

        const items = cfg.config?.items || [];
        const newItems = items.filter(i => i.id !== itemId);

        const payload = {
            config_type: activeType,
            name: cfg.name,
            enabled: newItems.some(i => i.enabled),
            config: {items: newItems},
        };

        try {
            await fetch(`${cmdbBase}/api/notification-configs/${cfg.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json', ...authHeaders()},
                body: JSON.stringify(payload),
            });
            await fetchConfigs();
        } catch (err) {
            console.error('删除失败:', err);
        }
    };

    const handleToggleItem = async (itemId, enabled) => {
        if (!cmdbBase || !activeType) return;

        const cfg = getConfig(activeType);
        if (!cfg) return;

        const items = cfg.config?.items || [];
        const newItems = items.map(i => i.id === itemId ? {...i, enabled} : i);

        const payload = {
            config_type: activeType,
            name: cfg.name,
            enabled: newItems.some(i => i.enabled),
            config: {items: newItems},
        };

        try {
            await fetch(`${cmdbBase}/api/notification-configs/${cfg.id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json', ...authHeaders()},
                body: JSON.stringify(payload),
            });
            await fetchConfigs();
        } catch (err) {
            console.error('更新状态失败:', err);
        }
    };

    const handleTestItem = async (item) => {
        if (!cmdbBase) return;
        setTesting(item.id);
        try {
            const resp = await fetch(`${cmdbBase}/api/notification-configs/test`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...authHeaders()},
                body: JSON.stringify({config_type: activeType, config: item.config}),
            });
            const result = await resp.json();
            if (result.success) {
                alert('测试发送成功');
            } else {
                alert(`测试发送失败: ${result.error || '未知错误'}`);
            }
        } catch (err) {
            alert('网络错误，请重试');
        } finally {
            setTesting(null);
        }
    };

    const handleDeleteType = async () => {
        if (!confirm('确定要删除该通知类型的所有配置吗？')) return;
        const cfg = getConfig(activeType);
        if (!cfg || !cmdbBase) return;
        try {
            await fetch(`${cmdbBase}/api/notification-configs/${cfg.id}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            await fetchConfigs();
            setActiveType(null);
        } catch (err) {
            console.error('删除失败:', err);
        }
    };

    if (!user) return <Navigate to="/login" replace/>;

    const currentTypeInfo = NOTIFICATION_TYPES.find(t => t.key === activeType);
    const currentConfig = getConfig(activeType);
    const configItems = currentConfig?.config?.items || [];

    console.log('[通知配置] 渲染详情页:', {activeType, currentConfig, configItems});

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="平台配置"
                subtitle="通知配置"
                brandIcon="bi bi-bell"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={logout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page">
                <div style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 12,
                    padding: 28,
                }}>
                    {activeType ? (
                        <div>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24}}>
                                <button
                                    className="btn"
                                    onClick={() => {setActiveType(null); setEditingItem(null); setShowAddForm(false);}}
                                    style={{display: 'flex', alignItems: 'center', gap: 4}}
                                >
                                    <i className="bi bi-arrow-left"/> 返回
                                </button>
                                <div style={{flex: 1}}/>
                                <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                    <span style={{color: currentTypeInfo?.color, fontSize: 24}}>
                                        {currentTypeInfo?.icon}
                                    </span>
                                    <strong style={{fontSize: 18}}>{currentTypeInfo?.name}配置</strong>
                                </div>
                                <div style={{flex: 1}}/>
                                {currentConfig && (
                                    <button
                                        className="btn"
                                        style={{color: '#ef4444'}}
                                        onClick={handleDeleteType}
                                    >
                                        <i className="bi bi-trash"/> 删除全部
                                    </button>
                                )}
                            </div>

                            <div style={{marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                <p style={{margin: 0, color: 'var(--text-3)', fontSize: 14}}>
                                    共 {configItems.length} 个配置项，{configItems.filter(i => i.enabled).length} 个已启用
                                </p>
                                <button
                                    className="btn btn-default"
                                    onClick={() => {setShowAddForm(true); setEditingItem(null);}}
                                >
                                    <i className="bi bi-plus-circle"/> 添加配置
                                </button>
                            </div>

                            {showAddForm && (
                                <ConfigItemForm
                                    type={activeType}
                                    item={null}
                                    onSave={handleSaveItem}
                                    onCancel={() => setShowAddForm(false)}
                                />
                            )}

                            {editingItem && (
                                <ConfigItemForm
                                    type={activeType}
                                    item={editingItem}
                                    onSave={handleSaveItem}
                                    onCancel={() => setEditingItem(null)}
                                />
                            )}

                            {configItems.length === 0 && !showAddForm && !editingItem ? (
                                <div style={{
                                    padding: 40,
                                    textAlign: 'center',
                                    color: 'var(--text-3)',
                                    background: 'var(--surface-2)',
                                    borderRadius: 10,
                                    border: '1px solid var(--border-2)',
                                }}>
                                    <div style={{fontSize: 48, marginBottom: 16, opacity: 0.5}}>
                                        {currentTypeInfo?.icon}
                                    </div>
                                    <p style={{margin: '0 0 8px', fontSize: 14}}>暂无配置</p>
                                    <p style={{margin: 0, fontSize: 13}}>点击"添加配置"按钮创建第一个通知配置</p>
                                </div>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    maxHeight: 'calc(100vh - 280px)',
                                    overflowY: 'auto',
                                    paddingRight: 4,
                                }}>
                                    {configItems.map(item => (
                                        <div
                                            key={item.id}
                                            style={{
                                                background: 'var(--surface-2)',
                                                border: `1px solid ${item.enabled ? currentTypeInfo?.color + '40' : 'var(--border-2)'}`,
                                                borderRadius: 10,
                                                padding: 16,
                                                opacity: item.enabled ? 1 : 0.7,
                                            }}
                                        >
                                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8}}>
                                                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                                                    <label
                                                        style={{position: 'relative', display: 'inline-block', width: 40, height: 22}}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={item.enabled}
                                                            onChange={e => handleToggleItem(item.id, e.target.checked)}
                                                            style={{opacity: 0, width: 0, height: 0}}
                                                        />
                                                        <span style={{
                                                            position: 'absolute',
                                                            cursor: 'pointer',
                                                            top: 0, left: 0, right: 0, bottom: 0,
                                                            backgroundColor: item.enabled ? '#22c55e' : '#6b7280',
                                                            transition: '0.3s',
                                                            borderRadius: 22,
                                                        }}>
                                                            <span style={{
                                                                position: 'absolute',
                                                                content: '',
                                                                height: 16,
                                                                width: 16,
                                                                left: item.enabled ? 20 : 3,
                                                                bottom: 3,
                                                                backgroundColor: 'white',
                                                                transition: '0.3s',
                                                                borderRadius: '50%',
                                                            }}/>
                                                        </span>
                                                    </label>
                                                    <div>
                                                        <div style={{fontWeight: 500, fontSize: 14}}>{item.name}</div>
                                                        <div style={{fontSize: 12, color: 'var(--text-3)', marginTop: 2}}>
                                                            {activeType === 'email' ? (
                                                                <span>
                                                                    <i className="bi bi-envelope" style={{marginRight: 4}}/>
                                                                    {item.config?.smtp_user || '-'} @ {item.config?.smtp_host || '-'}:{item.config?.smtp_port || '25'}
                                                                </span>
                                                            ) : (
                                                                <span>
                                                                    <i className="bi bi-link-45deg" style={{marginRight: 4}}/>
                                                                    {item.config?.webhook_url ? (
                                                                        item.config.webhook_url.length > 40
                                                                            ? item.config.webhook_url.substring(0, 40) + '...'
                                                                            : item.config.webhook_url
                                                                    ) : '-'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{display: 'flex', gap: 8}}>
                                                    <button
                                                        className="btn"
                                                        style={{padding: '4px 12px', fontSize: 12}}
                                                        onClick={() => handleTestItem(item)}
                                                        disabled={testing === item.id}
                                                    >
                                                        {testing === item.id ? '测试中...' : '测试'}
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        style={{padding: '4px 12px', fontSize: 12}}
                                                        onClick={() => {setEditingItem(item); setShowAddForm(false);}}
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        style={{padding: '4px 12px', fontSize: 12, color: '#ef4444'}}
                                                        onClick={() => handleDeleteItem(item.id)}
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24}}>
                                <div>
                                    <h2 style={{margin: '0 0 8px', fontSize: 18}}>
                                        <i className="bi bi-bell"/> 通知配置
                                    </h2>
                                    <p style={{margin: 0, color: 'var(--text-3)', fontSize: 14}}>
                                        配置告警通知渠道，当系统触发告警时将通过已启用的渠道发送通知
                                    </p>
                                </div>
                                <button className="btn" onClick={() => navigate('/platform-config')}
                                        style={{display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0}}>
                                    <i className="bi bi-arrow-left"/> 返回平台配置
                                </button>
                            </div>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                                gap: 16,
                            }}>
                                {NOTIFICATION_TYPES.map(type => {
                                    const cfg = getConfig(type.key);
                                    const items = cfg?.config?.items || [];
                                    const enabledCount = items.filter(i => i.enabled).length;

                                    return (
                                        <div
                                            key={type.key}
                                            onClick={() => setActiveType(type.key)}
                                            style={{
                                                background: 'var(--surface-2)',
                                                border: '1px solid var(--border-2)',
                                                borderRadius: 10,
                                                padding: 24,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                minHeight: 180,
                                                display: 'flex',
                                                flexDirection: 'column',
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = type.color;
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = 'var(--border-2)';
                                                e.currentTarget.style.transform = 'none';
                                            }}
                                        >
                                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12}}>
                                                <div style={{fontSize: 32, color: type.color}}>
                                                    {type.icon}
                                                </div>
                                            </div>
                                            <h3 style={{margin: '0 0 6px', fontSize: 14}}>{type.name}</h3>
                                            <p style={{
                                                margin: 0,
                                                fontSize: 13,
                                                color: 'var(--text-3)',
                                                lineHeight: 1.5,
                                                flex: 1,
                                            }}>{type.description}</p>
                                            <div style={{
                                                marginTop: 12,
                                                fontSize: 12,
                                                color: enabledCount > 0 ? type.color : 'var(--text-3)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 4,
                                            }}>
                                                {enabledCount > 0 ? (
                                                    <>
                                                        <i className="bi bi-check-circle-fill"/>
                                                        已配置 {items.length} 项，{enabledCount} 项已启用
                                                    </>
                                                ) : items.length > 0 ? (
                                                    <>
                                                        <i className="bi bi-clock"/>
                                                        已配置 {items.length} 项（未启用）
                                                    </>
                                                ) : (
                                                    <>
                                                        <i className="bi bi-plus-circle"/>
                                                        点击配置
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
