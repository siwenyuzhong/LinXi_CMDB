import React, {useEffect, useMemo, useState} from 'react';
import {NavLink} from 'react-router-dom';

const NAV_ITEMS = [
    {to: '/chat', label: '首页', icon: 'bi bi-chat-dots', end: true},
    {to: '/', label: '工作看板', icon: 'bi bi-newspaper', end: true},
    {to: '/workflows', label: 'AI工作流', icon: 'bi bi-menu-button-wide-fill'},
    {to: '/models', label: '模型配置', icon: 'bi bi-pencil-square'},
    {to: '/model-instances', label: '模型数据', icon: 'bi bi-card-list\r️'},
    {to: '/scripts', label: '工具库', icon: 'bi bi-terminal'},
    {to: '/tasks', label: '任务管理', icon: 'bi bi-alarm', end: true},
    {to: '/skills', label: '技能管理', icon: 'bi bi-tools'},
    {to: '/skill-development', label: '对话运维', icon: 'bi bi-robot'},
    {to: '/hosts', label: '主机管理', icon: 'bi bi-laptop-fill'},
    {to: '/platform-config', label: '平台配置', icon: 'bi bi-gear\r️'},
    {to: '/tasks/history', label: '任务历史', icon: 'bi bi-files'},
];

export default function AppSidebar(
    {
        title,
        subtitle,
        brandIcon = '⚡',
        actions = null,
        footer = null,
        theme,
        onToggleTheme,
        username,
        onLogout,
    }) {
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

    useEffect(() => {
        localStorage.setItem('sidebarCollapsed', collapsed);
    }, [collapsed]);

    const sidebarClassName = useMemo(
        () => `app-sidebar ${collapsed ? 'collapsed' : ''}`,
        [collapsed],
    );

    return (
        <>
            <aside className={sidebarClassName}>
                <div className="app-sidebar-header">
                    <div className="app-brand">
                        {brandIcon.startsWith('bi ') ? <i className={`app-brand-icon ${brandIcon}`}/> :
                            <span className="app-brand-icon">{brandIcon}</span>}
                        <div className="app-brand-text">
                            <span className="app-brand-name">AI灵犀 · 心有灵犀</span>
                            <strong className="app-brand-title">{title}</strong>
                            {subtitle && <span className="app-brand-subtitle">{subtitle}</span>}
                        </div>
                    </div>
                </div>

                <div className="app-sidebar-top">
                    <nav className="app-sidebar-nav">
                        {NAV_ITEMS.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.end}
                                className={({isActive}) => `app-nav-link ${isActive ? 'active' : ''}`}
                                title={collapsed ? item.label : undefined}
                            >
                                {item.icon.startsWith('bi ') ? <i className={`app-nav-icon ${item.icon}`}/> :
                                    <span className="app-nav-icon">{item.icon}</span>}
                                <span className="app-nav-label">{item.label}</span>
                            </NavLink>
                        ))}
                    </nav>

                    {(actions || footer) && (
                        <div className="app-sidebar-section-group">
                            {actions && (
                                <section className="app-sidebar-section">
                                    <div className="app-sidebar-section-title">快捷操作</div>
                                    <div className="app-sidebar-action-list">{actions}</div>
                                </section>
                            )}
                        </div>
                    )}
                </div>

                <div className="app-sidebar-collapse-bar" onClick={() => setCollapsed((prev) => !prev)}>
                    <button
                        type="button"
                        className="btn-icon app-sidebar-collapse-btn"
                        title={collapsed ? '展开导航栏' : '收起导航栏'}
                        aria-label={collapsed ? '展开导航栏' : '收起导航栏'}
                        aria-pressed={collapsed}
                    >
                        <span className="app-sidebar-collapse-btn-icon">{collapsed ? '→' : '←'}</span>
                    </button>
                </div>

            </aside>
            <div className="app-topbar">
                <button className="btn btn-icon app-topbar-btn" onClick={onToggleTheme}
                        title={theme === 'dark' ? '切换浅色' : '切换深色'}>
                    <i className={`${theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill'}`}/>
                </button>
                <span className="app-topbar-user">
                    <i className="bi bi-person-circle"/>
                    {username || '未登录'}
                </span>
                <button className="btn btn-icon app-topbar-btn" onClick={onLogout} title="退出登录">
                    <i className="bi bi-box-arrow-right"/>
                </button>
            </div>
        </>
    );
}
