import React, {useState, useRef, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';

export default function SkillDevelopmentPage() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [matchedSkills, setMatchedSkills] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [isHistoryView, setIsHistoryView] = useState(false); // 是否是查看历史对话
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const messagesEndRef = useRef(null);

    // 自动滚动到最新消息
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const getAuthHeaders = () => {
        const token = getStoredAuthToken();
        return token ? {'Authorization': `Bearer ${token}`} : {};
    };

    // 加载对话历史列表
    const fetchSessions = async () => {
        try {
            setLoadingSessions(true);
            // 添加user_id参数过滤当前用户的对话
            const url = user?.id
                ? `${cmdbBase}/api/skill-dev/sessions?user_id=${user.id}`
                : `${cmdbBase}/api/skill-dev/sessions`;
            const response = await fetch(url, {headers: getAuthHeaders()});
            if (response.ok) {
                const data = await response.json();
                setSessions(data.items || data);
            } else if (response.status === 403) {
                const err = await response.json().catch(() => ({error: '无权限使用对话运维'}));
                alert(`⚠️ 权限不足: ${err.error || '无权限使用对话运维'}`);
            }
        } catch (err) {
            console.error('获取对话列表失败:', err);
        } finally {
            setLoadingSessions(false);
        }
    };

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    useEffect(() => {
        if (!apiBase || !cmdbBase) return;
        fetchSessions();
        handleNewChat();
    }, [apiBase, cmdbBase]);

    // 创建新对话
    const handleNewChat = () => {
        setSessionId(null);
        setIsHistoryView(false);
        setMessages([
            {
                role: 'assistant',
                content: '你好！我是灵犀。请描述你的需求，我会自动匹配技能管理中的相关技能来帮助你完成任务。',
                timestamp: new Date().toISOString()
            }
        ]);
        setMatchedSkills([]);
    };

    // 加载指定对话
    const handleLoadSession = async (sessId) => {
        try {
            setLoading(true);
            const url = user?.id
                ? `${cmdbBase}/api/skill-dev/sessions/${sessId}?user_id=${user.id}`
                : `${cmdbBase}/api/skill-dev/sessions/${sessId}`;
            const response = await fetch(url, {headers: getAuthHeaders()});
            if (response.ok) {
                const data = await response.json();
                setSessionId(sessId);
                setIsHistoryView(true); // 设置为历史查看模式
                setMessages(data.messages.map(msg => ({
                    ...msg,
                    content: msg.content.startsWith('[Paste') ? msg.content.replace(/^\[Pasted?[^\]]*\]?\s*/, '').trim() : msg.content,
                    matched_skills: typeof msg.matched_skills === 'string' ? JSON.parse(msg.matched_skills) : (msg.matched_skills || []),
                    reasoning_steps: typeof msg.reasoning_steps === 'string' ? JSON.parse(msg.reasoning_steps) : (msg.reasoning_steps || [])
                })));
            }
        } catch (err) {
            console.error('加载对话失败:', err);
        } finally {
            setLoading(false);
        }
    };

    // 删除对话
    const handleDeleteSession = async (sessId, e) => {
        e.stopPropagation();
        if (!confirm('确定要删除这个对话吗？')) {
            return;
        }

        try {
            const url = user?.id
                ? `${cmdbBase}/api/skill-dev/sessions/${sessId}?user_id=${user.id}`
                : `${cmdbBase}/api/skill-dev/sessions/${sessId}`;
            const response = await fetch(url, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            });

            if (response.ok) {
                // 如果删除的是当前对话，创建新对话
                if (sessId === sessionId) {
                    handleNewChat();
                }
                // 刷新对话列表
                fetchSessions();
            }
        } catch (err) {
            console.error('删除对话失败:', err);
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim() || loading) return;

        const cleanedInput = inputValue.startsWith('[Paste') ? inputValue.replace(/^\[Pasted?[^\]]*\]?\s*/, '').trim() : inputValue;
        const userMessage = {
            role: 'user',
            content: cleanedInput,
            timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, userMessage]);
        const currentInput = cleanedInput;
        setInputValue('');
        setLoading(true);

        // 创建助手消息占位符
        const assistantMessageIndex = messages.length + 1;
        const assistantMessage = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            matched_skills: [],
            reasoning_steps: [],
            conversation_status: null,
            isStreaming: true
        };
        setMessages(prev => [...prev, assistantMessage]);

        try {
            const response = await fetch(`${apiBase}/api/skill-development/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({
                    message: currentInput,
                    session_id: sessionId,
                    user_id: user?.id  // 添加用户ID
                }),
            });

            if (!response.ok) {
                const errMsg = response.status === 403
                    ? ((await response.json().catch(() => ({}))).error || '无权限使用对话运维')
                    : '发送消息失败';
                if (response.status === 403) {
                    alert(`⚠️ 权限不足: ${errMsg}`);
                }
                throw new Error(errMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === 'session') {
                                // 更新会话ID
                                if (!sessionId) {
                                    setSessionId(data.session_id);
                                }
                                setIsHistoryView(false);
                            } else if (data.type === 'step') {
                                // 更新推理步骤
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const msg = newMessages[assistantMessageIndex];
                                    if (msg) {
                                        const steps = [...(msg.reasoning_steps || [])];
                                        const existingIndex = steps.findIndex(s => s.step === data.step);
                                        if (existingIndex >= 0) {
                                            steps[existingIndex] = data;
                                        } else {
                                            steps.push(data);
                                        }
                                        msg.reasoning_steps = steps;
                                    }
                                    return newMessages;
                                });
                            } else if (data.type === 'message') {
                                // 更新最终消息内容
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const msg = newMessages[assistantMessageIndex];
                                    if (msg) {
                                        msg.content = data.content;
                                        msg.matched_skills = data.matched_skills;
                                        msg.conversation_status = data.conversation_status;
                                        msg.isStreaming = false;
                                    }
                                    return newMessages;
                                });
                                setMatchedSkills(data.matched_skills || []);
                                // 记录 token 消耗
                                const assistantContent = data.content || '';
                                const inputTokens = data.usage?.prompt_tokens || Math.ceil(currentInput.length / 4) + 200;
                                const outputTokens = data.usage?.completion_tokens || Math.ceil(assistantContent.length / 4);
                                api.recordModelUsage({
                                    model: data.model || '对话运维',
                                    prompt_tokens: inputTokens,
                                    completion_tokens: outputTokens,
                                    total_tokens: inputTokens + outputTokens,
                                    source: 'skill-development',
                                }).catch(() => {
                                });
                            } else if (data.type === 'message_update') {
                                // 更新消息内容（LLM 总结完成后补充内容，不修改其他状态）
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const msg = newMessages[assistantMessageIndex];
                                    if (msg) {
                                        msg.content = data.content;
                                    }
                                    return newMessages;
                                });
                            } else if (data.type === 'error') {
                                throw new Error(data.error);
                            }
                        } catch (e) {
                            console.error('解析SSE数据失败:', e);
                        }
                    }
                }
            }

            // 刷新对话列表
            fetchSessions();
        } catch (err) {
            // 更新助手消息为错误状态
            setMessages(prev => {
                const newMessages = [...prev];
                const msg = newMessages[assistantMessageIndex];
                if (msg) {
                    msg.content = `抱歉，发生了错误：${err.message}`;
                    msg.isError = true;
                    msg.isStreaming = false;
                }
                return newMessages;
            });
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleExecuteSkill = async (skillId, skillName) => {
        try {
            setLoading(true);

            const response = await fetch(`${apiBase}/api/skill-development/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({
                    skill_id: skillId,
                    action: 'default',
                    parameters: {},
                    session_id: sessionId,
                    user_id: user?.id,
                    user_input: `执行技能 ${skillName}`
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                const errMsg = data.error || '执行技能失败';
                if (response.status === 403) {
                    alert(`⚠️ 权限不足: ${errMsg}`);
                }
                throw new Error(errMsg);
            }

            if (!sessionId && data.session_id) {
                setSessionId(data.session_id);
            }
            setIsHistoryView(false);

            const executionMessage = {
                role: 'assistant',
                content: data.message,
                timestamp: new Date().toISOString(),
                isExecutionResult: true,
                matched_skills: data.status === 'success' ? [{skill: {name: skillName}}] : [],
                reasoning_steps: []
            };

            setMessages(prev => [...prev, executionMessage]);
            fetchSessions();
        } catch (err) {
            const errorMessage = {
                role: 'assistant',
                content: `执行技能时发生错误：${err.message}`,
                timestamp: new Date().toISOString(),
                isError: true
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    const renderMessage = (message, index) => {
        const isUser = message.role === 'user';
        const reasoningSteps = message.reasoning_steps || [];

        return (
            <div
                key={index}
                className={`skill-dev-message ${isUser ? 'user-message' : 'assistant-message'} ${message.isError ? 'error-message' : ''} ${message.isStreaming ? 'is-streaming' : ''}`}
            >
                <div className="message-avatar">
                    {isUser ? '我' : '🦏'}
                </div>
                <div className="message-content">
                    {/* 显示推理步骤 */}
                    {!isUser && reasoningSteps.length > 0 && !message.content.includes('抱歉，我没有找到与您需求匹配的技能') && (
                        <div className="reasoning-steps">
                            {reasoningSteps.map((step, i) => (
                                <div key={i} className={`reasoning-step ${step.status} step-${step.step}`}>
                                    {step.status === 'loading' ? (
                                        <span className="step-icon"><span className="css-spinner"/></span>
                                    ) : (
                                        <span className="step-icon">{step.icon}</span>
                                    )}
                                    <div className="step-content">
                                        <span className="step-title">{step.title}</span>
                                        {step.detail && <span className="step-detail">{step.detail}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="message-text">
                        {message.content.includes('📊 **结果分析**') ? (
                            <>
                                {message.content.split('📊 **结果分析**')[0].split('\n').map((line, i) => (
                                    <React.Fragment key={i}>
                                        {line}
                                        {i < message.content.split('📊 **结果分析**')[0].split('\n').length - 1 && <br/>}
                                    </React.Fragment>
                                ))}
                                <div className="result-analysis">
                                    <div className="analysis-header">📊 结果分析</div>
                                    <div className="analysis-content">
                                        {message.content.split('📊 **结果分析**')[1].split('\n').map((line, i) => (
                                            <React.Fragment key={i}>
                                                {line}
                                                {i < message.content.split('📊 **结果分析**')[1].split('\n').length - 1 &&
                                                    <br/>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            message.content.split('\n').map((line, i) => (
                                <React.Fragment key={i}>
                                    {line}
                                    {i < message.content.split('\n').length - 1 && <br/>}
                                </React.Fragment>
                            ))
                        )}
                    </div>

                    <div className="message-time">
                        {message.created_at ? new Date(message.created_at).toLocaleString() : new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="对话运维"
                subtitle="通过对话匹配技能执行"
                brandIcon="bi bi-robot"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content skill-development-page">
                <div className="skill-development-layout">
                    {/* 左侧对话历史列表 */}
                    <div className="chat-history-sidebar">
                        <div className="chat-history-header">
                            <h3>对话历史</h3>
                            <button className="new-chat-btn" onClick={handleNewChat}>
                                <i className="bi bi-plus-circle"> </i>
                                新对话
                            </button>
                        </div>
                        <div className="chat-history-list">
                            {loadingSessions ? (
                                <div className="loading-sessions">加载中...</div>
                            ) : sessions.length === 0 ? (
                                <div className="no-sessions">暂无对话记录</div>
                            ) : (
                                sessions.map(session => (
                                    <div
                                        key={session.id}
                                        className={`chat-history-item ${sessionId === session.id ? 'active' : ''}`}
                                        onClick={() => handleLoadSession(session.id)}
                                    >
                                        <div className="chat-history-item-content">
                                            <div className="chat-history-title">{(session.title || '').startsWith('[Paste') ? session.title.replace(/^\[Pasted?[^\]]*\]?\s*/, '').trim() : session.title}</div>
                                            <div className="chat-history-meta">
                                                <span>{session.message_count} 条消息</span>
                                                <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <button
                                            className="chat-history-delete"
                                            onClick={(e) => handleDeleteSession(session.id, e)}
                                            title="删除对话"
                                        >
                                            <i className="bi bi-trash-fill"/>
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 右侧对话区域 */}
                    <div className="chat-main-area">
                        <div className="skill-dev-messages">
                            {messages.map((message, index) => renderMessage(message, index))}
                            {loading && (
                                <div className="skill-dev-message assistant-message is-streaming">
                                    <div className="message-avatar">🦏</div>
                                    <div className="message-content">
                                        <div className="typing-indicator">
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef}/>
                        </div>

                        <div className="skill-dev-footer">
                            {isHistoryView ? (
                                <div className="history-view-notice">
                                    <i className="bi bi-clock-history history-icon"></i>
                                    <span>查看历史对话中</span>
                                    <button className="new-chat-from-history-btn" onClick={handleNewChat}>
                                        <i className="bi bi-plus-circle"> </i>
                                        开始新对话
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="skill-dev-input-container">
                    <textarea
                        className="skill-dev-input"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="描述你的需求，例如：我需要备份文件、查看系统日志、管理网络连接..."
                        disabled={loading}
                        rows={2}
                        style={{fontSize: 14}}
                    />
                                        <button
                                            className="skill-dev-send-btn"
                                            onClick={handleSendMessage}
                                            disabled={!inputValue.trim() || loading}
                                        >
                                            {loading ? '发送中...' : '发送'}
                                        </button>
                                    </div>
                                    <div className="skill-dev-hint">
                                        按 Enter 发送，Shift + Enter 换行
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
