import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import { useAuth } from '../AuthContext';
import { getCmdbApiBase } from '../config';
import { getStoredAuthToken } from '../api';
import AppSidebar from '../components/AppSidebar';

function RuleForm({ rule, models, onSave, onCancel }) {
  const [name, setName] = useState(rule?.name || '');
  const [modelId, setModelId] = useState(rule?.model_id || '');
  const [modelName, setModelName] = useState(rule?.model_name || '');
  const [cronExpr, setCronExpr] = useState(rule?.cron_expr || '');
  const [expireDays, setExpireDays] = useState(rule?.validation_config?.days || 7);
  const [expireHours, setExpireHours] = useState(rule?.validation_config?.hours || 0);
  const [expireMinutes, setExpireMinutes] = useState(rule?.validation_config?.minutes || 0);
  const cmdbBase = getCmdbApiBase();
  const token = getStoredAuthToken();
  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : {}, [token]);

  const selectedModel = models.find(m => m.id === modelId || m.model_id === modelId);

  const handleSave = () => {
    if (!name.trim() || !modelId) return;
    onSave({
      name: name.trim(),
      model_id: modelId,
      model_name: modelName || selectedModel?.name || '',
      check_field: 'updated_at',
      validation_type: 'recent',
      validation_config: { days: expireDays, hours: expireHours, minutes: expireMinutes },
      cron_expr: cronExpr,
    });
  };

  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border-2)',
      borderRadius: 10,
      padding: 24,
      marginBottom: 20,
    }}>
      <h4 style={{ margin: '0 0 16px' }}>{rule ? '编辑规则' : '新建规则'}</h4>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)' }}>规则名称</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="例如：服务器数据有效性校验"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)' }}>选择模型</label>
          <select value={modelId} onChange={e => {
            const m = models.find(mi => mi.id === e.target.value || mi.model_id === e.target.value);
            setModelId(e.target.value);
            setModelName(m?.name || '');
          }}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}>
            <option value="">-- 请选择模型 --</option>
            {models.map(m => (
              <option key={m.id || m.model_id} value={m.id || m.model_id}>
                {m.name} ({m.model_id || m.id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)' }}>校验字段</label>
          <div style={{
            padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
            background: 'var(--surface-3)', color: 'var(--text-2)', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <i className="bi bi-lock" style={{ fontSize: 12 }}/>
            更新时间 (updated_at) — 系统固定字段
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)' }}>
          数据过期时间（数据超过以下时间未更新视为无效）
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <input type="number" value={expireDays} min={0}
              onChange={e => setExpireDays(parseInt(e.target.value) || 0)}
              style={{ width: 80, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
                background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }} />
            <span style={{ marginLeft: 4, fontSize: 13, color: 'var(--text-3)' }}>天</span>
          </div>
          <div>
            <input type="number" value={expireHours} min={0} max={23}
              onChange={e => setExpireHours(parseInt(e.target.value) || 0)}
              style={{ width: 80, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
                background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }} />
            <span style={{ marginLeft: 4, fontSize: 13, color: 'var(--text-3)' }}>小时</span>
          </div>
          <div>
            <input type="number" value={expireMinutes} min={0} max={59}
              onChange={e => setExpireMinutes(parseInt(e.target.value) || 0)}
              style={{ width: 80, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
                background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }} />
            <span style={{ marginLeft: 4, fontSize: 13, color: 'var(--text-3)' }}>分钟</span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-3)' }}>
          Cron 表达式 (留空则不自动调度)
        </label>
        <input value={cronExpr} onChange={e => setCronExpr(e.target.value)}
          placeholder="例如：*/30 * * * * (每30分钟), 0 * * * * (每小时整点), 0 9 * * 1-5 (工作日9点)"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-2)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-default" onClick={handleSave}>
          <i className="bi bi-check-circle"/> 保存
        </button>
        <button className="btn" onClick={onCancel}>
          <i className="bi bi-x-circle"/> 取消
        </button>
      </div>
    </div>
  );
}

function ResultsPanel({ ruleId, cmdbBase, authHeaders }) {
  const [results, setResults] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const perPage = 10;

  const fetchResults = (p) => {
    setLoading(true);
    fetch(`${cmdbBase}/api/data-validity/results?rule_id=${ruleId}&page=${p}&per_page=${perPage}`, { headers: authHeaders })
      .then(r => r.json())
      .then(d => {
        setResults(d.items || []);
        setTotal(d.total || 0);
        setPage(p);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const openModal = () => {
    setShowModal(true);
    fetchResults(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn" onClick={openModal}
        style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="bi bi-clock-history"/> 检查记录
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-accent" style={{ background: 'transparent' }}/>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon"><i className="bi bi-card-checklist"/></span>
                <div>
                  <h3 className="modal-title">检查记录</h3>
                  <div className="modal-subtitle">共 {total} 条记录</div>
                </div>
              </div>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>加载中...</div>
              ) : results.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>暂无检查记录</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {results.map(r => (
                    <div key={r.id} style={{
                      padding: '10px 14px', borderRadius: 6,
                      border: '1px solid var(--border-2)', fontSize: 13,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <span style={{ color: 'var(--text-3)' }}>{r.checked_at?.slice(0, 19)?.replace('T', ' ')}</span>
                        <span style={{ margin: '0 8px', color: 'var(--text-3)' }}>|</span>
                        <span>共 {r.total_count} 条, </span>
                        <span style={{ color: '#22c55e' }}>有效 {r.valid_count}</span>
                        <span style={{ margin: '0 4px' }}>/</span>
                        <span style={{ color: r.invalid_count > 0 ? '#ef4444' : 'var(--text-3)' }}>
                          无效 {r.invalid_count}
                        </span>
                        <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>({r.duration_ms}ms)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {totalPages > 1 && (
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
                padding: '12px 24px', borderTop: '1px solid var(--border-2)',
              }}>
                <button className="btn" disabled={page <= 1} onClick={() => fetchResults(page - 1)}
                  style={{ fontSize: 13 }}>
                  <i className="bi bi-chevron-left"/> 上一页
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{page} / {totalPages}</span>
                <button className="btn" disabled={page >= totalPages} onClick={() => fetchResults(page + 1)}
                  style={{ fontSize: 13 }}>
                  下一页 <i className="bi bi-chevron-right"/>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DataValidity() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const cmdbBase = getCmdbApiBase();
  const token = getStoredAuthToken();
  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : {}, [token]);

  const [rules, setRules] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [triggering, setTriggering] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchModels = useCallback(async () => {
    try {
      const resp = await fetch(`${cmdbBase}/api/model-instances/meta/models?per_page=999`, { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        setModels(data.items || []);
      }
    } catch {}
  }, [cmdbBase, authHeaders]);

  const fetchRules = useCallback(async () => {
    try {
      const resp = await fetch(`${cmdbBase}/api/data-validity/rules?per_page=999`, { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        setRules(data.items || []);
      }
    } catch (err) {
      console.error('获取规则失败:', err);
    } finally {
      setLoading(false);
    }
  }, [cmdbBase, authHeaders]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${cmdbBase}/api/check-permission?resource_type=data-validity&resource_id=*&permission=data-validity:read`, { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (!data.allowed) {
            alert('⚠️ 权限不足: 无权限查看数据有效性维护');
            return;
          }
        }
      } catch (_) {}
    })();
    fetchModels();
    fetchRules();
  }, [fetchModels, fetchRules]);

  const handleSave = async (ruleData) => {
    try {
      if (editRule) {
        const resp = await fetch(`${cmdbBase}/api/data-validity/rules/${editRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(ruleData),
        });
        if (!resp.ok) { const e = await resp.json(); alert(e.error || '更新失败'); return; }
      } else {
        const resp = await fetch(`${cmdbBase}/api/data-validity/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(ruleData),
        });
        if (!resp.ok) { const e = await resp.json(); alert(e.error || '创建失败'); return; }
      }
      setShowForm(false);
      setEditRule(null);
      fetchRules();
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  };

  const handleDelete = async (ruleId) => {
    if (!confirm('确定删除此规则？')) return;
    try {
      const resp = await fetch(`${cmdbBase}/api/data-validity/rules/${ruleId}`, {
        method: 'DELETE', headers: authHeaders,
      });
      if (!resp.ok) { const e = await resp.json(); alert(e.error || '删除失败'); return; }
      fetchRules();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleToggle = async (ruleId, enabled) => {
    try {
      await fetch(`${cmdbBase}/api/data-validity/rules/${ruleId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ enabled }),
      });
      fetchRules();
    } catch (err) {
      alert('操作失败: ' + err.message);
    }
  };

  const handleTrigger = async (ruleId) => {
    setTriggering(ruleId);
    try {
      const resp = await fetch(`${cmdbBase}/api/data-validity/rules/${ruleId}/trigger`, {
        method: 'POST', headers: authHeaders,
      });
      if (!resp.ok) { const e = await resp.json(); alert(e.error || '触发失败'); return; }
      const result = await resp.json();
      alert(`检查完成!\n总计: ${result.total_count}\n有效: ${result.valid_count}\n无效: ${result.invalid_count}\n耗时: ${result.duration_ms}ms`);
      fetchRules();
    } catch (err) {
      alert('触发失败: ' + err.message);
    } finally {
      setTriggering(null);
    }
  };

  const handleLogout = async () => { await logout(); };

  if (!user) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>请先登录</div>;

  return (
    <div className="app-shell app-shell-page">
      <AppSidebar
        title="数据有效性"
        subtitle="维护模型数据有效性"
        brandIcon="bi bi-check2-square"
        theme={theme}
        onToggleTheme={toggleTheme}
        username={user?.username}
        onLogout={handleLogout}
      />
      <div className="app-content workflow-list-page task-page model-instance-page">
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 12,
          padding: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0, flexShrink: 0 }}>数据有效性规则</h3>
            <div style={{ flex: 1 }}/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="form-group" style={{position: 'relative', margin: 0, display: 'inline-flex', flexDirection: 'row', alignItems: 'center', width: 240}}>
                <i className="bi bi-search" style={{
                  position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-2)', fontSize: 13, pointerEvents: 'none', zIndex: 1
                }}/>
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  placeholder="搜索规则名称..."
                  style={{width: '100%', paddingLeft: 30, height: 34}}
                />
              </div>
              <button className="btn btn-default" onClick={() => { setShowForm(true); setEditRule(null); }}>
                <i className="bi bi-plus-circle"/> 新建规则
              </button>
              <button className="btn" onClick={() => navigate('/platform-config')}>
                <i className="bi bi-arrow-left"/> 返回
              </button>
            </div>
          </div>

          {showForm && (
            <RuleForm
              rule={editRule}
              models={models}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditRule(null); }}
            />
          )}

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>加载中...</div>
          ) : rules.length === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-3)',
              background: 'var(--surface-3)', borderRadius: 8,
              border: '1px solid var(--border-2)'
            }}>
              暂无数据有效性规则
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 4 }}>
              {rules.filter(r => !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase())).map(rule => (
                <div key={rule.id} style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 10,
                  padding: 20,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <strong style={{ fontSize: 15 }}>{rule.name}</strong>
                        <span style={{
                          fontSize: 12, padding: '1px 8px', borderRadius: 4,
                          background: rule.enabled ? '#dcfce7' : '#fef2f2',
                          color: rule.enabled ? '#16a34a' : '#ef4444',
                        }}>
                          {rule.enabled ? '已启用' : '已停用'}
                        </span>
                        {rule.last_run_at && (
                          <span style={{
                            fontSize: 12, padding: '1px 8px', borderRadius: 4,
                            background: rule.last_status === 'completed' ? '#dcfce7' : '#fef2f2',
                            color: rule.last_status === 'completed' ? '#16a34a' : '#ef4444',
                          }}>
                            {rule.last_status === 'completed' ? '上次成功' : '上次失败'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.8 }}>
                        <span>模型: <strong>{rule.model_name || rule.model_id}</strong></span>
                        <span style={{ margin: '0 12px' }}>|</span>
                        <span>字段: 更新时间 (<code style={{ background: 'var(--surface-3)', padding: '1px 6px', borderRadius: 4 }}>{rule.check_field}</code>)</span>
                        <span style={{ margin: '0 12px' }}>|</span>
                        <span>校验: 时效校验</span>
                        {rule.validation_config && (
                          <>
                            <span style={{ margin: '0 12px' }}>|</span>
                            <span>过期: {rule.validation_config.days || 0}天{rule.validation_config.hours || 0}小时{rule.validation_config.minutes || 0}分钟</span>
                          </>
                        )}
                        {rule.cron_expr && (
                          <>
                            <span style={{ margin: '0 12px' }}>|</span>
                            <span>Cron: <code style={{ background: 'var(--surface-3)', padding: '1px 6px', borderRadius: 4 }}>{rule.cron_expr}</code></span>
                          </>
                        )}
                        {rule.last_run_at && (
                          <>
                            <span style={{ margin: '0 12px' }}>|</span>
                            <span>上次检查: {rule.last_run_at?.slice(0, 19)?.replace('T', ' ')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                      <button className="btn" onClick={() => handleTrigger(rule.id)}
                        disabled={triggering === rule.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                        {triggering === rule.id ? (
                          <><i className="bi bi-arrow-repeat spin"/> 检查中</>
                        ) : (
                          <><i className="bi bi-play-fill"/> 执行</>
                        )}
                      </button>
                      <button className="btn" onClick={() => {
                        setEditRule(rule);
                        setShowForm(true);
                      }} style={{ fontSize: 13 }}>
                        <i className="bi bi-pencil"/> 编辑
                      </button>
                      <button className="btn" onClick={() => handleToggle(rule.id, !rule.enabled)}
                        style={{ fontSize: 13 }}>
                        <i className={`bi bi-toggle-${rule.enabled ? 'on' : 'off'}`}/>
                        {rule.enabled ? '停用' : '启用'}
                      </button>
                      <button className="btn" onClick={() => handleDelete(rule.id)}
                        style={{ fontSize: 13, color: '#ef4444' }}>
                        <i className="bi bi-trash"/> 删除
                      </button>
                    </div>
                  </div>

                  <ResultsPanel ruleId={rule.id} cmdbBase={cmdbBase} authHeaders={authHeaders} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
