import React, {useState, useEffect, useRef, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';

export default function ApiDocs() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const [spec, setSpec] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedTag, setExpandedTag] = useState(null);
    const [expandedPath, setExpandedPath] = useState(null);
    const [selectedMethod, setSelectedMethod] = useState('all');

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    useEffect(() => {
        if (!apiBase && !cmdbBase) return;
        const tryFetchSpec = async (baseUrl, paths) => {
            for (const p of paths) {
                try {
                    const url = `${baseUrl}${p}`;
                    const token = getStoredAuthToken();
                    const res = await fetch(url, {
                        headers: token ? {Authorization: `Bearer ${token}`} : {},
                    });
                    if (res.ok) return await res.json();
                } catch {}
            }
            return null;
        };
        const fetchSpec = async () => {
            setLoading(true);
            try {
                if (cmdbBase) {
                    const token = getStoredAuthToken();
                    const headers = token ? {Authorization: `Bearer ${token}`} : {};
                    const permissionRes = await fetch(`${cmdbBase}/api/check-permission?resource_type=api-docs&resource_id=*&permission=api-docs:read`, { headers });
                    if (permissionRes.ok) {
                        const permissionData = await permissionRes.json();
                        if (!permissionData.allowed) {
                            alert('⚠️ 权限不足: 无权限查看API文档');
                            return;
                        }
                    }
                }
                let data;
                try {
                    const res = await fetch('/swagger.json');
                    if (res.ok) data = await res.json();
                } catch {}
                if (!data) {
                    const candidates = ['/swagger.json', '/api/swagger.json', '/swagger/v1/swagger.json', '/spec', '/api/docs/swagger.json', '/api/spec'];
                    data = await tryFetchSpec(apiBase, candidates);
                }
                if (!data && cmdbBase) data = await tryFetchSpec(cmdbBase, ['/swagger.json', '/api/swagger.json', '/api/spec']);
                if (!data) throw new Error('无法获取API文档，请确认后端服务已启动并正确配置了 Swagger 文档');
                setSpec(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchSpec();
    }, [apiBase, cmdbBase]);

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const methodColors = {
        get: {bg: '#dbeafe', text: '#1d4ed8'},
        post: {bg: '#dcfce7', text: '#15803d'},
        put: {bg: '#fef3c7', text: '#92400e'},
        patch: {bg: '#fef3c7', text: '#92400e'},
        delete: {bg: '#fee2e2', text: '#dc2626'},
    };

    const methods = ['get', 'post', 'put', 'patch', 'delete'];

    if (!user) return null;

    const paths = spec ? Object.entries(spec.paths || {}) : [];
    const tags = spec ? (spec.tags || []).map(t => t.name) : [];

    const groupedByTag = {};
    paths.forEach(([path, methodsObj]) => {
        methods.forEach(m => {
            const methodObj = methodsObj?.[m];
            if (!methodObj) return;
            const tag = (methodObj.tags || ['default'])[0];
            if (!groupedByTag[tag]) groupedByTag[tag] = [];
            groupedByTag[tag].push({path, method: m, ...methodObj});
        });
    });

    const filteredTags = Object.entries(groupedByTag).filter(([tag, items]) => {
        if (searchTerm && !tag.toLowerCase().includes(searchTerm.toLowerCase()) &&
            !items.some(i => i.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (i.summary || '').toLowerCase().includes(searchTerm.toLowerCase()))) {
            return false;
        }
        if (selectedMethod !== 'all' && !items.some(i => i.method === selectedMethod)) {
            return false;
        }
        return true;
    });

    const isDark = theme === 'dark';
    const badgeBg = isDark ? '#1e293b' : '#fff';

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="API文档"
                subtitle="查看平台接口文档"
                brandIcon="bi bi-book"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page">
                <div style={{padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border)'}}>
                    <div className="form-group" style={{margin: 0, flex: 1, minWidth: 200, maxWidth: 360, position: 'relative'}}>
                        <i className="bi bi-search" style={{position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, zIndex: 1}}/>
                        <input
                            type="text"
                            placeholder="搜索接口..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{paddingLeft: 30, width: '100%', height: 36, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none'}}
                        />
                    </div>
                    <select value={selectedMethod}
                            onChange={e => setSelectedMethod(e.target.value)}
                            style={{height: 36, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, padding: '0 8px'}}>
                        <option value="all">全部方法</option>
                        {methods.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                    </select>
                    <button className="btn" onClick={() => navigate('/platform-config')}>
                        <i className="bi bi-arrow-left"/> 返回
                    </button>
                </div>

                <div style={{flex: 1, overflow: 'auto', padding: 16}}>
                    {loading && (
                        <div style={{textAlign: 'center', padding: 40, color: 'var(--text-3)'}}>
                            <i className="bi bi-arrow-repeat spin"/> 加载中...
                        </div>
                    )}
                    {error && (
                        <div style={{textAlign: 'center', padding: 40, color: '#ef4444'}}>
                            <i className="bi bi-exclamation-triangle"/> {error}
                        </div>
                    )}
                    {spec && !loading && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                            <div style={{fontSize: 13, color: 'var(--text-3)', marginBottom: 4}}>
                                共 {paths.reduce((sum, [, m]) => sum + methods.filter(method => m[method]).length, 0)} 个接口
                                {filteredTags.reduce((sum, [, items]) => sum + items.length, 0) < paths.reduce((sum, [, m]) => sum + methods.filter(method => m[method]).length, 0) && (
                                    <span>，筛选后 {filteredTags.reduce((sum, [, items]) => sum + items.length, 0)} 个</span>
                                )}
                            </div>
                            {filteredTags.length === 0 && !loading && (
                                <div style={{textAlign: 'center', padding: 40, color: 'var(--text-3)'}}>未找到匹配的接口</div>
                            )}
                            {filteredTags.map(([tag, items]) => (
                                <div key={tag} style={{
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                }}>
                                    <div
                                        onClick={() => setExpandedTag(expandedTag === tag ? null : tag)}
                                        style={{
                                            padding: '10px 16px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            borderBottom: expandedTag === tag ? '1px solid var(--border)' : 'none',
                                            background: 'var(--surface-2)',
                                        }}
                                    >
                                        <span style={{fontWeight: 600, fontSize: 14, flex: 1}}>{tag}</span>
                                        <span style={{fontSize: 12, color: 'var(--text-3)'}}>{items.length} 个接口</span>
                                        <span style={{fontSize: 12, color: 'var(--text-3)'}}>{expandedTag === tag ? '▲' : '▼'}</span>
                                    </div>
                                    {expandedTag === tag && items.map((item, i) => {
                                        const colors = methodColors[item.method] || methodColors.get;
                                        const isExpanded = expandedPath === `${item.method}-${item.path}`;
                                        return (
                                            <div key={i} style={{
                                                borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
                                            }}>
                                                <div
                                                    onClick={() => setExpandedPath(isExpanded ? null : `${item.method}-${item.path}`)}
                                                    style={{
                                                        padding: '8px 16px 8px 24px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        background: isExpanded ? 'var(--surface-2)' : 'transparent',
                                                    }}
                                                >
                                                    <span style={{
                                                        fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                                                        padding: '2px 6px', borderRadius: 4,
                                                        background: colors.bg, color: colors.text,
                                                        textTransform: 'uppercase', flexShrink: 0, minWidth: 48, textAlign: 'center',
                                                    }}>{item.method}</span>
                                                    <span style={{fontSize: 13, fontFamily: 'monospace', flex: 1, wordBreak: 'break-all'}}>{item.path}</span>
                                                    <span style={{fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300}}>{item.summary || ''}</span>
                                                    <span style={{fontSize: 11, color: 'var(--text-3)', flexShrink: 0}}>{isExpanded ? '▲' : '▼'}</span>
                                                </div>
                                                {isExpanded && (
                                                    <div style={{padding: '8px 16px 16px 24px', borderTop: '1px solid var(--border)'}}>
                                                        {item.description && (
                                                            <div style={{marginBottom: 12, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5}}>{item.description}</div>
                                                        )}
                                                        {/* Parameters */}
                                                        {item.parameters && item.parameters.length > 0 && (
                                                            <div style={{marginBottom: 12}}>
                                                                <div style={{fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6}}>参数</div>
                                                                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                                                                    {item.parameters.map((param, pi) => (
                                                                        <div key={pi} style={{
                                                                            display: 'flex', gap: 8, alignItems: 'center',
                                                                            padding: '6px 8px', borderRadius: 4, background: 'var(--surface-3)',
                                                                            fontSize: 12,
                                                                        }}>
                                                                            <code style={{fontSize: 12, fontWeight: 600}}>{param.name}</code>
                                                                            <span style={{color: 'var(--text-3)', fontSize: 11}}>{param.in}</span>
                                                                            {param.required && <span style={{color: '#ef4444', fontSize: 11}}>必填</span>}
                                                                            {param.schema && <span style={{color: 'var(--text-3)', fontSize: 11}}>{param.schema.type || ''}</span>}
                                                                            <span style={{color: 'var(--text-3)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{param.description || ''}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* Request Body */}
                                                        {item.requestBody && (
                                                            <div style={{marginBottom: 12}}>
                                                                <div style={{fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6}}>请求体</div>
                                                                <pre style={{
                                                                    margin: 0, padding: 8, borderRadius: 4,
                                                                    background: '#1a1a1a', color: '#f0f0f0',
                                                                    fontSize: 11, lineHeight: 1.5, overflow: 'auto',
                                                                    maxHeight: 200,
                                                                }}>{JSON.stringify(item.requestBody, null, 2)}</pre>
                                                            </div>
                                                        )}
                                                        {/* Responses */}
                                                        {item.responses && (
                                                            <div>
                                                                <div style={{fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6}}>响应</div>
                                                                {Object.entries(item.responses).map(([code, resp]) => (
                                                                    <div key={code} style={{marginBottom: 8}}>
                                                                        <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4}}>
                                                                            <span style={{
                                                                                fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                                                                                padding: '1px 6px', borderRadius: 3,
                                                                                background: code.startsWith('2') ? '#dcfce7' : '#fee2e2',
                                                                                color: code.startsWith('2') ? '#15803d' : '#dc2626',
                                                                            }}>{code}</span>
                                                                            <span style={{fontSize: 12, color: 'var(--text-2)'}}>{resp.description || ''}</span>
                                                                        </div>
                                                                        {resp.schema && (
                                                                            <pre style={{
                                                                                margin: 0, padding: 8, borderRadius: 4,
                                                                                background: '#1a1a1a', color: '#f0f0f0',
                                                                                fontSize: 11, lineHeight: 1.5, overflow: 'auto',
                                                                                maxHeight: 200,
                                                                            }}>{JSON.stringify(resp.schema, null, 2)}</pre>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
