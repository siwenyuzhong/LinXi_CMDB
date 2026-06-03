import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';

const EMPTY_FORM = {
    taskType: 'workflow',
    workflow_id: '',
    script_id: '',
    name: '',
    cron_expr: '*/5 * * * *',
    inputText: '{}',
    enabled: true,
};

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN');
}

function prettyJson(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

export default function TaskList() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [workflows, setWorkflows] = useState([]);
    const [scripts, setScripts] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [runningTaskId, setRunningTaskId] = useState('');
    const [editingTaskId, setEditingTaskId] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [errorMessage, setErrorMessage] = useState('');
    const [currentPage, setCurrentPage] = usePersistedState('taskListPage', 1);
    const [pageSize, setPageSize] = usePersistedState('taskListPageSize', 5);
    const [searchQuery, setSearchQuery] = useState('');

    const workflowOptions = useMemo(() => workflows.map((item) => ({
        id: item.id,
        label: item.name,
    })), [workflows]);

    const scriptOptions = useMemo(() => scripts
        .filter((item) => item.debug_status !== '未通过')
        .map((item) => ({id: item.id, label: item.name})), [scripts]);

    const loadData = useCallback(async () => {
        try {
            setErrorMessage('');
            const [workflowResult, taskResult, scriptResult, runningExecsResult] = await Promise.allSettled([
                api.listWorkflows(),
                api.listTasks(),
                api.listScripts(),
                api.listRunningExecutions(),
            ]);

            if (workflowResult.status === 'fulfilled') {
                setWorkflows(workflowResult.value);
            } else {
                console.error(workflowResult.reason);
                setWorkflows([]);
                setErrorMessage(workflowResult.reason?.message || '加载工作流失败');
            }

            if (taskResult.status === 'fulfilled') {
                setTasks(taskResult.value);
            } else {
                console.error(taskResult.reason);
                setTasks([]);
                setErrorMessage(taskResult.reason?.message || '加载任务失败，请确认服务端已重启并加载最新任务接口');
            }

            if (scriptResult.status === 'fulfilled') {
                setScripts(scriptResult.value);
            } else {
                console.error(scriptResult.reason);
                setScripts([]);
            }

            // Restore spinner for any task that still has a running execution
            if (runningExecsResult.status === 'fulfilled' && Array.isArray(runningExecsResult.value)) {
                runningExecsResult.value.forEach(item => {
                    if (item.task_id && item.id) {
                        setRunningTaskId(item.task_id);
                        pollExecution(item.id);
                    }
                });
            }
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '加载任务失败');
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const resetForm = useCallback(() => {
        setForm(EMPTY_FORM);
        setEditingTaskId('');
        setShowModal(false);
    }, []);

    const updateForm = (patch) => setForm((prev) => ({...prev, ...patch}));

    const openCreateModal = () => {
        const firstWorkflowId = workflowOptions[0]?.id || '';
        setForm({
            ...EMPTY_FORM,
            workflow_id: firstWorkflowId,
            name: firstWorkflowId ? `${workflowOptions[0].label} 定时任务` : '',
        });
        setEditingTaskId('');
        setShowModal(true);
        setErrorMessage('');
    };

    const openEditModal = (task) => {
        const taskType = task.type || 'workflow';
        setForm({
            taskType,
            workflow_id: task.workflow_id || '',
            script_id: task.script_id || '',
            name: task.name,
            cron_expr: task.cron_expr,
            inputText: prettyJson(task.input),
            enabled: Boolean(task.enabled),
        });
        setEditingTaskId(task.id);
        setShowModal(true);
        setErrorMessage('');
    };

    const handleRefChange = (refId) => {
        setForm((prev) => {
            const next = {...prev, workflow_id: '', script_id: ''};
            if (prev.taskType === 'script') {
                next.script_id = refId;
                if (!editingTaskId) {
                    const selected = scriptOptions.find((item) => item.id === refId);
                    next.name = selected ? `${selected.label} 定时任务` : prev.name;
                }
            } else {
                next.workflow_id = refId;
                if (!editingTaskId) {
                    const selected = workflowOptions.find((item) => item.id === refId);
                    next.name = selected ? `${selected.label} 定时任务` : prev.name;
                }
            }
            return next;
        });
    };

    const handleSubmit = async () => {
        setErrorMessage('');

        let parsedInput = {};
        try {
            parsedInput = JSON.parse(form.inputText || '{}');
        } catch (error) {
            setErrorMessage('输入参数必须是合法 JSON');
            return;
        }

        if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
            setErrorMessage('输入参数必须是 JSON 对象');
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                type: form.taskType,
                name: form.name,
                cron_expr: form.cron_expr,
                input: parsedInput,
                enabled: form.enabled,
            };

            if (form.taskType === 'script') {
                payload.script_id = form.script_id;
            } else {
                payload.workflow_id = form.workflow_id;
            }

            if (editingTaskId) {
                await api.updateTask(editingTaskId, payload);
            } else {
                await api.createTask(payload);
            }

            resetForm();
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '保存任务失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (taskId) => {
        if (!window.confirm('确定删除这个定时任务吗？')) return;
        try {
            await api.deleteTask(taskId);
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '删除任务失败');
        }
    };

    const pollExecution = async (execId) => {
        for (let i = 0; i < 600; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const exec = await api.getTaskExecution(execId);
                if (exec.status !== 'running') return;
            } catch {
                return;
            }
        }
    };

    const handleRunNow = async (taskId) => {
        if (!window.confirm('确定立即执行该定时任务吗？')) return;
        setRunningTaskId(taskId);
        setErrorMessage('');
        try {
            const res = await api.runTask(taskId);
            await pollExecution(res.execution_id);
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '手动执行任务失败');
        } finally {
            setRunningTaskId('');
        }
    };

    const handleToggleEnabled = async (task) => {
        const action = task.enabled ? '禁用' : '启用';
        if (!window.confirm(`确定${action}该定时任务吗？`)) return;
        setErrorMessage('');
        try {
            await api.updateTask(task.id, {enabled: !task.enabled});
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '切换任务状态失败');
        }
    };

    const filteredTasks = tasks.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.type && t.type.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.workflow_name && t.workflow_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.script_name && t.script_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.cron_expr && t.cron_expr.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.username && t.username.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
    const paginatedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="定时任务"
                subtitle="定时任务配置"
                brandIcon="bi bi-alarm"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content task-list-page">
                <div className="task-sticky-header">
                    <div className="task-filters">
                        <div className="task-search-box">
                            <span className="search-icon">
                                <i className="bi bi-search"></i>
                            </span>
                            <input
                                type="text"
                                placeholder="搜索定时任务..."
                                value={searchQuery}
                                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="task-search-input"
                            />
                        </div>

                        <button className="btn btn-default" onClick={() => openCreateModal()}>
                            <i className="bi bi-plus-circle"></i>
                            新建定时任务
                        </button>
                    </div>
                </div>

                <div className="task-scroll-content">
                {tasks.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🗓️</div>
                        <h3>暂无定时任务</h3>
                        <p>点击上方按钮创建第一个定时任务</p>
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <h3>未找到匹配的定时任务</h3>
                        <p>尝试使用其他关键词搜索</p>
                    </div>
                ) : (
                    <div className="task-list-container">
                        <div className="task-card-list">
                            {paginatedTasks.map((task, index) => (
                                <div key={task.id} className="task-item" style={{animationDelay: `${0.04 * index}s`}}>
                                    <div className="task-item-row-top">
                                        <span className="task-item-name">{task.name}</span>
                                        <span className={`task-item-badge ${task.type === 'script' ? 'badge-amber' : 'badge-blue'}`}>
                                            {task.type === 'script' ? '工具库' : 'AI工作流'}
                                        </span>
                                        <span className={`task-item-badge ${task.enabled ? 'badge-green' : 'badge-red'}`}>
                                            {task.enabled ? '已启用' : '已停用'}
                                        </span>
                                        <code className="task-item-cron">{task.cron_expr}</code>
                                    </div>
                                    <div className="task-item-row-bottom">
                                        <span className="task-item-desc">
                                            {task.type === 'script' ? task.script_name : task.workflow_name}
                                        </span>
                                        <div className="task-item-meta">
                                            <div className="task-item-meta-cell">
                                                <span className="meta-label">创建者</span>
                                                <span className="meta-val">{task.username || '—'}</span>
                                            </div>
                                            <div className="task-item-meta-cell">
                                                <span className="meta-label">下次执行</span>
                                                <span className="meta-val">{formatDateTime(task.next_run_at)}</span>
                                            </div>
                                            <div className="task-item-meta-cell task-item-actions">
                                                <button className="btn-icon" onClick={() => openEditModal(task)} title="编辑">
                                                    <i className="bi bi-pencil-fill"/>
                                                </button>
                                                <button className="btn-icon" onClick={() => handleRunNow(task.id)} disabled={runningTaskId === task.id} title={runningTaskId === task.id ? '执行中...' : '立即执行'}>
                                                    <i className={runningTaskId === task.id ? 'bi bi-arrow-repeat spin-green' : 'bi bi-caret-left'}/>
                                                </button>
                                                <button className="btn-icon" onClick={() => handleToggleEnabled(task)} title={task.enabled ? '停用' : '启用'}>
                                                    <i className={`bi ${task.enabled ? 'bi-pause-fill' : 'bi-play-fill'}`}/>
                                                </button>
                                                {/*{task.type !== 'script' && (*/}
                                                {/*    <button className="btn-icon" onClick={() => navigate(`/editor/${task.workflow_id}`)} title="打开工作流">*/}
                                                {/*        <i className="bi bi-link"/>*/}
                                                {/*    </button>*/}
                                                {/*)}*/}
                                                <button className="btn-icon btn-danger" onClick={() => handleDelete(task.id)} title="删除">
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

                {filteredTasks.length > 0 && (
                    <div className="pagination task-fixed-pagination">
                        <span className="pagination-info">共 {filteredTasks.length} 条，第 {currentPage}/{totalPages} 页</span>
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

                {showModal && (
                    <div className="modal-overlay">
                        <div className="modal-box task-modal">
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon"><i className="bi bi-alarm"/></span>
                                    <h3 className="modal-title">{editingTaskId ? '编辑定时任务' : '新建定时任务'}</h3>
                                </div>
                                <button className="modal-close" onClick={resetForm}>✕</button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>任务类型</label>
                                    <div className="task-type-toggle">
                                        <button
                                            type="button"
                                            className={`task-type-btn ${form.taskType === 'workflow' ? 'active' : ''}`}
                                            onClick={() => updateForm({
                                                taskType: 'workflow',
                                                workflow_id: workflowOptions[0]?.id || '',
                                                script_id: ''
                                            })}
                                        >
                                            <i className="bi bi-menu-button-wide-fill"></i> AI 工作流
                                        </button>
                                        <button
                                            type="button"
                                            className={`task-type-btn ${form.taskType === 'script' ? 'active' : ''}`}
                                            onClick={() => updateForm({
                                                taskType: 'script',
                                                script_id: scriptOptions[0]?.id || '',
                                                workflow_id: ''
                                            })}
                                        >
                                            <i className="bi bi-terminal"></i> 工具库
                                        </button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>{form.taskType === 'script' ? '关联脚本' : '关联工作流'}</label>
                                    {form.taskType === 'script' ? (
                                        <select value={form.script_id}
                                                onChange={(event) => handleRefChange(event.target.value)}>
                                            <option value="">请选择脚本</option>
                                            {scriptOptions.map((item) => (
                                                <option key={item.id} value={item.id}>{item.label}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <select value={form.workflow_id}
                                                onChange={(event) => handleRefChange(event.target.value)}>
                                            <option value="">请选择工作流</option>
                                            {workflowOptions.map((item) => (
                                                <option key={item.id} value={item.id}>{item.label}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label>任务名称</label>
                                    <input
                                        value={form.name}
                                        onChange={(event) => updateForm({name: event.target.value})}
                                        placeholder="例如：日报生成任务"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Cron 表达式：(分 时 日 月 星期，例如 0 9 * * 1-5 表示工作日 9:00 执行)</label>
                                    <input
                                        value={form.cron_expr}
                                        onChange={(event) => updateForm({cron_expr: event.target.value})}
                                        placeholder="*/5 * * * *"
                                    />
                                    <div className="form-hint">支持 <code>*</code>、<code>*/n</code>、区间和逗号组合。
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>输入参数 JSON</label>
                                    <textarea
                                        className="code-textarea task-json-input"
                                        value={form.inputText}
                                        onChange={(event) => updateForm({inputText: event.target.value})}
                                        rows={10}
                                        placeholder={"{\n  \"input_text\": \"hello\"\n}"}
                                    />
                                </div>

                                <label className="task-switch-row">
                                    <input
                                        type="checkbox"
                                        checked={form.enabled}
                                        onChange={(event) => updateForm({enabled: event.target.checked})}
                                    />
                                    <span>创建后立即启用</span>
                                </label>
                            </div>
                            <div className="modal-footer">
                                <button className="btn" onClick={resetForm}>取消</button>
                                <button className="btn btn-default" onClick={handleSubmit} disabled={submitting}>
                                    <i className="bi bi-pencil-square"></i>
                                    {submitting ? '保存中...' : '保存任务'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
