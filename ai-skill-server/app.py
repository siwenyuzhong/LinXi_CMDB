from flask import Flask
from flask_cors import CORS
from socketio_instance import socketio
from routes.skills import skills_bp
from routes.hosts import hosts_bp
from routes.platform_config import platform_config_bp
import os


def create_app():
    """创建 Flask 应用实例（供 gunicorn 使用）"""
    app = Flask(__name__)

    # 启用 CORS
    CORS(app)

    # SocketIO（threading 模式 + eventlet 可切换 async_mode）
    socketio.init_app(app, cors_allowed_origins="*", async_mode='threading')

    # 注册路由
    app.register_blueprint(skills_bp)
    app.register_blueprint(hosts_bp)
    app.register_blueprint(platform_config_bp)

    # 注册 SocketIO 事件（必须在 socketio 初始化之后）
    import routes.socket_events

    return app


app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('FLASK_PORT', 5001))
    socketio.run(app, host='127.0.0.1', port=port, debug=True, allow_unsafe_werkzeug=True)
