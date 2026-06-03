import React, {useState, useRef, useCallback, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import {getStoredAuthToken} from '../api';
import {getAssistantApiBase, getCmdbApiBase} from '../config';
import ReactMarkdown from 'react-markdown';

function ThinkingBlock({thought, sql, result, error, streamingThought}) {
    const [expanded, setExpanded] = useState(true);

    useEffect(() => {
        if (!streamingThought) {
            setExpanded(false);
        }
    }, [streamingThought]);

    if (!thought && !sql && !result && !error) return null;

    const hasContent = thought || sql || (result && result.length > 0) || error;

    return (
        <div style={{
            marginTop: 8,
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface)',
        }}>
            <div
                onClick={() => setExpanded(!expanded)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', cursor: 'pointer',
                    userSelect: 'none', fontSize: 13, color: 'var(--text-2)',
                }}
            >
                {streamingThought && (
                    <div style={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: '2px solid var(--border-2)',
                        borderTopColor: '#6366f1',
                        animation: 'aiSpin 0.7s linear infinite',
                        flexShrink: 0,
                    }}/>
                )}
                <span style={{transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', fontSize: 12}}>▶</span>
                <span>思考过程</span>
                {streamingThought && <span style={{fontSize: 11, color: '#6366f1'}}>（思考中）</span>}
                {!expanded && !streamingThought && hasContent && <span style={{fontSize: 11, color: 'var(--text-3)'}}>（点击展开）</span>}
            </div>
            {expanded && (
                <div style={{padding: '0 14px 12px', fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)'}}>
                    {thought && (
                        <div style={{marginBottom: sql || result || error ? 12 : 0}}>
                            <div style={{fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, fontSize: 12}}>推理过程</div>
                            <div style={{whiteSpace: 'pre-wrap'}}>{thought}</div>
                        </div>
                    )}
                    {sql && (
                        <div style={{marginBottom: result || error ? 12 : 0}}>
                            <div style={{fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, fontSize: 12}}>生成的 SQL</div>
                            <pre style={{
                                background: 'var(--surface-2)', padding: 10, borderRadius: 8,
                                overflowX: 'auto', fontSize: 13, color: 'var(--text)',
                                margin: 0,
                            }}>{sql}</pre>
                        </div>
                    )}
                    {error && (
                        <div style={{color: '#ef4444'}}>
                            <div style={{fontWeight: 600, marginBottom: 4, fontSize: 12}}>错误</div>
                            <div>{error}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ResultTable({data}) {
    if (!data || data.length === 0) return <div style={{color: 'var(--text-3)', fontSize: 14, padding: '12px 0'}}>查询结果为空</div>;

    const columns = Object.keys(data[0]);

    return (
        <div style={{overflowX: 'auto', marginTop: 8, borderRadius: 8, border: '1px solid var(--border)'}}>
            <table style={{
                width: 'auto', minWidth: '100%', borderCollapse: 'collapse', fontSize: 13,
                background: 'var(--surface)',
                whiteSpace: 'nowrap',
            }}>
                <thead>
                    <tr style={{background: 'var(--surface-2)'}}>
                        {columns.map(col => (
                            <th key={col} style={{
                                padding: '8px 12px', textAlign: 'left',
                                color: 'var(--text)', fontWeight: 600,
                                borderBottom: '1px solid var(--border)',
                                whiteSpace: 'nowrap',
                            }}>{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr key={i} style={{borderBottom: '1px solid var(--border)'}}>
                            {columns.map(col => (
                                <td key={col} style={{
                                    padding: '6px 12px', color: 'var(--text-2)',
                                }}>
                                    {formatCellValue(row[col])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div style={{padding: '6px 12px', fontSize: 13, color: 'var(--text-3)', borderTop: '1px solid var(--border)'}}>
                共 {data.length} 条记录
        </div>
    </div>
);
}

function formatCellValue(val) {
    if (val === null || val === undefined) return <span style={{color: 'var(--text-3)'}}>—</span>;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function formatMsgTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

let assistantApiBase = '/api/assistant';

export default function ChatHome() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();

    const [sessions, setSessions] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('chatSidebarOpen') !== 'false');
    const chatAreaRef = useRef(null);
    const currentSessionIdRef = useRef(currentSessionId);
    const messagesCacheRef = useRef({});

    useEffect(() => {
        (async () => {
            try {
                const cmdbBase = getCmdbApiBase();
                const token = getStoredAuthToken();
                const headers = token ? {Authorization: `Bearer ${token}`} : {};
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=assistant-chat&resource_id=*&permission=assistant-chat:use`, {headers});
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看智能助手');
                    }
                }
            } catch (_) {}
            loadSessions();
        })();
    }, []);

    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    useEffect(() => {
        assistantApiBase = getAssistantApiBase() || '/api/assistant';
    }, []);

    useEffect(() => {
        localStorage.setItem('chatSidebarOpen', sidebarOpen);
    }, [sidebarOpen]);

    const prevSessionRef = useRef(null);
    useEffect(() => {
        if (currentSessionId) {
            if (prevSessionRef.current && prevSessionRef.current !== currentSessionId) {
                messagesCacheRef.current[prevSessionRef.current] = messages;
            }
            prevSessionRef.current = currentSessionId;
            if (messagesCacheRef.current[currentSessionId]) {
                setMessages(messagesCacheRef.current[currentSessionId]);
            } else {
                loadMessages(currentSessionId);
            }
        } else {
            setMessages([]);
        }
    }, [currentSessionId]);

    const isNearBottom = useCallback(() => {
        const el = chatAreaRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    useEffect(() => {
        setTimeout(() => {
            if (chatAreaRef.current) {
                chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
            }
        }, 50);
    }, [currentSessionId]);

    useEffect(() => {
        if (isNearBottom()) {
            setTimeout(() => {
                if (chatAreaRef.current) {
                    chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [messages, isNearBottom]);

    const getAuthHeaders = () => {
        const token = getStoredAuthToken();
        return token ? {Authorization: `Bearer ${token}`} : {};
    };

    async function loadSessions() {
        try {
            const res = await fetch(`${assistantApiBase}/sessions`, {
                headers: {...getAuthHeaders()},
            });
            if (res.ok) {
                const data = await res.json();
                setSessions(data);
            }
        } catch (err) {
            console.error('load sessions:', err);
        }
    }

    async function loadMessages(sessionId) {
        try {
            const res = await fetch(`${assistantApiBase}/sessions/${sessionId}/messages`, {
                headers: {...getAuthHeaders()},
            });
            if (res.ok) {
                const data = await res.json();
                const parsed = data.map(msg => {
                    if (msg.result && typeof msg.result === 'string') {
                        try { msg.result = JSON.parse(msg.result); } catch { /* keep as string */ }
                    }
                    return msg;
                });
                if (!messagesCacheRef.current[sessionId]) {
                    messagesCacheRef.current[sessionId] = parsed;
                    setMessages(parsed);
                }
            }
        } catch (err) {
            console.error('load messages:', err);
        }
    }

    async function createNewSession() {
        try {
            const res = await fetch(`${assistantApiBase}/sessions`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...getAuthHeaders()},
                body: JSON.stringify({title: '新对话'}),
            });
            if (res.ok) {
                const session = await res.json();
                setSessions(prev => [session, ...prev]);
                setCurrentSessionId(session.id);
                setMessages([]);
            }
        } catch (err) {
            console.error('create session:', err);
        }
    }

    async function deleteSession(sessionId) {
        const session = sessions.find(s => s.id === sessionId);
        if (!confirm(`确定要删除对话「${session?.title || '未命名'}」吗？`)) return;
        try {
            await fetch(`${assistantApiBase}/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: {...getAuthHeaders()},
            });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            if (currentSessionId === sessionId) {
                const remaining = sessions.filter(s => s.id !== sessionId);
                if (remaining.length > 0) {
                    setCurrentSessionId(remaining[0].id);
                } else {
                    setCurrentSessionId(null);
                    setMessages([]);
                }
            }
        } catch (err) {
            console.error('delete session:', err);
        }
    }

    const sendMessage = useCallback(async () => {
        const text = input.trim();
        if (!text || loading) return;

        let sessionId = currentSessionId;
        if (!sessionId) {
            try {
                const res = await fetch(`${assistantApiBase}/sessions`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', ...getAuthHeaders()},
                    body: JSON.stringify({title: text}),
                });
                if (res.ok) {
                    const session = await res.json();
                    setSessions(prev => [session, ...prev]);
                    sessionId = session.id;
                    setCurrentSessionId(sessionId);
                } else {
                    return;
                }
            } catch (err) {
                console.error('create session:', err);
                return;
            }
        }

        const now = new Date().toISOString();
        const userMsg = {id: 'user-' + Date.now(), role: 'user', content: text, created_at: now};
        const assistantMsg = {
            id: 'assistant-' + Date.now(),
            role: 'assistant',
            content: '',
            thought: '',
            sql_query: '',
            result: '',
            _streamingThought: true,
            created_at: now,
        };
        setMessages(prev => {
            const next = [...prev, userMsg, assistantMsg];
            messagesCacheRef.current[sessionId] = next;
            return next;
        });
        setInput('');
        setLoading(true);

        const patch = (patchOrFn) => {
            const cached = [...(messagesCacheRef.current[sessionId] || [])];
            const idx = cached.findIndex(m => m.id === assistantMsg.id);
            if (idx === -1) return;
            const patchObj = typeof patchOrFn === 'function' ? patchOrFn(cached[idx]) : patchOrFn;
            cached[idx] = {...cached[idx], ...patchObj};
            messagesCacheRef.current[sessionId] = cached;
            if (currentSessionIdRef.current === sessionId) {
                setMessages(cached);
            }
        };

        try {
            const res = await fetch(`${assistantApiBase}/query`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...getAuthHeaders()},
                body: JSON.stringify({session_id: sessionId, query: text}),
            });

            if (!res.ok) {
                patch({content: '请求失败', thought: 'error'});
                setLoading(false);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let currentEvent = '';
                let prevDataLine = false;
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                        prevDataLine = false;
                    } else if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        const sep = prevDataLine ? '\n' : '';
                        prevDataLine = true;

                        if (currentEvent === 'thought' || currentEvent === 'thought_chunk') {
                            patch(m => ({thought: (m.thought || '') + sep + data, _streamingThought: true}));
                        } else if (currentEvent === 'sql') {
                            patch(m => ({sql_query: (m.sql_query || '') + sep + data}));
                        } else if (currentEvent === 'result') {
                            try {
                                patch({result: JSON.parse(data), _streamingThought: false, _summarizing: true});
                            } catch {
                                patch({result: data, _streamingThought: false, _summarizing: true});
                            }
                        } else if (currentEvent === 'error') {
                            patch({content: '查询失败', thought: sep + data, _streamingThought: false});
                        } else if (currentEvent === 'content') {
                            patch(m => ({content: (m.content || '') + sep + data, _summarizing: false}));
                        } else if (currentEvent === 'done') {
                            patch(m => ({_streamingThought: false, content: m.content || '查询完成'}));
                            loadSessions();
                        }
                        if (isNearBottom()) {
                            setTimeout(() => {
                                if (chatAreaRef.current) {
                                    chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
                                }
                            }, 50);
                        }
                    } else {
                        prevDataLine = false;
                    }
                }
            }
        } catch (err) {
            patch({content: '请求失败: ' + err.message, thought: 'error'});
        }

        setLoading(false);
        if (isNearBottom()) {
            setTimeout(() => {
                if (chatAreaRef.current) {
                    chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [input, loading, currentSessionId, isNearBottom]);

    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        },
        [sendMessage],
    );

    const handleLogout = useCallback(() => {
        logout();
        navigate('/login');
    }, [logout, navigate]);

    const activeTitle = currentSessionId
        ? (sessions.find(s => s.id === currentSessionId)?.title || '对话')
        : '灵犀助手';

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="首页"
                subtitle="数据查询助手"
                brandIcon="bi bi-chat-dots"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content" style={{padding: '46px 0 0 0', display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden'}}>
                <div style={{
                    display: 'flex',
                    flex: 1,
                    minHeight: 0,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                }}>
                    {sidebarOpen && (
                        <aside style={{
                            width: 280,
                            minWidth: 280,
                            background: 'var(--surface)',
                            borderRight: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                        }}>
                            <div style={{padding: '16px 16px 12px', borderBottom: '1px solid var(--border)'}}>
                                <button
                                    onClick={createNewSession}
                                    style={{
                                        width: '100%', padding: '10px 16px',
                                        background: 'transparent',
                                        border: '1.5px dashed var(--border-2)',
                                        borderRadius: 8,
                                        color: 'var(--text-2)',
                                        justifyContent: 'center',
                                        fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 8,
                                    }}
                                >
                                    <span style={{fontSize: 18, fontWeight: 300}}>+</span>
                                    开启新对话
                                </button>
                            </div>

                            <div style={{padding: '12px 16px 6px', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)'}}>
                                对话历史
                            </div>

                            <div style={{flex: 1, overflowY: 'auto', padding: '0 8px'}}>
                                {sessions.length === 0 && (
                                    <div style={{padding: '20px 16px', fontSize: 13, color: 'var(--text-3)', textAlign: 'center'}}>
                                        暂无对话记录
                                    </div>
                                )}
                                {sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        onClick={() => setCurrentSessionId(session.id)}
                                        style={{
                                            padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                                            marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8,
                                            background: session.id === currentSessionId ? 'rgba(99, 102, 241, 0.14)' : 'transparent',
                                            borderLeft: session.id === currentSessionId ? '3px solid #6366f1' : '3px solid transparent',
                                            position: 'relative',
                                        }}
                                    >
                                        <div style={{flex: 1, minWidth: 0}}>
                                            <div style={{
                                                fontSize: 13, fontWeight: 400,
                                                color: session.id === currentSessionId ? 'var(--text)' : 'var(--text-2)',
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>
                                                {session.title}
                                            </div>
                                            <div style={{
                                                fontSize: 11, color: 'var(--text-3)', marginTop: 2,
                                            }}>
                                                {(session.updated_at || session.created_at) ? new Date(session.updated_at || session.created_at).toLocaleDateString('zh-CN') : ''}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--text-3)', fontSize: 16, padding: '2px 4px',
                                                lineHeight: 1, transition: 'color 0.15s',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
                                            title="删除"
                                        ><i className="bi bi-trash-fill"/></button>
                                    </div>
                                ))}
                            </div>
                        </aside>
                    )}

                    <main style={{flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0}}>
                        <header style={{
                            height: 56, minHeight: 56, display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', padding: '0 20px',
                            borderBottom: '1px solid var(--border)',
                            background: 'var(--surface)',
                        }}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                                <button
                                    onClick={() => setSidebarOpen(o => !o)}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--text-2)', fontSize: 18, padding: 4,
                                        display: 'flex', alignItems: 'center',
                                    }}
                                    title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        {sidebarOpen
                                            ? <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></>
                                            : <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></>
                                        }
                                    </svg>
                                </button>
                                {!sidebarOpen && (
                                    <button
                                        onClick={createNewSession}
                                        style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            color: 'var(--text-2)', fontSize: 18, padding: 4,
                                            display: 'flex', alignItems: 'center',
                                        }}
                                        title="新建对话"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                            <line x1="12" y1="5" x2="12" y2="19"/>
                                            <line x1="5" y1="12" x2="19" y2="12"/>
                                        </svg>
                                    </button>
                                )}
                                <span style={{fontWeight: 600, fontSize: 15, color: 'var(--text)'}}>
                                    {activeTitle}
                                </span>
                            </div>
                        </header>

                        <div ref={chatAreaRef} style={{flex: 1, overflowY: 'auto', padding: '20px 0'}}>
                            <div style={{maxWidth: 800, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20}}>
                                {messages.length > 0 ? (
                                    messages.map((msg) => (
                                        <div key={msg.id}>
                                            {msg.role === 'user' ? (
                                                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4}}>
                                                    <div style={{
                                                        maxWidth: '70%',
                                                        background: 'var(--surface-2)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: '14px 14px 4px 14px',
                                                        padding: '10px 16px',
                                                        fontSize: 13,

                                                        lineHeight: 1.6,
                                                        color: 'var(--text)',
                                                    }}>{msg.content}</div>
                                                    <span style={{fontSize: 11, color: 'var(--text-3)'}}>{formatMsgTime(msg.created_at)}</span>
                                                </div>
                                            ) : (
                                                <div style={{display: 'flex', gap: 12}}>
                                                    <div style={{
                                                        width: 30, height: 30, borderRadius: 8,
                                                        flexShrink: 0,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 13, fontWeight: 600,
                                                        background: 'rgba(99, 102, 241, 0.14)',
                                                    }}>🦏</div>
                                                    <div style={{flex: 1, minWidth: 0}}>
                                                        {msg.thought && (
                                                            <ThinkingBlock
                                                                thought={msg.thought}
                                                                sql={msg.sql_query}
                                                                result={msg.result}
                                                                error={msg.content === '查询失败' ? msg.thought : null}
                                                                streamingThought={msg._streamingThought}
                                                            />
                                                        )}
                                                        {!msg.thought && msg._streamingThought && (
                                                            <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0'}}>
                                                                <div style={{display: 'flex', gap: 4}}>
                                                                    <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)', animation: 'typingBounce 1.4s infinite'}}/>
                                                                    <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)', animation: 'typingBounce 1.4s infinite', animationDelay: '0.2s'}}/>
                                                                    <div style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)', animation: 'typingBounce 1.4s infinite', animationDelay: '0.4s'}}/>
                                                                </div>
                                                                <span style={{fontSize: 13}}>思考中</span>
                                                            </div>
                                                        )}
                                                        {msg.result && Array.isArray(msg.result) && (
                                                            <ResultTable data={msg.result}/>
                                                        )}
                                                        {msg._summarizing && (
                                                            <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0', fontSize: 13, color: 'var(--text-3)'}}>
                                                                <div style={{width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-2)', borderTopColor: '#6366f1', animation: 'aiSpin 0.7s linear infinite'}}/>
                                                                正在生成总结...
                                                            </div>
                                                        )}
                                                        {msg.content && msg.content !== '查询完成' && (
                                                            <div className="assistant-content">
                                                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                                                            </div>
                                                        )}
                                                        {!msg.result && !msg.thought && !msg._streamingThought && (!msg.content || msg.content === '查询完成') && (
                                                            <div style={{fontSize: 13, lineHeight: 1.7, color: 'var(--text-2)', padding: '4px 0'}}>{msg.content || ''}</div>
                                                        )}
                                                        <span style={{fontSize: 11, color: 'var(--text-3)', display: 'block', marginTop: 4}}>{formatMsgTime(msg.created_at)}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div style={{textAlign: 'center', padding: '80px 0 40px'}}>
                                        <div style={{
                                            width: 56, height: 56,
                                            background: 'rgba(99, 102, 241, 0.14)',
                                            borderRadius: 16, margin: '0 auto 24px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontWeight: 700, fontSize: 22, color: '#fff',
                                            boxShadow: '0 8px 32px rgba(99, 102, 241, 0.3)',
                                        }}>🦏
                                        </div>
                                        <h1 style={{fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text)'}}>
                                            CMDB数据查询助手
                                        </h1>
                                        <p style={{color: 'var(--text-3)', fontSize: 14, maxWidth: 480, margin: '0 auto', lineHeight: 1.7}}>
                                            输入自然语言查询平台上的数据信息<br/>
                                            例如：查询所有模型 或 显示云主机数据
                                        </p>
                                    </div>
                                )}

                            </div>
                        </div>

                        <div style={{padding: '12px 24px 20px', background: 'linear-gradient(to top, var(--bg) 60%, transparent)'}}>
                            <div style={{maxWidth: 800, margin: '0 auto'}}>
                                <div style={{
                                    display: 'flex', alignItems: 'flex-end',
                                    background: 'var(--surface)',
                                    border: '1.5px solid var(--border)',
                                    borderRadius: 16, padding: 6,
                                }}>
                                    <textarea
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={3}
                                        placeholder="输入问题，例如：查询所有模型数据..."
                                        style={{
                                            flex: 1, background: 'transparent', border: 'none', outline: 'none',
                                            color: 'var(--text)',
                                            fontSize: 14.5, lineHeight: 1.6, padding: '10px 14px',
                                            resize: 'none', fontFamily: 'inherit',
                                        }}
                                    />
                                    <button
                                        onClick={sendMessage}
                                        disabled={loading || !input.trim()}
                                        style={{
                                            width: 36, height: 36, borderRadius: 10,
                                            background: !loading && input.trim() ? '#6366f1' : 'var(--surface-2)',
                                            border: 'none', color: !loading && input.trim() ? '#fff' : 'var(--text-3)',
                                            cursor: !loading && input.trim() ? 'pointer' : 'not-allowed',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 16, fontWeight: 600, flexShrink: 0,
                                        }}
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                            <line x1="22" y1="2" x2="11" y2="13"/>
                                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                        </svg>
                                    </button>
                                </div>
                                <div style={{textAlign: 'center', marginTop: 8, fontSize: 11.5, color: 'var(--text-3)'}}>
                                    按 Enter 发送 · Shift + Enter 换行
                                </div>
                            </div>
                        </div>
                    </main>
                    </div>

            </div>
        </div>
    );
}
