from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone
import uuid


def _iso_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + '+00:00'
    return dt.isoformat()

db = SQLAlchemy()


class Skill(db.Model):
    __tablename__ = 'skills'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default='')
    icon = db.Column(db.String(50), default='🎯')
    category = db.Column(db.String(50), default='')
    version = db.Column(db.String(20), default='1.0.0')
    status = db.Column(db.String(20), default='active')
    config = db.Column(db.Text, default='{}')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'icon': self.icon,
            'category': self.category,
            'version': self.version,
            'status': self.status,
            'config': self.config,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class ChatSession(db.Model):
    """对话会话模型"""
    __tablename__ = 'chat_sessions'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), nullable=True, index=True)  # 用户ID，用于区分不同用户的对话
    title = db.Column(db.String(200), default='新对话')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联消息
    messages = db.relationship('ChatMessage', backref='session', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'message_count': len(self.messages) if self.messages else 0
        }


class ChatMessage(db.Model):
    """对话消息模型"""
    __tablename__ = 'chat_messages'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = db.Column(db.String(36), db.ForeignKey('chat_sessions.id'), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # user 或 assistant
    content = db.Column(db.Text, nullable=False)
    matched_skills = db.Column(db.Text, default='[]')  # JSON格式存储匹配的技能
    reasoning_steps = db.Column(db.Text, default='[]')  # JSON格式存储推理步骤
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        import json
        return {
            'id': self.id,
            'session_id': self.session_id,
            'role': self.role,
            'content': self.content,
            'matched_skills': json.loads(self.matched_skills) if self.matched_skills else [],
            'reasoning_steps': json.loads(self.reasoning_steps) if self.reasoning_steps else [],
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Host(db.Model):
    """主机模型"""
    __tablename__ = 'hosts'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)  # 主机名称
    ip_address = db.Column(db.String(50), nullable=False)  # IP地址
    port = db.Column(db.Integer, default=22)  # 端口
    username = db.Column(db.String(100), nullable=False)  # 用户名
    auth_type = db.Column(db.String(20), default='password')  # 认证方式: password 或 key
    password = db.Column(db.String(200), default='')  # 密码（加密存储）
    private_key = db.Column(db.Text, default='')  # 私钥内容
    description = db.Column(db.Text, default='')  # 描述
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'ip_address': self.ip_address,
            'port': self.port,
            'username': self.username,
            'auth_type': self.auth_type,
            'description': self.description,
            'has_password': bool(self.password),
            'has_private_key': bool(self.private_key),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class SshExecutionHistory(db.Model):
    __tablename__ = 'ssh_execution_history'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    host_id = db.Column(db.String(36), nullable=False)
    host_name = db.Column(db.String(100), default='')
    host_ip = db.Column(db.String(50), default='')
    username = db.Column(db.String(100), default='')
    platform_user = db.Column(db.String(100), default='')
    command = db.Column(db.Text, nullable=False)
    executed_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'host_id': self.host_id,
            'host_name': self.host_name,
            'host_ip': self.host_ip,
            'username': self.username,
            'platform_user': self.platform_user,
            'command': self.command,
            'executed_at': self.executed_at.isoformat() if self.executed_at else None,
        }


class PlatformConfig(db.Model):
    __tablename__ = 'platform_configs'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    config_key = db.Column(db.String(100), unique=True, nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    value = db.Column(db.Text, default='')
    category = db.Column(db.String(50), default='general')
    description = db.Column(db.Text, default='')
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        import json
        try:
            val = json.loads(self.value) if self.value else ''
        except (json.JSONDecodeError, TypeError):
            val = self.value
        return {
            'id': self.id,
            'config_key': self.config_key,
            'name': self.name,
            'value': val,
            'category': self.category,
            'description': self.description,
            'enabled': self.enabled,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


