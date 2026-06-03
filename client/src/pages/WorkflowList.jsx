import React, {useEffect, useMemo, useState} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';

const EMPTY_FORM = {
    id: '',
    name: '',
    description: '',
};

const WORKFLOW_ORDER_STORAGE_KEY = 'promptflow_workflow_order';

function readStoredWorkflowOrder() {
    try {
        const raw = window.localStorage.getItem(WORKFLOW_ORDER_STORAGE_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('读取工作流顺序缓存失败:', error);
        return [];
    }
}

function writeStoredWorkflowOrder(workflows) {
    try {
        const ids = workflows.map((workflow) => workflow.id).filter(Boolean);
        window.localStorage.setItem(WORKFLOW_ORDER_STORAGE_KEY, JSON.stringify(ids));
    } catch (error) {
        console.error('写入工作流顺序缓存失败:', error);
    }
}

export default function WorkflowList() {
    const [workflows, setWorkflows] = useState([]);
    const [modalMode, setModalMode] = useState('create');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [currentPage, setCurrentPage] = usePersistedState('workflowListPage', 1);
    const [pageSize, setPageSize] = usePersistedState('workflowListPageSize', 5);
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();

    const isEditMode = modalMode === 'edit';
    const modalTitle = useMemo(() => (isEditMode ? '编辑工作流' : '新建工作流'), [isEditMode]);
    const submitText = useMemo(() => {
        if (submitting) {
            return isEditMode ? '保存中...' : '创建中...';
        }
        return isEditMode ? '保存修改' : '创建';
    }, [isEditMode, submitting]);

    const mergeWorkflowsByExistingOrder = (prevWorkflows, nextWorkflows) => {
        const storedOrder = readStoredWorkflowOrder();
        const baseOrder = prevWorkflows.length > 0 ? prevWorkflows.map((workflow) => workflow.id) : storedOrder;

        if (!baseOrder.length) {
            return nextWorkflows;
        }

        const nextMap = new Map(nextWorkflows.map((workflow) => [workflow.id, workflow]));
        const merged = [];

        baseOrder.forEach((workflowId) => {
            if (nextMap.has(workflowId)) {
                merged.push(nextMap.get(workflowId));
                nextMap.delete(workflowId);
            }
        });

        return [...merged, ...nextMap.values()];
    };

    const load = async () => {
        try {
            setErrorMessage('');
            const data = await api.listWorkflows();
            setWorkflows((prev) => mergeWorkflowsByExistingOrder(prev, data));
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '加载工作流失败');
        }
    };

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        if (workflows.length > 0) {
            writeStoredWorkflowOrder(workflows);
        }
    }, [workflows]);

    const closeModal = () => {
        if (submitting) return;
        setShowModal(false);
        setForm(EMPTY_FORM);
        setModalMode('create');
    };

    const openCreateModal = () => {
        setErrorMessage('');
        setModalMode('create');
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEditModal = (event, workflow) => {
        event.stopPropagation();
        setErrorMessage('');
        setModalMode('edit');
        setForm({
            id: workflow.id,
            name: workflow.name || '',
            description: workflow.description || '',
        });
        setShowModal(true);
    };

    const handleSubmit = async () => {
        const name = form.name.trim();
        const description = form.description.trim();
        if (!name) return;

        try {
            setSubmitting(true);
            setErrorMessage('');

            if (isEditMode) {
                const updatedWorkflow = await api.updateWorkflow(form.id, {name, description});
                setWorkflows((prev) => {
                    const next = prev.map((workflow) => (
                        workflow.id === form.id
                            ? {...workflow, ...updatedWorkflow}
                            : workflow
                    ));
                    writeStoredWorkflowOrder(next);
                    return next;
                });
                closeModal();
                return;
            }

            const wf = await api.createWorkflow({
                name,
                description,
                nodes: [
                    {
                        id: 'start-1',
                        type: 'start',
                        x: 100,
                        y: 200,
                        data: {label: '开始', variables: [{name: 'input_text', type: 'string', defaultValue: ''}]}
                    },
                    {id: 'end-1', type: 'end', x: 600, y: 200, data: {label: '结束', outputKeys: []}},
                ],
                connections: [{id: 'conn-1', from: 'start-1', to: 'end-1'}],
            });

            closeModal();
            navigate(`/editor/${wf.id}`);
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || (isEditMode ? '更新工作流失败' : '创建工作流失败'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (event, id) => {
        event.stopPropagation();
        if (window.confirm('确定删除此工作流？')) {
            try {
                setErrorMessage('');
                await api.deleteWorkflow(id);
                load();
            } catch (error) {
                console.error(error);
                setErrorMessage(error.message || '删除工作流失败');
            }
        }
    };

    const filteredWorkflows = workflows.filter(w =>
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (w.description && w.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / pageSize));
    const paginatedWorkflows = filteredWorkflows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="AI 工作流"
                subtitle="AI Prompt 工作流编排"
                brandIcon="bi bi-menu-button-wide-fill"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content list-page-view">

                <div className="workflow-sticky-header">

                    <div className="form-group" style={{margin: '0 0 0 12px', display: 'inline-flex', flexDirection: 'row', alignItems: 'center', position: 'relative'}}>
                        <i className="bi bi-search" style={{position: 'absolute', left: 12, color: 'var(--text-2)', fontSize: 13, pointerEvents: 'none', zIndex: 1}}></i>
                        <input
                            type="text"
                            placeholder="搜索工作流..."
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            onKeyDown={e => { if (e.key === 'Enter') setCurrentPage(1); }}
                            style={{width: 200, paddingLeft: 30}}
                        />
                    </div>

                    <button className="btn btn-default" onClick={() => openCreateModal()}>
                        <i className="bi bi-plus-circle"></i>
                        新建AI工作流
                    </button>
                </div>

                <div className="list-scroll-content">

                {showModal && (
                    <div className="modal-overlay">
                        <div className="modal-box workflow-form-modal">
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon">{isEditMode ? <i className="bi bi-hdd-network"/> : '✨'}</span>
                                    <h3 className="modal-title">{modalTitle}</h3>
                                </div>
                                <button className="modal-close" onClick={closeModal} disabled={submitting}>✕</button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>名称</label>
                                    <input
                                        autoFocus
                                        value={form.name}
                                        onChange={(event) => setForm((prev) => ({...prev, name: event.target.value}))}
                                        placeholder="我的工作流"
                                        onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>描述</label>
                                    <textarea
                                        value={form.description}
                                        onChange={(event) => setForm((prev) => ({
                                            ...prev,
                                            description: event.target.value
                                        }))}
                                        placeholder="描述这个工作流的用途..."
                                        rows={4}
                                    />
                                </div>
                                {isEditMode && (
                                    <div className="workflow-form-hint">
                                        仅修改列表中的基础信息，节点编排请点击卡片进入编辑器继续调整。
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn" onClick={closeModal} disabled={submitting}>取消</button>
                                <button className="btn btn-default" onClick={handleSubmit}
                                        disabled={submitting || !form.name.trim()}>
                                    <i className="bi bi-pencil-square"></i>
                                    {submitText}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {workflows.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <p>当前还没有工作流，请先创建。</p>
                    </div>
                ) : filteredWorkflows.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <h3>未找到匹配的工作流</h3>
                        <p>尝试使用其他关键词搜索</p>
                    </div>
                ) : (
                    <div className="skill-list-container">
                        <div className="skill-card-list">
                            {paginatedWorkflows.map((wf, index) => (
                                <div key={wf.id} className="skill-item" style={{animationDelay: `${0.04 * index}s`}}>
                                    <div className="skill-item-row-top">
                                        <span className="skill-item-name" onClick={() => navigate(`/editor/${wf.id}`)}>
                                            <i className="bi bi-hdd-network" style={{marginRight: 6}}></i> {wf.name}
                                        </span>
                                    </div>
                                    <div className="skill-item-row-bottom">
                                        <span className="skill-item-desc">{wf.description || '暂无描述'}</span>
                                        <div className="skill-item-meta">
                                            <div className="skill-item-meta-cell">
                                                <span className="meta-label">创建者</span>
                                                <span className="meta-val">{wf.username || '—'}</span>
                                            </div>
                                            <div className="skill-item-meta-cell">
                                                <span className="meta-label">更新</span>
                                                <span className="meta-val">{new Date(wf.updated_at).toLocaleString('zh-CN')}</span>
                                            </div>
                                            <div className="skill-item-meta-cell skill-item-actions">
                                                <button className="btn-icon" onClick={(event) => openEditModal(event, wf)} title="编辑">
                                                    <i className="bi bi-pencil-fill"/>
                                                </button>
                                                <button className="btn-icon btn-danger" onClick={(event) => handleDelete(event, wf.id)} title="删除">
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

                {filteredWorkflows.length > 0 && (
                    <div className="pagination workflow-fixed-pagination">
                        <span className="pagination-info">共 {filteredWorkflows.length} 条，第 {currentPage}/{totalPages} 页</span>
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
                            <button className="btn-sm" style={{marginLeft: 8}} disabled={currentPage >= totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}>下一页
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
