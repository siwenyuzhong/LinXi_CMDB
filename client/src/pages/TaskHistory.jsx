import React, {useCallback, useEffect, useState} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {loadConfig, getCmdbApiBase} from '../config';
import AppSidebar from '../components/AppSidebar';

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN');
}

function prettyJson(value) {
    try {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value || '');
    }
}

function durationText(ms) {
    if (!ms || ms <= 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function TaskHistory() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [activeTab, setActiveTab] = usePersistedState('taskHistoryTab', 'task');
    const [executions, setExecutions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [page, setPage] = usePersistedState('taskHistoryPage', 1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [viewDetail, setViewDetail] = useState(null);
    const [pageSize, setPageSize] = usePersistedState('taskHistoryPageSize', 5);
    const [cmdbBase, setCmdbBase] = useState('');

    const loadExecutions = useCallback(async (p, ps, silent) => {
        const ps_ = ps !== undefined ? ps : pageSize;
        if (!silent) setLoading(true);
        try {
            if (activeTab === 'inspect') {
                const data = await api.listInspectionHistory(p, ps_);
                setExecutions(data.records.map(r => ({...r, task_name: r.host_name, type: '巡检', ref_name: r.host_ip})));
                setTotal(data.total);
                setTotalPages(data.total_pages);
                setPage(data.page);
            } else if (activeTab === 'ssh') {
                const data = await api.listSshHistory(p, ps_);
                setExecutions(data.records.map(r => ({...r, task_name: r.host_name, type: 'SSH', ref_name: r.host_ip, started_at: r.executed_at})));
                setTotal(data.total);
                setTotalPages(data.pages);
                setPage(data.page);
            } else if (activeTab === 'cmdb') {
                const data = await api.listAsyncJobs(p, ps_);
                setExecutions(data.records);
                setTotal(data.total);
                setTotalPages(data.total_pages);
                setPage(data.page);
            } else {
                const data = await api.listAllTaskExecutions(p, ps_);
                setExecutions(data.executions);
                setTotal(data.total);
                setTotalPages(data.total_pages);
                setPage(data.page);
            }
            setErrorMessage('');
        } catch (error) {
            console.error(error);
            setExecutions([]);
            setErrorMessage(error.message || '加载失败');
        } finally {
            setLoading(false);
        }
    }, [activeTab, pageSize]);

    useEffect(() => {
        loadConfig().then(() => setCmdbBase(getCmdbApiBase()));
    }, []);

    const checkTabPermission = useCallback(async (tab) => {
        if (!cmdbBase) return true;
        const permMap = {
            ssh: { type: 'ssh-history', code: 'ssh-history:read', label: 'SSH执行历史' },
            inspect: { type: 'inspection', code: 'inspection:use', label: '巡检历史' },
        };
        const perm = permMap[tab];
        if (!perm) return true;
        const token = getStoredAuthToken();
        const headers = token ? {Authorization: `Bearer ${token}`} : {};
        try {
            const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=${perm.type}&resource_id=*&permission=${perm.code}`, { headers });
            if (res.ok) {
                const data = await res.json();
                if (!data.allowed) {
                    alert(`⚠️ 权限不足: 无权限查看${perm.label}`);
                    setLoading(false);
                    return false;
                }
            }
        } catch (_) {}
        return true;
    }, [cmdbBase]);

    useEffect(() => {
        (async () => {
            if (!await checkTabPermission(activeTab)) return;
            loadExecutions(page);
        })();
    }, [activeTab, cmdbBase, page, checkTabPermission]);

    // Poll for status changes while any execution is running
    useEffect(() => {
        const hasRunning = executions.some(e => e.status === 'running');
        if (!hasRunning) return;
        const interval = setInterval(() => {
            loadExecutions(page, undefined, true);
        }, 2000);
        return () => clearInterval(interval);
    }, [executions, activeTab, page]);

    const switchTab = (tab) => {
        setActiveTab(tab);
        setViewDetail(null);
        setPage(1);
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const downloadReport = (exec) => {
        const hostName = exec.task_name || exec.host_name || '未知主机';
        const hostIp = exec.ref_name || exec.host_ip || '—';
        const time = formatDateTime(exec.started_at);
        const timeFile = (exec.started_at || '').replace(/[T:]/g, '-').slice(0, 19);
        const inspector = user?.username || '未知';
        const statusText = exec.status === 'completed' || exec.status === 'success' ? '成功' : exec.status === 'failed' ? '失败' : exec.status || '未知';
        const statusColor = exec.status === 'completed' || exec.status === 'success' ? '#22c55e' : '#ef4444';

        const outputLines = exec.output?.lines
            ? exec.output.lines.filter(l => l.type === 'output' || l.type === 'info' || l.type === 'error').map(l => escHtml(l.text)).join('<br>')
            : '';

        const analysisText = escHtml(exec.analysis || exec.output?.analysis_text || '');

        function escHtml(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>巡检报告 - ${escHtml(hostName)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 24px; color: #1e293b; background: #f8fafc; }
  h1 { text-align: center; color: #0f172a; font-size: 24px; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #64748b; font-size: 13px; margin-bottom: 32px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .meta-item { background: #fff; border-radius: 10px; padding: 14px 18px; border: 1px solid #e2e8f0; }
  .meta-label { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 4px; }
  .meta-value { font-size: 15px; font-weight: 600; }
  .status-badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 13px; font-weight: 600; color: #fff; }
  .section { background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px; overflow: hidden; }
  .section-title { padding: 14px 20px; font-size: 15px; font-weight: 700; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
  .section-body { padding: 16px 20px; font-size: 13px; line-height: 1.7; }
  .section-body pre { margin: 0; white-space: pre-wrap; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
  .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  .error-text { color: #ef4444; }
</style>
</head>
<body>
  <h1>【${escHtml(hostName)}】巡检报告</h1>
  <div class="subtitle">由 灵犀 AI 自动生成</div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">主机名称</div>
      <div class="meta-value">${escHtml(hostName)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">主机 IP</div>
      <div class="meta-value">${escHtml(hostIp)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">巡检时间</div>
      <div class="meta-value">${escHtml(time)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">巡检人</div>
      <div class="meta-value">${escHtml(inspector)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">状态</div>
      <div class="meta-value"><span class="status-badge" style="background:${statusColor}">${escHtml(statusText)}</span></div>
    </div>
    <div class="meta-item">
      <div class="meta-label">耗时</div>
      <div class="meta-value">${escHtml(durationText(exec.duration_ms))}</div>
    </div>
  </div>

  ${outputLines ? `
  <div class="section">
    <div class="section-title">📋 原始输出</div>
    <div class="section-body"><pre>${outputLines}</pre></div>
  </div>` : ''}

  ${analysisText ? `
  <div class="section">
    <div class="section-title">🤖 AI 分析结论</div>
    <div class="section-body"><pre>${analysisText}</pre></div>
  </div>` : ''}

  ${exec.error ? `
  <div class="section">
    <div class="section-title" style="color:#ef4444">⚠️ 错误信息</div>
    <div class="section-body error-text">${escHtml(exec.error)}</div>
  </div>` : ''}

  <div class="footer">灵犀 AI 巡检系统 · ${escHtml(time)}</div>
</body>
</html>`;

        const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `巡检报告_${hostName}_${hostIp}_${timeFile}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="任务历史"
                subtitle="查看定时任务执行记录"
                brandIcon="bi bi-files"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content workflow-list-page list-page-view">

                <div className="workflow-sticky-header">
                    <div className="tab-bar" style={{marginBottom: 8, display: 'flex', gap: 4}}>
                        <button className={`tab${activeTab === 'task' ? ' active' : ''}`}
                                onClick={() => switchTab('task')}>定时任务
                        </button>
                        <button className={`tab${activeTab === 'inspect' ? ' active' : ''}`}
                                onClick={() => switchTab('inspect')}>巡检历史
                        </button>
                        <button className={`tab${activeTab === 'ssh' ? ' active' : ''}`}
                                onClick={() => switchTab('ssh')}>SSH执行历史
                        </button>
                        <button className={`tab${activeTab === 'cmdb' ? ' active' : ''}`}
                                onClick={() => switchTab('cmdb')}>CMDB入库历史
                        </button>
                    </div>
                </div>

                <div className="list-scroll-content">

                {loading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>加载中...</p>
                    </div>
                ) : executions.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <p>{activeTab === 'inspect' ? '暂无巡检记录' : activeTab === 'ssh' ? '暂无 SSH 执行记录' : activeTab === 'cmdb' ? '暂无入库记录' : '暂无执行记录'}</p>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="data-table">
                            <thead>
                            <tr>
                                <th style={{width: 48, textAlign: 'center'}}>#</th>
                                {activeTab === 'cmdb' ? (
                                    <>
                                        <th>用户名</th>
                                        <th>任务类型</th>
                                        <th>模型ID</th>
                                        <th>总数</th>
                                        <th>成功</th>
                                        <th>失败</th>
                                        <th>创建时间</th>
                                        <th>状态</th>
                                        <th>操作</th>
                                    </>
                                ) : (
                                    <>
                                        <th>{activeTab === 'inspect' ? '主机名称' : activeTab === 'ssh' ? '主机名称' : '任务名称'}</th>
                                        <th>类型</th>
                                        <th>{activeTab === 'inspect' ? '主机IP' : activeTab === 'ssh' ? '主机IP' : '关联资源'}</th>
                                        {activeTab !== 'inspect' && <th>执行者</th>}
                                        <th>{activeTab === 'ssh' ? '执行时间' : '开始时间'}</th>
                                        <th>状态</th>
                                        <th>耗时</th>
                                        <th>结果</th>
                                        {activeTab === 'inspect' && <th>报告下载</th>}
                                    </>
                                )}
                            </tr>
                            </thead>
                            <tbody>
                            {executions.map((exec, index) => {
                                const taskName = activeTab === 'task' ? (exec.ref_name || exec.task_name || '—') : (exec.task_name || '—');
                                const resourceName = activeTab === 'task' ? (exec.resource_name || '—') : (exec.ref_name || '—');
                                const executorName = activeTab === 'task' ? (exec.username || '—') : (activeTab === 'ssh' ? (exec.platform_user || '—') : '—');
                                return (
                                <tr key={exec.id}>
                                    <td style={{textAlign: 'center', color: 'var(--text-2)', fontSize: 13}}>{(page - 1) * pageSize + index + 1}</td>
                                    {activeTab === 'cmdb' ? (
                                        <>
                                            <td style={{fontSize: 12}}>{exec.username || '—'}</td>
                                            <td><span className="auth-badge script" style={{fontSize: 12}}>{exec.type}</span></td>
                                            <td style={{fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={exec.model_id || ''}>{exec.model_id || '—'}</td>
                                            <td>{exec.total_count ?? '—'}</td>
                                            <td style={{color: 'var(--success)'}}>{exec.success_count ?? '—'}</td>
                                            <td style={{color: exec.fail_count > 0 ? 'var(--danger)' : ''}}>{exec.fail_count ?? '—'}</td>
                                            <td>{formatDateTime(exec.created_at)}</td>
                                            <td>
                                                <span className={`task-status-chip ${exec.status === 'completed' ? 'enabled' : exec.status === 'failed' ? 'disabled' : exec.status === 'processing' ? 'pending' : ''}`}>
                                                    {exec.status === 'completed' ? '完成' : exec.status === 'failed' ? '失败' : exec.status === 'processing' ? '处理中' : exec.status === 'pending' ? '等待中' : exec.status || '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <button className="btn-icon"
                                                        onClick={() => setViewDetail(viewDetail === exec.id ? null : exec.id)}
                                                        title="详情">
                                                    {viewDetail === exec.id ? '▲' : '▼'}
                                                </button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                        <td><span style={{fontSize: 12}}>{taskName}</span></td>
                                        <td><span className={`auth-badge${exec.type === 'script' ? ' script' : exec.type === '巡检' ? ' inspect' : exec.type === 'SSH' ? ' ssh' : ' workflow'}`}>{exec.type === 'script' ? '工具库' : exec.type === '巡检' ? '巡检' : exec.type === 'SSH' ? 'SSH' : 'AI工作流'}</span></td>
                                        <td style={{fontSize: 12}}>{resourceName}</td>
                                        {activeTab !== 'inspect' && <td>{executorName}</td>}
                                        <td>{formatDateTime(exec.started_at)}</td>
                                        <td>
                                            {activeTab === 'ssh' ? (
                                                <span className="task-status-chip enabled">已执行</span>
                                            ) : exec.status === 'running' ? (
                                                <span className="task-status-chip running">
                                                    <i className="bi bi-arrow-repeat spin" style={{marginRight: 4, fontSize: 11}}/> 运行中
                                                </span>
                                            ) : (
                                                <span className={`task-status-chip ${(exec.status === 'completed' || exec.status === 'success') ? 'enabled' : exec.status === 'failed' ? 'disabled' : ''}`}>
                                                    {exec.status === 'completed' || exec.status === 'success' ? '成功' : exec.status === 'failed' ? '失败' : exec.status || '未知'}
                                                </span>
                                            )}
                                        </td>
                                        <td>{activeTab === 'ssh' ? '—' : durationText(exec.duration_ms)}</td>
                                        <td>
                                            <button className="btn-icon"
                                                    onClick={() => setViewDetail(viewDetail === exec.id ? null : exec.id)}
                                                    title="详情">
                                                {viewDetail === exec.id ? '▲' : '▼'}
                                            </button>
                                        </td>
                                        {activeTab === 'inspect' && (
                                            <td>
                                                <button className="btn-sm" onClick={() => downloadReport(exec)}
                                                        style={{fontSize: 12}}>下载HTML报告</button>
                                            </td>
                                        )}
                                        </>
                                    )}
                                </tr>
                            );
                            })}
                            </tbody>
                        </table>
                    </div>
                )}

                {viewDetail && (() => {
                    const exec = executions.find((e) => e.id === viewDetail);
                    if (!exec) return null;
                    return (
                        <div className="task-history-detail">
                                <div className="task-detail-sticky-header">
                                    {activeTab === 'inspect' && exec.task_name && (
                                        <div className="task-detail-host-badge">
                                            🖥️ {exec.task_name} ({exec.ref_name})
                                        </div>
                                    )}
                                    {activeTab === 'ssh' && (
                                        <div className="task-detail-host-badge">
                                            🖥️ {exec.task_name} ({exec.ref_name})
                                        </div>
                                    )}
                                    {activeTab === 'cmdb' && (
                                        <div className="task-detail-host-badge">
                                            📦 {exec.type} ({exec.username || '—'})
                                        </div>
                                    )}

                                </div>
                            <div className="model-editor-header" style={{margin: 0, paddingBottom: 8}}>
                                        <h4>执行详情</h4>
                                        <button className="btn btn-sm" onClick={() => setViewDetail(null)}>关闭</button>
                                    </div>
                                {exec.error && (
                                    <div className="task-last-error" style={{marginBottom: 12}}>
                                        错误信息：{exec.error}
                                    </div>
                                )}
                                {activeTab === 'ssh' && exec.command && (
                                    <div style={{marginBottom: 12}}>
                                        <div className="inspect-section-label">💻 执行命令</div>
                                        <pre className="task-history-pre" style={{maxHeight: 'none', background: 'var(--surface-2)', padding: 12, borderRadius: 6, fontSize: 13}}>
                                            {exec.command}
                                        </pre>
                                    </div>
                                )}
                                {activeTab === 'cmdb' && exec.errors && exec.errors.length > 0 && (
                                    <div style={{marginBottom: 12}}>
                                        <div className="inspect-section-label">⚠️ 错误列表</div>
                                        <pre className="task-history-pre" style={{maxHeight: 300, background: 'var(--surface-2)', padding: 12, borderRadius: 6, fontSize: 12}}>
                                            {prettyJson(exec.errors)}
                                        </pre>
                                    </div>
                                )}
                                {exec.output?.lines && (
                                    <div style={{marginBottom: (exec.analysis || exec.output?.analysis_text) ? 12 : 0}}>
                                        <div className="inspect-section-label">📋原始输出</div>
                                        <pre className="task-history-pre" style={{maxHeight: 'none', background: 'var(--surface-2)', padding: 12, borderRadius: 6, fontSize: 12}}>
                                            {exec.output.lines.filter(l => l.type === 'output' || l.type === 'info' || l.type === 'error').map((l, i) => l.text).join('\n')}
                                        </pre>
                                    </div>
                                )}
                                {(exec.analysis || exec.output?.analysis_text) && (
                                    <div>
                                        <div className="inspect-section-label">🤖AI结论分析</div>
                                        <pre className="task-history-pre" style={{maxHeight: 'none', background: 'var(--surface-1)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.6}}>
                                            {exec.analysis || exec.output?.analysis_text}
                                        </pre>
                                    </div>
                                )}
                                {activeTab !== 'cmdb' && !exec.output?.lines && !exec.analysis && !exec.output?.analysis_text && (
                                    <div className="model-detail-field-grid">
                                        <div>
                                            <span className="model-detail-field-label">输入参数</span>
                                            <pre className="task-history-pre">{prettyJson(exec.input)}</pre>
                                        </div>
                                        <div>
                                            <span className="model-detail-field-label">输出结果</span>
                                            <pre className="task-history-pre">{prettyJson(exec.output)}</pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {executions.length > 0 && (
                    <div className="pagination">
                        <span className="pagination-info">共 {total} 条，第 {page}/{totalPages} 页</span>
                        <select value={pageSize}
                                onChange={(e) => { const v = Number(e.target.value); setPageSize(v); loadExecutions(1, v); }}>
                            <option value={5}>5 条</option>
                            <option value={10}>10 条</option>
                            <option value={20}>20 条</option>
                            <option value={50}>50 条</option>
                        </select>
                        <div>
                            <button className="btn-sm" disabled={page <= 1}
                                    onClick={() => loadExecutions(page - 1)}>上一页
                            </button>
                            <button className="btn-sm" style={{marginLeft: 8}} disabled={page >= totalPages}
                                    onClick={() => loadExecutions(page + 1)}>下一页
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
