import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripQuotes(s) {
    return s.replace(/^['"]|['"]$/g, '').trim();
}

function loadConfigOnce() {
    try {
        const cfgPath = path.resolve(__dirname, '../config.yaml');
        const raw = fs.readFileSync(cfgPath, 'utf-8');
        const parsed = {};
        const m = raw.match(/LOGIN_PAGE:\s*\n((?:\s+.*\n?)*)/);
        if (m) {
            const lines = m[1].split('\n').filter(Boolean);
            for (const line of lines) {
                const [, k, v] = line.match(/\s+(\w+):\s*(?:["']?(.*?)["']?\s*$)/) || [];
                if (k) parsed[k] = v || '';
            }
        }
        const flask = raw.match(/FLASK_API_BASE:\s*(.+)/);
        const cmdb = raw.match(/CMDB_API_BASE:\s*(.+)/);
        const graph = raw.match(/AI_GRAPH_API_BASE:\s*(.+)/);
        const monitor = raw.match(/MONITOR:\s*\n\s+port:\s*(\d+)/);
        return {
            LOGIN_PAGE: parsed,
            FLASK_API_BASE: flask ? stripQuotes(flask[1]) : 'http://localhost:5001',
            CMDB_API_BASE: cmdb ? stripQuotes(cmdb[1]) : 'http://localhost:9080',
            AI_GRAPH_API_BASE: graph ? stripQuotes(graph[1]) : 'http://localhost:5002',
            MONITOR_API_BASE: monitor ? `http://localhost:${monitor[1]}` : 'http://localhost:5005',
        };
    } catch { return {}; }
}

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'inject-config',
            transformIndexHtml(html) {
                const cfg = loadConfigOnce();
                const b = cfg.LOGIN_PAGE || {};
                const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
                return html
                    .replace(/\{\{BRAND_TITLE\}\}/g, b.brand_title || '灵犀AI')
                    .replace(/\{\{BRAND_ICON\}\}/g, b.brand_icon || '🦏')
                    .replace('</head>', `<script>window.__BUILD_CONFIG__=${json}</script>\n</head>`);
            },
        },
    ],
    server: {
        host: "127.0.0.1",
        port: 5173,
        proxy: {
            '/api/assistant/': {
                target: 'http://localhost:5004',
                changeOrigin: true,
            },
            '/api/monitor/': {
                target: 'http://localhost:5005',
                changeOrigin: true,
            },
            '/api/monitor-items': {
                target: 'http://localhost:5005',
                changeOrigin: true,
            },
            '/api/alert-events': {
                target: 'http://localhost:5005',
                changeOrigin: true,
            },
            '/api/monitor': {
                target: 'http://localhost:5005',
                changeOrigin: true,
            },
            '/api/': {
                target: 'http://localhost:5003',
                changeOrigin: true,
            },
        },
        hmr: true,
        fs: {
            allow: [path.resolve(__dirname, '..')],
        },
    },
});
