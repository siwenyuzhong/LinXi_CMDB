import React, {useState, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {useAuth} from '../AuthContext';
import {useTheme} from '../ThemeContext';
import {getLoginPageBranding} from '../config';
import Modal from '../components/Modal';

export default function LoginPage() {
    const navigate = useNavigate();
    const {theme, toggleTheme} = useTheme();
    const {login, register} = useAuth();
    const [form, setForm] = useState({username: '', password: ''});
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const b = getLoginPageBranding() || {};
    const brandBadge = b.brand_badge || '✦';
    const brandTitle = b.brand_title || 'AI灵犀 · 心有灵犀';
    const brandSubtitle = b.brand_subtitle || '新一代AI技能与工作流协同平台';

    const handleAction = async (action) => {
        setErrorMessage('');
        setSubmitting(true);
        await new Promise(r => setTimeout(r, 0));
        try {
            if (action === 'register') {
                await register(form.username, form.password);
            } else {
                await login(form.username, form.password);
            }
            navigate('/chat', {replace: true});
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || (action === 'register' ? '注册失败' : '登录失败'));
        }
        setSubmitting(false);
    };

    return (
        <div className="workflow-list-page auth-page">
            <div className="auth-card-wrap">
                <div className="auth-card">
                    <div className="auth-brand-header">
                        <span className="logo">{brandBadge}</span>
                        <h1 className="auth-brand-title">{brandTitle}</h1>
                        <p className="auth-brand-subtitle">{brandSubtitle}</p>
                    </div>

                    <div className="form-group">
                        <label>用户名</label>
                        <input
                            value={form.username}
                            onChange={(event) => setForm((prev) => ({...prev, username: event.target.value}))}
                            placeholder="请输入用户名"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label>密码</label>
                        <input
                            type="password"
                            value={form.password}
                            onChange={(event) => setForm((prev) => ({...prev, password: event.target.value}))}
                            placeholder="请输入密码"
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleAction('login');
                                }
                            }}
                        />
                    </div>

                    <div className="modal-footer auth-actions">
                        <button className="btn btn-primary" onClick={() => handleAction('login')} disabled={submitting}>
                            登录
                        </button>
                        <button className="btn" onClick={() => handleAction('register')} disabled={submitting}>
                            注册
                        </button>
                        <button className="btn theme-toggle-btn" onClick={toggleTheme} title="切换主题">
                            {theme === 'dark' ? '☀️' : '🌙'}
                        </button>
                    </div>

                    <div className="auth-hint">默认管理员账号：admin / admin123456</div>
                </div>
            </div>

            <Modal
                open={!!errorMessage}
                onClose={() => setErrorMessage('')}
                title="提示"
                type="error"
                width={400}
                footer={
                    <button className="btn btn-primary" onClick={() => setErrorMessage('')}>
                        确定
                    </button>
                }
            >
                <p style={{margin: 0, lineHeight: 1.7, fontSize: 14}}>{errorMessage}</p>
            </Modal>
        </div>
    );
}
