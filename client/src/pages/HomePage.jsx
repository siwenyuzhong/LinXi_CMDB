import React, {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import {getFlaskApiBase, getCmdbApiBase, getMonitorApiBase} from '../config';

function formatTokenCount(value) {
    if (value >= 1000000) {
        const v = value / 1000000;
        return v % 1 === 0 ? `${v}M` : `${v.toFixed(1)}M`;
    }
    if (value >= 1000) {
        const v = value / 1000;
        return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`;
    }
    return String(value);
}

export default function HomePage() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [workflows, setWorkflows] = useState([]);
    const [models, setModels] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [instanceCount, setInstanceCount] = useState(0);
    const [modelDefs, setModelDefs] = useState([]);
    const [modelCounts, setModelCounts] = useState({});
    const [skills, setSkills] = useState([]);
    const [hostCount, setHostCount] = useState(0);
    const [modelUsageStats, setModelUsageStats] = useState([]);
    const [modelUsageTotal, setModelUsageTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [modelAlerts, setModelAlerts] = useState([]);
    const [monitorStats, setMonitorStats] = useState(null);

    useEffect(() => {
        const loadDashboard = async () => {
            try {
                const cmdbBase = getCmdbApiBase();
                const res = await fetch(
                    `${cmdbBase}/api/check-permission?resource_type=dashboard&resource_id=*&permission=dashboard:read`,
                    {headers: getStoredAuthToken() ? {'Authorization': `Bearer ${getStoredAuthToken()}`} : {}},
                );
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看工作看板');
                        setErrorMessage('⚠️ 权限不足: 无权限查看工作看板');
                        setLoading(false);
                        return;
                    }
                }
            } catch {
            }
            setLoading(true);
            try {
                setErrorMessage('');
                const authHeaders = getStoredAuthToken() ? {'Authorization': `Bearer ${getStoredAuthToken()}`} : {};
                const cmdbBase = getCmdbApiBase();
                const silentFetch = (url) => fetch(url, {headers: authHeaders}).then(r => r.ok ? r.json().catch(() => null) : null);

                const [workflowResult, modelResult, taskResult, modelMetaResult, usageResult, skillResult, hostResult] = await Promise.allSettled([
                    silentFetch(`${cmdbBase}/api/workflows`).then(r => r ? (r.items || r) : []),
                    silentFetch(`${cmdbBase}/api/models`).then(r => r ? (r.items || r) : []),
                    silentFetch(`${cmdbBase}/api/tasks`).then(r => r ? (r.items || r) : []),
                    silentFetch(`${cmdbBase}/api/model-instances/meta/models?per_page=10000`).then(r => r ? (r.items || r) : []),
                    silentFetch(`${cmdbBase}/api/model-usage/stats`),
                    fetch(`${getFlaskApiBase()}/api/skills`, {headers: authHeaders}).then(r => r.ok ? r.json().then(d => d.items || d) : []),
                    fetch(`${getFlaskApiBase()}/api/hosts`, {headers: authHeaders}).then(r => r.ok ? r.json() : {
                        hosts: [],
                        total: 0
                    }),
                ]);
                fetch(`${getMonitorApiBase()}/api/monitor/stats`).then(r => r.ok ? r.json().then(d => setMonitorStats(d)) : null);

                const nextWorkflows = workflowResult.status === 'fulfilled' ? workflowResult.value : [];
                const nextModels = modelResult.status === 'fulfilled' ? modelResult.value : [];
                const nextTasks = taskResult.status === 'fulfilled' ? taskResult.value : [];
                const nextMetaModels = modelMetaResult.status === 'fulfilled' ? modelMetaResult.value : [];

                setWorkflows(nextWorkflows);
                setModels(nextModels);
                setTasks(nextTasks);
                setModelDefs(nextMetaModels);
                setInstanceCount(nextMetaModels.reduce((sum, item) => sum + Number(item.instance_count || 0), 0));
                setSkills(skillResult.status === 'fulfilled' ? skillResult.value : []);
                {
                    const h = hostResult.status === 'fulfilled' ? hostResult.value : {hosts: [], total: 0};
                    setHostCount(Array.isArray(h) ? h.length : (h.total || 0));
                }

                if (usageResult.status === 'fulfilled' && usageResult.value) {
                    setModelUsageStats(usageResult.value.models || []);
                    setModelUsageTotal(usageResult.value.total_tokens || 0);
                }

                const firstError = [workflowResult, modelResult, taskResult, modelMetaResult, usageResult, skillResult]
                    .find((result) => result.status === 'rejected');
                if (firstError?.reason) {
                    setErrorMessage(firstError.reason.message || '首页数据加载不完整，部分数据已使用默认值展示');
                }
            } catch (error) {
                console.error(error);
                setErrorMessage(error.message || '首页数据加载失败');
            } finally {
                setLoading(false);
            }
        };

        loadDashboard();
    }, []);

    useEffect(() => {
        if (modelDefs.length === 0) return;
        const authHeaders = getStoredAuthToken() ? {'Authorization': `Bearer ${getStoredAuthToken()}`} : {};
        const cmdbBase = getCmdbApiBase();
        const silentFetch = (url) => fetch(url, {headers: authHeaders}).then(r => r.ok ? r.json().catch(() => null) : null);
        const loadAlerts = async (retry = 0) => {
            try {
                const data = await silentFetch(`${cmdbBase}/api/model-instances/alerts`);
                const items = data && data.alerts ? data.alerts : [];
                setModelAlerts(items.map(a => `${a.name}(${a.model_id})：共 ${a.total} 条数据，其中 ${a.invalid_count} 条无效，请关注！`));
            } catch {
            }
        };
        loadAlerts();
        const pollAlerts = async () => {
            await new Promise(r => setTimeout(r, 3000));
            loadAlerts();
        };
        pollAlerts();
        const loadCounts = async () => {
            const counts = {};
            await Promise.allSettled(modelDefs.map(async (m) => {
                if (!m.id) return;
                try {
                    const res = await silentFetch(`${cmdbBase}/api/model-instances?model_definition_id=${m.id}&per_page=1&page=1`);
                    counts[m.model_id || m.name] = res && typeof res === 'object' && res.total ? Number(res.total) : 0;
                } catch {
                    counts[m.model_id || m.name] = 0;
                }
            }));
            setModelCounts(counts);
        };
        loadCounts();
    }, [modelDefs]);

    const metrics = useMemo(() => ({
        workflowCount: workflows.length,
        modelCount: models.length,
        taskCount: tasks.length,
        instanceCount,
        skillCount: skills.length,
        hostCount,
        activeTaskCount: tasks.filter((task) => task.enabled).length,
    }), [instanceCount, models.length, skills.length, hostCount, tasks, workflows.length]);

    const modelChartData = useMemo(() => {
        if (!modelUsageStats.length) return [];
        const maxVal = Math.max(...modelUsageStats.map((s) => s.total_tokens), 1);
        return modelUsageStats.slice(0, 7).map((s) => ({
            label: s.model,
            fullName: s.model,
            value: s.total_tokens,
            call_count: s.call_count,
            pct: maxVal > 0 ? (s.total_tokens / maxVal) * 100 : 0,
        }));
    }, [modelUsageStats]);

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const modelInstanceItems = useMemo(() => {
        return modelDefs.map(m => {
            const key = m.model_id || m.name;
            const count = modelCounts[key] !== undefined ? modelCounts[key] : Number(m.instance_count || 0);
            return {
                label: m.name || m.model_id || '未知',
                value: count,
                icon: 'bi bi-box',
                color: '#6366f1',
                modelId: m.id,
            };
        });
    }, [modelDefs, modelCounts]);

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="工作看板"
                subtitle="数据运营管理"
                brandIcon="bi bi-newspaper"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
                footer={(
                    <div className="home-sidebar-summary">
                        <div className="home-sidebar-summary-item">
                            <span>工作流</span>
                            <strong>{metrics.workflowCount}</strong>
                        </div>
                        <div className="home-sidebar-summary-item">
                            <span>模型</span>
                            <strong>{metrics.modelCount}</strong>
                        </div>
                        <div className="home-sidebar-summary-item">
                            <span>任务</span>
                            <strong>{metrics.taskCount}</strong>
                        </div>
                    </div>
                )}
            />

            <div className="app-content home-page">


                <div className="w-content">


                    <div className="w-grid">
                        <div className="w-card w-card-resource">
                            <div className="w-card-header">
                                <div className="w-card-title">
                                    <span className="w-card-dot" style={{background: '#22c55e'}}/>
                                    我的资源（模型数量：{modelInstanceItems.length}）
                                </div>
                            </div>
                            <div className="w-resource-scroll">
                                <div className="w-resource-grid">
                                    {modelInstanceItems.length > 0 ? modelInstanceItems.map((r) => (
                                        <div key={r.label} className="w-resource-item"
                                             style={{cursor: 'pointer'}}
                                             onClick={() => navigate(`/model-instances?modelDefinitionId=${r.modelId}`)}>
                                            <div className="w-resource-icon"
                                                 style={{background: `linear-gradient(135deg, ${r.color}, ${r.color}dd)`}}>
                                                <i className={r.icon}/>
                                            </div>
                                            <div className="w-resource-num">{r.value}</div>
                                            <div className="w-resource-label">{r.label}</div>
                                        </div>
                                    )) : (
                                        <div className="w-empty-hint" style={{gridColumn: '1 / -1'}}>
                                            {loading ? '加载中...' : '暂无数据'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>


                        <div className="w-card w-card-notice">
                            <div className="w-card-header">
                                <div className="w-card-title">
                                    <span className="w-card-dot" style={{background: '#ef4444'}}/>
                                    系统通知
                                </div>
                            </div>
                            {monitorStats ? (
                                <div className="w-task-stats" style={{
                                    paddingBottom: 8,
                                    marginBottom: 8
                                }}>
                                    <div className="w-task-stat-item" style={{cursor: 'pointer'}}
                                         onClick={() => navigate('/platform-config/alert-management?tab=items')}>
                                        <div className="w-task-stat-num">{monitorStats.total_items}</div>
                                        <div className="w-task-stat-label" style={{fontSize: 11}}>监控项个数</div>
                                    </div>
                                    <div className="w-task-stat-item" style={{cursor: 'pointer'}}
                                         onClick={() => navigate('/platform-config/alert-management?tab=events')}>
                                        <div className="w-task-stat-num"
                                             style={{color: '#ef4444'}}>{monitorStats.pending_alerts}</div>
                                        <div className="w-task-stat-label"
                                             style={{fontSize: 11, color: '#ef4444'}}>当前告警数
                                        </div>
                                    </div>
                                    <div className="w-task-stat-item" style={{cursor: 'pointer'}}
                                         onClick={() => navigate('/platform-config/alert-management?tab=events')}>
                                        <div className="w-task-stat-num"
                                             style={{color: '#22c55e'}}>{monitorStats.resolved_alerts}</div>
                                        <div className="w-task-stat-label"
                                             style={{fontSize: 11, color: '#22c55e'}}>已恢复数
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="w-empty-hint">
                                    <i className="bi bi-bell"
                                       style={{
                                           fontSize: 32,
                                           color: 'var(--text-3)',
                                           display: 'block',
                                           marginBottom: 8
                                       }}/>
                                    <span>暂无通知</span>
                                </div>
                            )}
                        </div>

                        <div className="w-card w-card-info">
                            <div className="w-card-header">
                                <div className="w-card-title">
                                    <span className="w-card-dot" style={{background: '#f97316'}}/>
                                    模型告警
                                </div>
                            </div>
                            <div className="w-scroll-up-wrap">
                                <div
                                    className={`w-scroll-up-track${modelAlerts.length > 4 ? '' : ' w-scroll-up-static'}`}>
                                    {modelAlerts.length > 0 ? (
                                        <>
                                            <div className="w-info-items">
                                                {modelAlerts.map((alert, i) => (
                                                    <div key={i} className="w-info-item w-alert-item">
                                                        <i className="bi bi-exclamation-triangle-fill"
                                                           style={{color: '#f97316'}}/>
                                                        <span>{alert}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {modelAlerts.length > 4 && (
                                                <div className="w-info-items">
                                                    {modelAlerts.map((alert, i) => (
                                                        <div key={`dup-${i}`} className="w-info-item w-alert-item">
                                                            <i className="bi bi-exclamation-triangle-fill"
                                                               style={{color: '#f97316'}}/>
                                                            <span>{alert}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="w-info-items">
                                            <div className="w-info-item">
                                                <i className="bi bi-check-circle-fill" style={{color: '#22c55e'}}/>
                                                <span>暂无告警</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>

                    <div className="w-bottom-grid">

                        <div className="w-card w-card-task">
                            <div className="w-card-header">
                                <div className="w-card-title">
                                    <span className="w-card-dot" style={{background: '#14b8a6'}}/>
                                    定时任务概览
                                </div>
                            </div>
                            <div className="w-task-stats">
                                <div className="w-task-stat-item"
                                     style={{cursor: 'pointer'}}
                                     onClick={() => navigate('/tasks')}>
                                    <div className="w-task-stat-num">{metrics.taskCount}</div>
                                    <div className="w-task-stat-label">总任务</div>
                                </div>
                                <div className="w-task-stat-item"
                                     style={{cursor: 'pointer'}}
                                     onClick={() => navigate('/tasks')}>
                                    <div className="w-task-stat-num"
                                         style={{color: '#22c55e'}}>{metrics.activeTaskCount}</div>
                                    <div className="w-task-stat-label" style={{color: '#22c55e'}}>启用中</div>
                                </div>
                                <div className="w-task-stat-item"
                                     style={{cursor: 'pointer'}}
                                     onClick={() => navigate('/tasks')}>
                                    <div className="w-task-stat-num"
                                         style={{color: '#ef4444'}}>{metrics.taskCount - metrics.activeTaskCount}</div>
                                    <div className="w-task-stat-label" style={{color: '#ef4444'}}>已停用</div>
                                </div>
                            </div>
                        </div>

                        <div className="w-card w-card-notice">
                            <div className="w-card-header">
                                <div className="w-card-title">
                                    <span className="w-card-dot" style={{background: '#7c5cff'}}/>
                                    系统公告
                                </div>
                            </div>
                            <div className="w-empty-hint">
                                <i className="bi bi-megaphone"
                                   style={{fontSize: 32, color: 'var(--text-3)', display: 'block', marginBottom: 8}}/>
                                <span>暂无公告</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
