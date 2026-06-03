import React, {useState, useEffect, useCallback} from 'react';
import {Navigate, useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';
import AppSidebar from '../components/AppSidebar';

const CONFIG_CARDS = [
    {
        key: 'command_blacklist',
        icon: <i className="bi bi-x-circle"></i>,
        name: '命令黑名单',
        description: '管理 SSH 终端禁止执行的命令列表，匹配黑名单的命令将被拦截',
        default_value: [],
        placeholder: '输入不允许的命令（如 reboot、init、rm）',
    },
    {
        key: 'permission_management',
        icon: <i className="bi bi-shield-lock"></i>,
        name: '权限管理',
        description: '管理用户角色、用户组和资源级权限，支持批量授权和细粒度权限控制',
        navigate: '/platform-config/permissions',
    },
    {
        key: 'ai_graph',
        icon: <i className="bi bi-boxes"></i>,
        name: '模型拓扑',
        description: '通过模型关系字段串联多个模型，构建跨表查询链路，方便多表关联查询',
        navigate: '/platform-config/ai-graph',
    },
    {
        key: 'data_validity',
        icon: <i className="bi bi-clock"></i>,
        name: '数据有效性维护',
        description: '配置模型字段校验规则，定期检查数据有效性，发现无效数据',
        navigate: '/platform-config/data-validity',
    },
    {
        key: 'api_docs',
        icon: <i className="bi bi-book"></i>,
        name: 'API文档',
        description: '查看平台 API 接口文档，支持在线调试和接口测试',
        navigate: '/platform-config/api-docs',
    },
    {
        key: 'notification_config',
        icon: <i className="bi bi-bell"></i>,
        name: '通知配置',
        description: '配置告警通知渠道（邮件、企业微信、飞书、钉钉），系统触发告警时自动发送',
        navigate: '/platform-config/notification-config',
    },
    {
        key: 'model_data_management',
        icon: <i className="bi bi-database"></i>,
        name: '模型数据管理',
        description: '管理各模型的实例数据，支持按数量删除或一键清空全部模型数据',
        navigate: '/platform-config/model-data-management',
    },
    {
        key: 'alert_management',
        icon: <i className="bi bi-shield-exclamation"></i>,
        name: '告警管理',
        description: '端口监控与告警通知，实时检测服务状态并通过已配置的通知渠道发送告警',
        navigate: '/platform-config/alert-management',
    },
];

export default function PlatformConfig() {
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const navigate = useNavigate();
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(() => localStorage.getItem('platformConfigEditing') || null);
    const [editValue, setEditValue] = useState('');
    const [newItem, setNewItem] = useState('');

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    const authHeaders = () => {
        const t = getStoredAuthToken();
        return t ? {'Authorization': `Bearer ${t}`} : {};
    };

    const fetchConfigs = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const resp = await fetch(`${cmdbBase}/api/platform-configs`, {headers: authHeaders()});
            if (resp.ok) {
                const data = await resp.json();
                setConfigs(data.items || data);
            }
        } catch (err) {
            console.error('获取配置失败:', err);
        } finally {
            setLoading(false);
        }
    }, [cmdbBase]);

    useEffect(() => {
        if (cmdbBase) fetchConfigs();
    }, [cmdbBase, fetchConfigs]);

    useEffect(() => {
        if (!loading && configs.length === 0 && cmdbBase) {
            Promise.all(CONFIG_CARDS.map(card =>
                fetch(`${cmdbBase}/api/platform-configs`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', ...authHeaders()},
                    body: JSON.stringify({
                        config_key: card.key,
                        name: card.name,
                        value: card.default_value,
                        category: 'security',
                        description: card.description,
                    }),
                })
            )).then(() => fetchConfigs());
        }
    }, [loading, configs, cmdbBase, fetchConfigs]);

    const getConfig = (key) => configs.find(c => c.config_key === key);

    const handleAddItem = async (configKey) => {
        const cfg = getConfig(configKey);
        if (!cfg || !newItem.trim()) return;

        const arr = Array.isArray(cfg.value) ? [...cfg.value, newItem.trim()] : [newItem.trim()];
        await fetch(`${cmdbBase}/api/platform-configs/${cfg.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', ...authHeaders()},
            body: JSON.stringify({value: arr}),
        });
        setNewItem('');
        fetchConfigs();
    };

    const handleRemoveItem = async (configKey, index) => {
        const cfg = getConfig(configKey);
        if (!cfg || !Array.isArray(cfg.value)) return;

        const item = cfg.value[index];
        if (!confirm(`确定要删除命令「${item}」吗？`)) return;

        const arr = cfg.value.filter((_, i) => i !== index);
        await fetch(`${cmdbBase}/api/platform-configs/${cfg.id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', ...authHeaders()},
            body: JSON.stringify({value: arr}),
        });
        fetchConfigs();
    };

    const handleLogout = async () => {
        await logout();
    };

    if (!user) return <Navigate to="/login" replace/>;

    const card = CONFIG_CARDS.find(c => c.key === editing);

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="平台配置"
                subtitle="管理平台配置"
                brandIcon="bi bi-x-circle"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page">
                <div style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 12,
                    padding: 28,
                }}>
                    {editing ? (
                        <div>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20}}>
                                <strong style={{fontSize: 18}}>{card?.icon} {card?.name}</strong>
                                <div style={{flex: 1}}/>
                            </div>

                            {card?.key === 'command_blacklist' && (
                                <div>
                                    <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
                                        <input
                                            value={newItem}
                                            onChange={e => setNewItem(e.target.value)}
                                            placeholder={card.placeholder}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleAddItem(editing);
                                            }}
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                borderRadius: 6,
                                                border: '1px solid var(--border-2)',
                                                background: 'var(--surface-2)',
                                                color: 'var(--text)',
                                                fontSize: 14
                                            }}
                                        />
                                        <button className="btn btn-default" onClick={() => handleAddItem(editing)}><i
                                            className="bi bi-plus-circle"></i>添加命令
                                        </button>
                                        <button className="btn" onClick={() => {
                                            setEditing(null);
                                            localStorage.removeItem('platformConfigEditing');
                                        }} style={{display: 'flex', alignItems: 'center', gap: 4}}>
                                            <i className="bi bi-arrow-left"/> 返回
                                        </button>
                                    </div>

                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                        maxHeight: 420,
                                        overflowY: 'auto',
                                        paddingRight: 4
                                    }}>
                                        {(() => {
                                            const cfg = getConfig(editing);
                                            const items = Array.isArray(cfg?.value) ? cfg.value : [];
                                            return items.length === 0 ? (
                                                <div style={{
                                                    padding: 20,
                                                    textAlign: 'center',
                                                    color: 'var(--text-3)',
                                                    background: 'var(--surface-3)',
                                                    borderRadius: 8,
                                                    border: '1px solid var(--border-2)'
                                                }}>暂无黑名单命令</div>
                                            ) : items.map((item, i) => (
                                                <div key={i} style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    padding: '8px 12px',
                                                    background: 'var(--surface-3)',
                                                    borderRadius: 6,
                                                    border: '1px solid var(--border-2)'
                                                }}>
                                                    <code style={{fontSize: 14}}>{item}</code>
                                                    <button className="btn"
                                                            style={{color: '#ef4444', padding: '2px 8px'}}
                                                            onClick={() => handleRemoveItem(editing, i)}>删除
                                                    </button>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: 4}}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                gap: 16
                            }}>
                                {CONFIG_CARDS.map(card => {
                                    const cfg = getConfig(card.key);
                                    return (
                                        <div
                                            key={card.key}
                                            onClick={async () => {
                                                if (card.key === 'command_blacklist') {
                                                    const token = localStorage.getItem('promptflow_auth_token');
                                                    try {
                                                        const check = await fetch(`${cmdbBase}/api/check-permission?resource_type=platform-config&resource_id=command_blacklist&permission=command-blacklist:read`, {
                                                            headers: token ? {Authorization: `Bearer ${token}`} : {},
                                                        });
                                                        const result = await check.json();
                                                        if (!result.allowed) {
                                                            alert('⚠️ 权限不足：无权限访问命令黑名单');
                                                            return;
                                                        }
                                                    } catch {
                                                        alert('⚠️ 权限不足：无权限访问命令黑名单');
                                                        return;
                                                    }
                                                }
                                                if (card.key === 'alert_management') {
                                                    const token = localStorage.getItem('promptflow_auth_token');
                                                    try {
                                                        const check = await fetch(`${cmdbBase}/api/check-permission?resource_type=alert-management&resource_id=*&permission=alert-management:read`, {
                                                            headers: token ? {Authorization: `Bearer ${token}`} : {},
                                                        });
                                                        const result = await check.json();
                                                        if (!result.allowed) {
                                                            alert('⚠️ 权限不足：无权限访问告警管理');
                                                            return;
                                                        }
                                                    } catch {
                                                        alert('⚠️ 权限不足：无权限访问告警管理');
                                                        return;
                                                    }
                                                }
                                                if (card.key === 'model_data_management') {
                                                    const token = localStorage.getItem('promptflow_auth_token');
                                                    try {
                                                        const check = await fetch(`${cmdbBase}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:read`, {
                                                            headers: token ? {Authorization: `Bearer ${token}`} : {},
                                                        });
                                                        const result = await check.json();
                                                        if (!result.allowed) {
                                                            alert('⚠️ 权限不足：无权限访问模型数据管理');
                                                            return;
                                                        }
                                                    } catch {
                                                        alert('⚠️ 权限不足：无权限访问模型数据管理');
                                                        return;
                                                    }
                                                }
                                                card.navigate ? navigate(card.navigate) : (() => {
                                                    localStorage.setItem('platformConfigEditing', card.key);
                                                    setEditing(card.key);
                                                })();
                                            }}
                                            style={{
                                                background: 'var(--surface-2)',
                                                border: '1px solid var(--border-2)',
                                                borderRadius: 10,
                                                padding: 24,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                minHeight: 200,
                                                display: 'flex',
                                                flexDirection: 'column',
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = 'var(--accent)';
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = 'var(--border-2)';
                                                e.currentTarget.style.transform = 'none';
                                            }}
                                        >
                                            <div style={{fontSize: 32, marginBottom: 12}}>{card.icon}</div>
                                            <h3 style={{margin: '0 0 6px', fontSize: 14}}>{card.name}</h3>
                                            <p style={{
                                                margin: 0,
                                                fontSize: 13,
                                                color: 'var(--text-3)',
                                                lineHeight: 1.5,
                                                flex: 1,
                                            }}>{card.description}</p>
                                            {cfg && Array.isArray(cfg.value) && (
                                                <div style={{marginTop: 12, fontSize: 12, color: 'var(--accent)'}}>
                                                    已配置 {cfg.value.length} 项
                                                </div>
                                            )}
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
