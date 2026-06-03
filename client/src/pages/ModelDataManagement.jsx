import React, {useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getCmdbApiBase} from '../config';
import AppSidebar from '../components/AppSidebar';

export default function ModelDataManagement() {
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const navigate = useNavigate();
    const [cmdbBase, setCmdbBase] = useState('');
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [instanceCounts, setInstanceCounts] = useState({});
    const [deleteCounts, setDeleteCounts] = useState({});
    const [deleting, setDeleting] = useState({});
    const [canDelete, setCanDelete] = useState(false);

    useEffect(() => {
        loadConfig().then(() => {
            const base = getCmdbApiBase();
            setCmdbBase(base);
            const token = getStoredAuthToken();
            const headers = token ? {Authorization: `Bearer ${token}`} : {};
            fetch(`${base}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:read`, {headers})
                .then(r => r.json()).then(data => {
                if (!data.allowed) {
                    alert('⚠️ 权限不足：无权限访问模型数据管理');
                    navigate('/platform-config');
                }
            }).catch(() => navigate('/platform-config'));
            fetch(`${base}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:delete`, {headers})
                .then(r => r.json()).then(data => setCanDelete(data.allowed))
                .catch(() => setCanDelete(false));
        });
    }, [navigate]);

    const authHeaders = () => {
        const t = getStoredAuthToken();
        return t ? {'Authorization': `Bearer ${t}`} : {};
    };

    const fetchModels = useCallback(async () => {
        if (!cmdbBase) return;
        setLoading(true);
        try {
            const data = await api.listModels({per_page: 10000});
            setModels(data);
            await refreshCounts(data);
        } catch (err) {
            console.error('获取模型列表失败:', err);
        } finally {
            setLoading(false);
        }
    }, [cmdbBase]);

    const refreshCounts = async (modelList) => {
        const list = modelList || models;
        const counts = {};
        for (const m of list) {
            try {
                const resp = await api.listModelInstances({model_definition_id: m.id, per_page: 1});
                counts[m.id] = resp?.total || 0;
            } catch {
                counts[m.id] = 0;
            }
        }
        setInstanceCounts(counts);
    };

    useEffect(() => {
        if (cmdbBase) fetchModels();
    }, [cmdbBase, fetchModels]);

    const handleDeleteCount = async (modelId, modelName) => {
        if (!canDelete) {
            alert('⚠️ 权限不足：无权限删除模型数据');
            return;
        }
        const count = parseInt(deleteCounts[modelId], 10);
        if (!count || count < 1) {
            alert('请输入要删除的数量');
            return;
        }
        if (!confirm(`确定要删除「${modelName}」最新的 ${count} 条数据吗？`)) return;

        setDeleting(prev => ({...prev, [modelId]: true}));
        try {
            const resp = await api.listModelInstances({model_definition_id: modelId, per_page: count});
            const ids = (resp?.items || []).map(item => item.id);
            if (ids.length === 0) {
                alert('没有可删除的数据');
                return;
            }
            const result = await api.batchDeleteModelInstances(ids);
            if (result === undefined) return;
            alert(`成功删除 ${ids.length} 条数据`);
            refreshCounts();
        } catch (err) {
            alert('删除失败: ' + (err.message || err));
        } finally {
            setDeleting(prev => ({...prev, [modelId]: false}));
        }
    };

    const handleDeleteAll = async (modelId, modelName) => {
        if (!canDelete) {
            alert('⚠️ 权限不足：无权限删除模型数据');
            return;
        }
        if (!confirm(`确定要一键删除「${modelName}」的全部数据吗？此操作不可恢复！`)) return;

        setDeleting(prev => ({...prev, [modelId]: true}));
        try {
            const result = await api.deleteAllModelInstances(modelId);
            if (result === undefined) return;
            alert(`「${modelName}」全部数据已删除`);
            refreshCounts();
        } catch (err) {
            alert('删除失败: ' + (err.message || err));
        } finally {
            setDeleting(prev => ({...prev, [modelId]: false}));
        }
    };

    const handleLogout = async () => {
        await logout();
    };

    const styles = {
        wrapper: {
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 12,
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 80px)',
        },
        tableWrapper: {
            flex: 1,
            overflowY: 'auto',
        },
        title: {
            fontSize: 18,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: 0,
        },
        table: {
            width: '100%',
            borderCollapse: 'collapse',
        },
        th: {
            textAlign: 'left',
            padding: '10px 12px',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-2)',
            borderBottom: '1px solid var(--border-2)',
        },
        td: {
            padding: '10px 12px',
            fontSize: 14,
            borderBottom: '1px solid var(--border-2)',
            verticalAlign: 'middle',
        },
        input: {
            width: 80,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-2)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontSize: 14,
        },
        btn: {
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
            border: 'none',
            transition: 'all 0.2s',
        },
        btnDanger: {
            background: '#ef4444',
            color: '#fff',
        },
        btnOutline: {
            background: 'transparent',
            border: '1px solid var(--border-2)',
            color: 'var(--text)',
        },
        loading: {
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-3)',
        },
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="平台配置"
                subtitle="模型数据管理"
                brandIcon="bi bi-database"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page">
                <div style={styles.wrapper}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
                        <div style={styles.title}>
                            <i className="bi bi-database"/> 模型数据管理
                        </div>
                        <button className="btn" onClick={() => navigate('/platform-config')}
                                style={{display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0}}>
                            <i className="bi bi-arrow-left"/> 返回
                        </button>
                    </div>

                    {loading ? (
                        <div style={styles.loading}>加载中...</div>
                    ) : models.length === 0 ? (
                        <div style={styles.loading}>暂无模型</div>
                    ) : (
                        <div style={styles.tableWrapper}>
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={{...styles.th, width: 50, textAlign: 'center'}}>序号</th>
                                    <th style={styles.th}>模型名称</th>
                                    <th style={styles.th}>模型标识</th>
                                    <th style={styles.th}>数据总量</th>
                                    <th style={styles.th}>删除数量</th>
                                    <th style={styles.th}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {models.map((model, index) => (
                                    <tr key={model.id}>
                                        <td style={{...styles.td, textAlign: 'center', color: 'var(--text-3)'}}>
                                            {index + 1}
                                        </td>
                                        <td style={styles.td}>
                                            <strong>{model.name}</strong>
                                        </td>
                                        <td style={{...styles.td, color: 'var(--text-3)'}}>
                                            {model.model_id}
                                        </td>
                                        <td style={styles.td}>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '2px 10px',
                                                borderRadius: 10,
                                                background: 'var(--accent-bg)',
                                                color: 'var(--accent)',
                                                fontSize: 13,
                                                fontWeight: 600,
                                            }}>
                                                {instanceCounts[model.id] ?? '...'}
                                            </span>
                                        </td>
                                        <td style={styles.td}>
                                            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max={instanceCounts[model.id] || 0}
                                                    value={deleteCounts[model.id] || ''}
                                                    onChange={e => setDeleteCounts(prev => ({...prev, [model.id]: e.target.value}))}
                                                    placeholder="数量"
                                                    style={styles.input}
                                                />
                                                <button
                                                    style={{...styles.btn, ...styles.btnOutline}}
                                                    onClick={() => handleDeleteCount(model.id, model.name)}
                                                    disabled={deleting[model.id] || !canDelete}
                                                >
                                                    {deleting[model.id] ? '删除中...' : '删除'}
                                                </button>
                                            </div>
                                        </td>
                                        <td style={styles.td}>
                                            <button
                                                style={{...styles.btn, ...styles.btnDanger}}
                                                onClick={() => handleDeleteAll(model.id, model.name)}
                                                disabled={deleting[model.id] || !canDelete || (instanceCounts[model.id] || 0) === 0}
                                            >
                                                <i className="bi bi-trash-fill" style={{marginRight: 4}}/>
                                                {deleting[model.id] ? '删除中...' : '删除全部'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
