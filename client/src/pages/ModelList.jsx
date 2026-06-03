import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import AppSidebar from '../components/AppSidebar';
import Modal from '../components/Modal';

const FIELD_TYPES = [
    {value: 'string', label: '字符串'},
    {value: 'number', label: '数字'},
    {value: 'float', label: '浮点数'},
    {value: 'boolean', label: '布尔值'},
    {value: 'date', label: '日期'},
    {value: 'datetime', label: '日期时间'},
    {value: 'text', label: '长文本'},
    {value: 'json', label: 'JSON'},
    {value: 'struct', label: '结构体'},
    {value: 'array', label: '数组'},
    {value: 'enum', label: '枚举'},
    {value: 'relation', label: '关联关系'},
];

const RELATION_TYPES = [
    {value: 'oneToOne', label: '一对一', desc: 'A 与 B 一一对应，外键放在任一方；对方已绑定则不可重复占用。'},
    {value: 'oneToMany', label: '一对多', desc: 'A 可关联多条 B；外键放在「多」方 B 上，B 一旦被 A 关联就不能再被其他 A 占用。'},
    {value: 'manyToOne', label: '多对一', desc: '多条 A 关联同一条 B；外键放在「单」方 A 上，A 一旦选定 B 就不能再切换。'},
    {value: 'manyToMany', label: '多对多', desc: 'A 与 B 互相可多选；通常不强制外键字段，由反向关系承载。'},
];

const RELATION_TYPE_VALUES = RELATION_TYPES.map((item) => item.value);

function isMultiRelationType(value) {
    return value === 'oneToMany' || value === 'manyToOne' || value === 'manyToMany';
}

function getFkOwnerSide(relationType) {
    switch (relationType) {
        case 'oneToOne':
            return 'single';
        case 'oneToMany':
            return 'many';
        case 'manyToOne':
            return 'one';
        case 'manyToMany':
            return 'none';
        default:
            return 'single';
    }
}

function createEmptyField() {
    return {
        id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        label: '',
        type: 'string',
        required: false,
        unique: false,
        default_value: '',
        description: '',
        enum_options: [],
        relation: {
            model_id: '',
            relation_type: 'oneToOne',
            foreign_key: '',
            display_field: '',
            auto_generated: false,
            source_model_id: '',
            source_model_name: '',
            source_field_id: '',
            source_field_name: '',
        },
    };
}

const SYSTEM_FIELD_CONFIGS = [
    {
        id: 'system-status',
        name: 'status',
        label: '数据状态',
        type: 'boolean',
        required: true,
        unique: false,
        default_value: true,
        description: '系统默认字段，数据入库时默认有效。',
        enum_options: [],
        relation: null,
    },
    {
        id: 'system-createTime',
        name: 'createTime',
        label: '创建时间',
        type: 'datetime',
        required: false,
        unique: false,
        default_value: '',
        description: '系统默认字段，入库时自动写入，不可修改。',
        enum_options: [],
        relation: null,
    },
    {
        id: 'system-updated_at',
        name: 'updated_at',
        label: '更新时间',
        type: 'datetime',
        required: false,
        unique: false,
        default_value: '',
        description: '系统字段，数据变更时自动更新。',
        enum_options: [],
        relation: null,
    },
    {
        id: 'system-creator',
        name: 'creator',
        label: '创建人',
        type: 'string',
        required: false,
        unique: false,
        default_value: '',
        description: '系统默认字段，自动记录当前登录用户。',
        enum_options: [],
        relation: null,
    },
];

function isSystemField(field) {
    return ['status', 'createTime', 'creator', 'updated_at'].includes(String(field?.name || '').trim());
}

const systemFieldOrder = Object.fromEntries(
    SYSTEM_FIELD_CONFIGS.map((c, i) => [c.name, i])
);

function sortSystemFields(fields) {
    return [...fields].sort((a, b) => {
        const ai = systemFieldOrder[a.name] ?? 999;
        const bi = systemFieldOrder[b.name] ?? 999;
        return ai - bi;
    });
}

const EMPTY_FORM = {
    id: '',
    model_id: '',
    name: '',
    description: '',
    category: '',
    fields: [createEmptyField()],
};

function formatDateTime(value) {
    if (!value) return '—';

    const normalizedValue = String(value).includes('T')
        ? String(value)
        : String(value).replace(' ', 'T');
    const date = new Date(normalizedValue);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString('zh-CN');
}

function getTypeLabel(type) {
    return FIELD_TYPES.find((item) => item.value === type)?.label || type;
}

function getRelationTypeLabel(type) {
    return RELATION_TYPES.find((item) => item.value === type)?.label || type;
}

function getRelationTypeDesc(type) {
    return RELATION_TYPES.find((item) => item.value === type)?.desc || '';
}

function getFkHint(relationType, side) {
    const owner = getFkOwnerSide(relationType);
    if (owner === 'none') {
        return '多对多关系无需显式外键字段。';
    }
    if (side === 'source') {
        if (owner === 'single') {
            return '一对一关系：当前字段即为外键，请在「外键字段」中填写本字段名（如本字段名即 customer_id）。';
        }
        if (owner === 'many') {
            return '当前 A 是一对多的「一」方：外键会落在 B（多）方，自动由对端反向字段承载，请填写对端 B 侧的外键字段名。';
        }
        if (owner === 'one') {
            return '当前 A 是多对一的「多」方：外键就放在 A 自身，请在「外键字段」中填写本字段名。';
        }
    } else {
        if (owner === 'single') {
            return '对方一对一时：本反向字段为外键。';
        }
        if (owner === 'many') {
            return '对方一对多时：外键放在「多」方，即本字段；请填写本反向字段名。';
        }
        if (owner === 'one') {
            return '对方多对一时：外键放在「单」方，由源关系承载；本字段可仅作展示用。';
        }
    }
    return '';
}

function normalizeFieldForSubmit(field) {
    const next = {
        id: field.id,
        name: field.name.trim(),
        label: field.label.trim(),
        type: field.type,
        required: Boolean(field.required),
        unique: Boolean(field.unique),
        default_value: field.default_value,
        description: field.description.trim(),
        enum_options: field.enum_options || [],
    };

    if (field.type === 'relation') {
        next.relation = {
            model_id: field.relation?.model_id || '',
            relation_type: field.relation?.relation_type || 'oneToOne',
            foreign_key: (field.relation?.foreign_key || '').trim(),
            display_field: (field.relation?.display_field || '').trim(),
            auto_generated: Boolean(field.relation?.auto_generated),
            source_model_id: field.relation?.source_model_id || '',
            source_model_name: field.relation?.source_model_name || '',
            source_field_id: field.relation?.source_field_id || '',
            source_field_name: field.relation?.source_field_name || '',
        };
    }

    return next;
}

function createFormFromModel(model) {
    return {
        id: model.id,
        model_id: model.model_id || model.id || '',
        name: model.name || '',
        description: model.description || '',
        category: model.category || '',
        fields: (model.fields || []).length > 0
            ? model.fields.map((field) => ({
                ...createEmptyField(),
                ...field,
                enum_options: field.enum_options || [],
                relation: {
                    model_id: field.relation?.model_id || '',
                    relation_type: field.relation?.relation_type || 'oneToOne',
                    foreign_key: field.relation?.foreign_key || '',
                    display_field: field.relation?.display_field || '',
                    auto_generated: Boolean(field.relation?.auto_generated),
                    source_model_id: field.relation?.source_model_id || '',
                    source_model_name: field.relation?.source_model_name || '',
                    source_field_id: field.relation?.source_field_id || '',
                    source_field_name: field.relation?.source_field_name || '',
                },
            }))
            : [createEmptyField()],
    };
}

export default function ModelList() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [models, setModels] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [editingModelId, setEditingModelId] = useState('');
    const [selectedModel, setSelectedModel] = useState(null);
    const pendingModelRef = useRef(null);
    const navListRef = useRef(null);
    const savedScrollRef = useRef(0);
    const [form, setForm] = useState(EMPTY_FORM);
    const [errorMessage, setErrorMessage] = useState('');
    const [deleteAlert, setDeleteAlert] = useState({open: false, message: ''});
    const [isEditorVisible, setIsEditorVisible] = useState(false);
    const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
    const [editingFieldId, setEditingFieldId] = useState('');
    const [fieldDraft, setFieldDraft] = useState(createEmptyField());
    const [enumInputValue, setEnumInputValue] = useState('');
    const [modelSearchQuery, setModelSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState(() => {
        const saved = localStorage.getItem('modelListCollapsedGroups');
        return saved ? JSON.parse(saved) : {};
    });
    useEffect(() => {
        localStorage.setItem('modelListCollapsedGroups', JSON.stringify(collapsedGroups));
    }, [collapsedGroups]);

    const MODEL_NAV_SCROLL_KEY = 'modelListNavScrollTop';
    const MODEL_SELECTED_KEY = 'modelListSelectedModelId';
    useEffect(() => {
        if (models.length > 0) {
            const raf = requestAnimationFrame(() => {
                if (navListRef.current) {
                    try {
                        const saved = localStorage.getItem(MODEL_NAV_SCROLL_KEY);
                        if (saved) {
                            navListRef.current.scrollTop = parseInt(saved, 10) || 0;
                        } else {
                            const active = navListRef.current.querySelector('.model-nav-item.active');
                            if (active) active.scrollIntoView({block: 'nearest'});
                        }
                    } catch {
                    }
                }
            });
            return () => cancelAnimationFrame(raf);
        }
    }, [models]);
    useEffect(() => {
        const el = navListRef.current;
        if (!el) return;
        const handler = () => {
            try {
                localStorage.setItem(MODEL_NAV_SCROLL_KEY, String(el.scrollTop));
            } catch {
            }
        };
        el.addEventListener('scroll', handler, {passive: true});
        return () => el.removeEventListener('scroll', handler);
    }, []);
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (navListRef.current) {
                try {
                    localStorage.setItem(MODEL_NAV_SCROLL_KEY, String(navListRef.current.scrollTop));
                } catch {
                }
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);
    useEffect(() => {
        if (selectedModel) {
            try {
                localStorage.setItem(MODEL_SELECTED_KEY, selectedModel.id);
            } catch {
            }
        }
    }, [selectedModel]);
    const saveNavScroll = useCallback(() => {
        if (navListRef.current) {
            try {
                localStorage.setItem(MODEL_NAV_SCROLL_KEY, String(navListRef.current.scrollTop));
            } catch {
            }
        }
    }, []);

    const filteredModels = useMemo(() => {
        const q = modelSearchQuery.trim().toLowerCase();
        if (!q) return models;
        return models.filter((m) =>
            m.name.toLowerCase().includes(q) ||
            (m.model_id || '').toLowerCase().includes(q)
        );
    }, [models, modelSearchQuery]);

    const availableRelationModels = useMemo(() => {
        return models.filter((item) => item.id !== editingModelId);
    }, [models, editingModelId]);

    const orderedFormFields = useMemo(() => {
        const standardFields = form.fields.filter((field) => !isSystemField(field));
        const systemFields = form.fields.filter((field) => isSystemField(field));
        return [...standardFields, ...systemFields];
    }, [form.fields]);

    const loadData = useCallback(async () => {
        try {
            setErrorMessage('');
            const result = await api.listModels({per_page: 10000});
            setModels(result);
            const savedId = localStorage.getItem(MODEL_SELECTED_KEY);
            const savedModel = savedId ? result.find((item) => item.id === savedId) : null;
            setSelectedModel((prev) => {
                if (prev) return result.find((item) => item.id === prev.id) || null;
                return savedModel || (result.length > 0 ? result[0] : null);
            });
        } catch (error) {
            console.error(error);
            setModels([]);
            setErrorMessage(error.message || '加载模型定义失败');
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!isEditorVisible) {
            requestAnimationFrame(() => {
                if (navListRef.current) {
                    navListRef.current.scrollTop = savedScrollRef.current;
                }
            });
        }
    }, [isEditorVisible]);

    const closeFieldModal = useCallback(() => {
        setIsFieldModalOpen(false);
        setEditingFieldId('');
        setFieldDraft(createEmptyField());
        setEnumInputValue('');
    }, []);

    const resetForm = useCallback(() => {
        setForm({
            ...EMPTY_FORM,
            fields: [createEmptyField()],
        });
        setEditingModelId('');
        setSubmitting(false);
        setIsEditorVisible(false);
        if (pendingModelRef.current) {
            setSelectedModel(pendingModelRef.current);
            pendingModelRef.current = null;
        }
        closeFieldModal();
    }, [closeFieldModal]);

    const openCreateModal = () => {
        setForm({
            ...EMPTY_FORM,
            fields: [createEmptyField(), ...SYSTEM_FIELD_CONFIGS.map((field) => ({...field}))],
        });
        setEditingModelId('');
        setIsEditorVisible(true);
        setSelectedModel(null);
        setErrorMessage('');
        closeFieldModal();
    };

    const openEditModal = (model) => {
        if (navListRef.current) {
            savedScrollRef.current = navListRef.current.scrollTop;
        }
        setForm(createFormFromModel(model));
        pendingModelRef.current = model;
        setSelectedModel(null);
        setEditingModelId(model.id);
        setIsEditorVisible(true);
        setErrorMessage('');
        closeFieldModal();
    };

    const updateField = (fieldId, updater) => {
        setForm((prev) => ({
            ...prev,
            fields: prev.fields.map((field) => {
                if (field.id !== fieldId) return field;
                return typeof updater === 'function' ? updater(field) : {...field, ...updater};
            }),
        }));
    };

    const openCreateFieldModal = () => {
        setEditingFieldId('');
        setFieldDraft(createEmptyField());
        setIsFieldModalOpen(true);
    };

    const openEditFieldModal = (field) => {
        setEditingFieldId(field.id);
        setFieldDraft({
            ...createEmptyField(),
            ...field,
            enum_options: field.enum_options || [],
            relation: {
                model_id: field.relation?.model_id || '',
                relation_type: field.relation?.relation_type || 'oneToOne',
                foreign_key: field.relation?.foreign_key || '',
                display_field: field.relation?.display_field || '',
                auto_generated: Boolean(field.relation?.auto_generated),
                source_model_id: field.relation?.source_model_id || '',
                source_model_name: field.relation?.source_model_name || '',
                source_field_id: field.relation?.source_field_id || '',
                source_field_name: field.relation?.source_field_name || '',
            },
        });
        setIsFieldModalOpen(true);
    };

    const removeField = (fieldId) => {
        setForm((prev) => {
            if (prev.fields.length === 1) return prev;
            return {
                ...prev,
                fields: prev.fields.filter((field) => field.id !== fieldId),
            };
        });
    };

    const moveField = (fieldId, direction) => {
        setForm((prev) => {
            const idx = prev.fields.findIndex((f) => f.id === fieldId);
            if (idx === -1) return prev;
            const target = idx + direction;
            if (target < 0 || target >= prev.fields.length) return prev;
            const fields = [...prev.fields];
            [fields[idx], fields[target]] = [fields[target], fields[idx]];
            return {...prev, fields};
        });
    };

    const updateFieldDraft = (updater) => {
        setFieldDraft((prev) => (typeof updater === 'function' ? updater(prev) : {...prev, ...updater}));
    };

    const addEnumOption = () => {
        const trimmed = enumInputValue.trim();
        if (!trimmed) return;
        setFieldDraft((prev) => {
            const currentOptions = prev.enum_options || [];
            if (currentOptions.includes(trimmed)) return prev;
            return {
                ...prev,
                enum_options: [...currentOptions, trimmed],
            };
        });
        setEnumInputValue('');
    };

    const removeEnumOption = (optionToRemove) => {
        setFieldDraft((prev) => ({
            ...prev,
            enum_options: (prev.enum_options || []).filter((option) => option !== optionToRemove),
        }));
    };

    const saveFieldDraft = () => {
        const trimmedName = fieldDraft.name.trim();
        const trimmedLabel = fieldDraft.label.trim();
        const nextDraft = {
            ...fieldDraft,
            name: trimmedName,
            label: trimmedLabel,
            description: fieldDraft.description.trim(),
            default_value: fieldDraft.default_value,
            relation: fieldDraft.type === 'relation'
                ? {
                    model_id: fieldDraft.relation?.model_id || '',
                    relation_type: fieldDraft.relation?.relation_type || 'oneToOne',
                    foreign_key: (fieldDraft.relation?.foreign_key || '').trim(),
                    display_field: (fieldDraft.relation?.display_field || '').trim(),
                    auto_generated: Boolean(fieldDraft.relation?.auto_generated),
                    source_model_id: fieldDraft.relation?.source_model_id || '',
                    source_model_name: fieldDraft.relation?.source_model_name || '',
                    source_field_id: fieldDraft.relation?.source_field_id || '',
                    source_field_name: fieldDraft.relation?.source_field_name || '',
                }
                : {
                    model_id: '',
                    relation_type: 'oneToOne',
                    foreign_key: '',
                    display_field: '',
                    auto_generated: false,
                    source_model_id: fieldDraft.relation?.source_model_id || '',
                    source_model_name: fieldDraft.relation?.source_model_name || '',
                    source_field_id: fieldDraft.relation?.source_field_id || '',
                    source_field_name: fieldDraft.relation?.source_field_name || '',
                },
        };

        if (!trimmedName) {
            setErrorMessage('字段名不能为空');
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
            setErrorMessage('字段名只能包含字母、数字和下划线，且不能以数字开头');
            return;
        }

        if (nextDraft.type === 'relation' && !nextDraft.relation.model_id) {
            setErrorMessage('关系字段必须选择关联模型');
            return;
        }

        if (nextDraft.type === 'relation') {
            const relType = nextDraft.relation.relation_type;
            if (!RELATION_TYPE_VALUES.includes(relType)) {
                setErrorMessage(`关系类型「${relType}」不受支持`);
                return;
            }
            const fk = nextDraft.relation.foreign_key;
            const owner = getFkOwnerSide(relType);
            if (owner !== 'none' && !fk) {
                if (owner === 'many') {
                    setErrorMessage('一对多关系：必须在「外键字段」填写对端 B（多）方实际承载外键的字段名。');
                } else if (owner === 'one') {
                    setErrorMessage('多对一关系：必须在「外键字段」填写当前 A（多）方承载外键的字段名。');
                } else {
                    setErrorMessage('一对一关系：必须在「外键字段」填写承载外键的字段名。');
                }
                return;
            }
            if (fk && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fk)) {
                setErrorMessage('外键字段名只能包含字母、数字和下划线，且不能以数字开头');
                return;
            }
        }

        const duplicateField = form.fields.find((field) => field.name === trimmedName && field.id !== editingFieldId);
        if (duplicateField) {
            setErrorMessage(`字段名称 ${trimmedName} 已存在`);
            return;
        }

        setForm((prev) => {
            if (editingFieldId) {
                return {
                    ...prev,
                    fields: prev.fields.map((field) => (field.id === editingFieldId ? nextDraft : field)),
                };
            }

            return {
                ...prev,
                fields: [...prev.fields, nextDraft],
            };
        });

        setErrorMessage('');
        closeFieldModal();
    };

    const handleSubmit = async () => {
        const payload = {
            model_id: form.model_id.trim(),
            name: form.name.trim(),
            description: form.description.trim(),
            category: form.category.trim(),
            fields: form.fields.map(normalizeFieldForSubmit),
        };

        if (!payload.model_id) {
            setErrorMessage('模型 ID 不能为空');
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(payload.model_id)) {
            setErrorMessage('模型 ID 只能包含字母、数字和下划线，且不能以数字开头');
            return;
        }

        if (!payload.name) {
            setErrorMessage('模型名称不能为空');
            return;
        }

        if (payload.fields.length === 0) {
            setErrorMessage('至少需要定义一个字段');
            return;
        }

        setSubmitting(true);
        setErrorMessage('');

        try {
            if (editingModelId) {
                await api.updateModel(editingModelId, payload);
            } else {
                await api.createModel(payload);
            }

            resetForm();
            await loadData();
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '保存模型失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (modelId, modelName) => {
        const msg = `确定删除模型「${modelName || ''}」吗？`;
        if (!window.confirm(msg)) return;
        try {
            setErrorMessage('');
            setDeleteAlert({open: false, message: ''});
            await api.deleteModel(modelId);
            if (pendingModelRef.current?.id === modelId) {
                pendingModelRef.current = null;
            }
            setSelectedModel((prev) => (prev?.id === modelId ? null : prev));
            if (editingModelId === modelId) {
                resetForm();
            }
            await loadData();
        } catch (error) {
            console.error(error);
            setDeleteAlert({open: true, message: error.message || '删除模型失败'});
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="模型配置"
                subtitle="自定义模型字段与关系"
                brandIcon="bi bi-pencil-square"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content workflow-list-page task-page model-page">
                {isEditorVisible && (
                    <div className="page-hero-card model-editor-panel">
                        {errorMessage && (
                            <div className="task-error-banner">{errorMessage}</div>
                        )}
                        <div className="model-editor-summary">
                            <div className="model-editor-header">
                                <div>
                                    <h3>{editingModelId ? '编辑模型定义' : '新建模型定义'}</h3>
                                    <p>模型基础信息直接展示在页面中，字段通过弹窗逐条添加或编辑。</p>
                                </div>
                                <div className="task-card-actions model-editor-actions">
                                    <button className="btn" onClick={resetForm} disabled={submitting}>取消</button>
                                    <button className="btn btn-default" onClick={handleSubmit} disabled={submitting}>
                                        <i className="bi bi-pencil-square"></i>
                                        {submitting ? '保存中...' : '保存模型'}
                                    </button>
                                </div>
                            </div>

                            <div className="model-editor-body">
                                <div className="model-editor-main">
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>模型 ID</label>
                                            <input
                                                autoFocus
                                                value={form.model_id}
                                                onChange={(event) => setForm((prev) => ({
                                                    ...prev,
                                                    model_id: event.target.value
                                                }))}
                                                placeholder="例如：customer"
                                            />
                                            <div className="form-hint">仅支持字母、数字、下划线，且不能以数字开头。</div>
                                        </div>

                                        <div className="form-group">
                                            <label>模型名称</label>
                                            <input
                                                value={form.name}
                                                onChange={(event) => setForm((prev) => ({
                                                    ...prev,
                                                    name: event.target.value
                                                }))}
                                                placeholder="例如：客户"
                                            />
                                        </div>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>模型分类</label>
                                            <input
                                                value={form.category}
                                                list="category-options"
                                                onChange={(event) => setForm((prev) => ({
                                                    ...prev,
                                                    category: event.target.value
                                                }))}
                                                placeholder="例如：业务数据"
                                            />
                                            <datalist id="category-options">
                                                {[...new Set(models.map((m) => m.category).filter(Boolean))].map((cat) => (
                                                    <option key={cat} value={cat}/>
                                                ))}
                                            </datalist>
                                        </div>

                                        <div className="form-group">
                                            <label>模型描述</label>
                                            <input
                                                type="text"
                                                value={form.description}
                                                onChange={(event) => setForm((prev) => ({
                                                    ...prev,
                                                    description: event.target.value
                                                }))}
                                                placeholder="# 描述这个模型的业务用途..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="model-editor-side">
                                    <div className="model-editor-stat-card">
                                        <span className="model-detail-summary-label">当前编辑</span>
                                        <strong>{form.name || '未命名模型'}</strong>
                                        <div className="task-card-workflow">模型 ID：{form.model_id || '未填写'}</div>
                                        <div className="task-card-workflow">字段数：{form.fields.length}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="model-field-section model-inline-field-section">
                            <div className="model-field-section-header">
                                <div>
                                    <div className="model-field-section-title">字段定义</div>
                                    <div className="form-hint">点击“添加字段”或“编辑”时再弹出字段录入窗口。</div>
                                </div>
                                <button className="btn btn-sm btn-primary" onClick={openCreateFieldModal} type="button">
                                    + 添加字段
                                </button>
                            </div>

                            <div className="model-inline-field-list">
                                {orderedFormFields.length === 0 && (
                                    <div className="model-detail-empty">当前模型暂无字段定义，请先添加字段。</div>
                                )}

                                {(() => {
                                    const standardFields = orderedFormFields.filter(f => !isSystemField(f));
                                    const systemFields = sortSystemFields(orderedFormFields.filter(f => isSystemField(f)));
                                    return <>
                                        {standardFields.map((field, index) => {
                                            const isAutoGenerated = Boolean(field.relation?.auto_generated);
                                            const isBuiltInField = false;
                                            const relatedModelName = models.find((item) => item.id === field.relation?.model_id || item.model_id === field.relation?.model_id)?.name;
                                            const sourceModelName = field.relation?.source_model_name
                                                || models.find((item) => item.id === field.relation?.source_model_id || item.model_id === field.relation?.source_model_id)?.name
                                                || '—';

                                            return (
                                                <div key={field.id} className="model-form-field-card model-inline-field-card">
                                                    <div className="model-form-field-card-header">
                                                        <div>
                                                            <strong>{field.label || field.name || `字段 ${index + 1}`}</strong>
                                                            <div className="task-card-workflow">字段名：{field.name || '未填写'}</div>
                                                        </div>
                                                        <div className="model-detail-field-tags">
                                                            <span className="model-field-chip-type">{getTypeLabel(field.type)}</span>
                                                            {field.type === 'relation' && (
                                                                <span className="model-field-chip-flag">{getRelationTypeLabel(field.relation?.relation_type)}</span>
                                                            )}
                                                            {field.required && <span className="model-field-chip-flag">必填</span>}
                                                            {field.unique && <span className="model-field-chip-flag">唯一</span>}
                                                            {isAutoGenerated && <span className="model-field-chip-flag">自动生成</span>}
                                                        </div>
                                                    </div>

                                                    <div className="model-detail-field-grid">
                                                        <div><span className="model-detail-field-label">显示名</span><strong>{field.label || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">默认值</span><strong>{field.default_value || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">字段说明</span><strong>{field.description || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">关系目标</span><strong>{field.type === 'relation' ? (relatedModelName || field.relation?.model_id || '—') : '—'}</strong></div>
                                                        {isAutoGenerated && field.relation?.source_field_name && (
                                                            <div><span className="model-detail-field-label">源关系</span><strong>{sourceModelName} · {field.relation.source_field_name}</strong></div>
                                                        )}
                                                        {field.type === 'relation' && field.relation?.foreign_key && (
                                                            <div><span className="model-detail-field-label">外键字段</span><strong>{field.relation.foreign_key}</strong></div>
                                                        )}
                                                        {field.type === 'enum' && field.enum_options && field.enum_options.length > 0 && (
                                                            <div><span className="model-detail-field-label">枚举选项</span><strong>{field.enum_options.join(', ')}</strong></div>
                                                        )}
                                                    </div>

                                                    <div className="task-card-actions">
                                                        <div style={{display: 'flex', gap: 4, marginRight: 'auto'}}>
                                                            <button className="btn btn-sm" type="button"
                                                                    style={{padding: '2px 8px', fontSize: 13}}
                                                                    onClick={() => moveField(field.id, -1)}
                                                                    disabled={form.fields.findIndex(f => f.id === field.id) === 0}>
                                                                <i className="bi bi-chevron-up"/>
                                                            </button>
                                                            <button className="btn btn-sm" type="button"
                                                                    style={{padding: '2px 8px', fontSize: 13}}
                                                                    onClick={() => moveField(field.id, 1)}
                                                                    disabled={form.fields.findIndex(f => f.id === field.id) === form.fields.length - 1}>
                                                                <i className="bi bi-chevron-down"/>
                                                            </button>
                                                        </div>
                                                        <button className="btn" type="button" onClick={() => openEditFieldModal(field)}>
                                                            <i className="bi bi-pencil-square"></i> 编辑
                                                        </button>
                                                        {!isAutoGenerated && (
                                                            <button className="btn btn-danger" type="button" onClick={() => removeField(field.id)} disabled={form.fields.length === 1}>
                                                                <i className="bi bi-trash-fill"/> 删除
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {systemFields.length > 0 && (
                                            <div style={{
                                                marginTop: 24, marginBottom: 12, padding: '8px 12px',
                                                background: 'var(--surface-3)', borderRadius: 6,
                                                fontSize: 13, fontWeight: 600, color: 'var(--text-2)',
                                                display: 'flex', alignItems: 'center', gap: 6,
                                            }}>
                                                <i className="bi bi-gear"/> 系统字段
                                            </div>
                                        )}

                                        {systemFields.map((field) => {
                                            const relatedModelName = models.find((item) => item.id === field.relation?.model_id || item.model_id === field.relation?.model_id)?.name;

                                            return (
                                                <div key={field.id} className="model-form-field-card model-inline-field-card" style={{opacity: 0.7}}>
                                                    <div className="model-form-field-card-header">
                                                        <div>
                                                            <strong>{field.label || field.name}</strong>
                                                            <div className="task-card-workflow">字段名：{field.name || '未填写'}</div>
                                                        </div>
                                                        <div className="model-detail-field-tags">
                                                            <span className="model-field-chip-type">{getTypeLabel(field.type)}</span>
                                                            <span className="model-field-chip-flag">系统字段</span>
                                                        </div>
                                                    </div>

                                                    <div className="model-detail-field-grid">
                                                        <div><span className="model-detail-field-label">显示名</span><strong>{field.label || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">默认值</span><strong>{field.default_value || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">字段说明</span><strong>{field.description || '—'}</strong></div>
                                                        <div><span className="model-detail-field-label">关系目标</span><strong>—</strong></div>
                                                    </div>

                                                    <div className="task-card-actions">
                                                        <span style={{fontSize: 12, color: 'var(--text-3)'}}>系统内置，不可编辑</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>;
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {!isEditorVisible && (
                    <div className="model-split-layout">
                        <div className="model-nav-panel">
                            <div className="model-nav-header">
                                <h3>模型列表</h3>
                                <span className="model-count">{models.length}</span>
                                <button className="btn btn-default" onClick={openCreateModal}
                                        style={{marginLeft: 'auto', padding: '2px 10px', fontSize: 13}}>
                                    <i className="bi bi-plus-circle"></i> 新建
                                </button>
                            </div>
                            <div className="model-nav-list" ref={navListRef}>
                                {filteredModels.length === 0 ? (
                                    <div
                                        className="model-nav-empty">{modelSearchQuery ? '未匹配到模型' : '暂无模型'}</div>
                                ) : (
                                    (() => {
                                        const groups = {};
                                        filteredModels.forEach((m) => {
                                            const cat = m.category?.trim() || '未分类';
                                            if (!groups[cat]) groups[cat] = [];
                                            groups[cat].push(m);
                                        });
                                        return Object.entries(groups).map(([cat, items]) => (
                                            <div key={cat} className="model-nav-group">
                                                <div className="model-nav-group-title ziti"
                                                     onClick={() => setCollapsedGroups(prev => ({
                                                         ...prev,
                                                         [cat]: !prev[cat]
                                                     }))} style={{cursor: 'pointer'}}>
                                                    <span
                                                        className="tree-expand-icon">{collapsedGroups[cat] ? '▶' : '▼'}</span>
                                                    {cat}
                                                </div>
                                                {!collapsedGroups[cat] && items.map((model) => (
                                                    <div
                                                        key={model.id}
                                                        className={`model-nav-item${selectedModel?.id === model.id ? ' active' : ''}`}
                                                        onClick={() => {
                                                            saveNavScroll();
                                                            setSelectedModel(model);
                                                        }}
                                                    >
                                                        <div className="model-nav-item-name">{model.name}</div>
                                                        <div
                                                            className="task-card-workflow">{model.model_id || model.id}</div>
                                                        <div style={{
                                                            fontSize: 11,
                                                            color: 'var(--text-3)',
                                                            marginTop: 2
                                                        }}>{model.username || '—'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ));
                                    })()
                                )}
                            </div>
                            <div className="model-nav-search">
                                <input
                                    type="text"
                                    placeholder="搜索模型..."
                                    value={modelSearchQuery}
                                    onChange={(e) => setModelSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="model-content-panel">
                            {!selectedModel ? (
                                <div className="empty-state">
                                    <div className="empty-icon">🧱</div>
                                    <p>请选择或新建一个模型查看详情</p>
                                </div>
                            ) : (
                                <>
                                    <div className="model-detail-info-panel">
                                        <div className="model-detail-summary">
                                            <div className="model-detail-header-row">
                                                <div>
                                                    <h2>{selectedModel.name}</h2>
                                                    <p className="task-card-workflow">模型
                                                        ID：{selectedModel.model_id || selectedModel.id}</p>
                                                </div>
                                                <div className="model-detail-right-group">
                                                    <div className="model-detail-meta">
                                                        <div className="model-detail-summary-item">
                                                            <span className="model-detail-summary-label">字段数</span>
                                                            <strong>{selectedModel.fields?.length || 0}</strong>
                                                        </div>
                                                        <div className="model-detail-summary-item">
                                                            <span className="model-detail-summary-label">更新时间</span>
                                                            <strong>{formatDateTime(selectedModel.updated_at)}</strong>
                                                        </div>
                                                    </div>
                                                    <div className="model-editor-actions">
                                                        <button className="btn"
                                                                onClick={() => openEditModal(selectedModel)}
                                                                type="button">
                                                            <i className="bi bi-pencil-square"></i>
                                                            编辑
                                                        </button>

                                                        <button className="btn btn-default"
                                                                onClick={openCreateModal}>
                                                            <i className="bi bi-plus-circle"></i>
                                                            新建模型
                                                        </button>

                                                        <button className="btn btn-danger"
                                                                onClick={() => handleDelete(selectedModel.id, selectedModel.name)}
                                                                type="button">
                                                            <i className="bi bi-trash-fill"/>
                                                            删除
                                                        </button>

                                                    </div>
                                                </div>
                                            </div>
                                            {selectedModel.description && (
                                                <div className="model-detail-desc-box">
                                                    <span className="model-detail-summary-label">描述</span>
                                                    <p>{selectedModel.description}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="model-detail-fields-panel">
                                        <div className="model-detail-section-header">
                                            <div>
                                                <div className="model-field-section-title">字段详情</div>
                                                <div className="form-hint">当前模型的全部字段定义。</div>
                                            </div>
                                        </div>
                                        {(selectedModel.fields || []).length === 0 ? (
                                            <div className="model-detail-empty">当前模型暂无字段定义。</div>
                                        ) : (
                                            <div className="model-inline-field-list">
                                                {(() => {
                                                    const allFields = selectedModel.fields || [];
                                                    const standardFields = allFields.filter(f => !isSystemField(f));
                                                    const systemFields = sortSystemFields(allFields.filter(f => isSystemField(f)));
                                                    return <>
                                                        {standardFields.map((field, index) => {
                                                            const isAutoGen = Boolean(field.relation?.auto_generated);
                                                            const relatedModelName = models.find((item) => item.id === field.relation?.model_id || item.model_id === field.relation?.model_id)?.name || field.relation?.model_id || '—';
                                                            const sourceModelName = field.relation?.source_model_name
                                                                || models.find((item) => item.id === field.relation?.source_model_id || item.model_id === field.relation?.source_model_id)?.name
                                                                || '—';
                                                            return (
                                                            <div key={field.id || `${field.name}-${index}`}
                                                                 className="model-form-field-card model-inline-field-card model-detail-field-card">
                                                                <div className="model-form-field-card-header">
                                                                    <div>
                                                                        <strong>{field.label || field.name || `字段 ${index + 1}`}</strong>
                                                                        <div className="task-card-workflow">字段名：{field.name || '—'}</div>
                                                                    </div>
                                                                    <div className="model-detail-field-tags">
                                                                        <span className="model-field-chip-type">{getTypeLabel(field.type)}</span>
                                                                        {field.type === 'relation' && (
                                                                            <span className="model-field-chip-flag">{getRelationTypeLabel(field.relation?.relation_type)}</span>
                                                                        )}
                                                                        {field.required && <span className="model-field-chip-flag">必填</span>}
                                                                        {field.unique && <span className="model-field-chip-flag">唯一</span>}
                                                                        {isAutoGen && <span className="model-field-chip-flag">自动生成</span>}
                                                                    </div>
                                                                </div>
                                                                <div className="model-detail-field-grid">
                                                                    <div><span className="model-detail-field-label">显示名</span><strong>{field.label || '—'}</strong></div>
                                                                    <div><span className="model-detail-field-label">默认值</span><strong>{field.default_value || '—'}</strong></div>
                                                                    <div><span className="model-detail-field-label">字段说明</span><strong>{field.description || '—'}</strong></div>
                                                                    <div><span className="model-detail-field-label">关系目标</span><strong>{field.type === 'relation' ? relatedModelName : '—'}</strong></div>
                                                                    {isAutoGen && field.relation?.source_field_name && (
                                                                        <div><span className="model-detail-field-label">源关系</span><strong>{sourceModelName} · {field.relation.source_field_name}</strong></div>
                                                                    )}
                                                                    {field.type === 'relation' && (
                                                                        <>
                                                                            <div><span className="model-detail-field-label">关系类型</span><strong>{getRelationTypeLabel(field.relation?.relation_type)}</strong></div>
                                                                            <div><span className="model-detail-field-label">外键字段</span><strong>{field.relation?.foreign_key || '—'}</strong></div>
                                                                        </>
                                                                    )}
                                                                    {field.type === 'enum' && field.enum_options && field.enum_options.length > 0 && (
                                                                        <div><span className="model-detail-field-label">枚举选项</span><strong>{field.enum_options.join(', ')}</strong></div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            );
                                                        })}

                                                        {systemFields.length > 0 && (
                                                            <div style={{
                                                                marginTop: 24, marginBottom: 12, padding: '8px 12px',
                                                                background: 'var(--surface-3)', borderRadius: 6,
                                                                fontSize: 13, fontWeight: 600, color: 'var(--text-2)',
                                                                display: 'flex', alignItems: 'center', gap: 6,
                                                            }}>
                                                                <i className="bi bi-gear"/> 系统字段
                                                            </div>
                                                        )}

                                                        {systemFields.map((field) => (
                                                            <div key={field.id || field.name}
                                                                 className="model-form-field-card model-inline-field-card model-detail-field-card"
                                                                 style={{opacity: 0.7}}>
                                                                <div className="model-form-field-card-header">
                                                                    <div>
                                                                        <strong>{field.label || field.name}</strong>
                                                                        <div className="task-card-workflow">字段名：{field.name || '—'}</div>
                                                                    </div>
                                                                    <div className="model-detail-field-tags">
                                                                        <span className="model-field-chip-type">{getTypeLabel(field.type)}</span>
                                                                        <span className="model-field-chip-flag">系统字段</span>
                                                                    </div>
                                                                </div>
                                                                <div className="model-detail-field-grid">
                                                                    <div><span className="model-detail-field-label">显示名</span><strong>{field.label || '—'}</strong></div>
                                                                    <div><span className="model-detail-field-label">默认值</span><strong>{field.default_value || '—'}</strong></div>
                                                                    <div><span className="model-detail-field-label">字段说明</span><strong>{field.description || '—'}</strong></div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </>;
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {isFieldModalOpen && (
                    <div className="modal-overlay">
                        <div className="modal-box model-modal model-field-modal"
                             onClick={(event) => event.stopPropagation()}>
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon"><i className="bi bi-pencil-square"/></span>
                                    <h3 className="modal-title">{editingFieldId ? '编辑字段' : '添加字段'}</h3>
                                </div>
                                <button className="modal-close" onClick={closeFieldModal}>✕</button>
                            </div>

                            <div className="modal-body">
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>字段名</label>
                                        <input
                                            autoFocus
                                            value={fieldDraft.name}
                                            onChange={(event) => updateFieldDraft({name: event.target.value})}
                                            placeholder="例如：email"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>显示名</label>
                                        <input
                                            value={fieldDraft.label}
                                            onChange={(event) => updateFieldDraft({label: event.target.value})}
                                            placeholder="例如：邮箱"
                                        />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>字段类型</label>
                                        <select
                                            value={fieldDraft.type}
                                            onChange={(event) => updateFieldDraft((prev) => ({
                                                ...prev,
                                                type: event.target.value,
                                                enum_options: event.target.value === 'enum' ? (prev.enum_options || []) : prev.enum_options,
                                                relation: event.target.value === 'relation'
                                                    ? {
                                                        ...(prev.relation || {}),
                                                        model_id: prev.relation?.model_id || '',
                                                        relation_type: prev.relation?.relation_type || 'oneToOne',
                                                        foreign_key: prev.relation?.foreign_key || '',
                                                        display_field: prev.relation?.display_field || '',
                                                        auto_generated: Boolean(prev.relation?.auto_generated),
                                                    }
                                                    : {
                                                        ...(prev.relation || {}),
                                                        model_id: '',
                                                        relation_type: 'oneToOne',
                                                        foreign_key: '',
                                                        display_field: '',
                                                        auto_generated: Boolean(prev.relation?.auto_generated),
                                                    },
                                            }))}
                                        >
                                            {FIELD_TYPES.map((item) => (
                                                <option key={item.value} value={item.value}>{item.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>默认值</label>
                                        <input
                                            value={fieldDraft.default_value}
                                            onChange={(event) => updateFieldDraft({default_value: event.target.value})}
                                            placeholder="可选"
                                        />
                                    </div>
                                </div>

                                {fieldDraft.type === 'enum' && (
                                    <div className="form-group">
                                        <label>枚举选项</label>
                                        <div style={{display: 'flex', gap: '8px', marginBottom: '8px'}}>
                                            <input
                                                value={enumInputValue}
                                                onChange={(e) => setEnumInputValue(e.target.value)}
                                                placeholder="输入枚举选项"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        addEnumOption();
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="btn btn-sm"
                                                onClick={addEnumOption}
                                            >
                                                添加
                                            </button>
                                        </div>
                                        {(fieldDraft.enum_options || []).length > 0 && (
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px'}}>
                                                {fieldDraft.enum_options.map((option) => (
                                                    <span
                                                        key={option}
                                                        className="model-field-chip-type"
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        {option}
                                                        <button
                                                            type="button"
                                                            onClick={() => removeEnumOption(option)}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                padding: '0 2px',
                                                                fontSize: '12px',
                                                                color: '#666',
                                                            }}
                                                        >
                                                            ×
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="form-hint">输入枚举选项后点击添加或按回车键。</div>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>字段说明</label>
                                    <textarea
                                        className="model-description-textarea"
                                        value={fieldDraft.description}
                                        onChange={(event) => updateFieldDraft({description: event.target.value})}
                                        placeholder="# 补充字段语义或约束说明..."
                                        rows={2}
                                    />
                                </div>

                                <div className="model-checkbox-row">
                                    <label className="task-switch-row">
                                        <input
                                            type="checkbox"
                                            checked={fieldDraft.required}
                                            onChange={(event) => updateFieldDraft({required: event.target.checked})}
                                        />
                                        <span>必填</span>
                                    </label>
                                    <label className="task-switch-row">
                                        <input
                                            type="checkbox"
                                            checked={fieldDraft.unique}
                                            onChange={(event) => updateFieldDraft({unique: event.target.checked})}
                                        />
                                        <span>唯一</span>
                                    </label>
                                </div>

                                {fieldDraft.type === 'relation' && (
                                    <div className="model-relation-panel">
                                        {fieldDraft.relation?.auto_generated && (
                                            <div
                                                className="form-hint">该关系字段由对端模型自动生成，关联模型不可改，但其他配置仍可调整。
                                            </div>
                                        )}

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>关联模型</label>
                                                <select
                                                    value={fieldDraft.relation?.model_id || ''}
                                                    onChange={(event) => updateFieldDraft((prev) => ({
                                                        ...prev,
                                                        relation: {
                                                            ...(prev.relation || {}),
                                                            model_id: event.target.value,
                                                        },
                                                    }))}
                                                    disabled={Boolean(fieldDraft.relation?.auto_generated)}
                                                >
                                                    <option value="">请选择模型</option>
                                                    {availableRelationModels.map((item) => (
                                                        <option key={item.id}
                                                                value={item.id}>{item.name}（{item.model_id || item.id}）</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="form-group">
                                                <label>关系类型</label>
                                                <select
                                                    value={fieldDraft.relation?.relation_type || 'oneToOne'}
                                                    onChange={(event) => updateFieldDraft((prev) => ({
                                                        ...prev,
                                                        relation: {
                                                            ...(prev.relation || {}),
                                                            relation_type: event.target.value,
                                                        },
                                                    }))}
                                                >
                                                    {RELATION_TYPES.map((item) => (
                                                        <option key={item.value}
                                                                value={item.value}>{item.label}</option>
                                                    ))}
                                                </select>
                                                <div className="form-hint">
                                                    {getRelationTypeDesc(fieldDraft.relation?.relation_type)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>外键字段 {getFkOwnerSide(fieldDraft.relation?.relation_type) !== 'none' && <span style={{color: 'var(--danger)'}}> *</span>}</label>
                                                <input
                                                    value={fieldDraft.relation?.foreign_key || ''}
                                                    onChange={(event) => updateFieldDraft((prev) => ({
                                                        ...prev,
                                                        relation: {
                                                            ...(prev.relation || {}),
                                                            foreign_key: event.target.value,
                                                        },
                                                    }))}
                                                    placeholder="例如：customer_id"
                                                />
                                                <div className="form-hint">
                                                    {getFkHint(fieldDraft.relation?.relation_type, fieldDraft.relation?.auto_generated ? 'inverse' : 'source')}
                                                </div>
                                            </div>
                                            <div className="form-group">
                                                <label>展示字段</label>
                                                <input
                                                    value={fieldDraft.relation?.display_field || ''}
                                                    onChange={(event) => updateFieldDraft((prev) => ({
                                                        ...prev,
                                                        relation: {
                                                            ...(prev.relation || {}),
                                                            display_field: event.target.value,
                                                        },
                                                    }))}
                                                    placeholder="例如：name"
                                                />
                                                <div
                                                    className="form-hint">填写关联模型中用于展示的字段名，留空则自动回退。
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button className="btn" onClick={closeFieldModal}>取消</button>
                                <button className="btn btn-default" onClick={saveFieldDraft}>
                                    <i className="bi bi-pencil-square"></i>
                                    保存字段
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <Modal
                    open={deleteAlert.open}
                    onClose={() => setDeleteAlert({open: false, message: ''})}
                    title="删除失败"
                    type="error"
                    footer={
                        <button className="btn btn-default"
                                onClick={() => setDeleteAlert({open: false, message: ''})}>
                            确定
                        </button>
                    }
                >
                    <p>{deleteAlert.message}</p>
                </Modal>
            </div>
        </div>
    );
}
