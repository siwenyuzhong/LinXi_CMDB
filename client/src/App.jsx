import React from 'react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ThemeProvider} from './ThemeContext';
import {AuthProvider, useAuth} from './AuthContext';
import HomePage from './pages/HomePage';
import ChatHome from './pages/ChatHome';
import ScriptList from './pages/ScriptList';
import WorkflowList from './pages/WorkflowList';
import WorkflowEditor from './pages/WorkflowEditor';
import TaskList from './pages/TaskList';
import TaskHistory from './pages/TaskHistory';
import ModelList from './pages/ModelList';
import ModelInstanceList from './pages/ModelInstanceList';
import SkillList from './pages/SkillList';
import SkillDetail from './pages/SkillDetail';
import SkillDevelopmentPage from './pages/SkillDevelopmentPage';
import HostList from './pages/HostList';
import PlatformConfig from './pages/PlatformConfig';
import PermissionManagement from './pages/PermissionManagement';
import AIGraph from './pages/AIGraph';
import DataValidity from './pages/DataValidity';
import ApiDocs from './pages/ApiDocs';
import NotificationConfig from './pages/NotificationConfig';
import ModelDataManagement from './pages/ModelDataManagement';
import AlertManagement from './pages/AlertManagement';
import LoginPage from './pages/LoginPage';
import ScrollRestoration from './components/ScrollRestoration';

function AppRoutes() {
    const {loading, isAuthenticated} = useAuth();

    if (loading) {
        return <div className="loading">登录状态检查中...</div>;
    }

    return (
        <Routes>
            <Route
                path="/login"
                element={isAuthenticated ? <Navigate to="/chat" replace/> : <LoginPage/>}
            />
            <Route
                path="/chat"
                element={isAuthenticated ? <ChatHome/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/"
                element={isAuthenticated ? <HomePage/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/workflows"
                element={isAuthenticated ? <WorkflowList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/tasks"
                element={isAuthenticated ? <TaskList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/tasks/history"
                element={isAuthenticated ? <TaskHistory/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/models"
                element={isAuthenticated ? <ModelList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/model-instances"
                element={isAuthenticated ? <ModelInstanceList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/scripts"
                element={isAuthenticated ? <ScriptList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/skills"
                element={isAuthenticated ? <SkillList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/skills/:skillId"
                element={isAuthenticated ? <SkillDetail/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/skill-development"
                element={isAuthenticated ? <SkillDevelopmentPage/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/hosts"
                element={isAuthenticated ? <HostList/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config"
                element={isAuthenticated ? <PlatformConfig/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/permissions"
                element={isAuthenticated ? <PermissionManagement/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/ai-graph"
                element={isAuthenticated ? <AIGraph/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/ai-graph/new"
                element={isAuthenticated ? <AIGraph/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/ai-graph/:graphId"
                element={isAuthenticated ? <AIGraph/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/data-validity"
                element={isAuthenticated ? <DataValidity/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/api-docs"
                element={isAuthenticated ? <ApiDocs/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/notification-config"
                element={isAuthenticated ? <NotificationConfig/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/model-data-management"
                element={isAuthenticated ? <ModelDataManagement/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/platform-config/alert-management"
                element={isAuthenticated ? <AlertManagement/> : <Navigate to="/login" replace/>}
            />
            <Route
                path="/editor/:id"
                element={isAuthenticated ? <WorkflowEditor/> : <Navigate to="/login" replace/>}
            />
            <Route path="*" element={<Navigate to={isAuthenticated ? '/chat' : '/login'} replace/>}/>
        </Routes>
    );
}

function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <ScrollRestoration/>
                    <AppRoutes/>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;
