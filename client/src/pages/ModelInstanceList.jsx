import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import * as XLSX from 'xlsx-js-style';
import {usePersistedState} from '../hooks';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {api, getStoredAuthToken} from '../api';
import {useTheme} from '../ThemeContext';
import {useAuth} from '../AuthContext';
import {getCmdbApiBase} from '../config';
import AppSidebar from '../components/AppSidebar';

let globalImportProgress = null;
const globalImportListeners = new Set();

function setGlobalImportProgress(progress) {
    globalImportProgress = progress;
    globalImportListeners.forEach(fn => fn(progress));
}

function useGlobalImportProgress() {
    const [progress, setProgress] = useState(globalImportProgress);
    useEffect(() => {
        globalImportListeners.add(setProgress);
        return () => { globalImportListeners.delete(setProgress); };
    }, []);
    return progress;
}

function formatDateTime(value) {
    if (!value) return '—';

    const normalizedValue = String(value).includes('T')
        ? String(value)
        : String(value).replace(' ', 'T');
    const date = new Date(normalizedValue);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function getFieldTypeLabel(type) {
    switch (type) {
        case 'string':
            return '字符串';
        case 'number':
            return '数字';
        case 'boolean':
            return '布尔值';
        case 'date':
            return '日期';
        case 'datetime':
            return '日期时间';
        case 'text':
            return '长文本';
        case 'json':
            return 'JSON';
        case 'struct':
            return '结构体';
        case 'array':
            return '数组';
        case 'enum':
            return '枚举';
        case 'float':
            return '浮点数';
        case 'relation':
            return '关联关系';
        default:
            return type || '未定义';
    }
}

function isMultiRelationField(field) {
    const relationType = String(field?.relation?.relation_type || '').trim();
    return relationType === 'one_to_many'
        || relationType === 'many_to_one'
        || relationType === 'many_to_many'
        || relationType === 'oneToMany'
        || relationType === 'manyToOne'
        || relationType === 'manyToMany';
}

function isSystemReadonlyField(field) {
    return field?.name === 'createTime' || field?.name === 'creator' || field?.name === 'updated_at' || field?.name === 'created_at';
}

function isStatusField(field) {
    return field?.name === 'status';
}

function getInitialValue(field, currentUser = '') {
    if (isStatusField(field)) {
        return true;
    }

    if (field?.name === 'createTime') {
        return '';
    }

    if (field?.name === 'creator') {
        return currentUser || '';
    }

    if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
        if (field.type === 'boolean') {
            return Boolean(field.default_value);
        }
        if (field.type === 'relation' && isMultiRelationField(field)) {
            return Array.isArray(field.default_value)
                ? field.default_value
                : String(field.default_value)
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean);
        }
        return field.default_value;
    }

    switch (field.type) {
        case 'boolean':
            return false;
        case 'json':
            return '{}';
        case 'array':
        case 'struct':
            return '[]';
        case 'relation':
            return isMultiRelationField(field) ? [] : '';
        default:
            return '';
    }
}

function createFormFromModel(model, data = {}, currentUser = '', instance = null) {
    const fields = Array.isArray(model?.fields) ? model.fields : [];
    const form = fields.reduce((acc, field) => {
        const rawValue = data[field.name];

        if (rawValue === undefined || rawValue === null) {
            acc[field.name] = getInitialValue(field, currentUser);
            return acc;
        }

        if (field.type === 'json' || field.type === 'struct' || field.type === 'array') {
            acc[field.name] = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue, null, 2);
            return acc;
        }

        if (field.type === 'boolean') {
            acc[field.name] = Boolean(rawValue);
            return acc;
        }

        if (field.type === 'relation') {
            acc[field.name] = isMultiRelationField(field)
                ? (Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [])
                : (rawValue ?? '');
            return acc;
        }

        acc[field.name] = rawValue;
        return acc;
    }, {});

    if (instance) {
        form.updated_at = instance.updated_at || '';
        form.created_at = instance.created_at || '';
    }

    return form;
}

function buildPayloadFromForm(model, form) {
    const fields = Array.isArray(model?.fields) ? model.fields : [];
    const data = {};

    for (const field of fields) {
        const value = form[field.name];

        switch (field.type) {
            case 'number':
            case 'float':
                data[field.name] = value === '' ? '' : Number(value);
                break;
            case 'boolean':
                if (isStatusField(field) && value === undefined) {
                    data[field.name] = true;
                    break;
                }
                data[field.name] = Boolean(value);
                break;
            case 'json': {
                const text = String(value || '').trim();
                data[field.name] = text ? JSON.parse(text) : {};
                break;
            }
            case 'array':
            case 'struct': {
                const text = String(value || '').trim();
                data[field.name] = text ? JSON.parse(text) : [];
                break;
            }
            case 'relation':
                data[field.name] = isMultiRelationField(field)
                    ? (Array.isArray(value) ? value : value ? [value] : [])
                    : (value || '');
                break;
            default:
                data[field.name] = value;
                break;
        }
    }

    return data;
}

function formatDisplayText(value, maxLength = 40) {
    if (value === undefined || value === null || value === '') {
        return '—';
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '—';
        }
        const text = value.join('、');
        return text.length > Math.max(maxLength, 80) ? `${text.slice(0, Math.max(maxLength, 80))}...` : text;
    }

    const text = typeof value === 'string' ? value : String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getRelationOptionLabel(field, option) {
    const displayFieldName = String(field?.relation?.display_field || '').trim();
    const displayValue = displayFieldName ? option?.data?.[displayFieldName] : undefined;

    if (displayValue !== undefined && displayValue !== null && displayValue !== '') {
        return formatDisplayText(displayValue, 80);
    }

    return formatDisplayText(option?.label || option?.value || '', 80);
}

function getDisplayValue(field, value, relationOptionsMap = {}, instance) {
    if (!field) return '—';

    if (field.type === 'relation' && field.relation?.auto_generated && instance) {
        const targetModelId = field.relation.model_id;
        const sourceFieldName = field.relation.source_field_name;
        const options = relationOptionsMap[`${field.name}_${targetModelId}`] || relationOptionsMap[targetModelId] || [];
        const relatedOptions = options.filter((opt) => {
            const relValue = opt.data?.[sourceFieldName];
            if (Array.isArray(relValue)) return relValue.includes(instance.id);
            return relValue === instance.id;
        });
        if (relatedOptions.length === 0) return '—';
        const labels = relatedOptions.map((opt) => getRelationOptionLabel(field, opt)).filter(Boolean);
        if (labels.length <= 3) return labels.join('、');
        return labels.slice(0, 2).join('、') + ` 等${labels.length}项`;
    }

    if (value === undefined || value === null) return '—';

    if (field.type === 'relation') {
        const relationTargetModelId = field.relation?.model_id || '';
        const relationOptions = relationOptionsMap[`${field.name}_${relationTargetModelId}`] || relationOptionsMap[relationTargetModelId] || [];
        const optionMap = new Map(relationOptions.map((option) => [option.value, option]));
        const values = Array.isArray(value) ? value : [value];
        const labels = values.map((item) => {
            const option = optionMap.get(item);
            if (!option) return formatDisplayText(item, 80);
            return getRelationOptionLabel(field, option);
        }).filter((item) => item && item !== '—');
        if (labels.length === 0) return '—';
        if (labels.length <= 3) return labels.join('、');
        return labels.slice(0, 2).join('、') + ` 等${labels.length}项`;
    }

    if (field.name === 'updated_at' || field.name === 'created_at') {
        return formatDateTime(value);
    }

    if (field.type === 'boolean') {
        if (isStatusField(field)) {
            return value ? '有效' : '无效';
        }
        return value ? '是' : '否';
    }

    if (field.type === 'json' || field.type === 'struct' || field.type === 'array') {
        return formatDisplayText(JSON.stringify(value), 80);
    }

    return formatDisplayText(value, Array.isArray(value) ? 80 : 40);
}

function getInstanceFieldValue(instance, field) {
    if (field?.name === 'updated_at') {
        return instance?.updated_at;
    }

    if (field?.name === 'created_at') {
        return instance?.created_at;
    }

    return instance?.data?.[field?.name];
}

function getAvatarText(value) {
    const text = String(value || '').trim();
    if (!text) return 'NA';
    const segments = text.split(/\s+/).filter(Boolean);
    if (segments.length === 1) {
        return segments[0].slice(0, 2).toUpperCase();
    }
    return `${segments[0][0] || ''}${segments[1][0] || ''}`.toUpperCase();
}

function getAvatarColor(seed) {
    const palettes = [
        'orange',
        'purple',
        'green',
        'cyan',
        'pink',
        'red',
        'yellow',
        'blue',
    ];
    const text = String(seed || 'default');
    let total = 0;
    for (let index = 0; index < text.length; index += 1) {
        total += text.charCodeAt(index);
    }
    return palettes[total % palettes.length];
}

function getBadgeClassName(value) {
    const text = String(value || '').toLowerCase();
    if (text.includes('高') || text.includes('p0') || text.includes('critical') || text.includes('严重')) {
        return 'is-danger';
    }
    if (text.includes('中') || text.includes('p1') || text.includes('warning')) {
        return 'is-warning';
    }
    if (text.includes('低') || text.includes('p2') || text.includes('success') || text.includes('正常')) {
        return 'is-success';
    }
    if (text.includes('devops') || text.includes('技术') || text.includes('平台')) {
        return 'is-cyan';
    }
    if (text.includes('业务') || text.includes('产品')) {
        return 'is-purple';
    }
    return 'is-default';
}

function getColumnType(field) {
    const name = String(field.name || '').toLowerCase();
    const label = String(field.label || '').toLowerCase();
    const combined = `${name} ${label}`;

    if (field.type === 'boolean') return 'status';
    if (field.type === 'number' || field.type === 'float') return 'badge';
    if (field.type === 'relation') return 'person';
    if (combined.includes('owner') || combined.includes('负责人') || combined.includes('联系人')) return 'person';
    if (combined.includes('状态')) return 'status';
    if (combined.includes('级别') || combined.includes('等级') || combined.includes('类型') || combined.includes('分类')) return 'badge';
    return 'text';
}

function getRelationFullText(field, value, relationOptionsMap = {}, instance) {
    if (field.type === 'relation' && field.relation?.auto_generated && instance) {
        const targetModelId = field.relation.model_id;
        const sourceFieldName = field.relation.source_field_name;
        const options = relationOptionsMap[`${field.name}_${targetModelId}`] || relationOptionsMap[targetModelId] || [];
        const relatedOptions = options.filter((opt) => {
            const relValue = opt.data?.[sourceFieldName];
            if (Array.isArray(relValue)) return relValue.includes(instance.id);
            return relValue === instance.id;
        });
        if (relatedOptions.length === 0) return '';
        return relatedOptions.map((opt) => getRelationOptionLabel(field, opt)).filter(Boolean).join('、');
    }
    if (field.type === 'relation') {
        const relationTargetModelId = field.relation?.model_id || '';
        const relationOptions = relationOptionsMap[`${field.name}_${relationTargetModelId}`] || relationOptionsMap[relationTargetModelId] || [];
        const optionMap = new Map(relationOptions.map((option) => [option.value, option]));
        const values = Array.isArray(value) ? value : [value];
        const labels = values.map((item) => {
            const option = optionMap.get(item);
            if (!option) return formatDisplayText(item, 80);
            return getRelationOptionLabel(field, option);
        }).filter((item) => item && item !== '—');
        return labels.join('、');
    }
    return '';
}

function renderCellContent(field, value, instanceId, relationOptionsMap = {}, onExpandJson, instance) {
    const displayValue = getDisplayValue(field, value, relationOptionsMap, instance);
    const columnType = getColumnType(field);
    const isJsonOrStruct = field.type === 'json' || field.type === 'struct' || field.type === 'array';

    if (columnType === 'person' && displayValue !== '—') {
        const avatarColor = getAvatarColor(`${field.name}-${displayValue}-${instanceId}`);
        return (
            <div className="instance-person-cell">
                <span className={`instance-avatar avatar-${avatarColor}`}>{getAvatarText(displayValue)}</span>
                <span className="instance-person-text" title={displayValue}>{displayValue}</span>
            </div>
        );
    }

    if (columnType === 'status') {
        const isInvalid = isStatusField(field) && !value;
        return (
            <span
                className={`instance-status-dot ${isInvalid || displayValue === '—' || displayValue === '否' ? 'is-offline' : 'is-online'}`}>
                <span className="instance-status-dot-core"/>
                <span title={String(value ?? '')}
                    style={isInvalid ? {color: '#ef4444', fontWeight: 500} : {}}>
                    {displayValue}
                </span>
            </span>
        );
    }

    if (columnType === 'badge') {
        return (
            <span className={`instance-table-badge ${getBadgeClassName(displayValue)}`} title={displayValue}>
                {displayValue}
            </span>
        );
    }

    if (isJsonOrStruct && onExpandJson && value != null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        const rawText = typeof value === 'string' ? value : JSON.stringify(value);
        const isTruncated = rawText.length > 80;
        if (isTruncated) {
            return (
                <span className="instance-cell-json">
                    <span className="instance-json-truncated">{displayValue}</span>
                    <button className="btn btn-link btn-xs" onClick={() => onExpandJson(field, value)}>展开</button>
                </span>
            );
        }
    }

    return (
        <span className="instance-cell-text" title={field.type === 'relation' ? getRelationFullText(field, value, relationOptionsMap, instance) || displayValue : displayValue}>
            {displayValue}
        </span>
    );
}

function RelationMultiDropdown({ value, options, field, onChange, disabled, loading }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e) => {
            if (ref.current && !ref.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const selectedSet = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);
    const selectedOptions = useMemo(
        () => options.filter((o) => selectedSet.has(o.value)),
        [options, selectedSet]
    );

    const displayText = selectedOptions.length === 0
        ? '请选择...'
        : selectedOptions.length <= 2
            ? selectedOptions.map((o) => o.label).join(', ')
            : `已选 ${selectedOptions.length} 项`;

    const toggleOption = (optValue) => {
        if (optValue === '----') {
            onChange([]);
            setOpen(false);
            return;
        }
        // 已选中的可以取消选择；已被其他源实例占用的不允许再选
        const option = options.find((o) => o.value === optValue);
        if (option && option.bound && !selectedSet.has(optValue)) {
            return;
        }
        const next = new Set(selectedSet);
        if (next.has(optValue)) {
            next.delete(optValue);
        } else {
            next.add(optValue);
        }
        onChange(Array.from(next));
    };

    return (
        <div className="relation-dropdown-wrap" ref={ref}>
            <div
                className={`relation-dropdown-trigger${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}`}
                onClick={() => { if (!disabled) setOpen((prev) => !prev); }}
            >
                <span className="relation-dropdown-trigger-text">{loading ? '加载中...' : displayText}</span>
                <span className="relation-dropdown-arrow">{open ? '▲' : '▼'}</span>
            </div>
            {open && (
                <div className="relation-dropdown-panel">
                    {options.length === 0 && !loading && (
                        <div className="relation-dropdown-empty">暂无可选数据</div>
                    )}
                    {loading && <div className="relation-dropdown-empty">加载中...</div>}
                    <div
                        className="relation-dropdown-option is-clear"
                        onClick={(e) => { e.stopPropagation(); toggleOption('----'); }}
                    >
                        ----
                    </div>
                    {options.map((option) => {
                        const checked = selectedSet.has(option.value);
                        const isBound = option.bound && !checked;
                        return (
                            <div
                                key={option.value}
                                className={`relation-dropdown-option${checked ? ' is-checked' : ''}${isBound ? ' is-bound' : ''}`}
                                onClick={(e) => { e.stopPropagation(); toggleOption(option.value); }}
                                title={isBound ? '已被其他实例占用，不可重复选择' : ''}
                            >
                                <span className="relation-dropdown-checkbox">{checked ? '✓' : (isBound ? '🔒' : '')}</span>
                                <span className="relation-dropdown-option-label">
                                    {option.label}
                                    {isBound ? <span className="relation-dropdown-bound-tag">已被占用</span> : null}
                                </span>
                            </div>
                        );
                    })}
                    </div>
                    )}
                </div>
    );
}

export default function ModelInstanceList() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const {theme, toggleTheme} = useTheme();
    const {user, logout} = useAuth();
    const [models, setModels] = useState([]);
    const [instances, setInstances] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [keyword, setKeyword] = useState('');
    const [searchKeyword, setSearchKeyword] = useState('');
    const [pageSizeMap, setPageSizeMap] = usePersistedState('modelInstancePageSizeMap', {});
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = useMemo(() => pageSizeMap[selectedModelId] || 5, [pageSizeMap, selectedModelId]);
    const [selectedInstanceIds, setSelectedInstanceIds] = useState([]);
    const [showDisplayFieldPanel, setShowDisplayFieldPanel] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importPreview, setImportPreview] = useState(null);
    const [importFile, setImportFile] = useState(null);
    const [importErrors, setImportErrors] = useState([]);
    const importProgress = useGlobalImportProgress();
    const importPreviewRef = useRef(null);
    const [showPasteFilter, setShowPasteFilter] = useState(false);
    const [pasteFilterText, setPasteFilterText] = useState('');
    const [parsedPasteFilters, setParsedPasteFilters] = useState(null);
    const [showModal, setShowModal] = usePersistedState('modelInstanceShowModal', false);
    const [editingInstanceId, setEditingInstanceId] = usePersistedState('modelInstanceEditingId', '');
    const [isCreateIntent, setIsCreateIntent] = useState(false);
    const [form, setForm] = usePersistedState('modelInstanceForm', {});
    const [relationOptionsMap, setRelationOptionsMap] = useState({});
    const [loadingRelationFields, setLoadingRelationFields] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [inverseRelations, setInverseRelations] = useState([]);
    const [inverseLoading, setInverseLoading] = useState(false);
    const [expandedJson, setExpandedJson] = useState(null);
    const [jsonCopied, setJsonCopied] = useState(false);
    const [detailInstance, setDetailInstance] = useState(null);
    const [modelSearchQuery, setModelSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState(() => {
        const saved = localStorage.getItem('modelInstanceCollapsedGroups');
        return saved ? JSON.parse(saved) : {};
    });
    const [perms, setPerms] = useState({export: false, exportTemplate: false, import: false});
    useEffect(() => {
        localStorage.setItem('modelInstanceCollapsedGroups', JSON.stringify(collapsedGroups));
    }, [collapsedGroups]);

    const navListRef = useRef(null);
    const MODEL_INSTANCE_NAV_SCROLL_KEY = 'modelInstanceNavScrollTop';
    const MODEL_INSTANCE_SELECTED_KEY = 'modelInstanceSelectedModelId';
    const saveNavScroll = useCallback(() => {
        if (navListRef.current) {
            try {
                localStorage.setItem(MODEL_INSTANCE_NAV_SCROLL_KEY, String(navListRef.current.scrollTop));
            } catch {
            }
        }
    }, []);
    useEffect(() => {
        if (models.length > 0) {
            const raf = requestAnimationFrame(() => {
                if (navListRef.current) {
                    try {
                        const saved = localStorage.getItem(MODEL_INSTANCE_NAV_SCROLL_KEY);
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
        if (selectedModelId) {
            try {
                localStorage.setItem(MODEL_INSTANCE_SELECTED_KEY, selectedModelId);
            } catch {
            }
        }
    }, [selectedModelId]);
    useEffect(() => {
        const el = navListRef.current;
        if (!el) return;
        const handler = () => {
            try {
                localStorage.setItem(MODEL_INSTANCE_NAV_SCROLL_KEY, String(el.scrollTop));
            } catch {
            }
        };
        el.addEventListener('scroll', handler, {passive: true});
        return () => el.removeEventListener('scroll', handler);
    }, []);

    const [selectedDisplayFieldNames, setSelectedDisplayFieldNames] = useState([]);
    useEffect(() => {
        if (!selectedModelId) return;
        const saved = localStorage.getItem('modelInstanceDisplayFields');
        const all = saved ? JSON.parse(saved) : {};
        setSelectedDisplayFieldNames(all[selectedModelId] || []);
    }, [selectedModelId]);
    useEffect(() => {
        if (!selectedModelId) return;
        const saved = localStorage.getItem('modelInstanceDisplayFields');
        const all = saved ? JSON.parse(saved) : {};
        all[selectedModelId] = selectedDisplayFieldNames;
        localStorage.setItem('modelInstanceDisplayFields', JSON.stringify(all));
    }, [selectedDisplayFieldNames, selectedModelId]);

    const filteredModels = useMemo(() => {
        const q = modelSearchQuery.trim().toLowerCase();
        if (!q) return models;
        return models.filter((m) =>
            m.name.toLowerCase().includes(q) ||
            (m.model_id || '').toLowerCase().includes(q)
        );
    }, [models, modelSearchQuery]);

    const selectedModel = useMemo(
        () => models.find((item) => item.id === selectedModelId) || null,
        [models, selectedModelId],
    );

    const visibleFields = useMemo(() => {
        if (!selectedModel) {
            return [];
        }

        const allFields = [
            ...(selectedModel.fields || []),
            ...((selectedModel.fields || []).some(f => f.name === 'updated_at') ? [] : [{
                id: 'system-updated_at',
                name: 'updated_at',
                label: '更新时间',
                type: 'datetime',
                required: false,
                unique: false,
                default_value: '',
                description: '系统字段，数据变更时自动更新',
                relation: null,
            }]),
        ];

        const base = [...allFields];

        const idx = base.findIndex(f => f.name === 'createTime');
        if (idx !== -1) {
            const updatedAtIdx = base.findIndex(f => f.name === 'updated_at');
            if (updatedAtIdx !== -1 && updatedAtIdx !== idx + 1) {
                const copy = [...base];
                const [item] = copy.splice(updatedAtIdx, 1);
                const insertAt = copy.findIndex(f => f.name === 'createTime') + 1;
                copy.splice(insertAt, 0, item);
                return copy;
            }
        }
        return base;
    }, [selectedModel]);

    const defaultDisplayFields = useMemo(() => {
        const statusField = visibleFields.find((field) => field.name === 'status') || null;
        const systemFieldNames = new Set(['status', 'createTime', 'creator', 'updated_at', 'created_at']);
        const nonSystemFields = visibleFields.filter((field) => !systemFieldNames.has(field.name));

        if (!statusField) {
            return nonSystemFields.slice(0, 5);
        }
        return [statusField, ...nonSystemFields.slice(0, 4)];
    }, [visibleFields]);

    const activeDisplayFields = useMemo(() => {
        const selectedFields = visibleFields.filter((field) => selectedDisplayFieldNames.includes(field.name));
        return selectedFields.length > 0 ? selectedFields : defaultDisplayFields;
    }, [defaultDisplayFields, selectedDisplayFieldNames, visibleFields]);

    const primaryField = activeDisplayFields[0] || null;
    const secondaryFields = activeDisplayFields.slice(1);
    const tableColumnCount = activeDisplayFields.length + 2;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const allPagedSelected = instances.length > 0 && instances.every((instance) => selectedInstanceIds.includes(instance.id));
    const somePagedSelected = instances.some((instance) => selectedInstanceIds.includes(instance.id));

    const loadModels = useCallback(async () => {
        const result = await api.listModelInstanceModels({per_page: 10000});
        setModels(result);
        setSelectedModelId((prev) => {
            const urlModelId = searchParams.get('modelDefinitionId');
            if (urlModelId && result.some((item) => item.id === urlModelId)) {
                return urlModelId;
            }
            if (prev && result.some((item) => item.id === prev)) {
                return prev;
            }
            const savedId = localStorage.getItem(MODEL_INSTANCE_SELECTED_KEY);
            if (savedId && result.some((item) => item.id === savedId)) {
                return savedId;
            }
            return result[0]?.id || '';
        });
    }, [searchParams]);

    const loadInstances = useCallback(async (modelId, currentKeyword, page, perPage, pasteFilters) => {
        if (!modelId) {
            setInstances([]);
            setTotalCount(0);
            return;
        }

        setLoading(true);
        try {
            const result = await api.listModelInstances({
                model_definition_id: modelId,
                keyword: currentKeyword,
                page: page,
                per_page: perPage,
                pasteFilters: pasteFilters || null,
            });
            setInstances(result.items || []);
            setTotalCount(result.total || 0);
            setErrorMessage('');
        } catch (error) {
            console.error(error);
            setInstances([]);
            setTotalCount(0);
            setErrorMessage(error.message || '加载模型实例失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const bootstrap = async () => {
            try {
                setErrorMessage('');
                const cmdbBase = getCmdbApiBase();
                const token = getStoredAuthToken();
                const headers = token ? {Authorization: `Bearer ${token}`} : {};
                const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:read`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.allowed) {
                        alert('⚠️ 权限不足: 无权限查看模型数据');
                        return;
                    }
                }
                await loadModels();
                const permChecks = await Promise.allSettled([
                    fetch(`${cmdbBase}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:export`, {headers}).then(r => r.json()),
                    fetch(`${cmdbBase}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:export-template`, {headers}).then(r => r.json()),
                    fetch(`${cmdbBase}/api/check-permission?resource_type=model-instance&resource_id=*&permission=model-instance:import`, {headers}).then(r => r.json()),
                ]);
                setPerms({
                    export: permChecks[0].status === 'fulfilled' && permChecks[0].value.allowed,
                    exportTemplate: permChecks[1].status === 'fulfilled' && permChecks[1].value.allowed,
                    import: permChecks[2].status === 'fulfilled' && permChecks[2].value.allowed,
                });
            } catch (error) {
                console.error(error);
                setModels([]);
                setInstances([]);
                setErrorMessage(error.message || '加载模型列表失败');
            }
        };

        bootstrap();
    }, [loadModels]);

    useEffect(() => {
        loadInstances(selectedModelId, searchKeyword, currentPage, pageSize, parsedPasteFilters);
    }, [selectedModelId, searchKeyword, currentPage, pageSize, loadInstances, parsedPasteFilters]);

    useEffect(() => {
        if (!selectedModel) {
            setSelectedDisplayFieldNames([]);
            setShowDisplayFieldPanel(false);
            setExpandedJson(null);
            return;
        }

        setSelectedDisplayFieldNames((prev) => {
            const availableFieldNames = visibleFields.map((field) => field.name);
            const nextSelected = prev.filter((fieldName) => availableFieldNames.includes(fieldName));
            const nextDefaultFieldNames = defaultDisplayFields.map((field) => field.name);
            const isLegacyStatusOnlySelection = nextSelected.length === 1 && nextSelected[0] === 'status';

            if (nextSelected.length > 0 && !isLegacyStatusOnlySelection) {
                return nextSelected;
            }

            return nextDefaultFieldNames;
        });
    }, [defaultDisplayFields, selectedModel, visibleFields]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    useEffect(() => {
        setSelectedInstanceIds((prev) => prev.filter((instanceId) => instances.some((instance) => instance.id === instanceId)));
    }, [instances]);

    useEffect(() => {
        const relationFields = visibleFields.filter((field) => field.type === 'relation' && field.relation?.model_id);
        if (relationFields.length === 0) {
            setRelationOptionsMap({});
            setLoadingRelationFields([]);
            return;
        }

        let ignore = false;

        const loadRelationOptions = async () => {
            const targetIds = Array.from(new Set(relationFields.map((field) => field.relation.model_id).filter(Boolean)));
            setLoadingRelationFields(targetIds);

            const results = await Promise.allSettled(relationFields.map(async (field) => {
                const targetModelId = field.relation.model_id;
                const response = await api.listModelInstanceRelationOptions(targetModelId, selectedModel?.id, field.name, editingInstanceId || '');
                return [`${field.name}_${targetModelId}`, response.options || []];
            }));

            if (ignore) {
                return;
            }

            const resolved = {};
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    const [key, options] = r.value;
                    resolved[key] = options;
                } else {
                    console.warn('关联模型选项加载失败:', r.reason);
                }
            }
            setRelationOptionsMap(resolved);
            setLoadingRelationFields([]);
        };

        loadRelationOptions();

        return () => {
            ignore = true;
        };
    }, [visibleFields, selectedModel?.id]);

    useEffect(() => {
        if (!editingInstanceId) {
            setInverseRelations([]);
            return;
        }
        let ignore = false;
        setInverseLoading(true);
        api.getInverseRelations(editingInstanceId).then((res) => {
            if (!ignore) {
                setInverseRelations(res?.relations || []);
                setInverseLoading(false);
            }
        }).catch(() => {
            if (!ignore) {
                setInverseRelations([]);
                setInverseLoading(false);
            }
        });
        return () => { ignore = true; };
    }, [editingInstanceId]);

    const resetForm = useCallback(() => {
        setForm({});
        setEditingInstanceId('');
        setIsCreateIntent(false);
        setShowModal(false);
        setSubmitting(false);
        setErrorMessage('');
        setInverseRelations([]);
    }, []);

    const openCreateModal = () => {
        if (!selectedModel) return;
        setForm(createFormFromModel(selectedModel, {}, user?.username || ''));
        setEditingInstanceId('');
        setIsCreateIntent(true);
        setShowModal(true);
        setErrorMessage('');
    };

    const openEditModal = (instance) => {
        if (!selectedModel) return;
        setForm(createFormFromModel(selectedModel, instance.data || {}, user?.username || '', instance));
        setEditingInstanceId(instance.id);
        setIsCreateIntent(false);
        setShowModal(true);
        setErrorMessage('');
    };

    const handleFieldChange = (field, value) => {
        setForm((prev) => ({
            ...prev,
            [field.name]: value,
        }));
    };

    const handleSearch = async () => {
        setSearchKeyword(keyword.trim());
        setCurrentPage(1);
    };

    const parsePasteFilters = (text) => {
        if (!text || !text.trim()) return null;
        let normalized = text.trim();
        normalized = normalized.replace(/'/g, '"');
        normalized = normalized.replace(/\bTrue\b/g, 'true');
        normalized = normalized.replace(/\bFalse\b/g, 'false');
        normalized = normalized.replace(/\bNone\b/g, 'null');
        try {
            const parsed = JSON.parse(normalized);
            if (!Array.isArray(parsed)) return null;
            return parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        } catch {
            return null;
        }
    };

    const handleApplyPasteFilter = () => {
        const parsed = parsePasteFilters(pasteFilterText);
        if (parsed === null && pasteFilterText.trim()) {
            window.alert('粘贴的过滤器格式不正确，请使用 JSON 或 Python 列表格式，例如：\n[{"instance_id": "xxx"}, {"status": true}]');
            return;
        }
        setParsedPasteFilters(parsed);
        setCurrentPage(1);
    };

    const handleClearPasteFilter = () => {
        setPasteFilterText('');
        setParsedPasteFilters(null);
        setShowPasteFilter(false);
        setCurrentPage(1);
    };

    useEffect(() => {
        if (!selectedModelId) return;
        const timer = setTimeout(() => {
            setSearchKeyword(keyword.trim());
            setCurrentPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [keyword, selectedModelId]);

    const handleToggleDisplayField = (fieldName) => {
        setSelectedDisplayFieldNames((prev) => {
            if (prev.includes(fieldName)) {
                if (prev.length === 1) {
                    return prev;
                }
                return prev.filter((item) => item !== fieldName);
            }

            return [...prev, fieldName];
        });
    };

    const handleSelectAllDisplayFields = () => {
        setSelectedDisplayFieldNames(visibleFields.map((field) => field.name));
    };

    const handleResetDisplayFields = () => {
        setSelectedDisplayFieldNames(defaultDisplayFields.map((field) => field.name));
    };

    const handleSubmit = async () => {
        if (!selectedModel) {
            setErrorMessage('请先选择模型');
            return;
        }

        setSubmitting(true);
        setErrorMessage('');

        try {
            const payload = {
                model_definition_id: selectedModel.id,
                data: buildPayloadFromForm(selectedModel, form),
            };

            if (isCreateIntent) {
                await api.createModelInstance(payload);
            } else if (editingInstanceId) {
                await api.updateModelInstance(editingInstanceId, payload);
            } else {
                await api.createModelInstance(payload);
            }

            resetForm();
            await loadInstances(selectedModel.id, searchKeyword, currentPage, pageSize, parsedPasteFilters);
        } catch (error) {
            console.error(error);
            const msg = error.message || '';
            if (/唯一|unique|duplicate/i.test(msg)) {
                window.alert(msg);
            } else {
                setErrorMessage(msg);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (instanceId) => {
        if (!window.confirm('确定删除这个模型实例吗？')) return;

        try {
            setErrorMessage('');
            await api.deleteModelInstance(instanceId);
            setSelectedInstanceIds((prev) => prev.filter((item) => item !== instanceId));
            await loadInstances(selectedModelId, searchKeyword, currentPage, pageSize, parsedPasteFilters);
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '删除模型实例失败');
        }
    };

    const handleToggleInstanceSelection = (instanceId) => {
        setSelectedInstanceIds((prev) => (
            prev.includes(instanceId)
                ? prev.filter((item) => item !== instanceId)
                : [...prev, instanceId]
        ));
    };

    const handleToggleSelectAllPaged = () => {
        if (instances.length === 0) {
            return;
        }

        setSelectedInstanceIds((prev) => {
            const pagedIds = instances.map((instance) => instance.id);
            if (pagedIds.every((instanceId) => prev.includes(instanceId))) {
                return prev.filter((instanceId) => !pagedIds.includes(instanceId));
            }

            return Array.from(new Set([...prev, ...pagedIds]));
        });
    };

    const handleBatchDelete = async () => {
        if (selectedInstanceIds.length === 0) {
            return;
        }

        if (!window.confirm(`确定批量删除已选中的 ${selectedInstanceIds.length} 条模型实例吗？`)) return;

        try {
            setErrorMessage('');
            const result = await api.batchDeleteModelInstances(selectedInstanceIds);
            const msg = result.message || '批量删除完成';
            setSelectedInstanceIds([]);
            await loadInstances(selectedModelId, searchKeyword, currentPage, pageSize, parsedPasteFilters);
            if (result.errors?.length > 0) {
                setErrorMessage(`${msg}，失败 ${result.errors.length} 条`);
            }
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '批量删除模型实例失败');
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login', {replace: true});
    };

    const handleExpandJson = useCallback((field, value) => {
        setExpandedJson({field: field.label || field.name, value});
    }, []);

    const handleCloseExpandJson = useCallback(() => {
        setExpandedJson(null);
    }, []);

    const handleExport = useCallback(async (mode) => {
        if (!selectedModel) return;
        setExporting(true);
        setShowExportModal(false);
        try {
            const fields = mode === 'all' ? visibleFields : activeDisplayFields;
            const result = await api.exportModelInstances({
                model_definition_id: selectedModel.id,
                keyword: searchKeyword,
                pasteFilters: parsedPasteFilters,
            });
            const items = result.items || [];
            if (items.length === 0) {
                alert('没有可导出的数据');
                return;
            }
            const wsData = [
                fields.map(f => f.label || f.name),
                ...items.map(item => fields.map(f => {
                    const raw = getInstanceFieldValue(item, f);
                    return getDisplayValue(f, raw, relationOptionsMap);
                })),
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            ws['!cols'] = fields.map(() => ({wch: 20}));
            XLSX.utils.book_append_sheet(wb, ws, '模型数据');
            XLSX.writeFile(wb, `${selectedModel.name}_${mode === 'all' ? '全部字段' : '当前展示字段'}.xlsx`);
        } catch (err) {
            alert('导出失败：' + (err.message || '未知错误'));
        } finally {
            setExporting(false);
        }
    }, [selectedModel, visibleFields, activeDisplayFields, searchKeyword, relationOptionsMap, parsedPasteFilters]);

    const handleExportTemplate = useCallback(() => {
        if (!selectedModel) return;
        const headerRow = visibleFields.map(f => ({
            v: (f.required || f.unique ? '*' : '') + (f.label || f.name),
            s: (f.required || f.unique) ? { font: { color: { rgb: 'FF0000' }, bold: true } } : {},
        }));
        const wsData = [headerRow];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = visibleFields.map(() => ({wch: 20}));
        XLSX.utils.book_append_sheet(wb, ws, '模版');
        XLSX.writeFile(wb, `${selectedModel.name}_导入模版.xlsx`);
    }, [selectedModel, visibleFields]);

    const handleImportFile = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportFile(file);
        setImportErrors([]);
        const reader = new FileReader();
        reader.onload = (evt) => {
            const data = new Uint8Array(evt.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: ''});
            if (rows.length === 0) {
                setImportPreview(null);
                return;
            }
            const headers = rows[0].map(h => String(h).replace(/^\*/, ''));
            const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));
            const fieldMap = {};
            visibleFields.forEach(f => {
                fieldMap[f.label?.trim()] = f;
                fieldMap[f.name?.trim()] = f;
            });
            const parsed = dataRows.map((row, ri) => {
                const item = {};
                let hasError = false;
                const errors = [];
                headers.forEach((header, ci) => {
                    const field = fieldMap[header];
                    if (!field) return;
                    const raw = row[ci] ?? '';
                    if (field.required && (raw === '' || raw === null || raw === undefined)) {
                        hasError = true;
                        errors.push(`${field.label || field.name}为必填`);
                        return;
                    }
                    if (field.unique && raw !== '') {
                        item[field.name] = raw;
                    } else if (field.type === 'boolean') {
                        item[field.name] = raw === true || raw === 'true' || raw === 1 || raw === '1';
                    } else if (field.type === 'number' || field.type === 'float') {
                        item[field.name] = raw === '' ? '' : Number(raw);
                    } else if (field.type === 'json' || field.type === 'struct' || field.type === 'array') {
                        if (raw === '' || raw === null || raw === undefined) {
                            item[field.name] = {};
                        } else if (typeof raw === 'string') {
                            try { item[field.name] = JSON.parse(raw); } catch { item[field.name] = raw; }
                        } else {
                            item[field.name] = raw;
                        }
                    } else {
                        item[field.name] = raw;
                    }
                });
                return {data: item, hasError, errors, rowIndex: ri + 2};
            });
            const previewData = {headers, rows: dataRows, fieldMap, parsed, total: parsed.length, errorCount: parsed.filter(p => p.hasError).length};
            setImportPreview(previewData);
            importPreviewRef.current = previewData;
        };
        reader.readAsArrayBuffer(file);
    }, [visibleFields]);

    const handleConfirmImport = useCallback(async () => {
        const preview = importPreviewRef.current;
        if (!selectedModel || !preview) return;

        const totalCount = preview.total - preview.errorCount;
        const hasUnique = visibleFields.some(f => f.unique);

        setShowImportModal(false);
        setGlobalImportProgress({done: 0, total: totalCount, updateCount: 0, finished: false});

        const items = preview.parsed.filter(item => !item.hasError).map(item => item.data);

        try {
            const result = await api.batchImportInstances({
                model_definition_id: selectedModel.id,
                items,
                update_by_unique: hasUnique,
            });
            setGlobalImportProgress({done: totalCount, total: totalCount, updateCount: result.updateCount || 0, finished: true});
            setImportFile(null);
            setImportPreview(null);
            importPreviewRef.current = null;
            await loadInstances(selectedModel.id, searchKeyword, currentPage, pageSize, parsedPasteFilters);
            const msg = result.failCount > 0
                ? `导入完成，成功 ${result.successCount} 条${result.updateCount > 0 ? `（其中 ${result.updateCount} 条更新）` : ''}，失败 ${result.failCount} 条`
                : `导入完成，共 ${result.successCount} 条${result.updateCount > 0 ? `（其中 ${result.updateCount} 条更新）` : ''}`;
            alert(msg);
        } catch (err) {
            setImportFile(null);
            setImportPreview(null);
            importPreviewRef.current = null;
            alert('导入失败：' + (err.message || '未知错误'));
        } finally {
            setGlobalImportProgress(null);
        }
    }, [selectedModel, visibleFields, loadInstances, searchKeyword, currentPage, pageSize, parsedPasteFilters]);

    return (
        <div className="app-shell app-shell-page">
            <AppSidebar
                title="模型数据"
                subtitle="模型实例数据管理"
                brandIcon="bi bi-card-list"
                theme={theme}
                onToggleTheme={toggleTheme}
                username={user?.username}
                onLogout={handleLogout}
            />

            <div className="app-content workflow-list-page task-page model-instance-page">

                <div className="model-split-layout">
                    <div className="model-nav-panel">
                        <div className="model-nav-header">
                            <h3>模型列表</h3>
                            <span className="model-count">{models.length}</span>
                        </div>
                        <div className="model-nav-list" ref={navListRef}>
                            {filteredModels.length === 0 ? (
                                <div className="model-nav-empty">{modelSearchQuery ? '未匹配到模型' : '暂无模型'}</div>
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
                                            <div className="model-nav-group-title"
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
                                                    className={`model-nav-item${selectedModelId === model.id ? ' active' : ''}`}
                                                    onClick={() => {
                                                        saveNavScroll();
                                                        setSelectedModelId(model.id);
                                                        setKeyword('');
                                                        setSearchKeyword('');
                                                        setCurrentPage(1);
                                                        setShowDisplayFieldPanel(false);
                                                        setSearchParams({});
                                                    }}
                                                >
                                                    <div className="model-nav-item-name">{model.name}</div>
                                                    <div
                                                        className="task-card-workflow">{model.model_id || model.id}</div>
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
                                onChange={(e) => {
                                    setModelSearchQuery(e.target.value);
                                    setSelectedModelId('');
                                }}
                            />
                        </div>
                    </div>
                    <div className="model-content-panel">
                        {errorMessage && (
                            <div className="task-error-banner" style={{margin: '12px 16px'}}>{errorMessage}</div>
                        )}
                        <div className="model-instance-topbar">
                            <div className="model-instance-filter-row">
                                <div className="model-instance-filter-group model-instance-toolbar-controls">
                                    <div className="form-group model-instance-search-group">
                                        <div className="model-instance-search-row">
                                            <input
                                                value={keyword}
                                                onChange={(event) => setKeyword(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        handleSearch();
                                                    }
                                                }}
                                                placeholder="搜索任意字段内容..."
                                                disabled={!selectedModel}
                                            />
                                            <button
                                                className="btn btn-default"
                                                type="button"
                                                onClick={handleSearch}
                                                disabled={!selectedModel}
                                            >
                                                <i className="bi bi-search"></i>
                                                搜索
                                            </button>

                                            <button
                                                className="btn btn-default"
                                                onClick={openCreateModal}
                                                disabled={!selectedModel}
                                            >
                                                <i className="bi bi-plus-circle"></i>
                                                新建实例
                                            </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="model-instance-table-shell">
                            <div className="model-instance-table-toolbar">
                                <div className="model-instance-table-title-block">
                                    <strong>{selectedModel?.name || '模型实例数据'}</strong>
                                    <span>
                                        {selectedModel
                                            ? `模型 ID：${selectedModel.model_id || selectedModel.id} · 实例数：${totalCount}`
                                            : '请先选择模型'}
                                    </span>
                                </div>

                                <div className="model-instance-toolbar-actions">
                                    <div className="model-instance-display-fields">
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={() => { setShowExportModal(prev => !prev); setShowDisplayFieldPanel(false); }}
                                            disabled={!selectedModel || instances.length === 0 || !perms.export}
                                        >
                                            <i className="bi bi-download"></i>
                                            导出EXCEL
                                        </button>
                                        {showExportModal && (
                                            <div className="model-instance-display-fields-panel" style={{position: 'absolute', right: 0, top: '100%', minWidth: 200, zIndex: 50}}>
                                                <div style={{padding: '8px 12px', fontSize: 13, color: 'var(--text-2)', borderBottom: '1px solid var(--border)'}}>
                                                    选择导出方式
                                                </div>
                                                <button className="model-instance-display-field-option" type="button"
                                                        style={{cursor: 'pointer', width: '100%', border: 'none', background: 'none', textAlign: 'left'}}
                                                        onClick={() => handleExport('all')}
                                                        disabled={exporting}>
                                                    导出全部字段数据
                                                </button>
                                                <button className="model-instance-display-field-option" type="button"
                                                        style={{cursor: 'pointer', width: '100%', border: 'none', background: 'none', textAlign: 'left'}}
                                                        onClick={() => handleExport('current')}
                                                        disabled={exporting}>
                                                    导出当前展示字段数据
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="btn btn-sm"
                                        type="button"
                                        onClick={handleExportTemplate}
                                        disabled={!selectedModel || !perms.exportTemplate}
                                    >
                                        <i className="bi bi-filetype-xlsx"></i>
                                        导出模版
                                    </button>
                                    <div className="model-instance-display-fields">
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={() => { setShowImportModal(true); setImportPreview(null); setImportFile(null); setImportErrors([]); }}
                                            disabled={!selectedModel || !perms.import}
                                        >
                                            <i className="bi bi-upload"></i>
                                            手动导入
                                        </button>
                                    </div>
                                    <div className="model-instance-display-fields">
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={() => setShowDisplayFieldPanel((prev) => !prev)}
                                            disabled={!selectedModel || visibleFields.length === 0}
                                        >
                                            展示字段（{activeDisplayFields.length}/{visibleFields.length}）
                                        </button>
                                        {showDisplayFieldPanel && selectedModel && visibleFields.length > 0 && (
                                            <div className="model-instance-display-fields-panel" style={{position: 'absolute', right: 0, top: '100%', zIndex: 50}}>
                                            <div className="model-instance-display-fields-actions">
                                                <button className="btn btn-link model-instance-clear-btn"
                                                        type="button"
                                                        onClick={handleSelectAllDisplayFields}>
                                                    全选
                                                </button>
                                                <button className="btn btn-link model-instance-clear-btn"
                                                        type="button"
                                                        onClick={handleResetDisplayFields}>
                                                    显示全部字段
                                                </button>
                                            </div>
                                            <div className="model-instance-display-fields-list">
                                                {visibleFields.map((field) => {
                                                    const checked = selectedDisplayFieldNames.includes(field.name);
                                                    const isOnlyOneSelected = checked && selectedDisplayFieldNames.length === 1;

                                                    return (
                                                        <label key={field.id || field.name}
                                                               className="model-instance-display-field-option">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                disabled={isOnlyOneSelected}
                                                                onChange={() => handleToggleDisplayField(field.name)}
                                                            />
                                                            <span>{field.label || field.name}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    </div>
                                </div>

                                <div className="model-instance-table-toolbar-right" style={{display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 100%', minWidth: 0}}>
                                    <div className="model-instance-page-size">
                                        <span>每页</span>
                                        <select
                                            value={pageSize}
                                            onChange={(event) => {
                                                setPageSizeMap((prev) => ({
                                                    ...prev,
                                                    [selectedModelId]: Number(event.target.value)
                                                }));
                                                setCurrentPage(1);
                                            }}
                                            disabled={!selectedModel}
                                        >
                                            <option value={5}>5 条</option>
                                            <option value={10}>10 条</option>
                                            <option value={20}>20 条</option>
                                            <option value={50}>50 条</option>
                                            <option value={100}>100 条</option>
                                            <option value={500}>500 条</option>
                                        </select>
                                    </div>

                                    <div className="model-instance-pagination-controls" style={{position: 'relative'}}>
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                            disabled={!selectedModel || currentPage <= 1}
                                        >
                                            上一页
                                        </button>
                                        <span
                                            className="model-instance-page-indicator">第 {currentPage} / {totalPages} 页</span>
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                                            disabled={!selectedModel || currentPage >= totalPages}
                                        >
                                            下一页
                                        </button>
                                        <div style={{position: 'relative', display: 'inline-block'}}>
                                         <button
                                             className="btn btn-sm btn-default"
                                             onClick={() => setShowPasteFilter((prev) => !prev)}
                                             disabled={!selectedModel}
                                             title="粘贴过滤器"
                                             style={parsedPasteFilters ? {background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)'} : {}}
                                         >
                                             <i className="bi bi-funnel"></i>
                                             高级查询
                                         </button>
                                         {showPasteFilter && (
                                             <div className="model-instance-display-fields-panel" style={{position: 'absolute', left: '100%', top: 0, minWidth: 420, zIndex: 50, marginLeft: 8}}>
                                                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
                                                    <span style={{fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap'}}>
                                                        粘贴过滤器（支持 JSON 或 Python 列表格式）
                                                    </span>
                                                    {parsedPasteFilters && (
                                                        <span style={{fontSize: 11, color: 'var(--success, #10b981)', whiteSpace: 'nowrap'}}>
                                                            已应用 {parsedPasteFilters.length} 个过滤条件
                                                        </span>
                                                    )}
                                                </div>
                                                <textarea
                                                    value={pasteFilterText}
                                                    onChange={(e) => setPasteFilterText(e.target.value)}
                                                    placeholder={'例如：\n[{"instance_id": "xxx"}]\n或 Python 格式：\n[{\'instance_id\': \'xxx\'}]'}
                                                    style={{
                                                        width: '100%',
                                                        minHeight: 60,
                                                        maxHeight: 120,
                                                        padding: '6px 10px',
                                                        fontSize: 12,
                                                        fontFamily: 'monospace',
                                                        borderRadius: 6,
                                                        border: '1px solid var(--border, #d0d7de)',
                                                        background: 'var(--surface-2, #f6f8fa)',
                                                        color: 'var(--text, #1f2328)',
                                                        resize: 'vertical',
                                                        boxSizing: 'border-box',
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                                            handleApplyPasteFilter();
                                                        }
                                                    }}
                                                />
                                                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                                                    <button
                                                        className="btn btn-sm"
                                                        onClick={handleApplyPasteFilter}
                                                        disabled={!selectedModel || !pasteFilterText.trim()}
                                                    >
                                                        <i className="bi bi-check-lg"></i>
                                                        应用
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-default"
                                                        onClick={handleClearPasteFilter}
                                                    >
                                                        <i className="bi bi-x-lg"></i>
                                                        清除
                                                    </button>
                                                    <span style={{fontSize: 11, color: 'var(--text-3, #656d76)'}}>
                                                        Ctrl+Enter 应用
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="model-instance-table-toolbar-right-end">
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                            onClick={handleBatchDelete}
                                            disabled={selectedInstanceIds.length === 0}
                                        >
                                            批量删除（{selectedInstanceIds.length}）
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="model-instance-table-scroll">
                                {(!selectedModel || loading || instances.length === 0) ? (
                                    <div className="instance-empty-panel">
                                        <div className="instance-empty-panel-content">
                                            {!selectedModel
                                                ? '当前没有可用模型，请先在模型配置页创建模型。'
                                                : loading
                                                    ? '正在加载模型实例数据...'
                                                    : '当前模型下还没有实例数据，请先创建。'}
                                        </div>
                                    </div>
                                ) : (
                                    <table className="model-instance-table">
                                        <thead>
                                        <tr>
                                            <th className="instance-col-checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={allPagedSelected}
                                                    ref={(node) => {
                                                        if (node) {
                                                            node.indeterminate = !allPagedSelected && somePagedSelected;
                                                        }
                                                    }}
                                                    onChange={handleToggleSelectAllPaged}
                                                    disabled={instances.length === 0}
                                                />
                                            </th>
                                            <th className="instance-col-primary">{primaryField?.label || primaryField?.name || '主字段'}</th>
                                            {secondaryFields.map((field) => (
                                                <th key={field.id || field.name}>{field.label || field.name}</th>
                                            ))}
                                            <th className="instance-col-actions">操作</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {instances.map((instance) => (
                                            <tr key={instance.id}>
                                                <td className="instance-col-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedInstanceIds.includes(instance.id)}
                                                        onChange={() => handleToggleInstanceSelection(instance.id)}
                                                    />
                                                </td>

                                                <td className="instance-col-primary">
                                                    <div className="instance-primary-cell" style={{cursor: 'pointer'}} onClick={() => setDetailInstance(instance)}>
                                                        <div className="instance-primary-text-block">
                                                            <strong
                                                                title={String(getInstanceFieldValue(instance, primaryField) ?? instance.id) || '—'}>
                                                                {primaryField ? getDisplayValue(primaryField, getInstanceFieldValue(instance, primaryField), relationOptionsMap, instance) : instance.id}
                                                            </strong>
                                                            <span>{instance.id}</span>
                                                            <span style={{fontSize: 11, color: 'var(--text-3)'}}>{instance.username || '—'}</span>
                                                        </div>
                                                    </div>
                                                </td>

                                                {secondaryFields.map((field) => (
                                                    <td key={field.id || field.name}>
                                                        {renderCellContent(field, getInstanceFieldValue(instance, field), instance.id, relationOptionsMap, handleExpandJson, instance)}
                                                    </td>
                                                ))}

                                                <td className="instance-col-actions">
                                                    <div className="instance-row-actions">
                                                        <button className="btn btn-sm" type="button"
                                                                onClick={() => openEditModal(instance)}>
                                                            编辑
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger-solid"
                                                            type="button"
                                                            onClick={() => handleDelete(instance.id)}
                                                        >
                                                            删除
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {showModal && selectedModel && (
                    <div className="modal-overlay">
                        <div className="modal-box model-instance-modal" onClick={(event) => event.stopPropagation()}>
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon"><i className={'bi bi-card-list'}></i></span>
                                    <div>
                                        <h3 className="modal-title">{editingInstanceId ? '编辑模型实例' : '新建模型实例'}</h3>
                                        <div className="modal-subtitle">当前模型：{selectedModel.name}</div>
                                    </div>
                                </div>
                                <div className="model-instance-display-fields">
                                        <button
                                            className="btn btn-sm"
                                            type="button"
                                        onClick={() => { setShowDisplayFieldPanel((prev) => !prev); setShowExportModal(false); }}
                                            disabled={!selectedModel || visibleFields.length === 0}
                                        >
                                            展示字段（{activeDisplayFields.length}/{visibleFields.length}）
                                        </button>
                                        {showDisplayFieldPanel && selectedModel && visibleFields.length > 0 && (
                                            <div className="model-instance-display-fields-panel" style={{position: 'absolute', right: 0, top: '100%', zIndex: 50}}>
                                                <div className="model-instance-display-fields-actions">
                                                    <button className="btn btn-link model-instance-clear-btn"
                                                            type="button"
                                                            onClick={handleSelectAllDisplayFields}>
                                                        全选
                                                    </button>
                                                    <button className="btn btn-link model-instance-clear-btn"
                                                            type="button"
                                                            onClick={handleResetDisplayFields}>
                                                        显示全部字段
                                                    </button>
                                                </div>
                                                <div className="model-instance-display-fields-list">
                                                    {visibleFields.map((field) => {
                                                        const checked = selectedDisplayFieldNames.includes(field.name);
                                                        const isOnlyOneSelected = checked && selectedDisplayFieldNames.length === 1;

                                                        return (
                                                            <label key={field.id || field.name}
                                                                   className="model-instance-display-field-option">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    disabled={isOnlyOneSelected}
                                                                    onChange={() => handleToggleDisplayField(field.name)}
                                                                />
                                                                <span>{field.label || field.name}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                </div>
                            </div>

                            {errorMessage && (
                                <div className="task-error-banner" style={{margin: '0 20px 12px'}}>{errorMessage}</div>
                            )}
                            <div className="modal-body model-instance-modal-body">
                                <div className="form-grid model-instance-form-grid">
                                    {visibleFields.map((field) => {
                                        const relationTargetModelId = field.relation?.model_id || '';
                                        const relationOptions = relationOptionsMap[`${field.name}_${relationTargetModelId}`] || relationOptionsMap[relationTargetModelId] || [];
                                        const relationLoading = relationTargetModelId && loadingRelationFields.includes(relationTargetModelId);
                                        const multiRelation = field.type === 'relation' && isMultiRelationField(field);

                                        const isRelField = field.type === 'relation' && multiRelation;

                                        return (
                                            <div key={field.id || field.name} className={`form-group${isRelField ? ' form-group-wide' : ''}`}>
                                                <label>
                                                    {field.label || field.name}
                                                    <span
                                                        className="form-hint-inline">{getFieldTypeLabel(field.type)}</span>
                                                </label>

                                                {field.type === 'text' && (
                                                    <textarea
                                                        value={form[field.name] ?? ''}
                                                        rows={4}
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder={field.description || `请输入${field.label || field.name}`}
                                                    />
                                                )}

                                                {field.type === 'boolean' && (
                                                    <label className="task-switch-row">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(form[field.name])}
                                                            onChange={(event) => handleFieldChange(field, event.target.checked)}
                                                            disabled={!editingInstanceId && isStatusField(field)}
                                                        />
                                                        <span>
                                                            {isStatusField(field)
                                                                ? (Boolean(form[field.name]) ? '有效' : '无效')
                                                                : (Boolean(form[field.name]) ? '是' : '否')}
                                                        </span>
                                                    </label>
                                                )}

                                                {field.type === 'json' && (
                                                    <textarea
                                                        value={form[field.name] ?? '{}'}
                                                        rows={6}
                                                        className="task-json-input"
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder="请输入合法 JSON 对象"
                                                    />
                                                )}

                                                {field.type === 'number' && (
                                                    <input
                                                        type="number"
                                                        value={form[field.name] ?? ''}
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder={field.description || `请输入${field.label || field.name}`}
                                                    />
                                                )}

                                                {field.type === 'float' && (
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        value={form[field.name] ?? ''}
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder={field.description || `请输入${field.label || field.name}`}
                                                    />
                                                )}

                                                {field.type === 'enum' && (
                                                    <select
                                                        value={form[field.name] ?? ''}
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                    >
                                                        <option value="">请选择{field.label || field.name}</option>
                                                        {(field.enum_options || []).map((option) => (
                                                            <option key={option} value={option}>{option}</option>
                                                        ))}
                                                    </select>
                                                )}

                                                {field.type === 'struct' && (
                                                    <textarea
                                                        value={form[field.name] ?? '[]'}
                                                        rows={6}
                                                        className="task-json-input"
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder="请输入合法 JSON 数组"
                                                    />
                                                )}

                                                {field.type === 'array' && (
                                                    <textarea
                                                        value={form[field.name] ?? '[]'}
                                                        rows={6}
                                                        className="task-json-input"
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder='请输入 JSON 数组，如 ["item1", "item2"]'
                                                    />
                                                )}

                                                {field.type === 'relation' && field.relation?.auto_generated && editingInstanceId && (
                                                    <div className="model-instance-relation-input-wrap">
                                                        <div className="form-hint" style={{marginBottom: 6}}>
                                                            此字段由关联模型自动生成，在当前模型中只读展示。
                                                        </div>
                                                        <div className="instance-primary-text-block" style={{padding: '6px 0'}}>
                                                            <strong>{inverseRelations.filter((r) => r.source_field_name === field.relation.source_field_name).map((r) => r.source_instance_label).join(', ') || '—'}</strong>
                                                        </div>
                                                    </div>
                                                )}

                                                {field.type === 'relation' && !field.relation?.auto_generated && (
                                                    <div className="model-instance-relation-input-wrap">
                                                        {multiRelation ? (
                                                            <RelationMultiDropdown
                                                                value={Array.isArray(form[field.name]) ? form[field.name] : []}
                                                                options={relationOptions}
                                                                field={field}
                                                                onChange={(values) => handleFieldChange(field, values)}
                                                                disabled={relationLoading || !relationTargetModelId}
                                                                loading={relationLoading}
                                                            />
                                                        ) : (
                                                             <select
                                                                 className="model-instance-relation-select"
                                                                 value={form[field.name] ?? ''}
                                                                 onChange={(event) => handleFieldChange(field, event.target.value)}
                                                                 disabled={relationLoading || !relationTargetModelId}
                                                             >
                                                                 <option value="">----</option>
                                                                 {relationOptions.map((option) => (
                                                                     <option key={option.value} value={option.value} disabled={option.bound}>
                                                                         {getRelationOptionLabel(field, option)}{option.bound ? ' (已被绑定)' : ''}
                                                                     </option>
                                                                 ))}
                                                            </select>
                                                        )}
                                                        <div className="form-hint model-instance-relation-hint">
                                                            {relationLoading
                                                                ? '正在加载关联模型数据...'
                                                                : relationOptions.length > 0
                                                                    ? `可选 ${relationOptions.length} 条关联数据`
                                                                    : '暂无可绑定的关联数据'}
                                                        </div>
                                                    </div>
                                                )}

                                                {(field.type === 'string' || field.type === 'date' || field.type === 'datetime') && (
                                                    <input
                                                        type={field.type === 'datetime' && !isSystemReadonlyField(field) ? 'datetime-local' : (field.type === 'date' ? 'date' : 'text')}
                                                        value={isSystemReadonlyField(field) ? formatDateTime(form[field.name]) : (form[field.name] ?? '')}
                                                        onChange={(event) => handleFieldChange(field, event.target.value)}
                                                        placeholder={field.description || `请输入${field.label || field.name}`}
                                                        disabled={isSystemReadonlyField(field)}
                                                    />
                                                )}

                                                {isSystemReadonlyField(field) && (
                                                    <div className="form-hint">
                                                        {field.name === 'createTime' ? '创建时间由系统在首次入库时自动生成，后续不可修改。'
                                                            : field.name === 'creator' ? '创建人由当前登录用户自动写入。'
                                                                : field.name === 'updated_at' ? '更新时间由系统在数据变更时自动更新。'
                                                                    : '创建时间由系统在数据入库时自动生成。'}
                                                    </div>
                                                )}

                                                {!editingInstanceId && isStatusField(field) && (
                                                    <div
                                                        className="form-hint">数据状态在新建入库时默认写入为“有效”。</div>
                                                )}

                                                <div
                                                    className={field.required && field.unique ? 'form-hint-error' : 'form-hint'}>
                                                    字段名：{field.name}
                                                    {field.required ? ' · 必填' : ''}
                                                    {field.unique ? ' · 唯一' : ''}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {editingInstanceId && (
                                <div className="modal-section-inverse">
                                    <div className="modal-section-title">关联信息</div>
                                    {inverseLoading ? (
                                        <div className="form-hint">正在加载关联数据...</div>
                                    ) : inverseRelations.length === 0 ? (
                                        <div className="form-hint">暂无其他模型的数据关联到此实例</div>
                                    ) : (
                                        <div className="inverse-relation-list">
                                            {inverseRelations.map((rel, idx) => (
                                                <div key={idx} className="inverse-relation-item">
                                                    <span className="inverse-relation-model">{rel.source_model_name}</span>
                                                    <span className="inverse-relation-sep">·</span>
                                                    <span className="inverse-relation-field">{rel.source_field_label || rel.source_field_name}</span>
                                                    <span className="inverse-relation-sep">→</span>
                                                    <span className="inverse-relation-instance">{rel.source_instance_label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="modal-footer">
                                <button className="btn" onClick={resetForm} disabled={submitting}>取消</button>
                                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting} style={{background: '#fff', border: '1px solid var(--border)', color: 'var(--text)'}}>
                                    <i className="bi bi-pencil-square"/> {submitting ? '保存中...' : '保存实例'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {expandedJson && (
                    <div className="modal-overlay" onClick={handleCloseExpandJson}>
                        <div className="modal-box json-expand-modal" onClick={(event) => event.stopPropagation()}>
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon"><i className="bi bi-card-list"/></span>
                                    <div>
                                        <h3 className="modal-title">{expandedJson.field}</h3>
                                        <div className="modal-subtitle">完整字段内容</div>
                                    </div>
                                </div>
                                <button className="modal-close" onClick={handleCloseExpandJson}>✕</button>
                            </div>
                            <div className="modal-body json-expand-body">
                                <pre className="json-expand-content">{JSON.stringify(expandedJson.value, null, 2)}</pre>
                            </div>
                            <div className="modal-footer">
                                <button className="btn" onClick={() => {
                                    const text = JSON.stringify(expandedJson.value, null, 2);
                                    navigator.clipboard.writeText(text).then(() => {
                                        setJsonCopied(true);
                                        setTimeout(() => setJsonCopied(false), 1500);
                                    });
                                }}>{jsonCopied ? '已复制' : <span><i className="bi bi-clipboard"/> 复制JSON</span>}</button>
                                <button className="btn" onClick={handleCloseExpandJson}>关闭</button>
                            </div>
                        </div>
                    </div>
                )}

                {showImportModal && (
                    <div className="modal-overlay" onClick={() => { setShowImportModal(false); setImportPreview(null); setImportFile(null); setImportErrors([]); }}>
                        <div className="modal-box" style={{width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column'}} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-accent"/>
                            <div className="modal-header">
                                <div className="modal-title-group">
                                    <span className="modal-icon"><i className="bi bi-upload"/></span>
                                    <div>
                                        <h3 className="modal-title">手动导入</h3>
                                        <div className="modal-subtitle">从导出模版编辑的 Excel 文件导入数据</div>
                                    </div>
                                </div>
                                <button className="modal-close" onClick={() => { setShowImportModal(false); setImportPreview(null); setImportFile(null); setImportErrors([]); }}>✕</button>
                            </div>
                            <div className="modal-body" style={{flex: 1, overflow: 'auto', padding: '16px 24px'}}>
                                <div style={{marginBottom: 16}}>
                                    <label style={{display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)'}}>
                                        选择 Excel 文件（.xlsx / .xls）
                                    </label>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={handleImportFile}
                                        style={{fontSize: 13}}
                                    />
                                    {importFile && <div style={{fontSize: 12, color: 'var(--text-3)', marginTop: 4}}>已选择: {importFile.name}</div>}
                                </div>
                                {importPreview && (
                                    <div style={{marginBottom: 16}}>
                                        <div style={{fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)'}}>
                                            数据预览（共 {importPreview.total} 行{importPreview.errorCount > 0 ? `，${importPreview.errorCount} 行有必填字段缺失` : ''}）
                                        </div>
                                        <div style={{overflow: 'auto', maxHeight: 320, border: '1px solid var(--border)', borderRadius: 8}}>
                                            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                                                <thead>
                                                    <tr>
                                                        <th style={{padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', position: 'sticky', top: 0}}>#</th>
                                                        {importPreview.headers.map((h, i) => (
                                                            <th key={i} style={{padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', whiteSpace: 'nowrap', position: 'sticky', top: 0}}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {importPreview.parsed.slice(0, 50).map((item, ri) => (
                                                        <tr key={ri} style={{background: item.hasError ? 'rgba(239,68,68,0.06)' : ri % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'}}>
                                                            <td style={{padding: '4px 8px', borderBottom: '1px solid var(--border-2)', color: 'var(--text-3)'}}>{item.rowIndex}</td>
                                                            {importPreview.headers.map((h, ci) => {
                                                                const field = importPreview.fieldMap[h];
                                                                const val = field ? (item.data[field.name] ?? '') : '';
                                                                return <td key={ci} style={{padding: '4px 8px', borderBottom: '1px solid var(--border-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={String(val)}>{String(val)}</td>;
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {importPreview.total > 50 && <div style={{padding: '6px 8px', fontSize: 12, color: 'var(--text-3)', textAlign: 'center'}}>仅显示前 50 行...</div>}
                                        </div>
                                    </div>
                                )}
                                {importErrors.length > 0 && (
                                    <div style={{marginBottom: 16, padding: 12, background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)'}}>
                                        <div style={{fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 4}}>导入错误</div>
                                        {importErrors.map((err, i) => (
                                            <div key={i} style={{fontSize: 12, color: '#ef4444'}}>{err}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn" onClick={() => { setShowImportModal(false); setImportPreview(null); setImportFile(null); setImportErrors([]); }}>取消</button>
                                <button className="btn" onClick={handleConfirmImport} disabled={!importPreview || !!importProgress}>
                                    <i className="bi bi-upload"/> {importing ? '导入中...' : `确认导入${importPreview ? `（${importPreview.total - importPreview.errorCount} 条）` : ''}`}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {detailInstance && selectedModel && (
                    <div className="inspect-drawer-overlay">
                        <div className="inspect-drawer" style={{width: 720}}>
                            <div className="inspect-drawer-header">
                                <h3><i className="bi bi-card-list"/> {primaryField ? getDisplayValue(primaryField, getInstanceFieldValue(detailInstance, primaryField), relationOptionsMap, detailInstance) : detailInstance.id}</h3>
                                <button className="inspect-drawer-close" onClick={() => setDetailInstance(null)}>✕</button>
                            </div>
                            <div className="inspect-drawer-body" style={{padding: '0 24px 24px'}}>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px'}}>
                                    <div style={{padding: '10px 0', borderBottom: '1px solid var(--border-2)'}}>
                                        <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 3}}>ID</div>
                                        <div style={{fontSize: 13, wordBreak: 'break-all', color: 'var(--text-2)'}}>{detailInstance.id}</div>
                                    </div>
                                    <div style={{padding: '10px 0', borderBottom: '1px solid var(--border-2)'}}>
                                        <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 3}}>创建者</div>
                                        <div style={{fontSize: 13, color: 'var(--text-2)'}}>{detailInstance.username || '—'}</div>
                                    </div>
                                    {detailInstance.created_at && (
                                        <div style={{padding: '10px 0', borderBottom: '1px solid var(--border-2)'}}>
                                            <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 3}}>创建时间</div>
                                            <div style={{fontSize: 13, color: 'var(--text-2)'}}>{formatDateTime(detailInstance.created_at)}</div>
                                        </div>
                                    )}
                                    {detailInstance.updated_at && (
                                        <div style={{padding: '10px 0', borderBottom: '1px solid var(--border-2)'}}>
                                            <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 3}}>更新时间</div>
                                            <div style={{fontSize: 13, color: 'var(--text-2)'}}>{formatDateTime(detailInstance.updated_at)}</div>
                                        </div>
                                    )}
                                </div>
                                <div style={{marginTop: 18, marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6}}>
                                    <i className="bi bi-card-list" style={{fontSize: 14}}/> 字段数据
                                </div>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
                                    {selectedModel.fields?.filter(f => f.type !== 'relation' || !f.relation?.auto_generated).map((field) => {
                                        const value = getInstanceFieldValue(detailInstance, field);
                                        const displayValue = getDisplayValue(field, value, relationOptionsMap, detailInstance);
                                        const isJson = field.type === 'json' || field.type === 'struct' || field.type === 'array';
                                        const isBoolean = field.type === 'boolean';
                                        const isWide = isJson;
                                        return (
                                            <div key={field.id || field.name} style={{
                                                gridColumn: isWide ? '1 / -1' : undefined,
                                                background: 'rgba(128,128,128,0.08)',
                                                borderRadius: 8,
                                                padding: '10px 14px',
                                            }}>
                                                <div style={{display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5}}>
                                                    <span style={{fontSize: 13, fontWeight: 600, color: 'var(--text)'}}>{field.label || field.name}</span>
                                                    {field.required && <span style={{fontSize: 9, color: '#ef4444'}}>*必填</span>}
                                                    {field.unique && <span style={{fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 3}}>唯一</span>}
                                                    <span style={{fontSize: 10, color: 'var(--accent)', marginLeft: 'auto', padding: '1px 6px', borderRadius: 3}}>
                                                        {field.type === 'relation' ? (field.relation?.relation_type === 'oneToMany' || field.relation?.relation_type === 'one_to_many' ? '一对多'
                                                            : field.relation?.relation_type === 'manyToOne' || field.relation?.relation_type === 'many_to_one' ? '多对一'
                                                            : field.relation?.relation_type === 'manyToMany' || field.relation?.relation_type === 'many_to_many' ? '多对多'
                                                            : '一对一')
                                                            : field.type === 'boolean' ? '布尔' : field.type === 'number' ? '数字' : field.type === 'float' ? '浮点数'
                                                            : field.type === 'date' ? '日期' : field.type === 'datetime' ? '日期时间'
                                                            : field.type === 'enum' ? '枚举' : field.type === 'text' ? '长文本' : '字符串'}
                                                    </span>
                                                </div>
                                                <div style={{fontSize: 13, color: 'var(--text-2)', wordBreak: 'break-all'}}>
                                                    {isBoolean ? (
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center',
                                                            padding: '2px 8px', borderRadius: 4, fontSize: 12,
                                                            background: value ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                                            color: value ? '#22c55e' : '#ef4444',
                                                        }}>{value ? '是' : '否'}</span>
                                                    ) : isJson && value != null && value !== '' && !(Array.isArray(value) && value.length === 0) ? (
                                                        <pre style={{margin: 0, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0d1117', color: '#e6edf3', padding: '8px 10px', borderRadius: 4, maxHeight: 180, overflowY: 'auto'}}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
                                                    ) : (
                                                        <span>{displayValue}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {importProgress && createPortal(
                <div style={{position: 'fixed', bottom: 24, right: 24, zIndex: 99999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 20px', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', minWidth: 260}}>
                    <div style={{fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6}}>
                        <i className="bi bi-arrow-repeat" style={{animation: 'spin 1s linear infinite'}}/>
                        正在导入...
                    </div>
                    <div style={{height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden'}}>
                        <div style={{height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${importProgress.total > 0 ? Math.round(importProgress.done / importProgress.total * 100) : 0}%`, transition: 'width 0.3s'}}/>
                    </div>
                    <div style={{fontSize: 12, color: 'var(--text-2)', marginTop: 6}}>
                        {importProgress.done} / {importProgress.total}{importProgress.updateCount > 0 ? `（已更新 ${importProgress.updateCount} 条）` : ''}
                    </div>
                </div>,
                document.body
            )}
        </div>
        </div>
        </div>
    )
        ;
}
