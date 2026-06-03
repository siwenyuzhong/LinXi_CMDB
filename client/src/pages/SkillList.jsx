import React, {useState, useEffect} from 'react';
import {usePersistedState} from '../hooks';
import {useNavigate} from 'react-router-dom';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import Modal from '../components/Modal';
import {loadConfig, getFlaskApiBase, getCmdbApiBase} from '../config';
import {getStoredAuthToken} from '../api';

export default function SkillList() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingSkill, setEditingSkill] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [apiBase, setApiBase] = useState('');
    const [cmdbBase, setCmdbBase] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [currentPage, setCurrentPage] = usePersistedState('skillListPage', 1);
    const [pageSize, setPageSize] = usePersistedState('skillListPageSize', 5);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        icon: '🦞',
        category: '',
        version: '1.0.0',
        status: 'active',
    });

    const iconOptions = ['🦞', '🎯', '⚡', '🔧', '📊', '🤖', '💬', '📝', '🔍', '🎨', '🛠️', '📈', '🌐', '🔒', '💡', '🚀'];
    const categoryOptions = ['数据分析', '文本处理', '图像处理', '自动化', '通信', '开发工具', '龙虾', '其他'];

    const incrementVersion = (version) => {
        const parts = (version || '1.0.0').split('.');
        if (parts.length >= 3) {
            const patch = parseInt(parts[2], 10);
            return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`;
        }
        return `${version}.1`;
    };

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
                        alert('⚠️ 权限不足: 无权限查看技能列表');
                        setLoading(false);
                        return;
                    }
                }
            } catch (_) {}
        })();
    }, [cmdbBase]);

    useEffect(() => {
        if (apiBase) fetchSkills();
    }, [apiBase]);

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

    const fetchSkills = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${apiBase}/api/skills`, {headers: getAuthHeaders()});
            if (!response.ok) {
                if (await handlePermissionError(response, '无权限查看技能列表')) { setLoading(false); return; }
                throw new Error('获取技能列表失败');
            }
            const data = await response.json();
            setSkills(Array.isArray(data) ? data : (data.items || []));
        } catch (err) {
            if (err.message && err.message !== '获取技能列表失败') return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (skill = null) => {
        if (skill) {
            setEditingSkill(skill);
            setFormData({
                name: skill.name,
                description: skill.description || '',
                icon: skill.icon || '🦞',
                category: skill.category || '',
                version: incrementVersion(skill.version || '1.0.0'),
                status: skill.status || 'active',
            });
        } else {
            setEditingSkill(null);
            setFormData({
                name: '',
                description: '',
                icon: '🦞',
                category: '',
                version: '1.0.0',
                status: 'active',
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingSkill(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editingSkill
                ? `${apiBase}/api/skills/${editingSkill.id}`
                : `${apiBase}/api/skills`;
            const method = editingSkill ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                if (await handlePermissionError(response, editingSkill ? '无权限编辑技能' : '无权限创建技能')) return;
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || '操作失败');
            }

            handleCloseModal();
            fetchSkills();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDelete = async (skillId) => {
        if (!confirm('确定要删除这个技能吗？')) {
            return;
        }

        try {
            const response = await fetch(`${apiBase}/api/skills/${skillId}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            });

            if (!response.ok) {
                if (await handlePermissionError(response, '无权限删除技能')) return;
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || '删除失败');
            }

            fetchSkills();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const skillsList = Array.isArray(skills) ? skills : [];
    const filteredSkills = skillsList.filter(skill => {
        const matchesSearch = skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (skill.description && skill.description.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesCategory = selectedCategory === 'all' || skill.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const totalPages = Math.max(1, Math.ceil(filteredSkills.length / pageSize));
    const paginatedSkills = filteredSkills.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const categories = ['all', ...new Set(skills.map(s => s.category).filter(Boolean))];

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

            <div className="app-content skill-list-page">
                <div className="skill-sticky-header">
                    <div className="skill-filters">


                        <div className="skill-search-box">
                            <span className="search-icon">
                                <i className="bi bi-search"></i>
                            </span>
                            <input
                                type="text"
                                placeholder="搜索技能..."
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="skill-search-input"
                            />
                        </div>

                        <button className="btn btn-default" onClick={() => handleOpenModal()}>
                            <i className="bi bi-plus-circle"></i>
                            新建技能
                        </button>

                        <div className="skill-category-tabs">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    className={`category-tab ${selectedCategory === cat ? 'active' : ''}`}
                                    onClick={() => {
                                        setSelectedCategory(cat);
                                        setCurrentPage(1);
                                    }}
                                >
                                    {cat === 'all' ? '全部' : cat}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="skill-scroll-content">
                {loading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>加载中...</p>
                    </div>
                ) : (
                    <>
                        {error && (
                            <div className="error-message">
                                <span>⚠️ {error}</span>
                                <button onClick={() => setError(null)}>✕</button>
                            </div>
                        )}



                        {filteredSkills.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">🦞</div>
                                <h3>暂无 技能 数据</h3>
                                <p>点击上方按钮添加您的第一个技能</p>
                            </div>
                        ) : (
                            <div className="skill-list-container">
                                <div className="skill-card-list">
                                    {paginatedSkills.map((skill, index) => (
                                        <div key={skill.id} className="skill-item" style={{animationDelay: `${0.04 * index}s`}}>
                                            <div className="skill-item-row-top">
                                                <span className="skill-item-name" onClick={() => navigate(`/skills/${skill.id}`)}>
                                                    {skill.icon || '🦞'} {skill.name}
                                                </span>
                                                <span className={`skill-item-badge ${skill.status === 'active' ? 'badge-green' : 'badge-red'}`}>
                                                    {skill.status === 'active' ? '启用' : '禁用'}
                                                </span>
                                                {skill.category && (
                                                    <span className="skill-item-category">{skill.category}</span>
                                                )}
                                            </div>
                                            <div className="skill-item-row-bottom">
                                                <span className="skill-item-desc">{skill.description || '暂无描述'}</span>
                                                <div className="skill-item-meta">
                                                    <div className="skill-item-meta-cell">
                                                        <span className="meta-label">版本</span>
                                                        <span className="meta-val">{skill.version || '1.0.0'}</span>
                                                    </div>
                                                    <div className="skill-item-meta-cell">
                                                        <span className="meta-label">创建者</span>
                                                        <span className="meta-val">{skill.username || '—'}</span>
                                                    </div>
                                                    <div className="skill-item-meta-cell">
                                                        <span className="meta-label">创建时间</span>
                                                        <span className="meta-val">{skill.created_at ? new Date(new Date(skill.created_at).getTime() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—'}</span>
                                                    </div>
                                                    <div className="skill-item-meta-cell skill-item-actions">
                                                        <button className="btn-icon" onClick={() => handleOpenModal(skill)} title="编辑">
                                                            <i className="bi bi-pencil-fill"/>
                                                        </button>
                                                        <button className="btn-icon btn-danger" onClick={() => handleDelete(skill.id)} title="删除">
                                                            <i className="bi bi-trash-fill"/>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
                </div>

                {!loading && filteredSkills.length > 0 && (
                    <div className="pagination skill-fixed-pagination">
                        <span className="pagination-info">共 {filteredSkills.length} 条，第 {currentPage}/{totalPages} 页</span>
                        <select value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}>
                            <option value={5}>5 条</option>
                            <option value={10}>10 条</option>
                            <option value={20}>20 条</option>
                            <option value={50}>50 条</option>
                        </select>
                        <div>
                            <button className="btn-sm" disabled={currentPage <= 1}
                                    onClick={() => setCurrentPage(p => p - 1)}>上一页
                            </button>
                            <button className="btn-sm" style={{marginLeft: 8}}
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}>下一页
                            </button>
                        </div>
                    </div>
                )}

                <Modal
                    open={showModal}
                    onClose={handleCloseModal}
                    title={editingSkill ? '编辑技能' : '新建技能'}
                    width={520}
                    icon={<i className="bi bi-tools"/>}
                >
                    <form onSubmit={handleSubmit} className="skill-form">
                        <div className="form-group">
                            <label htmlFor="skill-icon">图标</label>
                            <div className="icon-selector">
                                {iconOptions.map(icon => (
                                    <button
                                        key={icon}
                                        type="button"
                                        className={`icon-option ${formData.icon === icon ? 'selected' : ''}`}
                                        onClick={() => setFormData({...formData, icon})}
                                    >
                                        {icon}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label htmlFor="skill-name">名称 *</label>
                            <input
                                id="skill-name"
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({...formData, name: e.target.value})}
                                placeholder="例如: data_analysis, code-review"
                                required
                                pattern="[a-zA-Z0-9_-]+"
                                title="只能使用英文字母、数字、下划线(_)和连字符(-)"
                            />
                            <span className="form-hint">只能使用英文字母、数字、下划线(_)和连字符(-)</span>
                        </div>
                        <div className="form-group">
                            <label htmlFor="skill-description">描述</label>
                            <textarea
                                id="skill-description"
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                                placeholder="请输入技能描述"
                                rows={3}
                            />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="skill-category">分类</label>
                                <select
                                    id="skill-category"
                                    value={formData.category}
                                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                                >
                                    <option value="">选择分类</option>
                                    {categoryOptions.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="skill-version">版本</label>
                                <input
                                    id="skill-version"
                                    type="text"
                                    value={formData.version}
                                    readOnly={!!editingSkill}
                                    onChange={(e) => setFormData({...formData, version: e.target.value})}
                                    placeholder="例如：1.0.0"
                                />
                                {editingSkill && <span className="form-hint">保存修改后版本号将自动更新</span>}
                            </div>
                        </div>
                        <div className="form-group">
                            <label htmlFor="skill-status">状态</label>
                            <div className="status-toggle">
                                <button
                                    type="button"
                                    className={`status-btn ${formData.status === 'active' ? 'active' : ''}`}
                                    onClick={() => setFormData({...formData, status: 'active'})}
                                >
                                    <i className="bi bi-check-circle"></i> 启用
                                </button>
                                <button
                                    type="button"
                                    className={`status-btn ${formData.status === 'inactive' ? 'active' : ''}`}
                                    onClick={() => setFormData({...formData, status: 'inactive'})}
                                >
                                    <i className="bi bi-x-octagon"></i> 禁用
                                </button>
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn" onClick={handleCloseModal}>
                                取消
                            </button>
                            <button type="submit" className="btn btn-default">
                                <i className="bi bi-pencil-square"></i>
                                {editingSkill ? '保存修改' : '创建技能'}
                            </button>
                        </div>
                    </form>
                </Modal>
            </div>
        </div>
    );
}
