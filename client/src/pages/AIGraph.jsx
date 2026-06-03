import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {useNavigate, useParams, useLocation} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {getAiGraphApiBase, getCmdbApiBase} from '../config';
import AppSidebar from '../components/AppSidebar';
import * as XLSX from 'xlsx-js-style';

const RELATION_TYPE_LABELS = {
    oneToOne: '一对一',
    oneToMany: '一对多',
    manyToOne: '多对一',
    manyToMany: '多对多',
};

const FIELD_TYPE_LABELS = {
    string: '字符串',
    number: '数字',
    float: '浮点数',
    boolean: '布尔值',
    date: '日期',
    datetime: '日期时间',
    text: '长文本',
    json: 'JSON',
    struct: '结构体',
    array: '数组',
    enum: '枚举',
    relation: '关联关系',
};

function createEmptyNode() {
    return {
        model_id: '',
        model_name: '',
        relation_field: '',
        relation_field_name: '',
        relation_type: '',
        relation_target_field: '',
    };
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN');
}

function ChatDialog({graphId, graphName, onClose}) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const chatRef = useRef(null);

    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || loading) return;
        setInput('');
        setMessages(prev => [...prev, {role: 'user', content: text}]);
        setLoading(true);

        const base = getAiGraphApiBase();
        const token = localStorage.getItem('promptflow_auth_token');

        try {
            const resp = await fetch(`${base}/api/ai-graph/query`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({graph_id: graphId, raw_text: text}),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

            const dirLabel = data.direction === 'forward' ? '正向' : '反向';
            setMessages(prev => [...prev, {
                role: 'assistant',
                sql: data.sql?.query || '',
                desc: data.sql?.description || '',
                results: data.results || [],
                summary: data.summary || '',
                dirLabel,
                instanceId: data.search_term || '',
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {role: 'assistant', content: `请求失败: ${err.message}`}]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div style={{
                width: 780, maxWidth: '92vw', height: '85vh',
                background: 'var(--surface)', borderRadius: 12,
                display: 'flex', flexDirection: 'column',
                border: '1px solid var(--border-2)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}>
                <div style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border-2)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <strong><i className="bi bi-chat-dots" style={{marginRight: 6}}/>模型拓扑查询</strong>
                    <span style={{fontSize: 12, color: 'var(--text-3)', flex: 1, marginLeft: 8}}>
                        拓扑：{graphName}
                    </span>
                    <button className="btn" onClick={onClose} style={{padding: '2px 10px', fontSize: 13}}>
                        <i className="bi bi-x-lg"/>
                    </button>
                </div>
                <div ref={chatRef} style={{
                    flex: 1, overflow: 'auto', padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 16,
                }}>
                    {messages.length === 0 && (
                        <div style={{textAlign: 'center', color: 'var(--text-3)', fontSize: 13, paddingTop: 40, lineHeight: 2}}>
                            请输入实例 ID 查询关联数据<br/>
                            例如：<code style={{background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4}}>正向查询 instance-001</code>&nbsp;
                            <code style={{background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4}}>查询admin</code>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div key={i}>
                            {m.role === 'user' ? (
                                <div style={{
                                    padding: '8px 14px',
                                    borderRadius: 10,
                                    background: 'var(--accent)',
                                    color: '#fff',
                                    fontSize: 14,
                                    lineHeight: 1.5,
                                    width: 'fit-content',
                                    maxWidth: '80%',
                                    marginLeft: 'auto',
                                }}>{m.content}</div>
                            ) : m.sql ? (
                                <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                                    <div style={{
                                        fontSize: 12,
                                        color: 'var(--text-3)',
                                        display: 'flex', gap: 12,
                                    }}>
                                        <span><i className="bi bi-arrow-right"/> {m.dirLabel}</span>
                                        <span><i className="bi bi-box"/> {m.instanceId}</span>
                                        {m.desc && <span><i className="bi bi-info-circle"/> {m.desc}</span>}
                                        <span><i className="bi bi-table"/> {m.results.length} 条结果</span>
                                    </div>

                                    <details open>
                                        <summary style={{
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            color: 'var(--text-3)',
                                            userSelect: 'none',
                                        }}>
                                            <i className="bi bi-code-slash"/> SQL 语句
                                        </summary>
                                        <div style={{
                                            marginTop: 8,
                                            background: '#1e1e2e',
                                            borderRadius: 8,
                                            padding: 16,
                                            overflow: 'auto',
                                            position: 'relative',
                                        }}>
                                            <button className="btn" style={{
                                                position: 'absolute', top: 8, right: 8,
                                                fontSize: 11, padding: '2px 8px', opacity: 0.7,
                                            }}
                                                    onClick={() => navigator.clipboard.writeText(m.sql)}>
                                                <i className="bi bi-clipboard"/>
                                            </button>
                                            <pre style={{
                                                margin: 0,
                                                color: '#cdd6f4',
                                                fontSize: 13,
                                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                                lineHeight: 1.6,
                                                whiteSpace: 'pre',
                                            }}>{m.sql}</pre>
                                        </div>
                                    </details>

                                    <details open={m.results.length > 0}>
                                        <summary style={{
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            color: 'var(--text-3)',
                                            userSelect: 'none',
                                        }}>
                                            <i className="bi bi-table"/> 查询结果（{m.results.length} 条）
                                        </summary>
                                        <div style={{
                                            marginTop: 8,
                                            overflow: 'auto',
                                            border: '1px solid var(--border-2)',
                                            borderRadius: 8,
                                        }}>
                                            {m.results.length === 0 ? (
                                                <div style={{padding: '16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13}}>
                                                    未找到匹配数据
                                                </div>
                                            ) : m.results[0].error ? (
                                                <div style={{padding: '12px 16px', color: '#ef4444', fontSize: 13, whiteSpace: 'pre-wrap'}}>
                                                    <i className="bi bi-exclamation-triangle"/> 查询执行错误：{m.results[0].error}
                                                </div>
                                            ) : (
                                                <>
                                                    <table style={{
                                                        width: '100%',
                                                        borderCollapse: 'collapse',
                                                        fontSize: 12,
                                                    }}>
                                                        <thead>
                                                            <tr style={{background: 'var(--surface-2)'}}>
                                                                {Object.keys(m.results[0]).map(col => (
                                                                    <th key={col} style={{
                                                                        padding: '8px 12px',
                                                                        textAlign: 'left',
                                                                        borderBottom: '1px solid var(--border-2)',
                                                                        fontWeight: 600,
                                                                        whiteSpace: 'nowrap',
                                                                    }}>{col}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {m.results.slice(0, 50).map((row, ri) => (
                                                                <tr key={ri}
                                                                    style={{background: ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'}}>
                                                                    {Object.values(row).map((val, ci) => (
                                                                        <td key={ci} style={{
                                                                            padding: '6px 12px',
                                                                            borderBottom: '1px solid var(--border-2)',
                                                                            maxWidth: 200,
                                                                            overflow: 'hidden',
                                                                            textOverflow: 'ellipsis',
                                                                            whiteSpace: 'nowrap',
                                                                        }}>{formatCellValue(val)}</td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                    {m.results.length > 50 && (
                                                        <div style={{padding: '8px 12px', fontSize: 11, color: 'var(--text-3)', textAlign: 'center', borderTop: '1px solid var(--border-2)'}}>
                                                            仅显示前 50 条，共 {m.results.length} 条
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </details>

                                    {m.summary && (
                                        <div style={{
                                            padding: '12px 16px',
                                            background: 'rgba(99,102,241,0.08)',
                                            border: '1px solid rgba(99,102,241,0.2)',
                                            borderRadius: 8,
                                            fontSize: 14,
                                            lineHeight: 1.6,
                                            color: 'var(--text)',
                                        }}>
                                            <i className="bi bi-stars" style={{marginRight: 6, color: 'var(--accent)'}}/>
                                            {m.summary}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{
                                    padding: '8px 14px',
                                    borderRadius: 10,
                                    background: 'var(--surface-2)',
                                    color: 'var(--text)',
                                    fontSize: 14,
                                    lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap',
                                    width: 'fit-content',
                                    maxWidth: '80%',
                                }}>{m.content}</div>
                            )}
                        </div>
                    ))}
                    {loading && (
                        <div style={{
                            padding: '8px 14px',
                            borderRadius: 10,
                            background: 'var(--surface-2)',
                            color: 'var(--text-3)',
                            fontSize: 13,
                            width: 'fit-content',
                            display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                            <div className="chat-spinner"/>
                            正在查询并生成总结…
                        </div>
                    )}
                </div>
                <div style={{
                    padding: '10px 16px',
                    borderTop: '1px solid var(--border-2)',
                    display: 'flex', gap: 8,
                }}>
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="输入查询内容，如：正向查询 instance-001"
                        disabled={loading}
                        style={{flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13}}
                    />
                    <button className="btn btn-default" onClick={handleSend} disabled={loading}
                            style={{padding: '8px 16px', fontSize: 13}}>
                        {loading ? <i className="bi bi-hourglass-split"/> : <i className="bi bi-send-fill"/>}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ViewDialog({graph, models, onClose}) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const nodes = graph.nodes || [];

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        setResult(null);
        const base = getAiGraphApiBase();
        const token = localStorage.getItem('promptflow_auth_token');
        const chainNodes = nodes.map(n => ({
            model_id: n.model_id,
            model_name: n.model_name,
            relation_field: n.relation_field || '',
            relation_field_name: n.relation_field_name || '',
            relation_type: n.relation_type || '',
            relation_target_field: n.relation_target_field || '',
        }));
        try {
            const resp = await fetch(`${base}/api/ai-graph/chain-query`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({
                    nodes: chainNodes,
                    search_value: '',
                    search_field: '',
                    fuzzy_match: false,
                }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            if (data.error) throw new Error(data.error);
            setResult(data.result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [graph]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const getColKeys = () => {
        if (!result?.merged || result.merged.length === 0) return [];
        const keys = new Set();
        result.merged.forEach(item => {
            if (item.flat) Object.keys(item.flat).forEach(k => keys.add(k));
        });
        return Array.from(keys);
    };

    const colKeys = getColKeys();

    const exportToExcel = () => {
        if (!result?.merged || result.merged.length === 0) return;
        const wsData = [
            ['#', ...colKeys],
            ...result.merged.map((item, i) => [i + 1, ...colKeys.map(k => item.flat ? item.flat[k] : undefined)]),
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{wch: 6}, ...colKeys.map(() => ({wch: 20}))];
        XLSX.utils.book_append_sheet(wb, ws, '查询结果');
        XLSX.writeFile(wb, `${graph.name}_查询结果.xlsx`);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div style={{
                width: 860, maxWidth: '94vw', height: '90vh',
                background: 'var(--surface)', borderRadius: 12,
                display: 'flex', flexDirection: 'column',
                border: '1px solid var(--border-2)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}>
                <div style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border-2)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <strong><i className="bi bi-eye" style={{marginRight: 6}}/>查看拓扑</strong>
                    <span style={{fontSize: 14, fontWeight: 600, flex: 1, marginLeft: 10}}>{graph.name}</span>
                    <button className="btn" onClick={onClose} style={{padding: '2px 10px', fontSize: 13}}>
                        <i className="bi bi-x-lg"/>
                    </button>
                </div>

                <div style={{flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16}}>
                    {/* Chain section */}
                    <div style={{
                        background: 'var(--surface-2)',
                        borderRadius: 8,
                        padding: 14,
                        border: '1px solid var(--border-2)',
                    }}>
                        <div style={{fontSize: 13, fontWeight: 600, marginBottom: 8}}>
                            <i className="bi bi-link-45deg" style={{marginRight: 4}}/>拓扑链路
                        </div>
                        <div style={{
                            overflowX: 'auto',
                            paddingBottom: 4,
                        }}>
                        <div style={{display: 'flex', alignItems: 'stretch', gap: 0, fontSize: 13, width: 'fit-content'}}>
                            {nodes.filter(n => n.model_id).map((n, i) => {
                                const prevNode = i > 0 ? nodes[i - 1] : null;
                                return (
                                <div key={i} style={{display: 'flex', alignItems: 'center'}}>
                                    {i > 0 && prevNode?.relation_field && (
                                        <div style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                                            padding: '0 6px', color: 'var(--accent)', fontSize: 11, gap: 2,
                                        }}>
                                            <i className="bi bi-arrow-right" style={{fontSize: 16}}/>
                                            <span style={{whiteSpace: 'nowrap', color: 'var(--text-3)'}}>
                                                {prevNode.relation_field}
                                                {prevNode.relation_target_field && (
                                                    <> → {prevNode.relation_target_field}</>
                                                )}
                                            </span>
                                        </div>
                                    )}
                                    <div style={{
                                        background: 'var(--surface-3)',
                                        border: '1px solid var(--border-2)',
                                        borderRadius: 8,
                                        padding: '10px 14px',
                                        minWidth: 140,
                                    }}>
                                        <div style={{display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6}}>
                                            <span style={{
                                                background: 'var(--accent)', color: '#fff',
                                                width: 18, height: 18, borderRadius: '50%',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 9, fontWeight: 600, flexShrink: 0,
                                            }}>{i + 1}</span>
                                            <strong style={{fontSize: 13}}>{n.model_name || n.model_id}</strong>
                                        </div>
                                        <div style={{display: 'flex', flexWrap: 'wrap', gap: 3, paddingLeft: 24}}>
                                            {n.relation_field && (
                                                <span style={{
                                                    fontSize: 10,
                                                    padding: '1px 5px',
                                                    borderRadius: 3,
                                                    background: 'rgba(99,102,241,0.15)',
                                                    border: '1px solid rgba(99,102,241,0.4)',
                                                    color: 'var(--accent)',
                                                    fontWeight: 600,
                                                    title: `关联源字段 → ${n.relation_target_field || '?'}`,
                                                }}>
                                                    {n.relation_field}
                                                </span>
                                            )}
                                            {prevNode?.relation_target_field && (
                                                <span style={{
                                                    fontSize: 10,
                                                    padding: '1px 5px',
                                                    borderRadius: 3,
                                                    background: 'rgba(16,185,129,0.15)',
                                                    border: '1px solid rgba(16,185,129,0.4)',
                                                    color: '#10b981',
                                                    fontWeight: 600,
                                                    title: `${prevNode?.relation_field || '?'} → 目标字段`,
                                                }}>
                                                    {prevNode.relation_target_field}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '10px 14px',
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 8,
                            color: '#ef4444',
                            fontSize: 13,
                        }}>{error}</div>
                    )}

                    {/* Results section */}
                    {result && (
                        <div style={{
                            flex: 1,
                            overflow: 'auto',
                            border: '1px solid var(--border-2)',
                            borderRadius: 8,
                        }}>
                            <div style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border-2)',
                                fontSize: 13,
                                fontWeight: 600,
                                background: 'var(--surface-2)',
                                display: 'flex', justifyContent: 'space-between',
                            }}>
                                <span><i className="bi bi-table" style={{marginRight: 4}}/>查询结果</span>
                                <span>
                                    <button className="btn btn-sm" onClick={exportToExcel}
                                            style={{marginRight: 10, fontSize: 12, background: '#fff'}}>
                                        <i className="bi bi-filetype-xlsx" style={{marginRight: -4}}/>导出Excel
                                    </button>
                                    <span style={{fontWeight: 400, color: 'var(--text-3)'}}>
                                        共 {result.total || 0} 条
                                        {result.layers && ` | ${result.layers.length} 层`}
                                    </span>
                                </span>
                            </div>
                            {result.merged && result.merged.length > 0 ? (
                                <div style={{overflow: 'auto', maxHeight: 'calc(100% - 42px)'}}>
                                    <table style={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        fontSize: 12,
                                    }}>
                                        <thead>
                                        <tr style={{background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 1}}>
                                            <th style={{
                                                padding: '8px 10px',
                                                textAlign: 'left',
                                                borderBottom: '1px solid var(--border-2)',
                                                fontWeight: 600,
                                                whiteSpace: 'nowrap',
                                            }}>#</th>
                                            {colKeys.map(key => (
                                                <th key={key} style={{
                                                    padding: '8px 10px',
                                                    textAlign: 'left',
                                                    borderBottom: '1px solid var(--border-2)',
                                                    fontWeight: 600,
                                                    whiteSpace: 'nowrap',
                                                }}>{key}</th>
                                            ))}
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {result.merged.slice(0, 200).map((item, ri) => (
                                            <tr key={ri}
                                                style={{background: ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'}}>
                                                <td style={{
                                                    padding: '6px 10px',
                                                    borderBottom: '1px solid var(--border-2)',
                                                    color: 'var(--text-3)',
                                                    fontSize: 11,
                                                }}>{ri + 1}</td>
                                                {colKeys.map(key => (
                                                    <td key={key} style={{
                                                        padding: '6px 10px',
                                                        borderBottom: '1px solid var(--border-2)',
                                                        maxWidth: 200,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {formatCellValue(item.flat ? item.flat[key] : undefined)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                    {result.merged.length > 200 && (
                                        <div style={{
                                            padding: '8px 14px',
                                            fontSize: 11,
                                            color: 'var(--text-3)',
                                            textAlign: 'center',
                                            borderTop: '1px solid var(--border-2)',
                                        }}>
                                            仅显示前 200 条，共 {result.merged.length} 条
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{
                                    padding: 30,
                                    textAlign: 'center',
                                    color: 'var(--text-3)',
                                    fontSize: 13,
                                }}>
                                    <i className="bi bi-inbox" style={{fontSize: 24, display: 'block', marginBottom: 8}}/>
                                    未找到匹配数据
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatCellValue(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

export default function AIGraph() {
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const navigate = useNavigate();
    const {graphId} = useParams();
    const location = useLocation();
    const isNew = location.pathname.endsWith('/new');
    const editing = graphId || (isNew ? 'new' : null);
    const loadedRef = useRef(false);

    const [graphs, setGraphs] = useState([]);
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [showChat, setShowChat] = useState(false);
    const [form, setForm] = useState({
        name: '',
        description: '',
        nodes: [createEmptyNode()],
    });

    const fetchGraphs = useCallback(async () => {
        try {
            setErrorMessage('');
            const result = await api.listAIGraphs();
            setGraphs(result);
        } catch (err) {
            console.error('获取拓扑失败:', err);
            setErrorMessage(err.message || '获取拓扑失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const cmdbBase = getCmdbApiBase();
                const token = getStoredAuthToken();
                const headers = token ? {Authorization: `Bearer ${token}`} : {};
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=ai-graph&resource_id=*&permission=ai-graph:read`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看模型拓扑');
                        setLoading(false);
                        return;
                    }
                }
            } catch (_) {}
            fetchGraphs();
        })();
    }, [fetchGraphs]);

    const fetchModels = useCallback(async () => {
        try {
            const result = await api.listModels({per_page: 10000});
            setModels(result);
        } catch (err) {
            console.error('获取模型列表失败:', err);
        }
    }, []);

    const modelOptions = useMemo(() => {
        return models.map(m => ({
            value: m.id,
            label: `${m.name} (${m.model_id || m.id})`,
            model: m,
        }));
    }, [models]);

    const getModelFields = useCallback((modelId) => {
        const model = models.find(m => m.id === modelId);
        if (!model || !model.fields) return [];
        return model.fields;
    }, [models]);

    const getAllFields = useCallback((modelId) => {
        const fields = getModelFields(modelId);
        return fields.filter(f => !['status', 'createTime', 'creator'].includes(String(f.name || '').trim()));
    }, [getModelFields]);

    useEffect(() => {
        if (editing && !loadedRef.current) {
            loadedRef.current = true;
            fetchModels();
            if (editing !== 'new') {
                api.getAIGraph(editing).then(graph => {
                    if (graph) {
                        setForm({
                            name: graph.name || '',
                            description: graph.description || '',
                            nodes: (graph.nodes || []).length > 0
                                ? graph.nodes.map(n => ({...createEmptyNode(), ...n}))
                                : [createEmptyNode()],
                        });
                    }
                }).catch(() => {});
            }
        }
    }, [editing, fetchModels]);

    const resetForm = () => {
        loadedRef.current = false;
        setForm({name: '', description: '', nodes: [createEmptyNode()]});
        setErrorMessage('');
    };

    const openCreate = () => {
        navigate('/platform-config/ai-graph/new');
    };

    const openEdit = (graph) => {
        navigate(`/platform-config/ai-graph/${graph.id}`);
    };

    const [viewGraph, setViewGraph] = useState(null);

    const openView = (graph) => {
        setViewGraph(graph);
    };

    const updateNode = (index, updater) => {
        setForm(prev => {
            const nodes = [...prev.nodes];
            nodes[index] = typeof updater === 'function' ? updater(nodes[index]) : {...nodes[index], ...updater};
            return {...prev, nodes};
        });
    };

    const handleModelChange = (nodeIndex, modelId) => {
        const model = models.find(m => m.id === modelId);
        updateNode(nodeIndex, {
            model_id: modelId,
            model_name: model ? model.name : '',
            relation_field: '',
            relation_field_name: '',
            relation_type: '',
        });
        clearSubsequentNodes(nodeIndex);
    };

    const clearSubsequentNodes = (fromIndex) => {
        setForm(prev => {
            if (fromIndex >= prev.nodes.length - 1) return prev;
            return {...prev, nodes: prev.nodes.slice(0, fromIndex + 1)};
        });
    };

    const handleRelationChange = (nodeIndex, fieldName) => {
        const node = form.nodes[nodeIndex];
        const fields = getAllFields(node.model_id);
        const field = fields.find(f => f.name === fieldName);

        if (field) {
            const targetModelId = field.relation?.model_id || '';
            const targetModel = models.find(m => m.id === targetModelId);

            updateNode(nodeIndex, {
                relation_field: field.name,
                relation_field_name: field.label || field.name,
                relation_type: field.relation?.relation_type || '',
                relation_target_field: '',
            });

            if (targetModelId) {
                setForm(prev => {
                    const nodes = [...prev.nodes];
                    const nextIndex = nodeIndex + 1;
                    const nextNode = nextIndex < nodes.length ? nodes[nextIndex] : null;

                    if (nextNode && nextNode.model_id === targetModelId) {
                        return prev;
                    }

                    const newNode = {
                        model_id: targetModelId,
                        model_name: targetModel ? targetModel.name : '',
                        relation_field: '',
                        relation_field_name: '',
                        relation_type: '',
                    };

                    if (nextIndex < nodes.length) {
                        const updated = [...nodes.slice(0, nextIndex), newNode, ...nodes.slice(nextIndex + 1)];
                        return {...prev, nodes: updated};
                    }
                    return {...prev, nodes: [...nodes, newNode]};
                });
            } else {
                clearSubsequentNodes(nodeIndex);
            }
        } else {
            updateNode(nodeIndex, {relation_field: '', relation_field_name: '', relation_type: '', relation_target_field: ''});
            clearSubsequentNodes(nodeIndex);
        }
    };

    const handleTargetFieldChange = (nodeIndex, fieldName) => {
        updateNode(nodeIndex, {relation_target_field: fieldName});
    };

    const addNode = () => {
        setForm(prev => ({...prev, nodes: [...prev.nodes, createEmptyNode()]}));
    };

    const removeNode = (index) => {
        if (form.nodes.length <= 1) return;
        setForm(prev => {
            const nodes = prev.nodes.filter((_, i) => i !== index);
            return {...prev, nodes: nodes.length === 0 ? [createEmptyNode()] : nodes};
        });
    };

    const handleSubmit = async () => {
        if (!form.name.trim()) {
            setErrorMessage('拓扑名称不能为空');
            return;
        }

        const validNodes = form.nodes.filter(n => n.model_id);
        if (validNodes.length === 0) {
            setErrorMessage('至少需要一个模型节点');
            return;
        }

        const payload = {
            name: form.name.trim(),
            description: form.description.trim(),
            nodes: validNodes,
        };

        setSubmitting(true);
        setErrorMessage('');

        try {
            if (editing && editing !== 'new') {
                await api.updateAIGraph(editing, payload);
            } else {
                await api.createAIGraph(payload);
            }
            resetForm();
            navigate('/platform-config/ai-graph', {replace: true});
            await fetchGraphs();
        } catch (err) {
            console.error('保存拓扑失败:', err);
            setErrorMessage(err.message || '保存拓扑失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (graph) => {
        if (!window.confirm(`确定删除拓扑「${graph.name}」吗？`)) return;
        const wasEditing = editing === graph.id;
        try {
            setErrorMessage('');
            await api.deleteAIGraph(graph.id);
            if (wasEditing) {
                resetForm();
                navigate('/platform-config/ai-graph', {replace: true});
            }
            await fetchGraphs();
        } catch (err) {
            console.error('删除拓扑失败:', err);
            setErrorMessage(err.message || '删除拓扑失败');
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const fieldsForNode = (nodeIndex) => {
        const node = form.nodes[nodeIndex];
        if (!node.model_id) return [];
        return getAllFields(node.model_id);
    };

    const getModelName = (modelId) => {
        const m = models.find(x => x.id === modelId);
        return m ? m.name : modelId;
    };

    const chainPreview = (nodes) => {
        if (!nodes || nodes.length === 0) return '空';
        return nodes
            .filter(n => n.model_name || n.model_id)
            .map((n, i) => {
                const name = n.model_name || n.model_id;
                if (i === 0) return name;
                const prev = nodes[i - 1];
                const rel = prev?.relation_field_name || prev?.relation_field || '';
                return `${rel} → ${name}`;
            })
            .join(' > ');
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="模型拓扑"
                subtitle="管理模型拓扑链路"
                brandIcon="bi bi-diagram-3"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />
            <div className="app-content workflow-list-page task-page model-instance-page">
                <div style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 12,
                    padding: editing ? '12px 24px 20px' : 28,
                }}>
                    {errorMessage && (
                        <div style={{
                            padding: '10px 16px',
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 8,
                            color: '#ef4444',
                            marginBottom: 16,
                            fontSize: 14,
                        }}>{errorMessage}</div>
                    )}

                    {editing ? (
                        <div style={{display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)'}}>
                            <div style={{
                                flexShrink: 0,
                                borderBottom: '1px solid var(--border-2)',
                                paddingBottom: 16,
                                marginBottom: 16,
                            }}>
                                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16}}>
                                    <strong style={{fontSize: 18}}>
                                        <i className="bi bi-diagram-3" style={{marginRight: 6}}/>
                                        {editing === 'new' ? '新建模型拓扑' : '编辑模型拓扑'}
                                    </strong>
                                    <div style={{flex: 1}}/>
                                    <button className="btn" onClick={() => {
                                        resetForm();
                                        navigate('/platform-config/ai-graph');
                                    }} style={{display: 'flex', alignItems: 'center', gap: 4}}>
                                        <i className="bi bi-arrow-left"/> 返回
                                    </button>
                                    <button className="btn btn-default" onClick={handleSubmit} disabled={submitting}>
                                        <i className="bi bi-check-lg"/>
                                        {submitting ? '保存中...' : '保存拓扑'}
                                    </button>
                                </div>

                                <div style={{display: 'flex', gap: 16, flexWrap: 'wrap'}}>
                                    <div className="form-group" style={{flex: 2, minWidth: 250}}>
                                        <label>拓扑名称</label>
                                        <input
                                            autoFocus
                                            value={form.name}
                                            onChange={e => setForm(prev => ({...prev, name: e.target.value}))}
                                            placeholder="例如：订单客户链路"
                                        />
                                    </div>
                                    <div className="form-group" style={{flex: 3, minWidth: 300}}>
                                        <label>描述</label>
                                        <input
                                            value={form.description}
                                            onChange={e => setForm(prev => ({...prev, description: e.target.value}))}
                                            placeholder="描述这个拓扑的用途..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                flex: 1,
                                overflow: 'auto',
                                minHeight: 0,
                            }}>
                                <div style={{
                                    background: 'var(--surface-2)',
                                    borderRadius: 10,
                                    padding: 20,
                                    border: '1px solid var(--border-2)',
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 16,
                                    }}>
                                        <div>
                                            <strong style={{fontSize: 15}}>拓扑链路</strong>
                                            <div style={{fontSize: 12, color: 'var(--text-3)', marginTop: 2}}>
                                                依次选择模型和关联字段，串联多个模型形成查询链路
                                            </div>
                                        </div>
                                        <button className="btn btn-sm" onClick={addNode}
                                                style={{display: 'flex', alignItems: 'center', gap: 4}}>
                                            <i className="bi bi-plus-circle"/> 添加节点
                                        </button>
                                    </div>

                                    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                                        {form.nodes.map((node, index) => {
                                            const isFirst = index === 0;
                                            const allFields = fieldsForNode(index);
                                            const selectedField = node.relation_field
                                                ? allFields.find(f => f.name === node.relation_field)
                                                : null;
                                            const targetModelPreview = selectedField?.relation?.model_id
                                                ? getModelName(selectedField.relation.model_id)
                                                : '';
                                            const modelFields = node.model_id ? getModelFields(node.model_id) : [];

                                            return (
                                                <div key={index}>
                                                    {index > 0 && (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: 8,
                                                            padding: '6px 0',
                                                            color: 'var(--accent)',
                                                            fontSize: 13,
                                                        }}>
                                                            <div style={{
                                                                flex: 1,
                                                                height: 1,
                                                                background: 'var(--border-2)',
                                                            }}/>
                                                            <i className="bi bi-arrow-down"/>
                                                            <span style={{fontWeight: 500}}>
                                                                {form.nodes[index - 1]?.relation_field_name || form.nodes[index - 1]?.relation_field || '关联'}
                                                            </span>
                                                            <div style={{
                                                                flex: 1,
                                                                height: 1,
                                                                background: 'var(--border-2)',
                                                            }}/>
                                                        </div>
                                                    )}

                                                    <div style={{
                                                        background: 'var(--surface-3)',
                                                        border: '1px solid var(--border-2)',
                                                        borderRadius: 8,
                                                        padding: 16,
                                                    }}>
                                                        <div style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            marginBottom: 12,
                                                        }}>
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 8,
                                                            }}>
                                                                <span style={{
                                                                    background: 'var(--accent)',
                                                                    color: '#fff',
                                                                    width: 22,
                                                                    height: 22,
                                                                    borderRadius: '50%',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    fontSize: 11,
                                                                    fontWeight: 600,
                                                                }}>{index + 1}</span>
                                                                <strong style={{fontSize: 14}}>
                                                                    {isFirst ? '起始模型' : `第 ${index + 1} 步`}
                                                                </strong>
                                                            </div>
                                                            {!isFirst && (
                                                                <button className="btn"
                                                                        style={{color: '#ef4444', padding: '2px 8px', fontSize: 12}}
                                                                        onClick={() => removeNode(index)}>
                                                                    <i className="bi bi-trash-fill"/> 移除
                                                                </button>
                                                            )}
                                                        </div>

                                                        <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
                                                            <div className="form-group" style={{flex: 1, minWidth: 200}}>
                                                                <label style={{fontSize: 12, color: 'var(--text-3)'}}>选择模型</label>
                                                                <select
                                                                    value={node.model_id}
                                                                    onChange={e => handleModelChange(index, e.target.value)}
                                                                    style={{
                                                                        padding: '8px 10px',
                                                                        borderRadius: 6,
                                                                        border: '1px solid var(--border-2)',
                                                                        background: 'var(--surface)',
                                                                        color: 'var(--text)',
                                                                        fontSize: 13,
                                                                        width: '100%',
                                                                    }}
                                                                >
                                                                    <option value="">-- 请选择模型 --</option>
                                                                    {modelOptions.map(opt => (
                                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {!isFirst && (
                                                                <div className="form-group" style={{flex: 1, minWidth: 200}}>
                                                                    <label style={{fontSize: 12, color: 'var(--text-3)'}}>关联字段</label>
                                                                    <select
                                                                        value={node.relation_field}
                                                                        onChange={e => handleRelationChange(index, e.target.value)}
                                                                        style={{
                                                                            padding: '8px 10px',
                                                                            borderRadius: 6,
                                                                            border: '1px solid var(--border-2)',
                                                                            background: 'var(--surface)',
                                                                            color: 'var(--text)',
                                                                            fontSize: 13,
                                                                            width: '100%',
                                                                        }}
                                                                    >
                                                                <option value="">-- 终点（无关联）--</option>
                                                                        {allFields.map(f => (
                                                                            <option key={f.name} value={f.name}>
                                                                                {f.label || f.name} [{FIELD_TYPE_LABELS[f.type] || f.type}] (字段名: {f.name})
                                                                                {f.relation?.model_id ? ` → ${getModelName(f.relation.model_id)}` : ''}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            )}

                                                            {isFirst && allFields.length > 0 && (
    <div className="form-group" style={{flex: 1, minWidth: 200}}>
        <label style={{fontSize: 12, color: 'var(--text-3)'}}>关联字段（可选）</label>
        <select
            value={node.relation_field}
            onChange={e => handleRelationChange(index, e.target.value)}
            style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-2)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                width: '100%',
            }}
        >
            <option value="">-- 起点（不关联上游）--</option>
            {allFields.map(f => (
                <option key={f.name} value={f.name}>
                    {f.label || f.name} [{FIELD_TYPE_LABELS[f.type] || f.type}] (字段名: {f.name})
                    {f.relation?.model_id ? ` → ${getModelName(f.relation.model_id)}` : ''}
                </option>
            ))}
        </select>
    </div>
)}

{node.relation_field && index < form.nodes.length - 1 && form.nodes[index + 1]?.model_id && (
    <div className="form-group" style={{flex: 1, minWidth: 200}}>
        <label style={{fontSize: 12, color: 'var(--text-3)'}}>目标关联字段</label>
        <select
            value={node.relation_target_field || ''}
            onChange={e => handleTargetFieldChange(index, e.target.value)}
            style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-2)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                width: '100%',
            }}
        >
            <option value="">-- 按实例 ID 关联 --</option>
            {(() => {
                const nextNode = form.nodes[index + 1];
                if (!nextNode) return [];
                const targetFields = getAllFields(nextNode.model_id);
                    return targetFields.map(f => (
                        <option key={f.name} value={f.name}>
                            {f.label || f.name} [{FIELD_TYPE_LABELS[f.type] || f.type}] (字段名: {f.name})
                        </option>
                    ));
            })()}
        </select>
    </div>
)}
                                                        </div>

                                                        {modelFields.length > 0 && (
                                                            <div style={{
                                                                marginTop: 12,
                                                                borderTop: '1px solid var(--border-2)',
                                                                paddingTop: 10,
                                                            }}>
                                                                <div style={{
                                                                    fontSize: 12,
                                                                    color: 'var(--text-3)',
                                                                    marginBottom: 6,
                                                                }}>
                                                                    模型字段列表（{modelFields.length} 个字段）
                                                                </div>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    flexWrap: 'wrap',
                                                                    gap: 4,
                                                                }}>
                                                                    {modelFields.map(field => {
                                                                        const isRel = field.type === 'relation' && !field.relation?.auto_generated;
                                                                        const isSys = ['status', 'createTime', 'creator'].includes(String(field.name || '').trim());
                                                                        return (
                                                                            <span
                                                                                key={field.id || field.name}
                                                                                style={{
                                                                                    display: 'inline-flex',
                                                                                    alignItems: 'center',
                                                                                    gap: 4,
                                                                                    padding: '3px 8px',
                                                                                    borderRadius: 4,
                                                                                    fontSize: 11,
                                                                                    background: isRel ? 'rgba(99,102,241,0.12)' : isSys ? 'var(--surface-2)' : 'var(--surface)',
                                                                                    border: '1px solid',
                                                                                    borderColor: isRel ? 'rgba(99,102,241,0.3)' : 'var(--border-2)',
                                                                                    color: isRel ? 'var(--accent)' : 'var(--text-2)',
                                                                                }}
                                                                                title={`${field.label || field.name} (${FIELD_TYPE_LABELS[field.type] || field.type})${isRel ? ` → ${getModelName(field.relation?.model_id)}` : ''}`}
                                                                            >
                                                                                <span>{field.label || field.name}</span>
                                                                                <span style={{
                                                                                    fontSize: 10,
                                                                                    opacity: 0.7,
                                                                                }}>
                                                                                    {FIELD_TYPE_LABELS[field.type] || field.type}
                                                                                </span>
                                                                                {isRel && (
                                                                                    <span style={{fontSize: 10}}>→</span>
                                                                                )}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {form.nodes.filter(n => n.model_id).length >= 2 && (
                                        <div style={{
                                            marginTop: 16,
                                            padding: 12,
                                            background: 'rgba(99,102,241,0.08)',
                                            border: '1px solid rgba(99,102,241,0.2)',
                                            borderRadius: 8,
                                            fontSize: 13,
                                            color: 'var(--text-2)',
                                        }}>
                                            <i className="bi bi-link-45deg" style={{marginRight: 4}}/>
                                            链路预览：{chainPreview(form.nodes)}
                                        </div>
                                    )}
                        </div>
                            </div>

                            {showChat && (
                                <ChatDialog
                                    graphId={editing === 'new' ? '' : editing}
                                    graphName={form.name || '未命名'}
                                    onClose={() => setShowChat(false)}
                                />
                            )}
                        </div>
                    ) : (
                        <div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 20,
                            }}>
                                <div>
                                    <strong style={{fontSize: 18}}><i className="bi bi-diagram-3" style={{marginRight: 6}}/>模型拓扑</strong>
                                    <span style={{marginLeft: 8, fontSize: 13, color: 'var(--text-3)'}}>
                                        通过模型关系字段串联多个模型，构建跨表查询链路
                                    </span>
                                </div>
                                <div style={{display: 'flex', gap: 8}}>
                                    <button className="btn" onClick={() => navigate('/platform-config')}>
                                        <i className="bi bi-arrow-left"/> 返回平台配置
                                    </button>
                                    <button className="btn btn-default" onClick={openCreate}>
                                        <i className="bi bi-plus-circle"/> 新建模型拓扑
                                    </button>
                                </div>
                            </div>

                            {loading ? (
                                <div style={{
                                    padding: 40,
                                    textAlign: 'center',
                                    color: 'var(--text-3)',
                                }}>加载中...</div>
                            ) : graphs.length === 0 ? (
                                <div style={{
                                    padding: 40,
                                    textAlign: 'center',
                                    color: 'var(--text-3)',
                                    background: 'var(--surface-2)',
                                    borderRadius: 10,
                                    border: '1px solid var(--border-2)',
                                }}>
                                    <div style={{fontSize: 48, marginBottom: 12}}>
                                        <i className="bi bi-diagram-3"/>
                                    </div>
                                    <p style={{margin: '0 0 4px', fontSize: 15}}>暂无模型拓扑</p>
                                    <p style={{margin: 0, fontSize: 13}}>点击上方按钮创建第一个拓扑链路</p>
                                </div>
                            ) : (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                                    gap: 16,
                                }}>
                                    {graphs.map(graph => (
                                        <div
                                            key={graph.id}
                                            onClick={() => openEdit(graph)}
                                            style={{
                                                background: 'var(--surface-2)',
                                                border: '1px solid var(--border-2)',
                                                borderRadius: 10,
                                                padding: 20,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                flexDirection: 'column',
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = 'var(--accent)';
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = 'var(--border-2)';
                                                e.currentTarget.style.transform = 'none';
                                            }}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'flex-start',
                                            }}>
                                                <div style={{fontSize: 28, marginBottom: 8}}>
                                                    <i className="bi bi-diagram-3"/>
                                                </div>
                                                <div style={{display: 'flex', gap: 4}}>
                                                    <button
                                                        className="btn"
                                                        style={{color: 'var(--accent)', padding: '2px 8px', fontSize: 12}}
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            openView(graph);
                                                        }}
                                                        title="查看拓扑数据"
                                                    >
                                                        <i className="bi bi-eye"/>
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        style={{color: '#ef4444', padding: '2px 8px', fontSize: 12}}
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            handleDelete(graph);
                                                        }}
                                                    >
                                                        <i className="bi bi-trash-fill"/>
                                                    </button>
                                                </div>
                                            </div>
                                            <h3 style={{margin: '0 0 4px', fontSize: 15}}>{graph.name}</h3>
                                            {graph.description && (
                                                <p style={{
                                                    margin: '0 0 8px',
                                                    fontSize: 13,
                                                    color: 'var(--text-3)',
                                                    lineHeight: 1.4,
                                                }}>{graph.description}</p>
                                            )}
                                            <div style={{
                                                marginTop: 'auto',
                                                paddingTop: 8,
                                                fontSize: 12,
                                                color: 'var(--accent)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                <i className="bi bi-link-45deg"/> {chainPreview(graph.nodes || [])}
                                            </div>
                                            <div style={{
                                                marginTop: 8,
                                                fontSize: 11,
                                                color: 'var(--text-3)',
                                            }}>
                                                节点数：{(graph.nodes || []).filter(n => n.model_id).length} | 更新于：{formatDateTime(graph.updated_at)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {viewGraph && (
                <ViewDialog
                    graph={viewGraph}
                    models={models}
                    onClose={() => setViewGraph(null)}
                />
            )}
        </div>
    );
}
