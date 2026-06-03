import React, {useState, useRef, useCallback, useEffect} from 'react';
import {NODE_TYPES} from '../constants';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const PORT_RADIUS = 6;
const DEFAULT_VIEWPORT = {pan: {x: 80, y: 80}, zoom: 1};

function getViewportStorageKey(viewportKey) {
    return viewportKey ? `promptflow_canvas_viewport_${viewportKey}` : '';
}

function loadViewport(viewportKey) {
    const storageKey = getViewportStorageKey(viewportKey);
    if (!storageKey) {
        return null;
    }

    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        if (
            Number.isFinite(parsed?.pan?.x)
            && Number.isFinite(parsed?.pan?.y)
            && Number.isFinite(parsed?.zoom)
        ) {
            return parsed;
        }
    } catch (error) {
        console.error('Failed to load canvas viewport:', error);
    }

    return null;
}

function saveViewport(viewportKey, viewport) {
    const storageKey = getViewportStorageKey(viewportKey);
    if (!storageKey) {
        return;
    }

    try {
        localStorage.setItem(storageKey, JSON.stringify(viewport));
    } catch (error) {
        console.error('Failed to save canvas viewport:', error);
    }
}

function getFittedViewport(nodes, rect) {
    if (!rect?.width || !rect?.height || !nodes.length) {
        return DEFAULT_VIEWPORT;
    }

    const validNodes = nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!validNodes.length) {
        return DEFAULT_VIEWPORT;
    }

    const minX = Math.min(...validNodes.map((node) => node.x));
    const minY = Math.min(...validNodes.map((node) => node.y));
    const maxX = Math.max(...validNodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...validNodes.map((node) => node.y + NODE_HEIGHT));

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return DEFAULT_VIEWPORT;
    }

    const contentWidth = Math.max(maxX - minX, NODE_WIDTH);
    const contentHeight = Math.max(maxY - minY, NODE_HEIGHT);
    const padding = 80;
    const scaleX = (rect.width - padding * 2) / contentWidth;
    const scaleY = (rect.height - padding * 2) / contentHeight;
    const zoom = Math.max(0.3, Math.min(1.2, Math.min(scaleX, scaleY, 1.2)));

    return {
        zoom,
        pan: {
            x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
            y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
        },
    };
}

export default function WorkflowCanvas({
                                            nodes, connections, selectedNodeId,
                                            onSelectNode, onOpenNodeConfig, onUpdateNodes, onUpdateConnections,
                                            onDeleteNode, onDeleteConnection,
                                            nodeStatuses, nodeOutputs,
                                            viewportKey,
                                        }) {
    const svgRef = useRef(null);
    const hasInitializedViewportRef = useRef(false);
    const dragRef = useRef(null);
    const [connecting, setConnecting] = useState(null);
    const [mousePos, setMousePos] = useState({x: 0, y: 0});
    const [pan, setPan] = useState(() => loadViewport(viewportKey)?.pan || DEFAULT_VIEWPORT.pan);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({x: 0, y: 0});
    const [zoom, setZoom] = useState(() => loadViewport(viewportKey)?.zoom || DEFAULT_VIEWPORT.zoom);

    const getSvgPoint = useCallback((e) => {
        const rect = svgRef.current.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top - pan.y) / zoom,
        };
    }, [pan, zoom]);

    const handleNodePointerDown = useCallback((e, node, nodes) => {
        if (e.target.classList.contains('port')) return;
        e.stopPropagation();
        e.target.setPointerCapture(e.pointerId);
        onSelectNode(node.id);

        const rect = svgRef.current.getBoundingClientRect();
        const pos = {
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top - pan.y) / zoom,
        };
        const offsetX = pos.x - node.x;
        const offsetY = pos.y - node.y;
        const nodeId = node.id;

        dragRef.current = {nodeId, offsetX, offsetY};

        const onMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            const r = svgRef.current.getBoundingClientRect();
            const p = {
                x: (e.clientX - r.left - pan.x) / zoom,
                y: (e.clientY - r.top - pan.y) / zoom,
            };
            const newNodes = nodes.map(n =>
                n.id === d.nodeId
                    ? {...n, x: p.x - d.offsetX, y: p.y - d.offsetY}
                    : n
            );
            onUpdateNodes(newNodes);
        };
        const onUp = () => {
            dragRef.current = null;
            e.target.removeEventListener('pointermove', onMove);
            e.target.removeEventListener('pointerup', onUp);
        };
        e.target.addEventListener('pointermove', onMove);
        e.target.addEventListener('pointerup', onUp);
    }, [pan, zoom, onSelectNode, onUpdateNodes]);

    useEffect(() => {
        hasInitializedViewportRef.current = false;
        const savedViewport = loadViewport(viewportKey);
        if (savedViewport) {
            setPan(savedViewport.pan);
            setZoom(savedViewport.zoom);
            hasInitializedViewportRef.current = true;
            return;
        }

        setPan(DEFAULT_VIEWPORT.pan);
        setZoom(DEFAULT_VIEWPORT.zoom);
    }, [viewportKey]);

    useEffect(() => {
        if (!svgRef.current || !nodes.length || hasInitializedViewportRef.current) {
            return;
        }

        const nextViewport = getFittedViewport(nodes, svgRef.current.getBoundingClientRect());
        setPan(nextViewport.pan);
        setZoom(nextViewport.zoom);
        hasInitializedViewportRef.current = true;
        saveViewport(viewportKey, nextViewport);
    }, [nodes, viewportKey]);

    useEffect(() => {
        if (!hasInitializedViewportRef.current) {
            return;
        }

        saveViewport(viewportKey, {pan, zoom});
    }, [pan, zoom, viewportKey]);

    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeId && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
                    e.preventDefault();
                    onDeleteNode(selectedNodeId);
                }
            }
            if (e.key === 'Escape') {
                setConnecting(null);
                onSelectNode(null);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selectedNodeId, onDeleteNode, onSelectNode]);

    const handleMouseMove = useCallback((e) => {
        const pos = getSvgPoint(e);
        setMousePos(pos);

        if (isPanning) {
            setPan({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y,
            });
        }
    }, [isPanning, panStart, getSvgPoint]);

    const handleMouseUp = useCallback(() => {
        setIsPanning(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('nodeType');
        if (!type) return;
        const pos = getSvgPoint(e);
        const cfg = NODE_TYPES[type];
        const newNode = {
            id: `${type}-${Date.now()}`,
            type,
            x: pos.x - NODE_WIDTH / 2,
            y: pos.y - NODE_HEIGHT / 2,
            data: JSON.parse(JSON.stringify(cfg.defaultData)),
        };
        onUpdateNodes([...nodes, newNode]);
        onSelectNode(newNode.id);
    }, [nodes, getSvgPoint, onUpdateNodes, onSelectNode]);

    const handleCanvasClick = (e) => {
        if (e.target === svgRef.current || e.target.classList.contains('canvas-bg')) {
            if (!connecting) onSelectNode(null);
        }
    };

    const handlePortMouseDown = (e, nodeId, portType) => {
        e.stopPropagation();
        if (portType === 'output') {
            setConnecting({from: nodeId, fromPort: 'output'});
        }
    };

    const handlePortMouseUp = (e, nodeId, portType) => {
        e.stopPropagation();
        if (connecting && portType === 'input' && connecting.from !== nodeId) {
            const exists = connections.some(c => c.from === connecting.from && c.to === nodeId);
            if (!exists) {
                const newConn = {
                    id: `conn-${Date.now()}`,
                    from: connecting.from,
                    to: nodeId,
                    label: '',
                };
                const sourceNode = nodes.find(n => n.id === connecting.from);
                if (sourceNode?.type === 'condition') {
                    const existingTrue = connections.some(c => c.from === connecting.from && c.label === 'true');
                    newConn.label = existingTrue ? 'false' : 'true';
                }
                onUpdateConnections([...connections, newConn]);
            }
        }
        setConnecting(null);
    };

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }

        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        setZoom((currentZoom) => {
            const nextZoom = Math.max(0.3, Math.min(2, currentZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
            const worldX = (cursorX - pan.x) / currentZoom;
            const worldY = (cursorY - pan.y) / currentZoom;

            setPan({
                x: cursorX - worldX * nextZoom,
                y: cursorY - worldY * nextZoom,
            });

            return nextZoom;
        });
    }, [pan.x, pan.y]);

    // 根据节点状态获取边框颜色
    const getNodeStroke = (nodeId, defaultColor) => {
        const status = nodeStatuses?.[nodeId];
        if (status === 'running') return '#6366f1';
        if (status === 'success') return '#22c55e';
        if (status === 'error') return '#ef4444';
        return defaultColor;
    };

    const getNodeStrokeWidth = (nodeId, isSelected) => {
        const status = nodeStatuses?.[nodeId];
        if (status === 'running' || status === 'success' || status === 'error') return 3;
        if (isSelected) return 2;
        return 1;
    };

    const getNodeBg = (nodeId, cfg, isSelected) => {
        const status = nodeStatuses?.[nodeId];
        if (status === 'running') return isSelected ? cfg.bgColor : 'rgba(99, 102, 241, 0.08)';
        if (status === 'success') return isSelected ? '#052e16' : 'rgba(34, 197, 94, 0.06)';
        if (status === 'error') return isSelected ? '#450a0a' : 'rgba(239, 68, 68, 0.06)';
        return isSelected ? cfg.bgColor : 'var(--canvas-node-bg)';
    };

    // 渲染连接线
    const renderConnection = (conn) => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (!fromNode || !toNode) return null;

        const x1 = fromNode.x + NODE_WIDTH;
        const y1 = fromNode.y + NODE_HEIGHT / 2;
        const x2 = toNode.x;
        const y2 = toNode.y + NODE_HEIGHT / 2;
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
        const dx = Math.abs(x2 - x1) * 0.5;
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        return (
            <g key={conn.id}>
                <path
                    d={path}
                    fill="none"
                    stroke="var(--canvas-connection)"
                    strokeWidth="2"
                    className="connection-line"
                    style={{cursor: 'pointer'}}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('删除此连接？')) onDeleteConnection(conn.id);
                    }}
                />
                {conn.label && (
                    <text x={midX} y={midY - 8} textAnchor="middle" className="connection-label"
                          fill={conn.label === 'true' ? 'var(--green)' : 'var(--red)'} fontSize="11" fontWeight="600">
                        {conn.label === 'true' ? '✓ 是' : '✗ 否'}
                    </text>
                )}
                <polygon
                    points={`${x2},${y2} ${x2 - 8},${y2 - 4} ${x2 - 8},${y2 + 4}`}
                    fill="var(--canvas-connection)"
                />
            </g>
        );
    };

    const renderConnectingLine = () => {
        if (!connecting) return null;
        const fromNode = nodes.find(n => n.id === connecting.from);
        if (!fromNode) return null;
        const x1 = fromNode.x + NODE_WIDTH;
        const y1 = fromNode.y + NODE_HEIGHT / 2;
        const dx = Math.abs(mousePos.x - x1) * 0.5;
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(mousePos.x) || !Number.isFinite(mousePos.y)) return null;
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${mousePos.x - dx} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`;
        return <path d={path} fill="none" stroke="var(--canvas-connection-active)" strokeWidth="2"
                     strokeDasharray="6 3"/>;
    };

    return (
        <svg
            ref={svgRef}
            className="workflow-svg"
            style={{touchAction: 'none'}}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
            onWheel={handleWheel}
            onMouseDown={(e) => {
                if (e.button === 1 || (e.button === 0 && e.target.classList.contains('canvas-bg'))) {
                    setIsPanning(true);
                    setPanStart({x: e.clientX - pan.x, y: e.clientY - pan.y});
                }
            }}
        >
            <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--canvas-grid)" strokeWidth="0.5"/>
                </pattern>
                <pattern id="gridLarge" width="100" height="100" patternUnits="userSpaceOnUse">
                    <rect width="100" height="100" fill="url(#grid)"/>
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--canvas-grid-lg)" strokeWidth="0.8"/>
                </pattern>
            </defs>

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                <rect className="canvas-bg" x="-5000" y="-5000" width="10000" height="10000" fill="url(#gridLarge)"/>

                {connections.map(renderConnection)}
                {renderConnectingLine()}

                {nodes.map(node => {
                    const cfg = NODE_TYPES[node.type];
                    if (!cfg) return null;
                    const isSelected = node.id === selectedNodeId;
                    const status = nodeStatuses?.[node.id];

                    let subtitle = cfg.description;
                    if (node.type === 'code') {
                        const lang = node.data?.language || 'javascript';
                        subtitle = lang === 'python' ? 'Python 执行' : 'JavaScript 执行';
                    } else if (node.type === 'llm') {
                        subtitle = node.data?.model || 'LLM';
                    }

                    // 状态图标
                    let statusIcon = null;
                    if (status === 'running') {
                        statusIcon = (
                            <g transform={`translate(${NODE_WIDTH / 2}, ${NODE_HEIGHT + 16})`}>
                                <circle cx="0" cy="0" r="9" fill="rgba(99, 102, 241, 0.12)" stroke="#6366f1"
                                        strokeWidth="2"/>
                                <text x="0" y="4" textAnchor="middle" fill="#6366f1" fontSize="11" fontWeight="bold">…
                                </text>
                            </g>
                        );
                    } else if (status === 'success') {
                        statusIcon = (
                            <g transform={`translate(${NODE_WIDTH / 2}, ${NODE_HEIGHT + 16})`}>
                                <circle cx="0" cy="0" r="9" fill="#052e16" stroke="#22c55e" strokeWidth="2"/>
                                <text x="0" y="4" textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="bold">✓
                                </text>
                            </g>
                        );
                    } else if (status === 'error') {
                        statusIcon = (
                            <g transform={`translate(${NODE_WIDTH / 2}, ${NODE_HEIGHT + 16})`}>
                                <circle cx="0" cy="0" r="9" fill="#450a0a" stroke="#ef4444" strokeWidth="2"/>
                                <text x="0" y="4" textAnchor="middle" fill="#ef4444" fontSize="11" fontWeight="bold">✗
                                </text>
                            </g>
                        );
                    }

                    return (
                        <g
                            key={node.id}
                            transform={`translate(${node.x},${node.y})`}
                            className={`canvas-node ${isSelected ? 'selected' : ''}`}
                            onPointerDown={(e) => handleNodePointerDown(e, node, nodes)}
                            onDoubleClick={(e) => {
                                if (e.target.classList.contains('port')) return;
                                e.stopPropagation();
                                onOpenNodeConfig?.(node.id);
                            }}
                        >
                            {/* Running highlight */}
                            {status === 'running' && (
                                <rect
                                    x={-4} y={-4}
                                    width={NODE_WIDTH + 8} height={NODE_HEIGHT + 8}
                                    rx="12" fill="none"
                                    stroke="#6366f1" strokeWidth="2" opacity="0.2"
                                />
                            )}

                            {/* Node body */}
                            <rect
                                width={NODE_WIDTH} height={NODE_HEIGHT} rx="8"
                                fill={getNodeBg(node.id, cfg, isSelected)}
                                stroke={getNodeStroke(node.id, isSelected ? cfg.color : 'var(--canvas-node-border)')}
                                strokeWidth={getNodeStrokeWidth(node.id, isSelected)}
                            />

                            {/* Left color bar */}
                            <rect width="4" height={NODE_HEIGHT} rx="2" fill={cfg.color}/>

                            {/* Title */}
                            <text x="16" y="24" fill={cfg.color} fontSize="13" fontWeight="600"
                                  fontFamily="Inter, sans-serif">
                                {cfg.icon} {node.data?.label || cfg.label}
                            </text>
                            {/* Subtitle */}
                            <text x="16" y="44" fill="var(--canvas-node-sub)" fontSize="10"
                                  fontFamily="Inter, sans-serif">
                                {subtitle}
                            </text>

                            {/* Code badge */}
                            {node.type === 'code' && (
                                <g>
                                    {(node.data?.language || 'javascript') === 'python' ? (
                                        <>
                                            <rect x={NODE_WIDTH - 42} y={6} width="36" height="18" rx="4"
                                                  fill="#3776ab"/>
                                            <text x={NODE_WIDTH - 24} y={19} textAnchor="middle" fill="#ffd43b"
                                                  fontSize="10" fontWeight="800" fontFamily="monospace">PY
                                            </text>
                                        </>
                                    ) : (
                                        <>
                                            <rect x={NODE_WIDTH - 42} y={6} width="36" height="18" rx="4"
                                                  fill="#f7df1e"/>
                                            <text x={NODE_WIDTH - 24} y={19} textAnchor="middle" fill="#323330"
                                                  fontSize="10" fontWeight="800" fontFamily="monospace">JS
                                            </text>
                                        </>
                                    )}
                                </g>
                            )}

                            {/* Input port */}
                            {node.type !== 'start' && (
                                <circle
                                    className="port port-input"
                                    cx="0" cy={NODE_HEIGHT / 2} r={PORT_RADIUS}
                                    fill="var(--canvas-port-bg)"
                                    stroke="var(--canvas-port-input)"
                                    strokeWidth="2"
                                    onMouseUp={(e) => handlePortMouseUp(e, node.id, 'input')}
                                    style={{cursor: 'pointer'}}
                                />
                            )}

                            {/* Output port */}
                            {node.type !== 'end' && (
                                <circle
                                    className="port port-output"
                                    cx={NODE_WIDTH} cy={NODE_HEIGHT / 2} r={PORT_RADIUS}
                                    fill="var(--canvas-port-bg)"
                                    stroke={cfg.color}
                                    strokeWidth="2"
                                    onMouseDown={(e) => handlePortMouseDown(e, node.id, 'output')}
                                    style={{cursor: 'crosshair'}}
                                />
                            )}

                            {/* Condition labels */}
                            {node.type === 'condition' && (
                                <>
                                    <text x={NODE_WIDTH + 12} y={NODE_HEIGHT / 2 - 15} fill="var(--green)" fontSize="9"
                                          fontWeight="600">T
                                    </text>
                                    <text x={NODE_WIDTH + 12} y={NODE_HEIGHT / 2 + 20} fill="var(--red)" fontSize="9"
                                          fontWeight="600">F
                                    </text>
                                </>
                            )}

                            {/* Status indicator below node */}
                            {statusIcon}
                        </g>
                    );
                })}
            </g>
        </svg>
    );
}
