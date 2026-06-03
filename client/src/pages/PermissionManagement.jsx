import React, {useState, useEffect, useCallback} from 'react';
import {Navigate, useNavigate, useSearchParams} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getCmdbApiBase} from '../config';
import AppSidebar from '../components/AppSidebar';

const TABS = [
    {key: 'users', label: '用户管理', icon: 'bi bi-people'},
    {key: 'roles', label: '角色管理', icon: 'bi bi-shield-check'},
    {key: 'groups', label: '用户组', icon: 'bi bi-layers'},
    {key: 'permissions', label: '权限列表', icon: 'bi bi-shield-plus'},
];

async function apiRequest(base, path, options = {}) {
    const token = localStorage.getItem('promptflow_auth_token');
    const res = await fetch(`${base}/api${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
            ...options.headers,
        },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({error: res.statusText}));
        if (res.status === 403) {
            alert(`⚠️ 权限不足: ${err.error || '无权限执行此操作'}`);
            return;
        }
        throw new Error(err.error || '请求失败');
    }
    return res.json();
}

export default function PermissionManagement() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [cmdbBase, setCmdbBase] = useState('');
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'users');
    const [loading, setLoading] = useState(false);

    // Data states
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [groups, setGroups] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [resourcePerms, setResourcePerms] = useState([]);

    // Selection
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);
    const [selectedGroup, setSelectedGroup] = useState(null);

    // Role detail
    const [rolePerms, setRolePerms] = useState([]);
    // Group detail
    const [groupMembers, setGroupMembers] = useState([]);
    const [groupRoles, setGroupRoles] = useState([]);
    // User detail
    const [userRoles, setUserRoles] = useState([]);
    const [userPerms, setUserPerms] = useState([]);

    // Modals
    const [showRoleForm, setShowRoleForm] = useState(false);
    const [showGroupForm, setShowGroupForm] = useState(false);
    const [showResourcePermForm, setShowResourcePermForm] = useState(false);
    const [showGroupMemberForm, setShowGroupMemberForm] = useState(false);

    const [formData, setFormData] = useState({name: '', description: ''});
    const [resourceForm, setResourceForm] = useState({
        resource_type: '', resource_id: '', user_id: '', group_id: '',
        role_id: '', permission_code: '', effect: 'allow',
    });

    // User search
    const [userSearch, setUserSearch] = useState('');

    useEffect(() => {
        loadConfig().then(() => setCmdbBase(getCmdbApiBase()));
    }, []);

    const fetchUsers = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const data = await apiRequest(cmdbBase, '/users');
            setUsers(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    }, [cmdbBase]);

    const fetchRoles = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const data = await apiRequest(cmdbBase, '/roles');
            setRoles(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    }, [cmdbBase]);

    const fetchGroups = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const data = await apiRequest(cmdbBase, '/user-groups');
            setGroups(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    }, [cmdbBase]);

    const fetchPermissions = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const data = await apiRequest(cmdbBase, '/permissions');
            setPermissions(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    }, [cmdbBase]);

    const fetchResourcePerms = useCallback(async () => {
        if (!cmdbBase) return;
        try {
            const data = await apiRequest(cmdbBase, '/resource-permissions');
            setResourcePerms(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    }, [cmdbBase]);

    useEffect(() => {
        if (!cmdbBase) return;
        (async () => {
            const token = localStorage.getItem('promptflow_auth_token');
            try {
                const check = await fetch(`${cmdbBase}/api/check-permission?resource_type=permission&resource_id=*&permission=permission:manage`, {
                    headers: token ? {Authorization: `Bearer ${token}`} : {},
                });
                const result = await check.json();
                if (!result.allowed) {
                    alert('⚠️ 无权限访问权限管理');
                    navigate('/platform-config');
                    return;
                }
            } catch {
                alert('⚠️ 无权限访问权限管理');
                navigate('/platform-config');
                return;
            }
            fetchUsers();
            fetchRoles();
            fetchGroups();
            fetchPermissions();
            fetchResourcePerms();
        })();
    }, [cmdbBase, fetchUsers, fetchRoles, fetchGroups, fetchPermissions, fetchResourcePerms]);

    // User detail
    const selectUser = async (u) => {
        setSelectedUser(u);
        try {
            const [rolesData, permsData] = await Promise.all([
                apiRequest(cmdbBase, `/users/${u.id}/roles`),
                apiRequest(cmdbBase, `/users/${u.id}/permissions`),
            ]);
            setUserRoles(Array.isArray(rolesData) ? rolesData : []);
            setUserPerms(Array.isArray(permsData) ? permsData : []);
        } catch (e) {
            console.error(e);
        }
    };

    // Role detail
    const selectRole = async (r) => {
        setSelectedRole(r);
        try {
            const data = await apiRequest(cmdbBase, `/roles/${r.id}/permissions`);
            setRolePerms(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        }
    };

    // Group detail
    const selectGroup = async (g) => {
        setSelectedGroup(g);
        try {
            const [members, roles] = await Promise.all([
                apiRequest(cmdbBase, `/user-groups/${g.id}/members`),
                apiRequest(cmdbBase, `/user-groups/${g.id}/roles`),
            ]);
            setGroupMembers(Array.isArray(members) ? members : []);
            setGroupRoles(Array.isArray(roles) ? roles : []);
        } catch (e) {
            console.error(e);
        }
    };

    const handleLogout = async () => logout();

    if (!user) return <Navigate to="/login" replace/>;

    const filteredUsers = users.filter(u =>
        u.username.toLowerCase().includes(userSearch.toLowerCase())
    );

    const permGrouped = {};
    permissions.forEach(p => {
        if (!permGrouped[p.resource_type]) permGrouped[p.resource_type] = [];
        permGrouped[p.resource_type].push(p);
    });

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="权限管理"
                subtitle="权限管理"
                brandIcon="bi bi-shield-lock"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page"
                 style={{display: 'flex', flexDirection: 'column'}}>
                <div style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 12,
                    padding: 24,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 16,
                        flexShrink: 0
                    }}>
                        <button className="btn" onClick={() => navigate('/platform-config')}
                                style={{display: 'flex', alignItems: 'center', gap: 4}}>
                            <i className="bi bi-arrow-left"/> 返回平台配置
                        </button>
                        <div style={{fontSize: 13, color: 'var(--text-3)'}}>
                            {activeTab === 'users' && `${users.length} 个用户`}
                            {activeTab === 'roles' && `${roles.length} 个角色`}
                            {activeTab === 'groups' && `${groups.length} 个用户组`}
                            {activeTab === 'permissions' && `${permissions.length} 个权限`}
                        </div>
                    </div>
                    {/* Tabs */}
                    <div style={{
                        display: 'flex',
                        gap: 2,
                        marginBottom: 20,
                        borderBottom: '1px solid var(--border-2)',
                        flexShrink: 0
                    }}>
                        {TABS.map(tab => (
                            <button key={tab.key}
                                    onClick={() => {
                                        setActiveTab(tab.key);
                                        setSelectedUser(null);
                                        setSelectedRole(null);
                                        setSelectedGroup(null);
                                        setSearchParams({tab: tab.key});
                                    }}
                                    style={{
                                        padding: '10px 18px', fontSize: 14, cursor: 'pointer',
                                        background: 'transparent',
                                        color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-2)',
                                        border: 'none',
                                        borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        fontWeight: activeTab === tab.key ? 600 : 400,
                                        transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => {
                                        if (activeTab !== tab.key) e.currentTarget.style.color = 'var(--text)';
                                    }}
                                    onMouseLeave={e => {
                                        if (activeTab !== tab.key) e.currentTarget.style.color = 'var(--text-2)';
                                    }}
                            >
                                <i className={tab.icon}/> {tab.label}
                            </button>
                        ))}
                    </div>
                    <div style={{flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column'}}>

                        {/* Users Tab */}
                        {activeTab === 'users' && (
                            <div style={{display: 'flex', gap: 20, flex: 1, minHeight: 0, overflow: 'hidden'}}>
                                <div style={{
                                    flex: '0 0 320px', display: 'flex', flexDirection: 'column',
                                    border: '1px solid var(--border-2)', borderRadius: 10,
                                    background: 'var(--surface)', overflow: 'hidden',
                                }}>
                                    <div style={{
                                        padding: '12px 14px',
                                        borderBottom: '1px solid var(--border-2)',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: 'var(--text-2)'
                                    }}>
                                        <i className="bi bi-people"/> 用户列表 · {users.length}
                                    </div>
                                    <div style={{padding: '10px 14px'}}>
                                        <input
                                            placeholder="搜索用户..."
                                            value={userSearch} onChange={e => setUserSearch(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 12px', borderRadius: 6,
                                                border: '1px solid var(--border-2)', background: 'var(--surface-2)',
                                                color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                                            }}
                                        />
                                    </div>
                                    <div style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '0 8px 8px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2
                                    }}>
                                        {filteredUsers.map(u => (
                                            <div key={u.id}
                                                 onClick={() => selectUser(u)}
                                                 style={{
                                                     padding: '9px 12px', borderRadius: 6, cursor: 'pointer',
                                                     background: selectedUser?.id === u.id ? 'var(--accent)' : 'transparent',
                                                     color: selectedUser?.id === u.id ? '#fff' : 'var(--text)',
                                                     display: 'flex', alignItems: 'center', gap: 8, fontSize: 14,
                                                 }}>
                                                <i className="bi bi-person-circle"/>
                                                <span>{u.username}</span>
                                            </div>
                                        ))}
                                        {filteredUsers.length === 0 && (
                                            <div style={{
                                                color: 'var(--text-3)',
                                                padding: 20,
                                                textAlign: 'center'
                                            }}>暂无用户</div>
                                        )}
                                    </div>
                                </div>

                                <div style={{flex: 1, overflowY: 'auto'}}>
                                    {selectedUser ? (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            padding: 24
                                        }}>
                                            <h3 style={{
                                                margin: '0 0 20px',
                                                fontSize: 18,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8
                                            }}>
                                                <i className="bi bi-person-circle"/> {selectedUser.username}
                                            </h3>

                                            <div style={{marginBottom: 24}}>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: 12
                                                }}>
                                                    <span style={{fontSize: 14, fontWeight: 600}}>已分配角色</span>
                                                    <button className="btn btn-default" onClick={async () => {
                                                        const allRoleIds = roles.map(r => r.id);
                                                        try {
                                                            await apiRequest(cmdbBase, `/users/${selectedUser.id}/roles`, {
                                                                method: 'POST',
                                                                body: {role_ids: allRoleIds},
                                                            });
                                                            selectUser(selectedUser);
                                                        } catch (e) {
                                                            alert(e.message);
                                                        }
                                                    }} style={{fontSize: 12}}><i className="bi bi-check-all"/> 全选
                                                    </button>
                                                </div>
                                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                    {roles.map(r => {
                                                        const assigned = userRoles.some(ur => ur.id === r.id);
                                                        return (
                                                            <div key={r.id}
                                                                 onClick={async () => {
                                                                     const newIds = assigned
                                                                         ? userRoles.filter(ur => ur.id !== r.id).map(ur => ur.id)
                                                                         : [...userRoles.map(ur => ur.id), r.id];
                                                                     try {
                                                                         await apiRequest(cmdbBase, `/users/${selectedUser.id}/roles`, {
                                                                             method: 'POST',
                                                                             body: {role_ids: newIds},
                                                                         });
                                                                         selectUser(selectedUser);
                                                                     } catch (e) {
                                                                         alert(e.message);
                                                                     }
                                                                 }}
                                                                 style={{
                                                                     padding: '6px 14px',
                                                                     borderRadius: 20,
                                                                     cursor: 'pointer',
                                                                     fontSize: 13,
                                                                     border: '1px solid var(--border-2)',
                                                                     background: assigned ? 'var(--accent)' : 'var(--surface-2)',
                                                                     color: assigned ? '#fff' : 'var(--text)',
                                                                 }}>
                                                                {assigned ? '✓ ' : ''}{r.name}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div>
                                                <span style={{
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    marginBottom: 12,
                                                    display: 'block'
                                                }}>有效权限</span>
                                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                    {userPerms.map(p => (
                                                        <span key={p.id} style={{
                                                            padding: '4px 10px',
                                                            borderRadius: 4,
                                                            fontSize: 12,
                                                            background: 'var(--surface-2)',
                                                            border: '1px solid var(--border-2)',
                                                            color: 'var(--text-2)',
                                                        }}>{p.code}</span>
                                                    ))}
                                                    {userPerms.length === 0 && (
                                                        <span style={{
                                                            color: 'var(--text-3)',
                                                            fontSize: 13
                                                        }}>暂无权限</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            color: 'var(--text-3)',
                                            textAlign: 'center',
                                            padding: 60
                                        }}>
                                            <i className="bi bi-person" style={{fontSize: 48}}/><br/>
                                            请选择一个用户查看详情
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Roles Tab */}
                        {activeTab === 'roles' && (
                            <div style={{display: 'flex', gap: 20, flex: 1, minHeight: 0, overflow: 'hidden'}}>
                                <div style={{
                                    flex: '0 0 280px', display: 'flex', flexDirection: 'column',
                                    border: '1px solid var(--border-2)', borderRadius: 10,
                                    background: 'var(--surface)', overflow: 'hidden',
                                }}>
                                    <div style={{
                                        padding: '12px 14px',
                                        borderBottom: '1px solid var(--border-2)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                <span style={{fontSize: 13, fontWeight: 600, color: 'var(--text-2)'}}>
                                    <i className="bi bi-shield-check"/> 角色列表 · {roles.length}
                                </span>
                                        <button className="btn btn-default" onClick={() => {
                                            setFormData({name: '', description: ''});
                                            setShowRoleForm(true);
                                        }} style={{fontSize: 12, padding: '4px 10px'}}><i
                                            className="bi bi-plus-circle"/> 新建
                                        </button>
                                    </div>
                                    <div style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '8px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2
                                    }}>
                                        {roles.map(r => (
                                            <div key={r.id}
                                                 onClick={() => selectRole(r)}
                                                 style={{
                                                     padding: '9px 12px',
                                                     borderRadius: 6,
                                                     cursor: 'pointer',
                                                     background: selectedRole?.id === r.id ? 'var(--accent)' : 'transparent',
                                                     color: selectedRole?.id === r.id ? '#fff' : 'var(--text)',
                                                     display: 'flex',
                                                     alignItems: 'center',
                                                     justifyContent: 'space-between',
                                                     fontSize: 14,
                                                 }}>
                                                <span><i className="bi bi-shield-check"/> {r.name}</span>
                                                {r.is_system && <span style={{fontSize: 11, opacity: 0.6}}>系统</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{flex: 1, overflowY: 'auto'}}>
                                    {selectedRole ? (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            padding: 24
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                marginBottom: 12
                                            }}>
                                                <h3 style={{
                                                    margin: 0,
                                                    fontSize: 18,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8
                                                }}>
                                                    <i className="bi bi-shield-check"/> {selectedRole.name}
                                                    {selectedRole.is_system && <span style={{
                                                        fontSize: 12, marginLeft: 4, padding: '2px 8px',
                                                        borderRadius: 4, background: 'var(--surface-2)',
                                                        color: 'var(--text-3)',
                                                    }}>系统角色</span>}
                                                </h3>
                                                <div style={{display: 'flex', gap: 8}}>
                                                    <button className="btn btn-default" onClick={async () => {
                                                        const allPermIds = permissions.map(p => p.id);
                                                        try {
                                                            await apiRequest(cmdbBase, `/roles/${selectedRole.id}/permissions`, {
                                                                method: 'POST',
                                                                body: {permission_ids: allPermIds},
                                                            });
                                                            selectRole(selectedRole);
                                                        } catch (e) {
                                                            alert(e.message);
                                                        }
                                                    }} style={{fontSize: 12}}><i className="bi bi-check-all"/> 全选
                                                    </button>
                                                    {!selectedRole.is_system && (
                                                        <button className="btn" style={{color: '#ef4444'}}
                                                                onClick={async () => {
                                                                    if (!window.confirm(`确定删除角色"${selectedRole.name}"？`)) return;
                                                                    try {
                                                                        await apiRequest(cmdbBase, `/roles/${selectedRole.id}`, {method: 'DELETE'});
                                                                        setSelectedRole(null);
                                                                        fetchRoles();
                                                                    } catch (e) {
                                                                        alert(e.message);
                                                                    }
                                                                }}>
                                                            <i className="bi bi-trash"/> 删除
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <p style={{
                                                color: 'var(--text-3)',
                                                fontSize: 13,
                                                marginBottom: 20,
                                                paddingBottom: 16,
                                                borderBottom: '1px solid var(--border-2)'
                                            }}>
                                                {selectedRole.description || '暂无描述'}
                                            </p>

                                            <span style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                                marginBottom: 12,
                                                display: 'block'
                                            }}>权限列表</span>
                                            {Object.entries(permGrouped).map(([resourceType, perms]) => (
                                                <div key={resourceType} style={{marginBottom: 16}}>
                                                    <div style={{
                                                        fontSize: 13, fontWeight: 600, marginBottom: 8,
                                                        color: 'var(--text-2)', textTransform: 'capitalize',
                                                    }}>{resourceType}</div>
                                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                        {perms.map(p => {
                                                            const assigned = rolePerms.some(rp => rp.id === p.id);
                                                            return (
                                                                <div key={p.id}
                                                                     onClick={async () => {
                                                                         const newIds = assigned
                                                                             ? rolePerms.filter(rp => rp.id !== p.id).map(rp => rp.id)
                                                                             : [...rolePerms.map(rp => rp.id), p.id];
                                                                         try {
                                                                             await apiRequest(cmdbBase, `/roles/${selectedRole.id}/permissions`, {
                                                                                 method: 'POST',
                                                                                 body: {permission_ids: newIds},
                                                                             });
                                                                             selectRole(selectedRole);
                                                                         } catch (e) {
                                                                             alert(e.message);
                                                                         }
                                                                     }}
                                                                     style={{
                                                                         padding: '4px 12px',
                                                                         borderRadius: 14,
                                                                         cursor: 'pointer',
                                                                         fontSize: 12,
                                                                         border: '1px solid var(--border-2)',
                                                                         background: assigned ? 'var(--accent)' : 'var(--surface-2)',
                                                                         color: assigned ? '#fff' : 'var(--text)',
                                                                     }}>
                                                                    {assigned ? '✓ ' : ''}{p.action || p.code}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            color: 'var(--text-3)',
                                            textAlign: 'center',
                                            padding: 60
                                        }}>
                                            <i className="bi bi-shield-check" style={{fontSize: 48}}/><br/>
                                            请选择一个角色查看和编辑权限
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Groups Tab */}
                        {activeTab === 'groups' && (
                            <div style={{display: 'flex', gap: 20, flex: 1, minHeight: 0, overflow: 'hidden'}}>
                                <div style={{
                                    flex: '0 0 280px', display: 'flex', flexDirection: 'column',
                                    border: '1px solid var(--border-2)', borderRadius: 10,
                                    background: 'var(--surface)', overflow: 'hidden',
                                }}>
                                    <div style={{
                                        padding: '12px 14px',
                                        borderBottom: '1px solid var(--border-2)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                <span style={{fontSize: 13, fontWeight: 600, color: 'var(--text-2)'}}>
                                    <i className="bi bi-layers"/> 用户组列表 · {groups.length}
                                </span>
                                        <button className="btn btn-default" onClick={() => {
                                            setFormData({name: '', description: ''});
                                            setShowGroupForm(true);
                                        }} style={{fontSize: 12, padding: '4px 10px'}}><i
                                            className="bi bi-plus-circle"/> 新建
                                        </button>
                                    </div>
                                    <div style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: '8px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2
                                    }}>
                                        {groups.map(g => (
                                            <div key={g.id}
                                                 onClick={() => selectGroup(g)}
                                                 style={{
                                                     padding: '9px 12px',
                                                     borderRadius: 6,
                                                     cursor: 'pointer',
                                                     background: selectedGroup?.id === g.id ? 'var(--accent)' : 'transparent',
                                                     color: selectedGroup?.id === g.id ? '#fff' : 'var(--text)',
                                                     fontSize: 14,
                                                 }}>
                                                <i className="bi bi-layers"/> {g.name}
                                            </div>
                                        ))}
                                        {groups.length === 0 && (
                                            <div style={{
                                                color: 'var(--text-3)',
                                                padding: 20,
                                                textAlign: 'center'
                                            }}>暂无用户组</div>
                                        )}
                                    </div>
                                </div>

                                <div style={{flex: 1, overflowY: 'auto'}}>
                                    {selectedGroup ? (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            padding: 24
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                marginBottom: 20
                                            }}>
                                                <h3 style={{
                                                    margin: 0,
                                                    fontSize: 18,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8
                                                }}>
                                                    <i className="bi bi-layers"/> {selectedGroup.name}
                                                </h3>
                                                <button className="btn" style={{color: '#ef4444'}}
                                                        onClick={async () => {
                                                            if (!window.confirm(`确定删除用户组"${selectedGroup.name}"？`)) return;
                                                            try {
                                                                await apiRequest(cmdbBase, `/user-groups/${selectedGroup.id}`, {method: 'DELETE'});
                                                                setSelectedGroup(null);
                                                                fetchGroups();
                                                            } catch (e) {
                                                                alert(e.message);
                                                            }
                                                        }}>
                                                    <i className="bi bi-trash"/> 删除
                                                </button>
                                            </div>

                                            {/* Members */}
                                            <div style={{marginBottom: 24}}>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: 10
                                                }}>
                                                    <span style={{
                                                        fontSize: 14,
                                                        fontWeight: 600
                                                    }}>成员 ({groupMembers.length})</span>
                                                    <button className="btn btn-default"
                                                            onClick={() => setShowGroupMemberForm(true)}
                                                            style={{fontSize: 12}}><i
                                                        className="bi bi-person-plus"/> 添加成员
                                                    </button>
                                                </div>
                                                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                                                    {groupMembers.map(m => (
                                                        <div key={m.user_id} style={{
                                                            display: 'flex', justifyContent: 'space-between',
                                                            alignItems: 'center', padding: '8px 12px',
                                                            background: 'var(--surface-2)', borderRadius: 6,
                                                        }}>
                                                            <span><i
                                                                className="bi bi-person-circle"/> {m.username}</span>
                                                            <button className="btn"
                                                                    style={{color: '#ef4444', padding: '2px 8px'}}
                                                                    onClick={async () => {
                                                                        try {
                                                                            await apiRequest(cmdbBase, `/user-groups/${selectedGroup.id}/members/${m.user_id}`, {method: 'DELETE'});
                                                                            selectGroup(selectedGroup);
                                                                        } catch (e) {
                                                                            alert(e.message);
                                                                        }
                                                                    }}>移除
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {groupMembers.length === 0 && (
                                                        <div style={{
                                                            color: 'var(--text-3)',
                                                            fontSize: 13,
                                                            textAlign: 'center',
                                                            padding: 16
                                                        }}>暂无成员</div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Group Roles */}
                                            <div>
                                                <span style={{
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    marginBottom: 12,
                                                    display: 'block'
                                                }}>已分配角色</span>
                                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                    {roles.map(r => {
                                                        const assigned = groupRoles.some(gr => gr.id === r.id);
                                                        return (
                                                            <div key={r.id}
                                                                 onClick={async () => {
                                                                     const newIds = assigned
                                                                         ? groupRoles.filter(gr => gr.id !== r.id).map(gr => gr.id)
                                                                         : [...groupRoles.map(gr => gr.id), r.id];
                                                                     try {
                                                                         await apiRequest(cmdbBase, `/user-groups/${selectedGroup.id}/roles`, {
                                                                             method: 'POST',
                                                                             body: {role_ids: newIds},
                                                                         });
                                                                         selectGroup(selectedGroup);
                                                                     } catch (e) {
                                                                         alert(e.message);
                                                                     }
                                                                 }}
                                                                 style={{
                                                                     padding: '6px 14px',
                                                                     borderRadius: 20,
                                                                     cursor: 'pointer',
                                                                     fontSize: 13,
                                                                     border: '1px solid var(--border-2)',
                                                                     background: assigned ? 'var(--accent)' : 'var(--surface-2)',
                                                                     color: assigned ? '#fff' : 'var(--text)',
                                                                 }}>
                                                                {assigned ? '✓ ' : ''}{r.name}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 10,
                                            background: 'var(--surface)',
                                            color: 'var(--text-3)',
                                            textAlign: 'center',
                                            padding: 60
                                        }}>
                                            <i className="bi bi-layers" style={{fontSize: 48}}/><br/>
                                            请选择一个用户组查看详情
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Permissions Tab */}
                        {activeTab === 'permissions' && (
                            <div style={{height: '100%', overflowY: 'auto'}}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 16,
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 1,
                                    background: 'var(--surface)',
                                    paddingTop: 4,
                                    paddingBottom: 4
                                }}>
                                    <span style={{
                                        fontSize: 15,
                                        fontWeight: 600
                                    }}><i className="bi bi-shield-check" style={{marginRight: 2}}/> 权限定义列表 · {permissions.length}</span>
                                    <button className="btn btn-default" onClick={() => setShowResourcePermForm(true)}>
                                        <i className="bi bi-shield-plus"/> 资源授权
                                    </button>
                                </div>

                                <div style={{
                                    border: '1px solid var(--border-2)',
                                    borderRadius: 10,
                                    background: 'var(--surface)',
                                    padding: 20,
                                    marginBottom: 24
                                }}>
                                    {Object.entries(permGrouped).map(([resourceType, perms]) => (
                                        <div key={resourceType} style={{marginBottom: perms.length ? 16 : 0}}>
                                            <div style={{
                                                fontSize: 13, fontWeight: 600, marginBottom: 8,
                                                color: 'var(--text-2)', textTransform: 'capitalize',
                                            }}>
                                                {resourceType} <span style={{
                                                fontWeight: 400,
                                                color: 'var(--text-3)'
                                            }}>({perms.length})</span>
                                            </div>
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                {perms.map(p => (
                                                    <span key={p.id} style={{
                                                        padding: '4px 10px',
                                                        borderRadius: 4,
                                                        fontSize: 12,
                                                        background: 'var(--surface-2)',
                                                        border: '1px solid var(--border-2)',
                                                        color: 'var(--text-2)',
                                                    }} title={p.description}>{p.code}（{p.name}）</span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                    {permissions.length === 0 && (
                                        <div style={{
                                            color: 'var(--text-3)',
                                            textAlign: 'center',
                                            padding: 20
                                        }}>暂无权限定义</div>
                                    )}
                                </div>

                                {/* Resource Permissions List */}
                                <div style={{
                                    border: '1px solid var(--border-2)',
                                    borderRadius: 10,
                                    background: 'var(--surface)',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        padding: '14px 16px',
                                        borderBottom: '1px solid var(--border-2)',
                                        fontSize: 14,
                                        fontWeight: 600
                                    }}>
                                        资源级权限
                                    </div>
                                    <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 13}}>
                                        <thead>
                                        <tr style={{background: 'var(--surface-2)'}}>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>资源类型
                                            </th>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>资源ID
                                            </th>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>权限
                                            </th>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>用户/组
                                            </th>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>效果
                                            </th>
                                            <th style={{
                                                textAlign: 'left',
                                                padding: '10px 14px',
                                                fontWeight: 600,
                                                fontSize: 12,
                                                color: 'var(--text-2)'
                                            }}>操作
                                            </th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {resourcePerms.map(rp => {
                                            const subjName = rp.user_id
                                                ? (users.find(u => u.id === rp.user_id)?.username || rp.user_id)
                                                : rp.group_id
                                                    ? (groups.find(g => g.id === rp.group_id)?.name || rp.group_id)
                                                    : rp.role_id
                                                        ? (roles.find(r => r.id === rp.role_id)?.name || rp.role_id)
                                                        : '所有';
                                            const subjType = rp.user_id ? '用户' : rp.group_id ? '组' : rp.role_id ? '角色' : null;
                                            const subject = subjType ? `${subjType}:${subjName}` : '所有';
                                            return (
                                                <tr key={rp.id} style={{borderBottom: '1px solid var(--border-2)'}}>
                                                    <td style={{padding: '8px 12px'}}>{rp.resource_type}</td>
                                                    <td style={{
                                                        padding: '8px 12px',
                                                        fontSize: 12
                                                    }}>{rp.resource_id}</td>
                                                    <td style={{padding: '8px 12px'}}>{rp.permission_code}</td>
                                                    <td style={{padding: '8px 12px'}}>{subject}</td>
                                                    <td style={{padding: '8px 12px'}}>
                                                <span style={{
                                                    padding: '2px 8px', borderRadius: 4, fontSize: 12,
                                                    background: rp.effect === 'allow' ? '#065f4620' : '#ef444420',
                                                    color: rp.effect === 'allow' ? '#065f46' : '#ef4444',
                                                }}>{rp.effect}</span>
                                                    </td>
                                                    <td style={{padding: '8px 12px'}}>
                                                        <button className="btn"
                                                                style={{color: '#ef4444', padding: '2px 8px'}}
                                                                onClick={async () => {
                                                                    if (!window.confirm('确定删除此资源权限？')) return;
                                                                    try {
                                                                        await apiRequest(cmdbBase, `/resource-permissions/${rp.id}`, {method: 'DELETE'});
                                                                        fetchResourcePerms();
                                                                    } catch (e) {
                                                                        alert(e.message);
                                                                    }
                                                                }}>
                                                            <i className="bi bi-trash"/>
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {resourcePerms.length === 0 && (
                                            <tr>
                                                <td colSpan={6}
                                                    style={{padding: 20, textAlign: 'center', color: 'var(--text-3)'}}>
                                                    暂无资源级权限
                                                </td>
                                            </tr>
                                        )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Role Create/Edit Modal */}
                        {showRoleForm && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                            }} onClick={() => setShowRoleForm(false)}>
                                <div style={{
                                    background: 'var(--surface)', borderRadius: 12, padding: 0,
                                    width: 420, maxWidth: '90vw',
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                                    border: '1px solid var(--border-2)',
                                    overflow: 'hidden',
                                }} onClick={e => e.stopPropagation()}>
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '18px 24px', borderBottom: '1px solid var(--border-2)',
                                    }}>
                                        <h3 style={{
                                            margin: 0,
                                            fontSize: 16,
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8
                                        }}>
                                            <i className="bi bi-shield-check"/> 新建角色
                                        </h3>
                                        <button className="btn" onClick={() => setShowRoleForm(false)}
                                                style={{
                                                    padding: '4px 8px',
                                                    fontSize: 16,
                                                    border: 'none',
                                                    background: 'transparent'
                                                }}>
                                            <i className="bi bi-x-lg"/>
                                        </button>
                                    </div>
                                    <div style={{padding: 24}}>
                                        <div style={{marginBottom: 18}}>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 6,
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: 'var(--text-2)'
                                            }}>角色名称</label>
                                            <input
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                                placeholder="输入角色名称"
                                                autoFocus
                                                style={{
                                                    width: '100%', padding: '10px 14px', borderRadius: 8,
                                                    border: '1px solid var(--border-2)', background: 'var(--surface-2)',
                                                    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                                                    outline: 'none',
                                                }}
                                                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-2)'}
                                            />
                                        </div>
                                        <div style={{marginBottom: 24}}>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 6,
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: 'var(--text-2)'
                                            }}>描述</label>
                                            <textarea
                                                value={formData.description}
                                                onChange={e => setFormData({...formData, description: e.target.value})}
                                                placeholder="角色描述"
                                                rows={3}
                                                style={{
                                                    width: '100%',
                                                    padding: '10px 14px',
                                                    borderRadius: 8,
                                                    border: '1px solid var(--border-2)',
                                                    background: 'var(--surface-2)',
                                                    color: 'var(--text)',
                                                    fontSize: 14,
                                                    resize: 'vertical',
                                                    boxSizing: 'border-box',
                                                    outline: 'none',
                                                }}
                                                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-2)'}
                                            />
                                        </div>
                                        <div style={{display: 'flex', justifyContent: 'flex-end', gap: 10}}>
                                            <button className="btn" onClick={() => setShowRoleForm(false)}
                                                    style={{padding: '8px 20px', borderRadius: 8}}>取消
                                            </button>
                                            <button className="btn btn-default" onClick={async () => {
                                                if (!formData.name.trim()) return alert('请输入角色名称');
                                                try {
                                                    await apiRequest(cmdbBase, '/roles', {
                                                        method: 'POST',
                                                        body: formData
                                                    });
                                                    setShowRoleForm(false);
                                                    fetchRoles();
                                                } catch (e) {
                                                    alert(e.message);
                                                }
                                            }} style={{
                                                padding: '8px 20px',
                                                borderRadius: 8,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6
                                            }}>
                                                <i className="bi bi-check-lg"/> 创建
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Group Create Modal */}
                        {showGroupForm && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                            }} onClick={() => setShowGroupForm(false)}>
                                <div style={{
                                    background: 'var(--surface)', borderRadius: 12, padding: 0,
                                    width: 420, maxWidth: '90vw',
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                                    border: '1px solid var(--border-2)',
                                    overflow: 'hidden',
                                }} onClick={e => e.stopPropagation()}>
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '18px 24px', borderBottom: '1px solid var(--border-2)',
                                    }}>
                                        <h3 style={{
                                            margin: 0,
                                            fontSize: 16,
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8
                                        }}>
                                            <i className="bi bi-layers"/> 新建用户组
                                        </h3>
                                        <button className="btn" onClick={() => setShowGroupForm(false)}
                                                style={{
                                                    padding: '4px 8px',
                                                    fontSize: 16,
                                                    border: 'none',
                                                    background: 'transparent'
                                                }}>
                                            <i className="bi bi-x-lg"/>
                                        </button>
                                    </div>
                                    <div style={{padding: 24}}>
                                        <div style={{marginBottom: 18}}>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 6,
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: 'var(--text-2)'
                                            }}>用户组名称</label>
                                            <input
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                                placeholder="输入用户组名称"
                                                autoFocus
                                                style={{
                                                    width: '100%', padding: '10px 14px', borderRadius: 8,
                                                    border: '1px solid var(--border-2)', background: 'var(--surface-2)',
                                                    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                                                    outline: 'none',
                                                }}
                                                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-2)'}
                                            />
                                        </div>
                                        <div style={{marginBottom: 24}}>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 6,
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: 'var(--text-2)'
                                            }}>描述</label>
                                            <textarea
                                                value={formData.description}
                                                onChange={e => setFormData({...formData, description: e.target.value})}
                                                placeholder="用户组描述"
                                                rows={3}
                                                style={{
                                                    width: '100%',
                                                    padding: '10px 14px',
                                                    borderRadius: 8,
                                                    border: '1px solid var(--border-2)',
                                                    background: 'var(--surface-2)',
                                                    color: 'var(--text)',
                                                    fontSize: 14,
                                                    resize: 'vertical',
                                                    boxSizing: 'border-box',
                                                    outline: 'none',
                                                }}
                                                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-2)'}
                                            />
                                        </div>
                                        <div style={{display: 'flex', justifyContent: 'flex-end', gap: 10}}>
                                            <button className="btn" onClick={() => setShowGroupForm(false)}
                                                    style={{padding: '8px 20px', borderRadius: 8}}>取消
                                            </button>
                                            <button className="btn btn-default" onClick={async () => {
                                                if (!formData.name.trim()) return alert('请输入用户组名称');
                                                try {
                                                    await apiRequest(cmdbBase, '/user-groups', {
                                                        method: 'POST',
                                                        body: formData
                                                    });
                                                    setShowGroupForm(false);
                                                    fetchGroups();
                                                } catch (e) {
                                                    alert(e.message);
                                                }
                                            }} style={{
                                                padding: '8px 20px',
                                                borderRadius: 8,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6
                                            }}>
                                                <i className="bi bi-check-lg"/> 创建
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Add Group Member Modal */}
                        {showGroupMemberForm && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                            }} onClick={() => setShowGroupMemberForm(false)}>
                                <div style={{
                                    background: 'var(--surface)', borderRadius: 12, padding: 28,
                                    width: 400, maxWidth: '90vw',
                                }} onClick={e => e.stopPropagation()}>
                                    <h3 style={{
                                        margin: '0 0 16px',
                                        fontSize: 18
                                    }}>添加成员到「{selectedGroup?.name}」</h3>
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 4,
                                        maxHeight: 300,
                                        overflowY: 'auto'
                                    }}>
                                        {users.map(u => {
                                            const isMember = groupMembers.some(m => m.user_id === u.id);
                                            return (
                                                <div key={u.id}
                                                     onClick={async () => {
                                                         if (isMember) return;
                                                         try {
                                                             await apiRequest(cmdbBase, `/user-groups/${selectedGroup.id}/members`, {
                                                                 method: 'POST',
                                                                 body: {user_ids: [u.id]},
                                                             });
                                                             selectGroup(selectedGroup);
                                                         } catch (e) {
                                                             alert(e.message);
                                                         }
                                                     }}
                                                     style={{
                                                         padding: '8px 12px',
                                                         borderRadius: 6,
                                                         cursor: isMember ? 'default' : 'pointer',
                                                         background: 'var(--surface-2)',
                                                         opacity: isMember ? 0.5 : 1,
                                                         display: 'flex',
                                                         alignItems: 'center',
                                                         gap: 8,
                                                     }}>
                                                    <i className="bi bi-person-circle"/>
                                                    <span>{u.username}</span>
                                                    {isMember && <span style={{
                                                        marginLeft: 'auto',
                                                        fontSize: 12,
                                                        color: 'var(--accent)'
                                                    }}>已添加</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{marginTop: 16, display: 'flex', justifyContent: 'flex-end'}}>
                                        <button className="btn" onClick={() => setShowGroupMemberForm(false)}>关闭
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Resource Permission Modal */}
                        {showResourcePermForm && (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                            }} onClick={() => setShowResourcePermForm(false)}>
                                <div style={{
                                    background: 'var(--surface)', borderRadius: 12, padding: 28,
                                    width: 480, maxWidth: '90vw',
                                }} onClick={e => e.stopPropagation()}>
                                    <h3 style={{margin: '0 0 16px', fontSize: 18}}>新建资源权限</h3>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 12,
                                        marginBottom: 14
                                    }}>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>资源类型</label>
                                            <input value={resourceForm.resource_type}
                                                   onChange={e => setResourceForm({
                                                       ...resourceForm,
                                                       resource_type: e.target.value
                                                   })}
                                                   placeholder="如: host"
                                                   style={inputStyle}/>
                                        </div>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>资源ID</label>
                                            <input value={resourceForm.resource_id}
                                                   onChange={e => setResourceForm({
                                                       ...resourceForm,
                                                       resource_id: e.target.value
                                                   })}
                                                   placeholder="资源UUID"
                                                   style={inputStyle}/>
                                        </div>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>权限代码</label>
                                            <select value={resourceForm.permission_code}
                                                    onChange={e => setResourceForm({
                                                        ...resourceForm,
                                                        permission_code: e.target.value
                                                    })}
                                                    style={inputStyle}>
                                                <option value="">选择权限</option>
                                                {permissions.map(p => (
                                                    <option key={p.id} value={p.code}>{p.code}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>效果</label>
                                            <select value={resourceForm.effect}
                                                    onChange={e => setResourceForm({
                                                        ...resourceForm,
                                                        effect: e.target.value
                                                    })}
                                                    style={inputStyle}>
                                                <option value="allow">允许</option>
                                                <option value="deny">拒绝</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>用户 (可选)</label>
                                            <select value={resourceForm.user_id}
                                                    onChange={e => setResourceForm({
                                                        ...resourceForm,
                                                        user_id: e.target.value
                                                    })}
                                                    style={inputStyle}>
                                                <option value="">选择用户</option>
                                                {users.map(u => (
                                                    <option key={u.id} value={u.id}>{u.username}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{
                                                display: 'block',
                                                marginBottom: 4,
                                                fontSize: 13,
                                                color: 'var(--text-2)'
                                            }}>用户组 (可选)</label>
                                            <select value={resourceForm.group_id}
                                                    onChange={e => setResourceForm({
                                                        ...resourceForm,
                                                        group_id: e.target.value
                                                    })}
                                                    style={inputStyle}>
                                                <option value="">选择用户组</option>
                                                {groups.map(g => (
                                                    <option key={g.id} value={g.id}>{g.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
                                        <button className="btn" onClick={() => setShowResourcePermForm(false)}>取消
                                        </button>
                                        <button className="btn btn-default" onClick={async () => {
                                            if (!resourceForm.resource_type || !resourceForm.resource_id || !resourceForm.permission_code) {
                                                return alert('请填写资源类型、资源ID和权限代码');
                                            }
                                            try {
                                                await apiRequest(cmdbBase, '/resource-permissions', {
                                                    method: 'POST', body: resourceForm,
                                                });
                                                setShowResourcePermForm(false);
                                                setResourceForm({
                                                    resource_type: '', resource_id: '', user_id: '',
                                                    group_id: '', role_id: '', permission_code: '', effect: 'allow',
                                                });
                                                fetchResourcePerms();
                                            } catch (e) {
                                                alert(e.message);
                                            }
                                        }}>创建
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 6,
    border: '1px solid var(--border-2)', background: 'var(--surface-2)',
    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
};
