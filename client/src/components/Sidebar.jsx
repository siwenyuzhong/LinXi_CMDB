import React from 'react';
import {NODE_TYPES} from '../constants';

export default function Sidebar({onAddNode}) {
    return (
        <div className="sidebar">
            <div className="sidebar-title">节点类型</div>
            <div className="node-palette">
                {Object.entries(NODE_TYPES).map(([type, cfg]) => (
                    <div
                        key={type}
                        className="palette-item"
                        style={{borderColor: cfg.color}}
                        draggable
                        onDragStart={(e) => {
                            e.dataTransfer.setData('nodeType', type);
                        }}
                        onClick={() => onAddNode(type)}
                    >
                        <span className="palette-icon" style={{color: cfg.color}}>{cfg.icon}</span>
                        <div className="palette-info">
                            <span className="palette-label">{cfg.label}</span>
                            <span className="palette-desc">{cfg.description}</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="sidebar-help">
                <p><b>操作提示</b></p>
                <p>拖拽节点到画布 或 点击添加</p>
                <p>点击节点配置属性</p>
                <p>从输出端口拖拽到输入端口连线</p>
                <p>Delete 键删除选中节点</p>
            </div>
        </div>
    );
}
