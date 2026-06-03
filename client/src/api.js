import {API_BASE} from './constants';

const AUTH_TOKEN_KEY = 'promptflow_auth_token';

export function getStoredAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token) {
    if (!token) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        return;
    }
    localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function parseErrorResponse(res) {
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}));
        return err.error || err.message || res.statusText || 'Request failed';
    }

    const text = await res.text().catch(() => '');
    const normalizedText = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (/Cannot\s+(GET|POST|PUT|DELETE|PATCH)\s+/i.test(normalizedText)) {
        return '接口不存在，请确认服务端已重启并已加载最新认证接口';
    }

    return normalizedText || res.statusText || 'Request failed';
}

async function request(path, options = {}, retries = 3) {
    const token = getStoredAuthToken();
    const lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? {Authorization: `Bearer ${token}`} : {}),
                    ...options.headers,
                },
                ...options,
                body: options.body ? JSON.stringify(options.body) : undefined,
            });

            if (!res.ok) {
                const errMsg = await parseErrorResponse(res);
                if (res.status === 403) {
                    alert(`⚠️ 权限不足: ${errMsg}`);
                    return;
                }
                const error = new Error(errMsg);
                if (attempt === retries) {
                    throw error;
                }
                console.warn(`[RETRY] 请求失败 (尝试 ${attempt}/${retries}):`, error.message);
                await new Promise(resolve => setTimeout(resolve, attempt * 100));
                continue;
            }

            return res.json();
        } catch (error) {
            if (error.message && error.message.includes('权限不足')) return;
            if (attempt === retries) {
                throw error;
            }
            console.warn(`[RETRY] 请求异常 (尝试 ${attempt}/${retries}):`, error.message);
            await new Promise(resolve => setTimeout(resolve, attempt * 100));
        }
    }
}

export async function streamChat({messages = [], model = '', onMessage, onError, signal}) {
    const res = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({messages, model: model || undefined}),
        signal,
    });

    if (!res.ok) {
        throw new Error(await parseErrorResponse(res));
    }

    if (!res.body) {
        throw new Error('服务端未返回可读取的数据流');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const normalizeChunkPayload = (parsed) => {
        const choice = parsed?.choices?.[0] || {};
        const delta = choice?.delta || parsed?.delta || {};
        const message = choice?.message || parsed?.message || {};
        const thought = parsed?.thought
            || delta?.reasoning_content
            || delta?.reasoning
            || message?.reasoning_content
            || message?.reasoning
            || '';
        const content = parsed?.content
            || delta?.content
            || message?.content
            || parsed?.text
            || '';

        if (parsed?.error) {
            return {error: parsed.error};
        }

        return {
            thought: typeof thought === 'string' ? thought : '',
            content: typeof content === 'string' ? content : '',
        };
    };

    const emitPayload = (payload) => {
        if (!payload) {
            return false;
        }

        if (payload === '[DONE]') {
            return true;
        }

        if (typeof payload === 'string') {
            const text = payload.trim();
            if (!text) {
                return false;
            }

            if (text === '[DONE]') {
                return true;
            }

            try {
                return emitPayload(JSON.parse(text));
            } catch (error) {
                if (onMessage) {
                    onMessage({content: text, thought: ''});
                }
                return false;
            }
        }

        const normalized = normalizeChunkPayload(payload);
        if (normalized?.error) {
            if (onError) {
                onError(normalized.error);
            }
            return false;
        }

        if ((normalized?.content || normalized?.thought) && onMessage) {
            onMessage(normalized);
        }

        return false;
    };

    const emitBlock = (block) => {
        const text = String(block || '').trim();
        if (!text) {
            return false;
        }

        const dataLines = text
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''));

        if (dataLines.length) {
            for (const line of dataLines) {
                if (emitPayload(line)) {
                    return true;
                }
            }
            return false;
        }

        return emitPayload(text);
    };

    while (true) {
        const {value, done} = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), {stream: !done});

        const segments = buffer.split(/\r?\n\r?\n/);
        buffer = segments.pop() || '';

        for (const block of segments) {
            if (emitBlock(block)) {
                return;
            }
        }

        if (done) {
            if (buffer.trim()) {
                emitBlock(buffer.trim());
            }
            return;
        }
    }
}

export const api = {
    register: (data) => request('/auth/register', {method: 'POST', body: data}),
    login: (data) => request('/auth/login', {method: 'POST', body: data}),
    getMe: () => request('/auth/me'),
    logout: () => request('/auth/logout', {method: 'POST'}),
    listWorkflows: () => request('/workflows').then(r => (r ? (r.items || r) : [])),
    getWorkflow: (id) => request(`/workflows/${id}`),
    createWorkflow: (data) => request('/workflows', {method: 'POST', body: data}),
    updateWorkflow: (id, data) => request(`/workflows/${id}`, {method: 'PUT', body: data}),
    deleteWorkflow: (id) => request(`/workflows/${id}`, {method: 'DELETE'}),
    getExecutions: (id) => request(`/workflows/${id}/executions`).then(r => (r ? (r.items || r) : [])),
    getExecution: (workflowId, execId) => request(`/workflows/${workflowId}/executions/${execId}`),
    listTasks: () => request('/tasks').then(r => (r ? (r.items || r) : [])),
    createTask: (data) => request('/tasks', {method: 'POST', body: data}),
    updateTask: (id, data) => request(`/tasks/${id}`, {method: 'PUT', body: data}),
    deleteTask: (id) => request(`/tasks/${id}`, {method: 'DELETE'}),
    runTask: (id) => request(`/tasks/${id}/run`, {method: 'POST'}),
    listAllTaskExecutions: (page = 1, pageSize = 5) => request(`/tasks/all-executions?page=${page}&page_size=${pageSize}`),
    getTaskExecution: (execId) => request(`/task-executions/${execId}`),
    listRunningExecutions: () => request('/tasks/running-executions'),
    listModels: (params) => {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request(`/models${qs}`).then(r => (r ? (r.items || r) : []));
    },
    createModel: (data) => request('/models', {method: 'POST', body: data}),
    updateModel: (id, data) => request(`/models/${id}`, {method: 'PUT', body: data}),
    deleteModel: (id) => request(`/models/${id}`, {method: 'DELETE'}),
    listModelInstanceModels: (params) => {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request(`/model-instances/meta/models${qs}`).then(r => (r ? (r.items || r) : []));
    },
    listSkills: () => request('/skills').then(r => (r ? (r.items || r) : [])),
    listModelInstanceRelationOptions: (modelDefinitionId, sourceModelId, sourceFieldName, excludeInstanceId) => {
        const params = new URLSearchParams({model_definition_id: modelDefinitionId});
        if (sourceModelId) params.set('source_model_id', sourceModelId);
        if (sourceFieldName) params.set('source_field_name', sourceFieldName);
        if (excludeInstanceId) params.set('exclude_instance_id', excludeInstanceId);
        return request(`/model-instances/meta/relation-options?${params.toString()}`);
    },
    getInverseRelations: (instanceId) => {
        return request(`/model-instances/${instanceId}/inverse-relations`);
    },
    listModelInstances: ({model_definition_id, keyword = '', page, per_page, filters = {}, pasteFilters = null}) => {
        const params = new URLSearchParams({model_definition_id});
        if (keyword) params.set('keyword', keyword);
        if (page) params.set('page', page);
        if (per_page) params.set('per_page', per_page);
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined) {
                params.set(key, value);
            }
        });
        if (pasteFilters && pasteFilters.length > 0) {
            params.set('filters', JSON.stringify(pasteFilters));
        }
        return request(`/model-instances?${params.toString()}`);
    },
    createModelInstance: (data) => request('/model-instances', {method: 'POST', body: data}),
    updateModelInstance: (id, data) => request(`/model-instances/${id}`, {method: 'PUT', body: data}),
    getModelInstanceAlerts: () => request('/model-instances/alerts').then(r => r || {alerts: []}),
    deleteModelInstance: (id) => request(`/model-instances/${id}`, {method: 'DELETE'}),
    batchDeleteModelInstances: (ids) => request('/model-instances/batch-delete', {method: 'POST', body: {ids}}),
    deleteAllModelInstances: (modelDefinitionId) => request('/model-instances/delete-by-model', {method: 'POST', body: {model_definition_id: modelDefinitionId}}),
    exportModelInstances: async ({model_definition_id, keyword = '', filters = {}, pasteFilters = null}) => {
        const perPage = 5000;
        let page = 1;
        let allItems = [];
        let total = Infinity;
        while (allItems.length < total) {
            const params = new URLSearchParams({model_definition_id, per_page: String(perPage), page: String(page)});
            if (keyword) params.set('keyword', keyword);
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== '' && value !== null && value !== undefined) {
                    params.set(key, value);
                }
            });
            if (pasteFilters && pasteFilters.length > 0) {
                params.set('filters', JSON.stringify(pasteFilters));
            }
            const result = await request(`/model-instances?${params.toString()}`);
            const items = result.items || [];
            total = result.total || total;
            allItems = allItems.concat(items);
            if (items.length < perPage) break;
            page++;
        }
        return {items: allItems, total};
    },
    batchImportInstances: ({model_definition_id, items, update_by_unique = true}) => request('/model-instances/batch-import', {
        method: 'POST',
        body: {model_definition_id, items, update_by_unique},
    }),
    streamChat,

    // 灵犀助手对话（linxi_chat_messages 表）
    linxiListSessions: () => request('/linxi-chat/sessions').then(r => (r ? (r.items || r) : [])),
    linxiCreateSession: (data) => request('/linxi-chat/sessions', {method: 'POST', body: data}),
    linxiUpdateSession: (id, data) => request(`/linxi-chat/sessions/${id}`, {method: 'PUT', body: data}),
    linxiGetMessages: (sessionId) => request(`/linxi-chat/sessions/${sessionId}/messages`).then(r => (r ? (r.items || r) : [])),
    linxiAddMessage: (sessionId, data) => request(`/linxi-chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: data
    }),
    linxiUpdateMessage: (sessionId, msgId, data) => request(`/linxi-chat/sessions/${sessionId}/messages/${msgId}`, {
        method: 'PUT',
        body: data
    }),

    listScripts: () => request('/scripts').then(r => (r ? (r.items || r) : [])),
    createScript: (data) => request('/scripts', {method: 'POST', body: data}),
    updateScript: (id, data) => request(`/scripts/${id}`, {method: 'PUT', body: data}),
    deleteScript: (id) => request(`/scripts/${id}`, {method: 'DELETE'}),

    // 模型消耗统计
    recordModelUsage: (data) => request('/model-usage/record', {method: 'POST', body: data}),
    getModelUsageStats: () => request('/model-usage/stats'),

    // 巡检历史
    listInspectionHistory: (page = 1, pageSize = 5) => request(`/inspection-history?page=${page}&page_size=${pageSize}`),

    // SSH 执行历史（cmdb）
    listSshHistory: (page = 1, pageSize = 10) => request(`/ssh-history?page=${page}&per_page=${pageSize}`),

    // CMDB 入库历史（async_jobs）
    listAsyncJobs: (page = 1, pageSize = 10) => request(`/async-jobs?page=${page}&page_size=${pageSize}`),
    updateScriptDebugStatus: (id, debug_status) => request(`/scripts/${id}/debug-status`, {
        method: 'PATCH',
        body: {debug_status}
    }),

    // Permissions API
    listPermissions: () => request('/permissions'),
    createPermission: (data) => request('/permissions', {method: 'POST', body: data}),
    deletePermission: (id) => request(`/permissions/${id}`, {method: 'DELETE'}),

    listRoles: () => request('/roles'),
    createRole: (data) => request('/roles', {method: 'POST', body: data}),
    updateRole: (id, data) => request(`/roles/${id}`, {method: 'PUT', body: data}),
    deleteRole: (id) => request(`/roles/${id}`, {method: 'DELETE'}),
    getRolePermissions: (id) => request(`/roles/${id}/permissions`),
    assignRolePermissions: (id, permissionIds) => request(`/roles/${id}/permissions`, {
        method: 'POST', body: {permission_ids: permissionIds}
    }),

    listUsers: () => request('/users'),
    getUserRoles: (userId) => request(`/users/${userId}/roles`),
    assignUserRoles: (userId, roleIds) => request(`/users/${userId}/roles`, {
        method: 'POST', body: {role_ids: roleIds}
    }),
    getUserPermissions: (userId) => request(`/users/${userId}/permissions`),

    listUserGroups: () => request('/user-groups'),
    createUserGroup: (data) => request('/user-groups', {method: 'POST', body: data}),
    updateUserGroup: (id, data) => request(`/user-groups/${id}`, {method: 'PUT', body: data}),
    deleteUserGroup: (id) => request(`/user-groups/${id}`, {method: 'DELETE'}),
    getGroupMembers: (id) => request(`/user-groups/${id}/members`),
    addGroupMembers: (id, userIds) => request(`/user-groups/${id}/members`, {
        method: 'POST', body: {user_ids: userIds}
    }),
    removeGroupMember: (groupId, userId) => request(`/user-groups/${groupId}/members/${userId}`, {method: 'DELETE'}),
    getGroupRoles: (id) => request(`/user-groups/${id}/roles`),
    assignGroupRoles: (id, roleIds) => request(`/user-groups/${id}/roles`, {
        method: 'POST', body: {role_ids: roleIds}
    }),

    listResourcePermissions: (params) => {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request(`/resource-permissions${qs}`);
    },
    createResourcePermission: (data) => request('/resource-permissions', {method: 'POST', body: data}),
    deleteResourcePermission: (id) => request(`/resource-permissions/${id}`, {method: 'DELETE'}),

    checkPermission: (resourceType, resourceId, permission) =>
        request(`/check-permission?resource_type=${resourceType}&resource_id=${resourceId}&permission=${permission}`),

    // AI图谱 (AI识谱)
    listAIGraphs: (params) => {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request(`/ai-graphs${qs}`).then(r => (r ? (r.items || r) : []));
    },
    getAIGraph: (id) => request(`/ai-graphs/${id}`),
    createAIGraph: (data) => request('/ai-graphs', {method: 'POST', body: data}),
    updateAIGraph: (id, data) => request(`/ai-graphs/${id}`, {method: 'PUT', body: data}),
    deleteAIGraph: (id) => request(`/ai-graphs/${id}`, {method: 'DELETE'}),
};
