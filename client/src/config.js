const buildConfig = (() => {
  try {
    return window.__BUILD_CONFIG__ || {};
  } catch { return {}; }
})();

export function getFlaskApiBase() {
  return buildConfig?.FLASK_API_BASE || 'http://localhost:5001';
}

export function getCmdbApiBase() {
  return buildConfig?.CMDB_API_BASE || 'http://localhost:5003';
}

export function getAiGraphApiBase() {
  return buildConfig?.AI_GRAPH_API_BASE || 'http://localhost:5002';
}

export function getMonitorApiBase() {
  return '';
}

export function getAssistantApiBase() {
  return '/api/assistant';
}

export function getLoginPageBranding() {
  return buildConfig?.LOGIN_PAGE || null;
}

export function loadConfig() {
  return Promise.resolve(buildConfig);
}
