import React, {useState, useEffect} from 'react';
import {NODE_TYPES} from '../constants';

export default function NodeConfig({node, nodes, connections, onUpdate, onUpdateConnections, onClose, onDelete}) {
    const cfg = NODE_TYPES[node.type];
    const [data, setData] = useState({...node.data});

    useEffect(() => {
        setData({...node.data});
    }, [node.id]);

    const handleChange = (key, value) => {
        const newData = {...data, [key]: value};
        setData(newData);
        onUpdate({...node, data: newData});
    };

    const handleVariableChange = (index, field, value) => {
        const vars = [...(data.variables || [])];
        vars[index] = {...vars[index], [field]: value};
        handleChange('variables', vars);
    };

    const addVariable = () => {
        handleChange('variables', [...(data.variables || []), {name: '', type: 'string', defaultValue: ''}]);
    };

    const removeVariable = (index) => {
        handleChange('variables', (data.variables || []).filter((_, i) => i !== index));
    };

    const outgoingConns = connections.filter(c => c.from === node.id);
    const incomingConns = connections.filter(c => c.to === node.id);

    const currentLang = data.language || 'javascript';

    return (
        <div className="node-config-panel">
            <div className="config-header">
                <div className="config-title">
                    <span style={{color: cfg.color, fontSize: '18px'}}>{cfg.icon}</span>
                    <h3>{cfg.label} 配置</h3>
                </div>
                <div className="config-actions">
                    <button className="btn-icon btn-danger" onClick={onDelete} title="删除节点"><i
                        className="bi bi-trash3"></i>
                    </button>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>
            </div>

            <div className="config-body">
                {/* Node label */}
                <div className="form-group">
                    <label>节点名称</label>
                    <input value={data.label || ''} onChange={e => handleChange('label', e.target.value)}/>
                </div>

                {/* Start node */}
                {node.type === 'start' && (
                    <div className="form-group">
                        <label>输入变量</label>
                        {(data.variables || []).map((v, i) => (
                            <div key={i} className="variable-row">
                                <input placeholder="变量名" value={v.name}
                                       onChange={e => handleVariableChange(i, 'name', e.target.value)}/>
                                <select value={v.type} onChange={e => handleVariableChange(i, 'type', e.target.value)}>
                                    <option value="string">String</option>
                                    <option value="number">Number</option>
                                    <option value="boolean">Boolean</option>
                                </select>
                                <input placeholder="默认值" value={v.defaultValue}
                                       onChange={e => handleVariableChange(i, 'defaultValue', e.target.value)}/>
                                <button className="btn-icon btn-danger" onClick={() => removeVariable(i)}>✕</button>
                            </div>
                        ))}
                        <button className="btn btn-sm" onClick={addVariable}>+ 添加变量</button>
                    </div>
                )}

                {/* LLM node */}
                {node.type === 'llm' && (
                    <>
                        <div className="form-group">
                            <label>模型</label>
                            <select value={data.model || 'gpt-3.5-turbo'}
                                    onChange={e => handleChange('model', e.target.value)}>
                                <option value="gpt-5.4">gpt-5.4</option>
                                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                                <option value="gpt-4">GPT-4</option>
                                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                <option value="gpt-4o">GPT-4o</option>
                                <option value="claude-3-opus">Claude 3 Opus</option>
                                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                                <option value="deepseek-chat">DeepSeek Chat</option>
                                <option value="THUDM/GLM-4-9B-0414">THUDM/GLM-4-9B-0414</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>API Base URL</label>
                            <input value={data.baseUrl || ''} onChange={e => handleChange('baseUrl', e.target.value)}
                                   placeholder="https://api.openai.com/v1"/>
                        </div>
                        <div className="form-group">
                            <label>API Key</label>
                            <input type="password" value={data.apiKey || ''}
                                   onChange={e => handleChange('apiKey', e.target.value)} placeholder="sk-..."/>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Temperature</label>
                                <input type="number" min="0" max="2" step="0.1" value={data.temperature ?? 0.7}
                                       onChange={e => handleChange('temperature', parseFloat(e.target.value))}/>
                            </div>
                            <div className="form-group">
                                <label>Max Tokens</label>
                                <input type="number" min="1" max="128000" value={data.maxTokens ?? 2048}
                                       onChange={e => handleChange('maxTokens', parseInt(e.target.value))}/>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>System Prompt</label>
                            <textarea rows={3} value={data.systemPrompt || ''}
                                      onChange={e => handleChange('systemPrompt', e.target.value)}
                                      placeholder="系统提示词..."/>
                        </div>
                        <div className="form-group">
                            <label>Prompt</label>
                            <textarea rows={4} value={data.prompt || ''}
                                      onChange={e => handleChange('prompt', e.target.value)}
                                      placeholder="使用 {{变量名}} 引用上下文变量"/>
                            <div className="form-hint">使用 <code>{'{{变量名}}'}</code> 引用上游节点输出或输入变量</div>
                        </div>
                    </>
                )}

                {/* HTTP node */}
                {node.type === 'http' && (
                    <>
                        <div className="form-group">
                            <label>请求方法</label>
                            <select value={data.method || 'GET'} onChange={e => handleChange('method', e.target.value)}>
                                <option>GET</option>
                                <option>POST</option>
                                <option>PUT</option>
                                <option>PATCH</option>
                                <option>DELETE</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>URL</label>
                            <input value={data.url || ''} onChange={e => handleChange('url', e.target.value)}
                                   placeholder="https://api.example.com/data"/>
                        </div>
                        <div className="form-group">
                            <label>Headers (JSON)</label>
                            <textarea rows={2} value={data.headers || '{}'}
                                      onChange={e => handleChange('headers', e.target.value)}/>
                        </div>
                        <div className="form-group">
                            <label>Body</label>
                            <textarea rows={3} value={data.body || ''}
                                      onChange={e => handleChange('body', e.target.value)}/>
                        </div>
                    </>
                )}

                {/* ====== Code node — JS / PY 强视觉区分 ====== */}
                {node.type === 'code' && (
                    <>
                        {/* 语言选择器 */}
                        <div className="form-group">
                            <label>执行语言</label>
                            <div className="language-selector">
                                <button
                                    className={`lang-btn ${currentLang === 'javascript' ? 'active js-active' : ''}`}
                                    onClick={() => handleChange('language', 'javascript')}
                                >
                                    <span className="lang-badge js-badge">JS</span>
                                    <div className="lang-info">
                                        <span className="lang-name">JavaScript</span>
                                        <span className="lang-detail">Node.js 沙盒</span>
                                    </div>
                                    {currentLang === 'javascript' && <span className="lang-check">✓</span>}
                                </button>
                                <button
                                    className={`lang-btn ${currentLang === 'python' ? 'active py-active' : ''}`}
                                    onClick={() => handleChange('language', 'python')}
                                >
                                    <span className="lang-badge py-badge">PY</span>
                                    <div className="lang-info">
                                        <span className="lang-name">Python 3</span>
                                        <span className="lang-detail">python3 子进程</span>
                                    </div>
                                    {currentLang === 'python' && <span className="lang-check">✓</span>}
                                </button>
                            </div>
                        </div>

                        {/* 当前语言指示条 */}
                        <div className={`lang-indicator ${currentLang}`}>
                            <span className="lang-indicator-dot"/>
                            <span>
                当前: <b>{currentLang === 'python' ? 'Python 3' : 'JavaScript'}</b>
                                {currentLang === 'python' ? ' — 赋值给 result 变量' : ' — 使用 return 返回'}
              </span>
                        </div>

                        {/* 代码编辑区 */}
                        <div className="form-group">
                            <label>
                                {currentLang === 'python' ? '🐍 Python 代码' : '⚡ JavaScript 代码'}
                            </label>
                            <textarea
                                rows={10}
                                className={`code-textarea ${currentLang === 'python' ? 'code-python' : 'code-javascript'}`}
                                value={data.code || ''}
                                onChange={e => handleChange('code', e.target.value)}
                                spellCheck={false}
                                placeholder={
                                    currentLang === 'python'
                                        ? '# 使用 context 和 input 变量\n# 将结果赋值给 result\nresult = context.get("output", "") + " processed"'
                                        : '// 使用 context 和 input 变量\nreturn context.output + " processed";'
                                }
                            />
                            <div className="form-hint">
                                {currentLang === 'python' ? (
                                    <>
                                        可用变量: <code>context</code> (dict), <code>input</code> (dict)。
                                        将结果赋值给 <code>result</code> 变量。
                                    </>
                                ) : (
                                    <>
                                        可用变量: <code>context</code> (对象), <code>input</code> (对象)。
                                        使用 <code>return</code> 返回结果。
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Python 提示 */}
                        {currentLang === 'python' && (
                            <div className="python-hint">
                                <b>Python 执行说明:</b> 代码通过 <code>python3</code> 在临时文件中执行，超时 30
                                秒。请确保系统已安装 Python 3。
                            </div>
                        )}
                    </>
                )}

                {/* Condition node */}
                {node.type === 'condition' && (
                    <div className="form-group">
                        <label>条件表达式</label>
                        <textarea
                            rows={3}
                            className="code-textarea"
                            value={data.condition || ''}
                            onChange={e => handleChange('condition', e.target.value)}
                            placeholder="context.score > 80"
                        />
                        <div className="form-hint">返回 truthy 值走「是」分支，否则走「否」分支</div>
                        <div className="connection-info">
                            <h4>连接配置</h4>
                            {outgoingConns.map(conn => (
                                <div key={conn.id} className="conn-item">
                                    <span
                                        className={`conn-label ${conn.label}`}>{conn.label === 'true' ? '✓ 是' : '✗ 否'}</span>
                                    <span>→ {nodes.find(n => n.id === conn.to)?.data?.label || conn.to}</span>
                                </div>
                            ))}
                            <p className="form-hint">从输出端口拖拽连线到目标节点，自动分配「是/否」分支</p>
                        </div>
                    </div>
                )}

                {/* Prompt node */}
                {node.type === 'prompt' && (
                    <div className="form-group">
                        <label>Prompt 模板</label>
                        <textarea
                            rows={6}
                            value={data.template || ''}
                            onChange={e => handleChange('template', e.target.value)}
                            placeholder="使用 {{变量名}} 引用上下文变量"
                        />
                        <div className="form-hint">使用 <code>{'{{变量名}}'}</code> 引用上下文变量</div>
                    </div>
                )}

                {/* End node */}
                {node.type === 'end' && (
                    <div className="form-group">
                        <label>输出变量（留空则输出全部上下文）</label>
                        <input
                            value={(data.outputKeys || []).join(', ')}
                            onChange={e => handleChange('outputKeys', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            placeholder="output, result, answer"
                        />
                        <div className="form-hint">用逗号分隔需要输出的变量名</div>
                    </div>
                )}

                {/* Connection info */}
                <div className="connection-info">
                    <h4>连接信息</h4>
                    {incomingConns.length > 0 && (
                        <p>⬅
                            来自: {incomingConns.map(c => nodes.find(n => n.id === c.from)?.data?.label).join(', ')}</p>
                    )}
                    {outgoingConns.length > 0 && (
                        <p>➡ 去往: {outgoingConns.map(c => nodes.find(n => n.id === c.to)?.data?.label).join(', ')}</p>
                    )}
                    {incomingConns.length === 0 && outgoingConns.length === 0 && (
                        <p className="text-muted">暂无连接</p>
                    )}
                </div>
            </div>
        </div>
    );
}
