import React, {useState, useEffect} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import CodeEditor from '../components/CodeEditor';
import Modal from '../components/Modal';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';

function getLanguageType(filePath) {
    const ext = filePath?.split('.').pop()?.toLowerCase();
    const langMap = {
        py: 'python',
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',
    };
    return langMap[ext] || null;
}

function TreeNode({node, level = 0, onFileClick, onNewFile}) {
    const [expanded, setExpanded] = useState(level < 2);
    const [showActions, setShowActions] = useState(false);

    const icon = node.type === 'directory' ? (expanded ? '📂' : '📁') : '📄';

    const handleClick = () => {
        if (node.type === 'directory') {
            setExpanded(!expanded);
        } else {
            onFileClick(node.path);
        }
    };

    return (
        <div className="tree-node">
            <div
                className={`tree-node-content ${node.type}`}
                style={{paddingLeft: `${level * 20 + 8}px`}}
                onClick={handleClick}
                onMouseEnter={() => setShowActions(true)}
                onMouseLeave={() => setShowActions(false)}
            >
                {node.type === 'directory' && (
                    <span className="tree-expand-icon">{expanded ? '▼' : '▶'}</span>
                )}
                <span className="tree-node-icon">{icon}</span>
                <span className="tree-node-name">{node.name}</span>
                {showActions && node.type === 'directory' && (
                    <button
                        className="tree-action-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onNewFile(node.path);
                        }}
                        title="新建文件"
                    >
                        ➕
                    </button>
                )}
                {showActions && node.type === 'file' && (
                    <button
                        className="tree-action-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onFileClick(node.path);
                        }}
                        title="编辑文件"
                    >
                        ✏️
                    </button>
                )}
            </div>
            {node.type === 'directory' && expanded && node.children && (
                <div className="tree-children">
                    {node.children.map((child, index) => (
                        <TreeNode
                            key={index}
                            node={child}
                            level={level + 1}
                            onFileClick={onFileClick}
                            onNewFile={onNewFile}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SkillDetail() {
    const navigate = useNavigate();
    const {skillId} = useParams();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [skill, setSkill] = useState(null);
    const [tree, setTree] = useState([]);
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // 文件编辑状态
    const [showFileModal, setShowFileModal] = useState(false);
    const [currentFilePath, setCurrentFilePath] = useState('');
    const [fileContent, setFileContent] = useState('');
    const [isNewFile, setIsNewFile] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadConfig().then(() => {
            setApiBase(getFlaskApiBase());
            setCmdbBase(getCmdbApiBase());
        });
    }, []);

    useEffect(() => {
        if (!cmdbBase) return;
        (async () => {
            try {
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=skill&resource_id=*&permission=skill:read`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看技能');
                        navigate('/skills');
                        return;
                    }
                }
            } catch (_) {}
        })();
    }, [cmdbBase]);

    useEffect(() => {
        if (!apiBase) return;
        fetchSkillDetail();
    }, [skillId, apiBase]);

    useEffect(() => {
        if (skill && skill.name) {
            fetchSkillTree(skill.name);
        }
    }, [skill]);

    const getAuthHeaders = () => {
        const token = getStoredAuthToken();
        return token ? {'Authorization': `Bearer ${token}`} : {};
    };

    const handlePermissionError = async (response, fallbackMsg) => {
        if (response.status !== 403) return false;
        const data = await response.json().catch(() => ({}));
        alert(data.error || fallbackMsg);
        return true;
    };

    const fetchSkillDetail = async () => {
        try {
            const response = await fetch(`${apiBase}/api/skills/${skillId}`, {headers: getAuthHeaders()});
            if (!response.ok) {
                if (await handlePermissionError(response, '无权限查看技能')) return;
                throw new Error('获取技能详情失败');
            }
            const data = await response.json();
            setSkill(data);
        } catch (err) {
            if (err.message && err.message !== '获取技能详情失败') return;
            setError(err.message);
        }
    };

    const fetchSkillTree = async (skillName) => {
        try {
            setLoading(true);
            const response = await fetch(`${apiBase}/api/skills/${skillId}/tree?skill_name=${encodeURIComponent(skillName)}`, {headers: getAuthHeaders()});
            if (!response.ok) {
                if (await handlePermissionError(response, '无权限查看技能目录')) return;
                throw new Error('获取目录结构失败');
            }
            const data = await response.json();
            setTree(data.tree || []);
        } catch (err) {
            if (err.message && err.message !== '获取目录结构失败') return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const handleFileClick = async (filePath) => {
        if (!skill?.name) return;
        try {
            const response = await fetch(
                `${apiBase}/api/skills/${skillId}/file?file_path=${encodeURIComponent(filePath)}&skill_name=${encodeURIComponent(skill.name)}`,
                {headers: getAuthHeaders()}
            );
            if (!response.ok) {
                if (await handlePermissionError(response, '无权限读取技能文件')) return;
                throw new Error('读取文件失败');
            }
            const data = await response.json();
            setCurrentFilePath(filePath);
            setFileContent(data.content);
            setIsNewFile(false);
            setShowFileModal(true);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleNewFile = (dirPath) => {
        setCurrentFilePath(dirPath);
        setNewFileName('');
        setFileContent('');
        setIsNewFile(true);
        setShowFileModal(true);
    };

    const handleSaveFile = async () => {
        if (!skill?.name) return;
        try {
            setSaving(true);
            let filePath = currentFilePath;
            let content = fileContent;

            if (isNewFile) {
                if (!newFileName.trim()) {
                    setError('请输入文件名');
                    return;
                }
                filePath = `${currentFilePath}/${newFileName.trim()}`;
            }

            const url = isNewFile
                ? `${apiBase}/api/skills/${skillId}/file`
                : `${apiBase}/api/skills/${skillId}/file`;

            const method = isNewFile ? 'POST' : 'PUT';

            const response = await fetch(url, {
                method,
                headers: {'Content-Type': 'application/json', ...getAuthHeaders()},
                body: JSON.stringify({file_path: filePath, content, skill_name: skill.name}),
            });

            if (!response.ok) {
                if (await handlePermissionError(response, '无权限保存技能文件')) return;
                throw new Error(isNewFile ? '创建文件失败' : '保存文件失败');
            }

            setShowFileModal(false);
            fetchSkillTree(skill.name); // 刷新目录树
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCloseModal = () => {
        setShowFileModal(false);
        setCurrentFilePath('');
        setFileContent('');
        setNewFileName('');
        setIsNewFile(false);
    };

    if (loading) {
        return (
            <div className="app-shell app-shell-page">
                <AppSidebar
                    title="技能管理"
                    subtitle="管理和配置AI技能"
                    brandIcon="bi bi-tools"
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    username={user?.username}
                    onLogout={handleLogout}
                />
                <div className="app-content skill-detail-page">
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>加载中...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="技能管理"
                subtitle="管理和配置AI技能"
                brandIcon="bi bi-tools"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
                actions={(
                    <button className="btn app-sidebar-action-btn" onClick={() => navigate('/skills')}>
                        ← 返回列表
                    </button>
                )}
            />

            <div className="app-content skill-detail-page">
                {error && (
                    <div className="error-message">
                        <span>⚠️ {error}</span>
                        <button onClick={() => setError(null)}>✕</button>
                    </div>
                )}

                {skill && (
                    <div className="skill-detail-header">
                        <div className="skill-detail-title">
                            <span className="skill-detail-icon">{skill.icon || '🎯'}</span>
                            <div>
                                <h1>{skill.name}</h1>
                                <p className="skill-detail-desc">{skill.description || '暂无描述'}</p>
                            </div>
                        </div>
                        <div className="skill-detail-meta">
              <span className={`skill-status ${skill.status}`}>
                {skill.status === 'active' ? '启用' : '禁用'}
              </span>
                            <span className="skill-version">v{skill.version}</span>
                            {skill.category && (
                                <span className="skill-category-tag">{skill.category}</span>
                            )}
                        </div>
                    </div>
                )}

                <div className="skill-tree-container">
                    <div className="skill-tree-header">
                        <h2>📁 目录结构</h2>
                        <p className="skill-tree-hint">点击文件夹展开/折叠，点击文件编辑，悬停显示操作按钮</p>
                    </div>
                    <div className="skill-tree">
                        {tree.length === 0 ? (
                            <div className="tree-empty">
                                <p>暂无目录结构</p>
                            </div>
                        ) : (
                            tree.map((node, index) => (
                                <TreeNode
                                    key={index}
                                    node={node}
                                    onFileClick={handleFileClick}
                                    onNewFile={handleNewFile}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* 文件编辑模态框 */}
            <Modal open={showFileModal} onClose={handleCloseModal} width={800} icon={<i className="bi bi-tools"/>}>
                <div className="file-editor-modal">
                    <h2>{isNewFile ? '新建文件' : '编辑文件'}</h2>
                    {isNewFile && (
                        <div className="form-group">
                            <label>文件名</label>
                            <input
                                type="text"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                placeholder="例如: test.py"
                                className="form-input"
                            />
                        </div>
                    )}
                    {!isNewFile && (
                        <div className="file-path-display">
                            <span>📄 {currentFilePath}</span>
                        </div>
                    )}
                    <div className="form-group">
                        <label>文件内容</label>
                        {currentFilePath.split('/').pop() === 'SKILL.md' ? (
                            <textarea
                                value={fileContent}
                                onChange={(e) => setFileContent(e.target.value)}
                                rows={15}
                                className="form-textarea"
                                placeholder="输入文件内容..."
                            />
                        ) : (
                            <CodeEditor
                                value={fileContent}
                                onChange={(e) => setFileContent(e.target.value)}
                                type={getLanguageType(currentFilePath)}
                                placeholder="输入文件内容..."
                                minHeight="360px"
                            />
                        )}
                    </div>
                    <div className="modal-actions">
                        <button className="btn btn-default" onClick={handleCloseModal}>
                            取消
                        </button>
                        <button
                            className="btn btn-default"
                            onClick={handleSaveFile}
                            disabled={saving}
                        >
                            <i className="bi bi-pencil-square"></i>
                            {saving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            </Modal>

        </div>
    );
}
