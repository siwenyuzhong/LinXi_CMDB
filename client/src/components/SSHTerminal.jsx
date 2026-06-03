import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';
import Modal from './Modal';
import {getStoredAuthToken} from '../api';

const DEBOUNCE_MS = 600;

const DANGEROUS_COMMANDS_INFO = {
    'rm': '删除文件/目录，此操作不可恢复',
    'dd': '直接写入磁盘，可导致数据完全丢失',
    'mkfs': '格式化磁盘，将清除所有数据',
    'fdisk': '分区工具，误操作会导致数据丢失',
    'shutdown': '关闭系统',
    'reboot': '重启系统',
    'init': '改变系统运行级别',
    'kill': '终止进程，可能导致系统不稳定',
    'killall': '终止所有指定进程',
    'chmod': '改变文件权限',
    'chown': '改变文件所有者',
    'mv': '移动/重命名文件',
    'cp': '复制文件',
};

export default function SSHTerminal({ host, apiBase, onClose, user }) {
    const containerRef = useRef(null);
    const socketRef = useRef(null);
    const termRef = useRef(null);
    const lineBufferRef = useRef('');
    const suggestTimerRef = useRef(null);
    const showSuggestRef = useRef(false);
    const suggestionsRef = useRef([]);
    const blacklistRef = useRef([]);
    const pendingFlagRef = useRef(false);

    const [suggestions, setSuggestions] = useState([]);
    const [showSuggest, setShowSuggest] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);

    useEffect(() => {
        showSuggestRef.current = showSuggest;
    }, [showSuggest]);

    useEffect(() => {
        suggestionsRef.current = suggestions;
    }, [suggestions]);

    useEffect(() => {
        console.log('[DEBUG] 正在加载命令黑名单...');
        const h = getStoredAuthToken() ? {'Authorization': `Bearer ${getStoredAuthToken()}`} : {};
        fetch(`${apiBase}/api/command-blacklist`, {headers: h})
            .then(r => {
                console.log('[DEBUG] API 响应状态:', r.status);
                return r.json();
            })
            .then(resp => {
                console.log('[DEBUG] 黑名单原始API响应:', JSON.stringify(resp));
                
                // 尝试多种可能的数据格式
                const value = resp?.data?.data?.value 
                    || resp?.data?.value 
                    || resp?.value 
                    || resp;
                
                console.log('[DEBUG] 解析后的 value:', value, '类型:', Array.isArray(value) ? 'array' : typeof value);
                
                if (value && Array.isArray(value)) {
                    blacklistRef.current = value;
                    console.log('[DEBUG] ✅ 黑名单已加载:', value.length, '条命令:', value);
                } else {
                    console.log('[DEBUG] ❌ 黑名单为空或格式错误');
                }
            })
            .catch((err) => {
                console.error('[DEBUG] ❌ 加载黑名单失败:', err);
            });
    }, [apiBase]);

    const fetchSuggestions = useCallback(async (input) => {
        if (!input.trim()) {
            setSuggestions([]);
            setShowSuggest(false);
            return;
        }
        try {
            const resp = await fetch(`${apiBase}/api/ai/command-suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(getStoredAuthToken() ? {'Authorization': `Bearer ${getStoredAuthToken()}`} : {}) },
                body: JSON.stringify({
                    current_input: input,
                    host_info: { os_type: 'Linux' },
                }),
            });
            const data = await resp.json();
            if (data.suggestions && data.suggestions.length > 0) {
                setSuggestions(data.suggestions);
                setShowSuggest(true);
            } else {
                setSuggestions([]);
                setShowSuggest(false);
            }
        } catch {
            setSuggestions([]);
            setShowSuggest(false);
        }
    }, [apiBase]);

    const acceptSuggestion = useCallback((cmd) => {
        const socket = socketRef.current;
        if (!socket) return;
        socket.emit('ssh_data', { data: '\x15' });
        socket.emit('ssh_data', { data: cmd });
        lineBufferRef.current = cmd;
        setShowSuggest(false);
    }, []);

    useEffect(() => {
        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#e6edf3',
                selectionBackground: '#264f78',
                black: '#484f58',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#f0f6fc',
            },
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(containerRef.current);
        fitAddon.fit();

        const socket = io(apiBase, {
            transports: ['websocket', 'polling'],
            reconnection: false,
        });

        socket.on('connect', () => {
            socket.emit('ssh_connect', {
                host_id: host.id,
                platform_user: user?.username || '',
                token: getStoredAuthToken(),
            });
        });

        socket.on('ssh_connected', (msg) => {
            term.write(`\r\n\x1b[32m${msg.message}\x1b[0m\r\n`);
        });

        socket.on('ssh_output', (msg) => {
            term.write(msg.data);
        });

        socket.on('ssh_error', (msg) => {
            term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        });

        socket.on('ssh_blacklist_warning', (msg) => {
            setConfirmModal({
                command: msg.command,
                fullCommand: msg.full_command || msg.command,
                info: msg.info,
            });
            pendingFlagRef.current = true;
        });

        socket.on('disconnect', () => {
            term.write('\r\n\x1b[33m连接已断开\x1b[0m\r\n');
        });

        term.onData((data) => {
            // 弹窗确认中，仅响应 Ctrl+C 取消
            if (pendingFlagRef.current) {
                if (data === '\x03' || data === '\x04') {
                    socket.emit('ssh_cancel_command');
                    term.write('\r\n\x1b[33m✗ 已取消执行\x1b[0m\r\n');
                    pendingFlagRef.current = false;
                    setConfirmModal(null);
                    lineBufferRef.current = '';
                    setShowSuggest(false);
                }
                return;
            }

            const buf = lineBufferRef.current;

            if (data === '\r') {
                const cmd = buf.trim();
                const cmdName = cmd.split(/\s+/)[0];
                const blacklist = blacklistRef.current;

                if (cmdName && blacklist.includes(cmdName)) {
                    const info = DANGEROUS_COMMANDS_INFO[cmdName] || '此命令可能存在风险';
                    pendingFlagRef.current = true;
                    setConfirmModal({ command: cmdName, fullCommand: cmd, info });
                    lineBufferRef.current = '';
                    setShowSuggest(false);
                    return;
                }

                socket.emit('ssh_data', { data });
                lineBufferRef.current = '';
                setShowSuggest(false);
                return;
            }

            socket.emit('ssh_data', { data });

            if (data === '\x7f') {
                lineBufferRef.current = buf.slice(0, -1);
            } else if (data === '\x03' || data === '\x04') {
                lineBufferRef.current = '';
                setShowSuggest(false);
            } else if (data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) <= 0x7e) {
                lineBufferRef.current = buf + data;
            }

            if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
            if (data === ' ') {
                fetchSuggestions(lineBufferRef.current);
            } else {
                suggestTimerRef.current = setTimeout(() => {
                    fetchSuggestions(lineBufferRef.current);
                }, DEBOUNCE_MS);
            }
        });

        const handleResize = () => {
            fitAddon.fit();
            socket.emit('ssh_resize', {
                cols: term.cols,
                rows: term.rows,
            });
        };

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(containerRef.current);

        window.addEventListener('resize', handleResize);

        termRef.current = term;
        socketRef.current = socket;

        return () => {
            if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
            socket.disconnect();
            term.dispose();
        };
    }, [host.id, apiBase, fetchSuggestions, acceptSuggestion]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={containerRef} style={{
                width: '100%',
                height: '100%',
                background: '#0d1117',
                borderRadius: 6,
                overflow: 'hidden',
            }} />
            {showSuggest && suggestions.length > 0 && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: '#161b22',
                    borderTop: '1px solid #30363d',
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    zIndex: 10,
                }}>
                    <span style={{color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap'}}>AI提示：</span>
                    {suggestions.map((s, i) => (
                        <span
                            key={i}
                            onClick={() => acceptSuggestion(s)}
                            style={{
                                display: 'inline-block',
                                background: i === 0 ? '#1f6feb' : '#21262d',
                                border: '1px solid #30363d',
                                borderRadius: 4,
                                padding: '3px 10px',
                                color: '#e6edf3',
                                cursor: 'pointer',
                                fontSize: 13,
                                fontFamily: "'JetBrains Mono', monospace",
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {s}
                        </span>
                    ))}
                </div>
            )}

            {confirmModal && (
                <Modal
                    open={true}
                    onClose={() => {
                        socketRef.current?.emit('ssh_cancel_command');
                        pendingFlagRef.current = false;
                        setConfirmModal(null);
                    }}
                    title="危险命令确认"
                    type="confirm"
                    width={520}
                    closable={true}
                    closeOnOverlay={true}
                    footer={
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-ghost"
                                onClick={() => {
                                    socketRef.current?.emit('ssh_cancel_command');
                                    pendingFlagRef.current = false;
                                    setConfirmModal(null);
                                }}
                            >
                                取消
                            </button>
                            <button
                                className="btn btn-danger-solid"
                                onClick={() => {
                                    socketRef.current?.emit('ssh_confirm_command', { command: confirmModal.fullCommand });
                                    pendingFlagRef.current = false;
                                    setConfirmModal(null);
                                }}
                            >
                                确认执行
                            </button>
                        </div>
                    }
                >
                    <div style={{ lineHeight: 1.8, fontSize: 14 }}>
                        <p style={{ marginBottom: 12 }}>
                            <span style={{ color: '#ef4444', fontWeight: 700 }}>{confirmModal.command}</span>
                            {' '}命令在黑名单中，存在安全风险：
                        </p>
                        <p style={{
                            marginBottom: 16,
                            padding: '10px 14px',
                            background: 'rgba(239,68,68,0.08)',
                            borderLeft: '3px solid #ef4444',
                            borderRadius: 4,
                            color: '#fca5a5',
                        }}>
                            {confirmModal.info}
                        </p>
                        <p style={{ marginBottom: 8, color: '#94a3b8', fontSize: 13 }}>
                            完整命令：
                        </p>
                        <pre style={{
                            background: '#0d1117',
                            padding: '10px 14px',
                            borderRadius: 6,
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: '#e6edf3',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            border: '1px solid #30363d',
                        }}>
                            {confirmModal.fullCommand}
                        </pre>
                    </div>
                </Modal>
            )}
        </div>
    );
}
