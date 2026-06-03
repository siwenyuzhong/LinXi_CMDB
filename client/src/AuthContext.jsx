import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {api, clearAuthToken, getStoredAuthToken, setAuthToken} from './api';

const AuthContext = createContext(null);

export function AuthProvider({children}) {
    const [token, setToken] = useState(() => getStoredAuthToken());
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const logout = useCallback(async ({silent = false} = {}) => {
        try {
            if (!silent && token) {
                await api.logout();
            }
        } catch (error) {
            console.error(error);
        } finally {
            clearAuthToken();
            setToken('');
            setUser(null);
            setLoading(false);
        }
    }, [token]);

    const applyAuth = useCallback((payload) => {
        if (!payload?.token || !payload?.user) {
            throw new Error('登录响应无效');
        }

        setAuthToken(payload.token);
        setToken(payload.token);
        setUser(payload.user);
        setLoading(false);
    }, []);

    const login = useCallback(async (username, password) => {
        const payload = await api.login({username, password});
        applyAuth(payload);
        return payload.user;
    }, [applyAuth]);

    const register = useCallback(async (username, password) => {
        const payload = await api.register({username, password});
        applyAuth(payload);
        return payload.user;
    }, [applyAuth]);

    const refreshMe = useCallback(async (retries = 3) => {
        const currentToken = getStoredAuthToken();
        if (!currentToken) {
            setLoading(false);
            setUser(null);
            setToken('');
            return null;
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await api.getMe();
                setToken(currentToken);
                setUser(response.user);
                setLoading(false);
                return response.user;
            } catch (error) {
                if (error.message && error.message.includes('401')) {
                    await logout({silent: true});
                    return null;
                }
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        setLoading(false);
        return null;
    }, [logout]);

    useEffect(() => {
        refreshMe();
    }, [refreshMe]);

    const value = useMemo(() => ({
        token,
        user,
        loading,
        isAuthenticated: Boolean(token && user),
        login,
        register,
        logout,
        refreshMe,
    }), [token, user, loading, login, register, logout, refreshMe]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth 必须在 AuthProvider 内使用');
    }
    return context;
}
