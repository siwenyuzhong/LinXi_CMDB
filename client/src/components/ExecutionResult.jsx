import React, {useState} from 'react';
import {NODE_TYPES} from '../constants';

export default function ExecutionResult(
    {
        workflowId,
        result,
        history,
        selectedExecId,
        selectedExecDetail,
        onViewExec,
        onBackToHistory,
        onRefresh,
        onClose,
    }) {
    // 视图: 'current' | 'history' | 'detail'
    const [view, setView] = useState('current');

    // 判断当前显示哪个视图
    const currentView = selectedExecId ? 'detail' : view;

    // 获取节点类型信息
    const getNodeInfo = (type) => {
        const cfg = NODE_TYPES[type];
        return cfg || {icon: '?', color: '#64748b', label: type};
    };

    // 格式化 JSON
    const formatOutput = (output) => {
        if (output === null || output === undefined) return 'null';
        if (typeof output === 'string') return output;
        try {
            return JSON.stringify(output, null, 2);
        } catch {
            return String(output);
        }
    };

    // ====== 执行详情视图 ======
    const renderDetailView = () => {
        const detail = selectedExecDetail;
        if (!detail) return <div className="exec-loading">加载中...</div>;

        const nodeResults = detail.node_results || {};

        return (
            <div className="exec-detail-view">
                <div className="exec-detail-header">
                    <button className="btn btn-ghost btn-sm" onClick={onBackToHistory}>
                        ← 返回列表
                    </button>
                    <div className="exec-detail-meta">
            <span className={`status-badge ${detail.status}`}>
              {detail.status === 'success' ? '成功' : detail.status === 'failed' ? '失败' : '运行中'}
            </span>
                        <span className="exec-detail-time">
              {new Date(detail.started_at).toLocaleString('zh-CN')}
            </span>
                        <span className="exec-detail-duration">{detail.duration_ms}ms</span>
                    </div>
                </div>

                {/* 输入参数 */}
                {detail.input && Object.keys(detail.input).length > 0 && (
                    <div className="exec-section">
                        <h4>输入参数</h4>
                        <pre className="exec-output-pre">{formatOutput(detail.input)}</pre>
                    </div>
                )}

                {/* 各节点执行结果 */}
                <div className="exec-section">
                    <h4>节点执行详情</h4>
                    <div className="node-results-list">
                        {Object.entries(nodeResults).map(([nodeId, nodeResult]) => {
                            const nodeInfo = getNodeInfo(nodeResult.type || 'unknown');
                            const nodeName = nodeResult.label || nodeResult.nodeName || nodeId;

                            return (
                                <div key={nodeId} className="node-result-item">
                                    <div className="node-result-header">
                    <span className="node-result-icon" style={{color: nodeInfo.color}}>
                      {nodeInfo.icon}
                    </span>
                                        <span className="node-result-name">{nodeName}</span>
                                        <span
                                            className="node-result-type">{nodeResult.type || nodeId.split('-')[0]}</span>
                                    </div>
                                    {nodeResult.output !== undefined && (
                                        <pre className="node-result-output">{formatOutput(nodeResult.output)}</pre>
                                    )}
                                    {nodeResult.error && (
                                        <pre className="node-result-error">{nodeResult.error}</pre>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 最终输出 */}
                {detail.output && (
                    <div className="exec-section">
                        <h4>最终输出</h4>
                        <pre className="exec-output-pre">{formatOutput(detail.output)}</pre>
                    </div>
                )}

                {/* 错误信息 */}
                {detail.error && (
                    <div className="exec-section">
                        <h4>错误信息</h4>
                        <pre className="exec-error-pre">{detail.error}</pre>
                    </div>
                )}
            </div>
        );
    };

    // ====== 历史列表视图 ======
    const renderHistoryView = () => {
        return (
            <div className="exec-history-view">
                <div className="exec-history-header">
                    <h4>执行历史</h4>
                    <button className="btn btn-ghost btn-sm" onClick={onRefresh}>刷新</button>
                </div>
                {(!history || history.length === 0) ? (
                    <div className="exec-empty">
                        <span className="exec-empty-icon">📋</span>
                        <p>暂无执行记录</p>
                    </div>
                ) : (
                    <div className="exec-history-list">
                        {history.map((h, idx) => (
                            <div
                                key={h.id}
                                className={`history-item ${h.status}`}
                                onClick={() => onViewExec(h.id)}
                            >
                                <div className="history-item-top">
                  <span className={`status-badge ${h.status}`}>
                    {h.status === 'success' ? '成功' : h.status === 'failed' ? '失败' : '运行中'}
                  </span>
                                    <span className="history-index">#{history.length - idx}</span>
                                </div>
                                <div className="history-item-bottom">
                  <span className="history-time">
                    {new Date(h.started_at).toLocaleString('zh-CN')}
                  </span>
                                    <span className="history-duration">{h.duration_ms}ms</span>
                                </div>
                                {h.error && <div className="history-error-preview">{h.error.substring(0, 60)}...</div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // ====== 当前执行视图 ======
    const renderCurrentView = () => {
        return (
            <div className="exec-current-view">
                {result ? (
                    <div className="exec-result">
                        {/* 状态 */}
                        <div className={`exec-status ${result.status}`}>
                            <span className="status-dot"/>
                            <span>
                {result.status === 'success' ? '执行成功' : result.status === 'running' ? '执行中...' : '执行失败'}
              </span>
                            {result.duration && <span className="exec-duration">{result.duration}ms</span>}
                        </div>

                        {/* 执行日志 */}
                        {result.logs && result.logs.length > 0 && (
                            <div className="exec-section">
                                <h4>执行日志</h4>
                                <div className="exec-logs">
                                    {result.logs.map((log, i) => (
                                        <div key={i} className={`log-entry ${log.status}`}>
                      <span className="log-status">
                        {log.status === 'success' ? '✓' : log.status === 'failed' ? '✗' : '⋯'}
                      </span>
                                            <span className="log-name">{log.nodeName}</span>
                                            <span className="log-type">{log.type}</span>
                                            {log.duration && <span className="log-duration">{log.duration}ms</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 输出 */}
                        {result.output && (
                            <div className="exec-section">
                                <h4>输出结果</h4>
                                <pre className="exec-output-pre">{formatOutput(result.output)}</pre>
                            </div>
                        )}

                        {/* 错误 */}
                        {result.error && (
                            <div className="exec-section">
                                <h4>错误信息</h4>
                                <pre className="exec-error-pre">{result.error}</pre>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="exec-empty">
                        <span className="exec-empty-icon">▶</span>
                        <p>点击「执行」按钮运行工作流</p>
                        <p className="text-muted">执行结果将在此处显示</p>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="exec-panel">
            {/* 面板头部 */}
            <div className="exec-header">
                {currentView === 'detail' ? (
                    <div className="exec-header-title">
                        <span>执行详情</span>
                    </div>
                ) : (
                    <div className="exec-tabs">
                        <button
                            className={`tab ${view === 'current' ? 'active' : ''}`}
                            onClick={() => setView('current')}
                        >
                            当前执行
                        </button>
                        <button
                            className={`tab ${view === 'history' ? 'active' : ''}`}
                            onClick={() => {
                                setView('history');
                                onRefresh();
                            }}
                        >
                            历史记录
                        </button>
                    </div>
                )}
                <button className="btn-icon" onClick={onClose}>✕</button>
            </div>

            {/* 面板内容 */}
            <div className="exec-body">
                {currentView === 'detail' && renderDetailView()}
                {currentView === 'history' && renderHistoryView()}
                {currentView === 'current' && renderCurrentView()}
            </div>
        </div>
    );
}

