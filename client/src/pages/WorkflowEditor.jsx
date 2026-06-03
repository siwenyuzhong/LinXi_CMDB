import React, {useState, useEffect, useCallback, useRef} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {NODE_TYPES} from '../constants';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import Sidebar from '../components/Sidebar';
import WorkflowCanvas from '../components/WorkflowCanvas';
import NodeConfig from '../components/NodeConfig';
import ExecutionResult from '../components/ExecutionResult';
import Modal from '../components/Modal';

export default function WorkflowEditor() {
    const {id} = useParams();
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [workflow, setWorkflow] = useState(null);
    const [nodes, setNodes] = useState([]);
    const [connections, setConnections] = useState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [saving, setSaving] = useState(false);
    const saveTimer = useRef(null);

    const [rightPanel, setRightPanel] = useState(null);
    const [execResult, setExecResult] = useState(null);
    const [execHistory, setExecHistory] = useState([]);
    const [selectedExecId, setSelectedExecId] = useState(null);
    const [selectedExecDetail, setSelectedExecDetail] = useState(null);
    const [inputVars, setInputVars] = useState([]);
    const [inputValues, setInputValues] = useState({});
    const [alertModal, setAlertModal] = useState({open: false, type: 'default', title: '', message: ''});

    const [nodeStatuses, setNodeStatuses] = useState({});
    const [nodeOutputs, setNodeOutputs] = useState({});
    const eventSourceRef = useRef(null);
    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    useEffect(() => {
        connectionsRef.current = connections;
    }, [connections]);

    const showAlert = useCallback((title, message, type) => {
        setAlertModal({open: true, type: type || 'error', title, message});
    }, []);

    useEffect(() => {
        api.getWorkflow(id).then(wf => {
            setWorkflow(wf);
            const rawNodes = wf.nodes || [];
            const loadedNodes = rawNodes.map((n, i) => ({
                ...n,
                x: (n.x !== 0 && Number.isFinite(n.x)) ? n.x : 200 + (i % 4) * 280,
                y: (n.y !== 0 && Number.isFinite(n.y)) ? n.y : 150 + Math.floor(i / 4) * 160,
            }));
            setNodes(loadedNodes);
            setConnections(wf.connections || []);
        }).catch(() => navigate('/workflows'));
    }, [id, navigate]);

    const loadExecHistory = useCallback(() => {
        api.getExecutions(id).then(setExecHistory).catch(console.error);
    }, [id]);

    useEffect(() => {
        loadExecHistory();
    }, [id, execResult, loadExecHistory]);

    const viewExecDetail = useCallback((execId) => {
        setSelectedExecId(execId);
        api.getExecution(id, execId).then(setSelectedExecDetail).catch(console.error);
    }, [id]);

    const doSave = useCallback(async () => {
        setSaving(true);
        try {
            await api.updateWorkflow(id, {
                name: workflow?.name || '未命名',
                description: workflow?.description || '',
                nodes: nodesRef.current,
                connections: connectionsRef.current,
            });
        } catch (e) {
            console.error('Save failed:', e);
            showAlert('保存失败', `自动保存失败：${e.message}`, 'error');
        }
        setSaving(false);
    }, [id, workflow, showAlert]);

    const autoSave = useCallback(() => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(doSave, 800);
    }, [doSave]);

    const updateNodes = useCallback((newNodes) => {
        nodesRef.current = newNodes;
        setNodes(newNodes);
        autoSave();
    }, [autoSave]);

    const updateConnections = useCallback((newConns) => {
        connectionsRef.current = newConns;
        setConnections(newConns);
        clearTimeout(saveTimer.current);
        doSave();
    }, [doSave]);

    const addNode = useCallback((type, x, y) => {
        const cfg = NODE_TYPES[type];
        const newNode = {
            id: `${type}-${Date.now()}`,
            type,
            x: x || 200 + Math.random() * 300,
            y: y || 150 + Math.random() * 200,
            data: JSON.parse(JSON.stringify(cfg.defaultData)),
        };
        updateNodes([...nodes, newNode]);
        setSelectedNodeId(newNode.id);
        setRightPanel('config');
    }, [nodes, updateNodes]);

    const deleteNode = useCallback((nodeId) => {
        const newNodes = nodes.filter(n => n.id !== nodeId);
        const newConns = connections.filter(c => c.from !== nodeId && c.to !== nodeId);
        nodesRef.current = newNodes;
        connectionsRef.current = newConns;
        setNodes(newNodes);
        setConnections(newConns);
        autoSave();
        if (selectedNodeId === nodeId) {
            setSelectedNodeId(null);
            if (rightPanel === 'config') setRightPanel(null);
        }
    }, [nodes, connections, selectedNodeId, rightPanel, autoSave]);

    const deleteConnection = useCallback((connId) => {
        const newConns = connections.filter(c => c.id !== connId);
        updateConnections(newConns);
    }, [connections, updateConnections]);

    const validateWorkflow = useCallback(() => {
        const hasStart = nodes.some(n => n.type === 'start');
        const hasEnd = nodes.some(n => n.type === 'end');

        if (!hasStart) {
            showAlert('无法执行', '工作流缺少「开始」节点，请先添加一个开始节点。', 'error');
            return false;
        }
        if (!hasEnd) {
            showAlert('无法执行', '工作流缺少「结束」节点，请先添加一个结束节点。', 'error');
            return false;
        }
        if (nodes.length > 1) {
            const connectedIds = new Set();
            connections.forEach(c => {
                connectedIds.add(c.from);
                connectedIds.add(c.to);
            });
            const orphans = nodes.filter(n => !connectedIds.has(n.id));
            if (orphans.length > 0) {
                const names = orphans.map(n => {
                    const label = n.data?.label || n.type;
                    return `• ${label}`;
                }).join('\n');
                showAlert('存在未连接的节点', `以下节点没有连线，请先连接它们：\n\n${names}`, 'error');
                return false;
            }
        }
        return true;
    }, [nodes, connections, showAlert]);

    const doExecute = (input) => {
        setNodeStatuses({});
        setNodeOutputs({});
        setExecResult({status: 'running'});
        setRightPanel('exec');
        setSelectedExecId(null);
        setSelectedExecDetail(null);

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const logs = [];
        const startTime = Date.now();

        const inputParam = encodeURIComponent(JSON.stringify(input));
        const accessToken = encodeURIComponent(getStoredAuthToken());
        const es = new EventSource(`/api/workflows/${id}/execute-stream?input=${inputParam}&access_token=${accessToken}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'node_start') {
                    setNodeStatuses(prev => ({...prev, [data.nodeId]: 'running'}));
                    logs.push({
                        nodeId: data.nodeId,
                        nodeName: data.nodeName,
                        type: data.nodeType,
                        status: 'running',
                        startTime: Date.now(),
                    });
                    setExecResult({status: 'running', logs: [...logs], duration: Date.now() - startTime});
                }

                if (data.type === 'node_success') {
                    setNodeStatuses(prev => ({...prev, [data.nodeId]: 'success'}));
                    if (data.output) {
                        setNodeOutputs(prev => ({...prev, [data.nodeId]: data.output}));
                    }
                    const log = logs.find(l => l.nodeId === data.nodeId);
                    if (log) {
                        log.status = 'completed';
                        log.endTime = Date.now();
                        log.duration = log.endTime - log.startTime;
                    }
                    setExecResult({status: 'running', logs: [...logs], duration: Date.now() - startTime});
                }

                if (data.type === 'node_error') {
                    setNodeStatuses(prev => ({...prev, [data.nodeId]: 'error'}));
                    const log = logs.find(l => l.nodeId === data.nodeId);
                    if (log) {
                        log.status = 'failed';
                        log.endTime = Date.now();
                        log.error = data.error;
                    }
                    setExecResult(prev => ({
                        ...prev,
                        status: 'running',
                        logs: [...logs],
                        duration: Date.now() - startTime,
                        error: data.error,
                    }));
                }

                if (data.type === 'done') {
                    const result = data.result;
                    setExecResult({
                        status: result.status,
                        output: result.output,
                        error: result.error,
                        logs: [...logs],
                        duration: result.duration || (Date.now() - startTime),
                    });
                    es.close();
                    eventSourceRef.current = null;
                    loadExecHistory();
                }

                if (data.type === 'error') {
                    setExecResult({
                        status: 'failed',
                        error: data.error,
                        logs: [...logs],
                        duration: Date.now() - startTime,
                    });
                    es.close();
                    eventSourceRef.current = null;
                }
            } catch (e) {
                console.error('SSE parse error:', e);
            }
        };

        es.onerror = () => {
            setExecResult(prev => ({
                ...prev,
                status: prev.status === 'running' ? 'failed' : prev.status,
                error: prev.error || '连接中断',
            }));
            es.close();
            eventSourceRef.current = null;
        };
    };

    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const handleExecute = () => {
        if (!validateWorkflow()) return;

        const startNode = nodes.find(n => n.type === 'start');
        const variables = startNode?.data?.variables || [];
        const validVars = variables.filter(v => v.name && v.name.trim());

        if (validVars.length === 0) {
            doExecute({});
            return;
        }

        const defaultValues = {};
        validVars.forEach(v => {
            defaultValues[v.name] = v.defaultValue || '';
        });
        setInputVars(validVars);
        setInputValues(defaultValues);
        setRightPanel('input');
    };

    const handleInputConfirm = () => {
        const finalValues = {};
        inputVars.forEach(v => {
            let val = inputValues[v.name] || '';
            if (v.type === 'number') {
                val = val === '' ? 0 : Number(val);
            } else if (v.type === 'boolean') {
                val = val === 'true' || val === true;
            }
            finalValues[v.name] = val;
        });
        doExecute(finalValues);
    };

    const handleSelectNode = (nodeId) => {
        setSelectedNodeId(nodeId);
        if (!nodeId && rightPanel === 'config') {
            setRightPanel(null);
        }
    };

    const handleOpenNodeConfig = (nodeId) => {
        setSelectedNodeId(nodeId);
        if (nodeId) {
            setRightPanel('config');
        }
    };

    const handleToggleExecPanel = () => {
        if (rightPanel === 'exec') {
            setRightPanel(null);
        } else {
            setRightPanel('exec');
            setSelectedExecId(null);
            setSelectedExecDetail(null);
            loadExecHistory();
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const renderInputForm = () => (
        <div className="input-panel">
            <div className="input-panel-header">
                <div className="input-panel-title">
                    <span className="input-panel-icon">📝</span>
                    <h3>填写输入参数</h3>
                </div>
                <button className="btn-icon" onClick={() => setRightPanel(null)}>✕</button>
            </div>
            <div className="input-panel-body">
                <p className="input-panel-hint">请为工作流的输入变量填写参数值：</p>

                {inputVars.map((v, i) => (
                    <div key={i} className="input-var-group">
                        <div className="input-var-header">
                            <span className="input-var-label">变量名</span>
                            <span className="input-var-name">{v.name}</span>
                            <span className="input-var-type">{v.type || 'string'}</span>
                        </div>
                        {v.type === 'boolean' ? (
                            <div className="input-var-bool">
                                <button
                                    className={`bool-btn ${inputValues[v.name] === 'true' ? 'active true' : ''}`}
                                    onClick={() => setInputValues(prev => ({...prev, [v.name]: 'true'}))}
                                >
                                    ✓ True
                                </button>
                                <button
                                    className={`bool-btn ${inputValues[v.name] === 'false' ? 'active false' : ''}`}
                                    onClick={() => setInputValues(prev => ({...prev, [v.name]: 'false'}))}
                                >
                                    ✗ False
                                </button>
                            </div>
                        ) : (
                            <input
                                className="input-var-field"
                                type={v.type === 'number' ? 'number' : 'text'}
                                value={inputValues[v.name] || ''}
                                onChange={e => setInputValues(prev => ({...prev, [v.name]: e.target.value}))}
                                placeholder={v.defaultValue ? `默认: ${v.defaultValue}` : `输入 ${v.name} 的值`}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleInputConfirm();
                                }}
                            />
                        )}
                    </div>
                ))}

                <div className="input-panel-actions">
                    <button className="btn" onClick={() => setRightPanel(null)}>取消</button>
                    <button className="btn btn-secondary" onClick={handleInputConfirm}>
                        ▶ 开始执行
                    </button>
                </div>

                <div className="input-modal-shortcut">
                    提示: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 快速执行
                </div>
            </div>
        </div>
    );

    const selectedNode = nodes.find(n => n.id === selectedNodeId);

    if (!workflow) return <div className="loading">加载中...</div>;

    return (
        <div className="app-shell editor-shell">
            <AppSidebar
                title="AI 工作流编辑"
                subtitle={workflow.name}
                brandIcon="bi bi-menu-button-wide-fill"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
                actions={(
                    <>
                        <button className="btn app-sidebar-action-btn" onClick={() => navigate('/workflows')}>
                            ← 返回工作流
                        </button>
                        <button className="btn btn-secondary app-sidebar-action-btn" onClick={handleExecute}>
                            ▶ 执行工作流
                        </button>
                        <button
                            className={`btn app-sidebar-action-btn ${rightPanel === 'exec' ? 'btn-accent' : 'btn-ghost'}`}
                            onClick={handleToggleExecPanel}
                        >
                            📊 执行记录
                        </button>
                    </>
                )}
                footer={(
                    <div className="editor-sidebar-meta">
                        <div className="editor-sidebar-meta-row">
                            <span className="editor-sidebar-meta-label">节点数</span>
                            <strong>{nodes.length}</strong>
                        </div>
                        <div className="editor-sidebar-meta-row">
                            <span className="editor-sidebar-meta-label">连线数</span>
                            <strong>{connections.length}</strong>
                        </div>
                        <div className="editor-sidebar-status-list">
                            {nodes.some(n => n.type === 'start') && <span className="status-tag start">有开始</span>}
                            {nodes.some(n => n.type === 'end') ? (
                                <span className="status-tag end">有结束</span>
                            ) : (
                                <span className="status-tag missing">缺少结束节点</span>
                            )}
                            {saving && <span className="save-indicator">保存中...</span>}
                        </div>
                    </div>
                )}
            />

            <div className="editor-layout">

                {/*<div className="task-page-intro">*/}
                {/*    <div className="task-tip-card">*/}
                {/*        <strong>正在编辑工作流：【{workflow.name}】</strong>/*/}
                {/*        <code>在左侧发起导航与核心操作，中间区域专注于节点编排。</code>*/}
                {/*    </div>*/}
                {/*</div>*/}

                <div className="editor-body">
                    <Sidebar onAddNode={addNode}/>

                    <div className="canvas-area">
                        <WorkflowCanvas
                            viewportKey={id}
                            nodes={nodes}
                            connections={connections}
                            selectedNodeId={selectedNodeId}
                            onSelectNode={handleSelectNode}
                            onOpenNodeConfig={handleOpenNodeConfig}
                            onUpdateNodes={updateNodes}
                            onUpdateConnections={updateConnections}
                            onDeleteNode={deleteNode}
                            onDeleteConnection={deleteConnection}
                            nodeStatuses={nodeStatuses}
                            nodeOutputs={nodeOutputs}
                        />
                    </div>

                    {rightPanel === 'config' && selectedNode && (
                        <NodeConfig
                            node={selectedNode}
                            nodes={nodes}
                            connections={connections}
                            onUpdate={(updatedNode) => {
                                const newNodes = nodes.map(n => n.id === updatedNode.id ? updatedNode : n);
                                updateNodes(newNodes);
                            }}
                            onUpdateConnections={updateConnections}
                            onClose={() => {
                                setSelectedNodeId(null);
                                setRightPanel(null);
                            }}
                            onDelete={() => deleteNode(selectedNode.id)}
                        />
                    )}

                    {rightPanel === 'input' && renderInputForm()}

                    {rightPanel === 'exec' && (
                        <ExecutionResult
                            workflowId={id}
                            result={execResult}
                            history={execHistory}
                            selectedExecId={selectedExecId}
                            selectedExecDetail={selectedExecDetail}
                            onViewExec={viewExecDetail}
                            onBackToHistory={() => {
                                setSelectedExecId(null);
                                setSelectedExecDetail(null);
                            }}
                            onRefresh={loadExecHistory}
                            onClose={() => setRightPanel(null)}
                        />
                    )}
                </div>

                <Modal
                    open={alertModal.open}
                    onClose={() => setAlertModal({open: false, type: 'default', title: '', message: ''})}
                    title={alertModal.title}
                    type={alertModal.type}
                    footer={
                        <button
                            className={`btn ${alertModal.type === 'error' ? 'btn-danger-solid' : 'btn-primary'}`}
                            onClick={() => setAlertModal({open: false, type: 'default', title: '', message: ''})}
                        >
                            确定
                        </button>
                    }
                >
                    <div className="alert-message">
                        {alertModal.message.split('\n').map((line, i) => (
                            <p key={i}>{line || '\u00A0'}</p>
                        ))}
                    </div>
                </Modal>
            </div>
        </div>
    );
}
