import React, {useState, useEffect, useRef, useCallback} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import Modal from '../components/Modal';
import SSHTerminal from '../components/SSHTerminal';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {api, getStoredAuthToken} from '../api';

export default function HostList() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [hosts, setHosts] = useState([]);
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [page, setPage] = usePersistedState('hostListPage', 1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [perPage, setPerPage] = usePersistedState('hostListPerPage', 5);
    const [editingHost, setEditingHost] = useState(null);
    const [inspectTasks, setInspectTasks] = useState({});
    const [sshHost, setSshHost] = useState(null);
    const [sshOpen, setSshOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [allHosts, setAllHosts] = useState(null);
    const displayHosts = searchQuery ? (allHosts || hosts) : hosts;
    const filteredHosts = Array.isArray(displayHosts) ? displayHosts.filter(h =>
        h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (h.ip_address && h.ip_address.toLowerCase().includes(searchQuery.toLowerCase()))
    ) : [];
    const [formData, setFormData] = useState({
        name: '',
        ip_address: '',
        port: 22,
        username: '',
        auth_type: 'password',
        password: '',
        private_key: '',
        description: ''
    });

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    useEffect(() => {
        if (!cmdbBase) return;
        (async () => {
            try {
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=host&resource_id=*&permission=host:read`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看主机列表');
                        setLoading(false);
                        return;
                    }
                }
            } catch (_) {}
        })();
    }, [cmdbBase]);

    useEffect(() => {
        if (!cmdbBase) return;
        fetchHosts(page, perPage);
    }, [cmdbBase]);

    const fetchAllHosts = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const firstResp = await fetch(`${cmdbBase}/api/hosts?page=1&per_page=200`, {headers: getAuthHeaders()});
            if (!firstResp.ok) return;
            const firstData = await firstResp.json();
            if (!firstData || !Array.isArray(firstData.hosts)) return;
            let all = [...firstData.hosts];
            const totalPages = firstData.pages || 1;
            if (totalPages > 1) {
                const pages = [];
                for (let p = 2; p <= totalPages; p++) {
                    pages.push(p);
                }
                const results = await Promise.all(pages.map(p =>
                    fetch(`${cmdbBase}/api/hosts?page=${p}&per_page=200`, {headers: getAuthHeaders()})
                        .then(r => r.ok ? r.json() : null)
                ));
                results.forEach(r => {
                    if (r && Array.isArray(r.hosts)) all.push(...r.hosts);
                });
            }
            setAllHosts(all);
        } catch (_) {}
    }, [cmdbBase]);

    useEffect(() => {
        if (searchQuery) {
            fetchAllHosts();
        } else {
            setAllHosts(null);
        }
    }, [searchQuery, fetchAllHosts]);

    const fetchInspectTasks = useCallback(async () => {
        if (!apiBase) return;
        try {
            const resp = await fetch(`${apiBase}/api/inspect-tasks`, {headers: getAuthHeaders()});
            if (resp.ok) {
                const data = await resp.json();
                const taskMap = {};
                (data.tasks || []).forEach(t => {
                    if (!taskMap[t.host_id] || new Date(t.created_at) > new Date(taskMap[t.host_id].created_at)) {
                        taskMap[t.host_id] = t;
                    }
                });
                setInspectTasks(taskMap);
            }
        } catch (_) {}
    }, [apiBase]);

    useEffect(() => {
        if (!apiBase) return;
        fetchInspectTasks();
        const interval = setInterval(fetchInspectTasks, 5000);
        return () => clearInterval(interval);
    }, [apiBase, fetchInspectTasks]);

    const getAuthHeaders = () => {
        const token = getStoredAuthToken();
        return token ? {'Authorization': `Bearer ${token}`} : {};
    };

    const fetchHosts = async (p = 1, pp) => {
        const pp_ = pp !== undefined ? pp : perPage;
        try {
            setLoading(true);
            const response = await fetch(`${cmdbBase}/api/hosts?page=${p}&per_page=${pp_}`, {headers: getAuthHeaders()});
            if (response.status === 403) {
                const err = await response.json().catch(() => ({error: '无权限查看主机列表'}));
                alert(`⚠️ 权限不足: ${err.error || '无权限查看主机列表'}`);
                return;
            }
            if (response.ok) {
                const data = await response.json();
                if (data && Array.isArray(data.hosts)) {
                    setHosts(data.hosts);
                    setTotal(data.total);
                    setTotalPages(data.pages);
                    setPage(data.page);
                }
            }
        } catch (err) {
            console.error('获取主机列表失败:', err);
        } finally {
            setLoading(false);
        }
    };

    const PWD_PLACEHOLDER = '••••••••';

    const handleOpenModal = (host = null) => {
        if (host) {
            setEditingHost(host);
            setFormData({
                name: host.name,
                ip_address: host.ip_address,
                port: host.port,
                username: host.username,
                auth_type: host.auth_type,
                password: host.has_password ? PWD_PLACEHOLDER : '',
                private_key: host.has_private_key ? PWD_PLACEHOLDER : '',
                description: host.description || ''
            });
        } else {
            setEditingHost(null);
            setFormData({
                name: '',
                ip_address: '',
                port: 22,
                username: '',
                auth_type: 'password',
                password: '',
                private_key: '',
                description: ''
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingHost(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editingHost
                ? `${cmdbBase}/api/hosts/${editingHost.id}`
                : `${cmdbBase}/api/hosts`;
            const method = editingHost ? 'PUT' : 'POST';

            const body = {...formData};
            if (editingHost) {
                if (body.password === PWD_PLACEHOLDER) body.password = '';
                if (body.private_key === PWD_PLACEHOLDER) body.private_key = '';
            }

            const response = await fetch(url, {
                method,
                headers: {'Content-Type': 'application/json', ...getAuthHeaders()},
                body: JSON.stringify(body)
            });

            if (response.ok) {
                handleCloseModal();
                fetchHosts(page, perPage);
            } else {
                const data = await response.json();
                alert(data.error || '操作失败');
            }
        } catch (err) {
            console.error('保存主机失败:', err);
            alert('保存失败');
        }
    };

    const handleDelete = async (e, hostId) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('确定要删除这个主机吗？')) return;
        try {
            const response = await fetch(`${cmdbBase}/api/hosts/${hostId}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            });
            if (response.ok) {
                fetchHosts(page, perPage);
            }
        } catch (err) {
            console.error('删除主机失败:', err);
        }
    };

    const handleInspect = async (host) => {
        if (!apiBase) return;
        if (!window.confirm(`确定要对 ${host.name} (${host.ip_address}) 执行AI巡检吗？`)) return;
        try {
            const resp = await fetch(`${apiBase}/api/hosts/${host.id}/inspect`, {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            if (resp.status === 403) {
                const err = await resp.json().catch(() => ({error: '无权限执行AI巡检'}));
                alert(`⚠️ 权限不足: ${err.error || '无权限执行AI巡检'}`);
                return;
            }
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({error: '巡检启动失败'}));
                alert(err.error);
                return;
            }
            const data = await resp.json();
            setInspectTasks(prev => ({
                ...prev,
                [host.id]: {host_id: host.id, host_name: host.name, host_ip: host.ip_address, status: 'running', id: data.task_id}
            }));
        } catch (err) {
            alert(`巡检启动失败: ${err.message}`);
        }
    };

    const viewInspectResult = (task) => {
        if (task.status === 'running') return;
        navigate(`/tasks/history?tab=inspect`);
    };

    const handleOpenSSH = (host) => {
        if (!window.confirm(`确定要 SSH 登录到 ${host.name} (${host.ip_address}) 吗？`)) {
            return;
        }
        setSshHost(host);
        setSshOpen(true);
    };

    const closeSSH = () => {
        if (!window.confirm('确定要断开 SSH 连接吗？')) {
            return;
        }
        setSshOpen(false);
        setSshHost(null);
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="主机管理"
                subtitle="管理远程主机连接"
                brandIcon="bi bi-laptop-fill"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content host-list-page">
                <div className="host-sticky-header">
                    <div className="host-filters">
                        <div className="host-search-box">
                            <span className="search-icon">
                                <i className="bi bi-search"></i>
                            </span>
                            <input
                                type="text"
                                placeholder="搜索主机..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="host-search-input"
                            />
                        </div>

                        <button className="btn btn-default" onClick={() => handleOpenModal()}>
                            <i className="bi bi-plus-circle"></i> 新建主机
                        </button>
                    </div>
                </div>

                <div className="host-scroll-content">
                {loading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>加载中...</p>
                    </div>
                ) : hosts.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🖥️</div>
                        <h3>暂无主机</h3>
                        <p>点击上方按钮添加第一个主机</p>
                    </div>
                ) : filteredHosts.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <h3>未找到匹配的主机</h3>
                        <p>尝试使用其他关键词搜索</p>
                    </div>
                ) : (
                    <div className="host-list-container">
                        <div className="host-card-list">
                            {filteredHosts.map((host, index) => (
                                <div key={host.id} className="host-item" style={{animationDelay: `${0.04 * index}s`}}>
                                    <div className="host-item-row-top">
                                        <span className="host-item-name">
                                            <i className="bi bi-laptop-fill" style={{marginRight: 6, fontSize: 13}}/>
                                            {host.name}
                                        </span>
                                        <span className="host-item-badge badge-ssh">{host.ip_address}</span>
                                        <span className={`host-item-badge ${host.auth_type === 'password' ? 'badge-amber' : 'badge-blue'}`}>
                                            {host.auth_type === 'password' ? '密码' : '密钥'}
                                        </span>
                                        {inspectTasks[host.id]?.status === 'running' ? (
                                            <span className="host-item-badge badge-yellow">
                                                <i className="bi bi-arrow-repeat spin"/> 巡检中
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="host-item-row-bottom">
                                        <span className="host-item-desc">{host.description || '暂无描述'}</span>
                                        <div className="host-item-meta">
                                            <div className="host-item-meta-cell">
                                                <span className="meta-label">用户名</span>
                                                <span className="meta-val">{host.username || '—'}</span>
                                            </div>
                                            <div className="host-item-meta-cell">
                                                <span className="meta-label">端口</span>
                                                <span className="meta-val">{host.port}</span>
                                            </div>
                                            <div className="host-item-meta-cell host-item-actions">
                                                <button className="btn-icon" onClick={() => handleOpenSSH(host)} title="AI SSH" style={{color: 'rgb(16, 185, 129)'}}>
                                                    <i className="bi bi-terminal"/>
                                                </button>
                                                {inspectTasks[host.id]?.status === 'running' ? null : (
                                                    <button className="btn-icon" onClick={() => handleInspect(host)} title="AI巡检" style={{color: 'rgb(59, 130, 246)'}}>
                                                        <i className="bi bi-send-check-fill"/>
                                                    </button>
                                                )}
                                                <button className="btn-icon" onClick={() => handleOpenModal(host)} title="编辑">
                                                    <i className="bi bi-pencil-fill"/>
                                                </button>
                                                <button className="btn-icon btn-danger" onClick={(e) => handleDelete(e, host.id)} title="删除">
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

                {hosts.length > 0 && (
                    <div className="pagination host-fixed-pagination">
                        <span className="pagination-info">第 {page}/{totalPages} 页，共 {total} 条</span>
                        <select value={perPage}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setPerPage(v);
                                    fetchHosts(1, v);
                                }}>
                            <option value={5}>5 条</option>
                            <option value={10}>10 条</option>
                            <option value={20}>20 条</option>
                            <option value={50}>50 条</option>
                        </select>
                        <div>
                            <button className="btn-sm" disabled={page <= 1}
                                    onClick={() => fetchHosts(page - 1, perPage)}>上一页
                            </button>
                            <button className="btn-sm" style={{marginLeft: 8}}
                                    disabled={page >= totalPages}
                                    onClick={() => fetchHosts(page + 1, perPage)}>下一页
                            </button>
                        </div>
                    </div>
                )}

                {sshOpen && (
                    <div className="inspect-drawer-overlay">
                        <div className="inspect-drawer" onClick={(e) => e.stopPropagation()}
                             style={{width: 800}}>
                            <div className="inspect-drawer-header">
                                <h3>AI SSH — {sshHost?.name}</h3>
                                <span style={{fontSize: 12, color: 'var(--text-3)', marginLeft: 8}}>
                                    {sshHost?.ip_address}:{sshHost?.port}
                                </span>
                                <button className="inspect-drawer-close" onClick={closeSSH}>✕</button>
                            </div>
                            <div className="inspect-drawer-body" style={{padding: 0, height: 'calc(100vh - 120px)'}}>
                                {sshHost && (
                                    <SSHTerminal host={sshHost} apiBase={apiBase} onClose={closeSSH} user={user}/>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <Modal
                    open={showModal}
                    title={editingHost ? '编辑主机' : '添加主机'}
                    onClose={handleCloseModal}
                    width={520}
                    closeOnOverlay={false}
                    icon={<i className="bi bi-laptop-fill"/>}
                >
                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="form-group">
                            <label>主机名称 *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({...formData, name: e.target.value})}
                                placeholder="例如：生产服务器"
                                required
                            />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>IP地址 *</label>
                                <input
                                    type="text"
                                    value={formData.ip_address}
                                    onChange={(e) => setFormData({...formData, ip_address: e.target.value})}
                                    placeholder="192.168.1.100"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>端口</label>
                                <input
                                    type="number"
                                    value={formData.port}
                                    onChange={(e) => setFormData({...formData, port: parseInt(e.target.value) || 22})}
                                    placeholder="22"
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label>用户名 *</label>
                            <input
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({...formData, username: e.target.value})}
                                placeholder="root"
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>认证方式</label>
                            <select
                                value={formData.auth_type}
                                onChange={(e) => setFormData({...formData, auth_type: e.target.value})}
                            >
                                <option value="password">密码认证</option>
                                <option value="key">密钥认证</option>
                            </select>
                        </div>
                        {formData.auth_type === 'password' ? (
                            <div className="form-group">
                                <label>密码</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                                    placeholder={editingHost ? '留空则不修改' : '请输入密码'}
                                />
                            </div>
                        ) : (
                            <div className="form-group">
                                <label>私钥内容</label>
                                <textarea
                                    value={formData.private_key}
                                    onChange={(e) => setFormData({...formData, private_key: e.target.value})}
                                    placeholder="-----BEGIN RSA PRIVATE KEY-----"
                                    rows={4}
                                />
                            </div>
                        )}
                        <div className="form-group">
                            <label>描述</label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                                placeholder="主机用途描述..."
                                rows={2}
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn" onClick={handleCloseModal}>
                                取消
                            </button>
                            <button type="submit" className="btn btn-default">
                                <i className="bi bi-pencil-square"></i>
                                {editingHost ? '保存修改' : '添加主机'}
                            </button>
                        </div>
                    </form>
                </Modal>
            </div>
        </div>
    );
}
