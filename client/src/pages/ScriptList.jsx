import React, {useState, useEffect, useCallback, useRef} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import CodeEditor from '../components/CodeEditor';
import Modal from '../components/Modal';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import pythonLogo from '../img/python.png';
import shellLogo from '../img/shell.png';


const SCRIPT_TYPES = [
    {value: 'python', label: 'Python'},
    {value: 'shell', label: 'Shell'},
];


const TYPE_TEMPLATES = {
    python: '# -*- coding: UTF-8 -*-\n',
    shell: '#!/ai-assistant-server/bash\n',
};

export default function ScriptList() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [scripts, setScripts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingScript, setEditingScript] = useState(null);
    const [currentPage, setCurrentPage] = usePersistedState('scriptListCurrentPage', 1);
    const [pageSize, setPageSize] = usePersistedState('scriptListPageSize', 5);
    const [searchQuery, setSearchQuery] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        type: 'python',
        content: '',
        description: '',
    });
    const [debuggingMap, setDebuggingMap] = useState({}); // { [scriptId]: taskId }
    const pollMapRef = useRef({});
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    const loadScripts = useCallback(async (resetPage = true, silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await api.listScripts();
            setScripts(data);
            if (resetPage) setCurrentPage(1);
        } catch (err) {
            setErrorMessage('加载脚本列表失败: ' + err.message);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!cmdbBase) return;
        (async () => {
            try {
                const token = getStoredAuthToken();
                const headers = token ? {Authorization: `Bearer ${token}`} : {};
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=script&resource_id=*&permission=script:read`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看工具库');
                        setLoading(false);
                        return;
                    }
                }
            } catch (_) {}
            loadScripts(false);
        })();
    }, [cmdbBase, loadScripts]);

    const handleOpenModal = (script = null) => {
        setErrorMessage('');
        if (script) {
            setEditingScript(script);
            setFormData({
                name: script.name,
                type: script.type || 'python',
                content: script.content || '',
                description: script.description || '',
            });
        } else {
            setEditingScript(null);
            setFormData({name: '', type: 'python', content: TYPE_TEMPLATES.python, description: ''});
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingScript(null);
        setErrorMessage('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        try {
            if (editingScript) {
                await api.updateScript(editingScript.id, formData);
            } else {
                await api.createScript(formData);
            }
            handleCloseModal();
            loadScripts();
        } catch (err) {
            setErrorMessage(err.message);
        }
    };

    const handleDelete = async (e, script) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`确定要删除脚本「${script.name}」吗？`)) return;
        try {
            await api.deleteScript(script.id);
            await loadScripts(false);
        } catch (err) {
            setErrorMessage('删除失败: ' + err.message);
        }
    };

    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyList, setHistoryList] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedHistoryId, setSelectedHistoryId] = useState(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyPageSize, setHistoryPageSize] = usePersistedState('scriptHistoryPageSize', 10);

    const openHistory = async (page = 1, pageSize) => {
        if (!apiBase) return;
        if (cmdbBase) {
            const token = getStoredAuthToken();
            const headers = token ? {Authorization: `Bearer ${token}`} : {};
            try {
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=script-debug&resource_id=*&permission=script-debug:read`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看调试历史');
                        return;
                    }
                }
            } catch (_) {}
        }
        setHistoryOpen(true);
        setSelectedHistoryId(null);
        setHistoryLoading(true);
        const ps = pageSize != null ? pageSize : historyPageSize;
        try {
            const resp = await fetch(`${apiBase}/api/debug-script/history?page=${page}&page_size=${ps}`);
            const data = await resp.json();
            setHistoryList(data.items || []);
            setHistoryTotal(data.total != null ? data.total : (data.items || []).length);
            setHistoryPage(data.page || 1);
        } catch (_) {
        } finally {
            setHistoryLoading(false);
        }
    };

    const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

    const statusLabel = {
        running: '运行中',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
    };

    const formatTime = (t) => t ? new Date(t + 'Z').toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) : '—';

    const stopPolling = (scriptId) => {
        if (scriptId && pollMapRef.current[scriptId]) {
            clearInterval(pollMapRef.current[scriptId]);
            delete pollMapRef.current[scriptId];
            return;
        }
        if (!scriptId) {
            Object.values(pollMapRef.current).forEach(clearInterval);
            pollMapRef.current = {};
        }
    };

    const completeDebug = (scriptId, newStatus) => {
        stopPolling(scriptId);
        setDebuggingMap(prev => { const next = {...prev}; delete next[scriptId]; return next; });
        setScripts(prev => prev.map(s =>
            s.id === scriptId ? {...s, debug_status: newStatus} : s
        ));
        try { api.updateScriptDebugStatus(scriptId, newStatus); } catch (_) {}
        loadScripts(false, true);
    };

    const cancelDebug = async (scriptId, taskId) => {
        stopPolling(scriptId);
        setDebuggingMap(prev => { const next = {...prev}; delete next[scriptId]; return next; });
        if (apiBase && taskId) {
            try { await fetch(`${apiBase}/api/debug-script/${taskId}`, {method: 'DELETE'}); } catch (_) {}
        }
    };

    const startPolling = (scriptId, taskId) => {
        stopPolling(scriptId);
        pollMapRef.current[scriptId] = setInterval(async () => {
            try {
                const r = await fetch(`${apiBase}/api/debug-script/${taskId}`);
                const result = await r.json();
                if (result.done) {
                    const newStatus = result.return_code === 0 ? '已通过' : '未通过';
                    completeDebug(scriptId, newStatus);
                }
            } catch (_) {
                stopPolling(scriptId);
                setDebuggingMap(prev => { const next = {...prev}; delete next[scriptId]; return next; });
            }
        }, 500);
    };

    // On mount: resume all running debug tasks from DB
    useEffect(() => {
        if (!apiBase) return;
        fetch(`${apiBase}/api/debug-script/running`)
            .then(r => r.json())
            .then(data => {
                const items = data.items || [];
                const newMap = {};
                items.forEach(item => {
                    if (item.script_id) newMap[item.script_id] = item.id;
                });
                if (Object.keys(newMap).length > 0) {
                    setDebuggingMap(newMap);
                    Object.entries(newMap).forEach(([scriptId, taskId]) => startPolling(scriptId, taskId));
                }
            })
            .catch(() => {});
    }, [apiBase]);

    useEffect(() => {
        return () => stopPolling();
    }, [apiBase]);

    useEffect(() => {
        if (historyOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [historyOpen]);

    const handleDebug = async (script) => {
        if (!apiBase || debuggingMap[script.id]) return;
        const token = getStoredAuthToken();
        const headers = token ? {Authorization: `Bearer ${token}`} : {};
        try {
            const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=script-debug&resource_id=*&permission=script-debug:execute`, { headers });
            if (res.ok) {
                const data = await res.json();
                if (!data.allowed) {
                    alert('⚠️ 权限不足: 无权限执行调试');
                    return;
                }
            }
        } catch (_) {}
        setDebuggingMap(prev => ({...prev, [script.id]: 'pending'}));
        setErrorMessage('');
        try {
            const resp = await fetch(`${apiBase}/api/debug-script`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({type: script.type, content: script.content, name: script.name, script_id: script.id}),
            });
            const data = await resp.json();
            if (data.task_id) {
                setDebuggingMap(prev => ({...prev, [script.id]: data.task_id}));
                startPolling(script.id, data.task_id);
            } else {
                setDebuggingMap(prev => { const next = {...prev}; delete next[script.id]; return next; });
                setErrorMessage(data.error || '启动失败');
            }
        } catch (err) {
            setDebuggingMap(prev => { const next = {...prev}; delete next[script.id]; return next; });
            setErrorMessage(err.message);
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const typeLabel = (type) => SCRIPT_TYPES.find((t) => t.value === type)?.label || type;

    const filteredScripts = scripts.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const totalPages = Math.max(1, Math.ceil(filteredScripts.length / pageSize));
    const paginatedScripts = filteredScripts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="工具库"
                subtitle="工具列表"
                brandIcon="bi bi-terminal"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />


            <div className="app-content script-list-page">
                <div className="script-sticky-header">
                    <div className="script-filters">
                        <div className="script-search-box">
                            <span className="search-icon">
                                <i className="bi bi-search"></i>
                            </span>
                            <input
                                type="text"
                                placeholder="搜索脚本..."
                                value={searchQuery}
                                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="script-search-input"
                            />
                        </div>

                        <button className="btn btn-default" onClick={() => handleOpenModal()}>
                            <i className="bi bi-plus-circle"></i>
                            新建工具
                        </button>
                        <button className="btn btn-default" onClick={() => openHistory(1)}>
                            <i className="bi bi-clock-history"></i> 调试历史
                        </button>
                    </div>
                </div>

                <div className="script-scroll-content">
                {loading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>加载中...</p>
                    </div>
                ) : scripts.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🧰</div>
                        <h3>暂无脚本</h3>
                        <p>点击上方按钮创建第一个工具</p>
                    </div>
                ) : filteredScripts.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <h3>未找到匹配的脚本</h3>
                        <p>尝试使用其他关键词搜索</p>
                    </div>
                ) : (
                    <div className="script-list-container">
                        <div className="script-card-list">
                            {paginatedScripts.map((script, index) => (
                                <div key={script.id} className="script-item" style={{animationDelay: `${0.04 * index}s`}}>
                                    <div className="script-item-row-top">
                                        <span className="script-item-name">
                                            <img
                                                src={script.type === 'python' ? pythonLogo : shellLogo}
                                                alt={script.type}
                                                style={{width: 20, height: 20, verticalAlign: 'middle', objectFit: 'contain', marginRight: 6}}
                                            />
                                            {script.name}
                                        </span>
                                        <span className={`script-item-badge ${script.type === 'python' ? 'badge-blue' : 'badge-amber'}`}>
                                            {typeLabel(script.type)}
                                        </span>
                                        <span
                                            className={`script-item-badge ${script.debug_status === '已通过' ? 'badge-green' : debuggingMap[script.id] ? 'badge-yellow' : 'badge-red'}`}
                                        >
                                            {debuggingMap[script.id] ? (
                                                <><i className="bi bi-arrow-repeat spin" /> 正在调试中</>
                                            ) : (script.debug_status || '未通过')}
                                        </span>
                                    </div>
                                    <div className="script-item-row-bottom">
                                        <span className="script-item-desc">{script.description || '暂无描述'}</span>
                                        <div className="script-item-meta">
                                            <div className="script-item-meta-cell">
                                                <span className="meta-label">创建者</span>
                                                <span className="meta-val">{script.username || '—'}</span>
                                            </div>
                                            <div className="script-item-meta-cell">
                                                <span className="meta-label">更新时间</span>
                                                <span className="meta-val">{script.updated_at ? new Date(script.updated_at).toLocaleString('zh-CN') : '—'}</span>
                                            </div>
                                            <div className="script-item-meta-cell script-item-actions">
                                                <button className="btn-sm ts" style={{fontSize: 12}}
                                                        onClick={() => debuggingMap[script.id]
                                                            ? cancelDebug(script.id, debuggingMap[script.id])
                                                            : handleDebug(script)}>
                                                    {debuggingMap[script.id] ? '取消调试' : '▶ 调试'}
                                                </button>
                                                <button className="btn-icon" onClick={() => handleOpenModal(script)} title="编辑">
                                                    <i className="bi bi-pencil-fill"/>
                                                </button>
                                                <button className="btn-icon btn-danger" onClick={(e) => handleDelete(e, script)} title="删除">
                                                    <i className="bi bi-trash-fill"/>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                </div>

                {filteredScripts.length > 0 && (
                    <div className="pagination script-fixed-pagination">
                        <span className="pagination-info">共 {filteredScripts.length} 条，第 {currentPage}/{totalPages} 页</span>
                        <select value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}>
                            <option value={5}>5 条</option>
                            <option value={10}>10 条</option>
                            <option value={20}>20 条</option>
                            <option value={50}>50 条</option>
                        </select>
                        <div>
                            <button className="btn-sm" disabled={currentPage <= 1}
                                    onClick={() => setCurrentPage(p => p - 1)}>上一页
                            </button>
                            <button className="btn-sm" style={{marginLeft: 8}}
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}>下一页
                            </button>
                        </div>
                    </div>
                )}

                <Modal
                    open={showModal}
                    title={editingScript ? '编辑脚本' : '新建脚本'}
                    onClose={handleCloseModal}
                    width={960}
                >
                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="form-row">
                            <div className="form-group" style={{flex: 1}}>
                                <label>脚本名称 *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                                    placeholder="例如：数据清洗脚本"
                                    required
                                />
                            </div>
                            <div className="form-group" style={{flex: 0, minWidth: 140}}>
                                <label>类型</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => {
                                        const newType = e.target.value;
                                        setFormData((prev) => ({
                                            ...prev,
                                            type: newType,
                                            content: editingScript ? prev.content : TYPE_TEMPLATES[newType] || '',
                                        }));
                                    }}
                                >
                                    {SCRIPT_TYPES.map((t) => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>描述</label>
                            <input
                                type="text"
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                                placeholder="脚本功能简述..."
                            />
                        </div>

                        <div className="form-group">
                            <label>脚本内容</label>
                            <div className="code-editor-wrap">
                                <div className="code-editor-header">
                  <span className={`code-editor-lang ${formData.type}`}>
                    {formData.type === 'python' ?
                        <><i className="bi bi-filetype-py"
                             style={{fontSize: 16, verticalAlign: 'middle', marginRight: 4}}/> Python</> :
                        <span><i className="bi bi-filetype-sh"
                                 style={{fontSize: 16, verticalAlign: 'middle', marginRight: 2}}/> Shell</span>}
                  </span>
                                </div>
                                <div className="code-editor-body">
                                    <div className="code-editor-gutter" aria-hidden="true">
                                        {(formData.content || '').split('\n').map((_, i) => (
                                            <div key={i} className="code-editor-ln">{i + 1}</div>
                                        ))}
                                    </div>
                                    <CodeEditor
                                        value={formData.content}
                                        onChange={(e) => setFormData({...formData, content: e.target.value})}
                                        type={formData.type}
                                        placeholder={formData.type === 'python' ? '# 在此编写 Python 代码...' : '#!/ai-assistant-server/bash\n# 在此编写 Shell 脚本...'}
                                    />
                                </div>
                            </div>
                        </div>

                        {errorMessage &&
                            <div className="task-error-banner" style={{marginBottom: 12}}>{errorMessage}</div>}

                        <div className="modal-actions">
                            <button type="button" className="btn" onClick={handleCloseModal}>取消</button>
                            <button type="submit" className="btn btn-default">
                                <i className="bi bi-pencil-square"></i>
                                {editingScript ? '保存修改' : '创建脚本'}
                            </button>
                        </div>
                    </form>
                </Modal>

                {errorMessage && !showModal && (
                    <div className="task-error-banner" style={{marginTop: 12}}>{errorMessage}</div>
                )}

                {historyOpen && (
                    <div className="inspect-drawer-overlay">
                        <div className="inspect-drawer">
                            <div className="inspect-drawer-header">
                                <h3><i className="bi bi-clock-history"/> 调试历史</h3>
                                <button className="inspect-drawer-close" onClick={() => setHistoryOpen(false)}>✕</button>
                            </div>
                            <div className="inspect-drawer-body" style={{padding: 0, height: 'calc(100vh - 120px)'}}>
                                {historyLoading ? (
                                    <div style={{padding: 32, textAlign: 'center', color: 'var(--text-3)'}}>
                                        <i className="bi bi-arrow-repeat spin"/> 加载中...
                                    </div>
                                ) : historyList.length === 0 ? (
                                    <div style={{padding: 32, textAlign: 'center', color: 'var(--text-3)'}}>暂无调试记录</div>
                                ) : (
                                    <div style={{fontSize: 13, display: 'flex', flexDirection: 'column', height: '100%'}}>
                                        <div style={{flex: 1, overflowY: 'auto'}}>
                                        {historyList.map((item, i) => (
                                            <div key={item.id}>
                                                <div onClick={() => setSelectedHistoryId(selectedHistoryId === item.id ? null : item.id)}
                                                     style={{
                                                         display: 'flex', alignItems: 'center', gap: 8,
                                                         padding: '10px 16px', cursor: 'pointer',
                                                         background: selectedHistoryId === item.id ? 'var(--bg-3)' : 'transparent',
                                                         borderBottom: !selectedHistoryId || selectedHistoryId !== item.id
                                                             ? '1px solid var(--border-2)'
                                                             : 'none',
                                                     }}>
                                                    <span style={{
                                                        flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
                                                        background: item.status === 'completed' ? '#22c55e'
                                                            : item.status === 'cancelled' ? '#f59e0b'
                                                                : '#ef4444',
                                                    }}/>
                                                    <span style={{flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4}}>
                                                        <img src={item.script_type === 'python' ? pythonLogo : shellLogo} alt={item.script_type || 'shell'} style={{width: 16, height: 16, flexShrink: 0, objectFit: 'contain'}}/>
                                                        {item.script_name || '未命名'}
                                                    </span>
                                                    <span style={{
                                                        fontSize: 11, flexShrink: 0,
                                                        padding: '1px 6px', borderRadius: 4,
                                                        background: item.status === 'completed' ? 'rgba(34,197,94,0.15)'
                                                            : item.status === 'cancelled' ? 'rgba(245,158,11,0.15)'
                                                            : item.status === 'running' ? 'rgba(99,102,241,0.15)'
                                                            : 'rgba(239,68,68,0.15)',
                                                        color: item.status === 'completed' ? '#22c55e'
                                                            : item.status === 'cancelled' ? '#f59e0b'
                                                            : item.status === 'running' ? '#6366f1'
                                                            : '#ef4444',
                                                    }}>
                                                        {statusLabel[item.status] || item.status}
                                                    </span>
                                                    <span style={{flexShrink: 0, color: 'var(--text-3)', fontSize: 11}}>
                                                        {formatTime(item.started_at)}
                                                    </span>
                                                    <span style={{flexShrink: 0, color: 'var(--text-3)', fontSize: 11}}>
                                                        <i className={`bi bi-chevron-${selectedHistoryId === item.id ? 'up' : 'down'}`}/>
                                                    </span>
                                                </div>
                                                {selectedHistoryId === item.id && (
                                                    <div style={{
                                                        padding: '4px 16px 12px',
                                                        background: 'var(--bg-3)',
                                                        borderBottom: '1px solid var(--border-2)',
                                                    }}>
                                                        {item.output ? (
                                                            <div style={{marginBottom: 6}}>
                                                                <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 2}}>执行结果:</div>
                                                                <pre style={{
                                                                    margin: 0, fontSize: 11, lineHeight: 1.5,
                                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                                                    background: '#1a1a1a', color: '#f0f0f0',
                                                                    padding: '8px 10px', borderRadius: 4,
                                                                    maxHeight: 120, overflowY: 'auto',
                                                                }}>{item.output}</pre>
                                                            </div>
                                                        ) : null}
                                                        {item.error ? (
                                                            <div>
                                                                <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 2}}>失败原因:</div>
                                                                <pre style={{
                                                                    margin: 0, fontSize: 11, lineHeight: 1.5,
                                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                                                    background: '#1a1a1a', color: '#ef4444',
                                                                    padding: '8px 10px', borderRadius: 4,
                                                                    maxHeight: 80, overflowY: 'auto',
                                                                }}>{item.error}</pre>
                                                            </div>
                                                        ) : null}
                                                        <div style={{marginTop: 6, fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16}}>
                                                            <span>返回码: {item.return_code}</span>
                                                            {item.finished_at && <span>完成时间: {formatTime(item.finished_at)}</span>}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        </div>
                                        <div style={{flexShrink: 0, borderTop: '1px solid var(--border-2)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12}}>
                                            <span style={{fontSize: 12, color: 'var(--text-3)'}}>
                                                共 {historyTotal} 条，第 {historyPage}/{historyTotalPages} 页
                                            </span>
                                            <select value={historyPageSize} onChange={(e) => {
                                                const v = Number(e.target.value);
                                                setHistoryPageSize(v);
                                                openHistory(1, v);
                                            }} style={{fontSize: 12, padding: '2px 4px'}}>
                                                <option value={5}>5 条</option>
                                                <option value={10}>10 条</option>
                                                <option value={20}>20 条</option>
                                                <option value={50}>50 条</option>
                                            </select>
                                            <div>
                                                <button className="btn-sm" style={{fontSize: 12, padding: '4px 10px'}}
                                                        disabled={historyPage <= 1}
                                                        onClick={() => openHistory(historyPage - 1, historyPageSize)}>上一页</button>
                                                <button className="btn-sm" style={{fontSize: 12, padding: '4px 10px', marginLeft: 6}}
                                                        disabled={historyPage >= historyTotalPages}
                                                        onClick={() => openHistory(historyPage + 1, historyPageSize)}>下一页</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
