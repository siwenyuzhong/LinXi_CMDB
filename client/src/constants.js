export const NODE_TYPES = {
    start: {
        label: '开始',
        color: '#22c55e',
        bgColor: '#052e16',
        icon: '▶',
        description: '工作流入口，定义输入变量',
        defaultData: {
            label: '开始',
            variables: [{name: 'input_text', type: 'string', defaultValue: ''}],
        },
    },
    llm: {
        label: 'LLM',
        color: '#f97316',
        bgColor: '#431407',
        icon: '🤖',
        description: '调用大语言模型',
        defaultData: {
            label: 'LLM',
            model: 'gpt-3.5-turbo',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            temperature: 0.7,
            maxTokens: 2048,
            systemPrompt: '你是一个有帮助的AI助手。',
            prompt: '{{input_text}}',
        },
    },
    http: {
        label: 'HTTP',
        color: '#3b82f6',
        bgColor: '#172554',
        icon: '🌐',
        description: '发送 HTTP 请求',
        defaultData: {
            label: 'HTTP 请求',
            method: 'GET',
            url: 'https://api.example.com/data',
            headers: '{}',
            body: '',
        },
    },
    code: {
        label: '代码',
        color: '#a855f7',
        bgColor: '#2e1065',
        icon: '💻',
        description: '执行代码',
        defaultData: {
            label: '代码执行',
            language: 'javascript',  // ← 新增默认语言
            code: '// 使用 context 和 input 变量\nreturn context.output || "result";',
        },
    },
    condition: {
        label: '条件',
        color: '#eab308',
        bgColor: '#422006',
        icon: '◇',
        description: '条件分支判断',
        defaultData: {
            label: '条件判断',
            condition: 'context.score > 80',
        },
    },
    prompt: {
        label: 'Prompt',
        color: '#14b8a6',
        bgColor: '#042f2e',
        icon: '📝',
        description: 'Prompt 模板拼接',
        defaultData: {
            label: 'Prompt 模板',
            template: '请根据以下内容回答问题：\n{{input_text}}',
        },
    },
    end: {
        label: '结束',
        color: '#ef4444',
        bgColor: '#450a0a',
        icon: '⏹',
        description: '工作流出口，定义输出',
        defaultData: {
            label: '结束',
            outputKeys: [],
        },
    },
};

export const API_BASE = '/api';
