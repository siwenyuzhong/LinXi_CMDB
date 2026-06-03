import threading
import json
import paramiko
from flask import request
from flask_socketio import emit
from socketio_instance import socketio
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from skill_router import get_skill_router_manager


def _get_cmdb_host(host_id, token=''):
    """从 Go cmdb API 获取主机信息"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        req = Request(f'{cmdb_base}/api/hosts/{host_id}', method='GET')
        req.add_header('Content-Type', 'application/json')
        if token:
            req.add_header('Authorization', f'Bearer {token}')
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 404:
            return None
        return None
    except Exception:
        return None


def _get_cmdb_host_credentials(host_id, token=''):
    """从 Go cmdb API 获取主机凭证（包含密码）"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        req = Request(f'{cmdb_base}/api/hosts/{host_id}/credentials', method='GET')
        req.add_header('Content-Type', 'application/json')
        if token:
            req.add_header('Authorization', f'Bearer {token}')
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 404:
            return None
        return None
    except Exception:
        return None


ssh_sessions = {}

COMMAND_BLACKLIST = {}
COMMAND_BLACKLIST_INFO = {
    'rm': '删除文件/目录，此操作不可恢复',
    'dd': '直接写入磁盘，可导致数据完全丢失',
    'mkfs': '格式化磁盘，将清除所有数据',
    'fdisk': '分区工具，误操作会导致数据丢失',
    'shutdown': '关闭系统',
    'reboot': '重启系统',
    'init': '改变系统运行级别',
    'kill': '终止进程，可能导致系统不稳定',
    'killall': '终止所有指定进程',
    'chmod': '改变文件权限',
    'chown': '改变文件所有者',
}


def _load_command_blacklist(token=''):
    """从 CMDB 加载命令黑名单"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        req = Request(f'{cmdb_base}/api/command-blacklist', method='GET')
        req.add_header('Content-Type', 'application/json')
        if token:
            req.add_header('Authorization', f'Bearer {token}')
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if data.get('value') and isinstance(data['value'], list):
                COMMAND_BLACKLIST.clear()
                for cmd in data['value']:
                    COMMAND_BLACKLIST[cmd] = COMMAND_BLACKLIST_INFO.get(cmd, '此命令可能存在风险')
                print(f"[INFO] 已加载 {len(COMMAND_BLACKLIST)} 条黑名单命令: {list(COMMAND_BLACKLIST.keys())}")
    except Exception as e:
        print(f"[WARN] 加载命令黑名单失败: {e}")


def get_private_key(key_content):
    from io import StringIO
    key_file = StringIO(key_content)
    for key_cls in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]:
        try:
            key_file.seek(0)
            return key_cls.from_private_key(key_file)
        except paramiko.SSHException:
            continue
    raise paramiko.SSHException('无法解析私钥，支持的格式: RSA/Ed25519/ECDSA')


@socketio.on('connect')
def on_connect():
    pass


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    session = ssh_sessions.pop(sid, None)
    if session:
        try:
            session['channel'].close()
        except:
            pass
        try:
            session['client'].close()
        except:
            pass


@socketio.on('ssh_connect')
def on_ssh_connect(data):
    sid = request.sid
    host_id = data.get('host_id')
    platform_user = data.get('platform_user', '')
    token = data.get('token', '')

    host = _get_cmdb_host_credentials(host_id, token)
    if not host:
        emit('ssh_error', {'message': '主机不存在或无法获取凭证'})
        return

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        connect_kwargs = {
            'hostname': host['ip_address'],
            'port': host.get('port', 22) or 22,
            'username': host.get('username', 'root'),
            'timeout': 10,
        }

        if host.get('auth_type') == 'key' and host.get('private_key'):
            connect_kwargs['pkey'] = get_private_key(host['private_key'])
            connect_kwargs['look_for_keys'] = False
            connect_kwargs['allow_agent'] = False
        else:
            connect_kwargs['password'] = host.get('password')
            connect_kwargs['look_for_keys'] = False
            connect_kwargs['allow_agent'] = False

        client.connect(**connect_kwargs)

        _load_command_blacklist(token)

        channel = client.invoke_shell(term='xterm-256color')
        channel.setblocking(0)

        session = {
            'client': client,
            'channel': channel,
            'host': host,
            'platform_user': platform_user,
            'command_buffer': '',
            'pending_command': None,
        }
        ssh_sessions[sid] = session

        if COMMAND_BLACKLIST:
            emit('ssh_connected', {
                'message': f'已连接到 {host["name"]} ({host["ip_address"]})，黑名单已加载'
            })
        else:
            emit('ssh_connected', {
                'message': f'已连接到 {host["name"]} ({host["ip_address"]})，黑名单未配置'
            })

        def read_ssh():
            while True:
                sess = ssh_sessions.get(sid)
                if not sess:
                    break
                ch = sess['channel']
                if ch.closed:
                    break
                try:
                    if ch.recv_ready():
                        data = ch.recv(4096)
                        if data:
                            socketio.emit('ssh_output', {
                                'data': data.decode('utf-8', errors='replace')
                            }, to=sid)
                except:
                    pass
                threading.Event().wait(0.01)

        thread = threading.Thread(target=read_ssh, daemon=True)
        thread.start()

    except Exception as e:
        emit('ssh_error', {'message': str(e)})


@socketio.on('ssh_data')
def on_ssh_data(data):
    sid = request.sid
    session = ssh_sessions.get(sid)
    if not session:
        return

    try:
        data_str = data.get('data', '')

        if session['channel'].closed:
            return

        if session.get('pending_command'):
            if data_str == '\x03' or data_str == '\x04':
                session['channel'].send('\x03')
                session['command_buffer'] = ''
                session['pending_command'] = None
            return

        buf = session.get('command_buffer', '')

        if data_str == '\r':
            command = buf.strip()
            cmd_name = command.split()[0] if command.split() else ''

            if command and cmd_name in COMMAND_BLACKLIST:
                session['channel'].send('\x15')
                session['pending_command'] = command
                info = COMMAND_BLACKLIST.get(cmd_name, '此命令可能存在风险')
                emit('ssh_blacklist_warning', {
                    'command': cmd_name,
                    'full_command': command,
                    'info': info,
                    'message': f'\r\n\x1b[31m⚠️  警告：命令 "{cmd_name}" 在黑名单中！\x1b[0m\r\n\x1b[33m   风险说明：{info}\x1b[0m\r\n\x1b[36m   输入 "YES" 确认执行，或按 Ctrl+C 取消\x1b[0m\r\n\r\n'
                })
                session['command_buffer'] = ''
                return

            session['channel'].send(data_str)

            if command:
                host = session['host']
                try:
                    import requests as _req
                    _req.post('http://localhost:9080/api/ssh-history',
                        json={
                            'host_id': host['id'],
                            'host_name': host['name'],
                            'host_ip': host['ip_address'],
                            'platform_user': session.get('platform_user', ''),
                            'command': command,
                        },
                        headers={'X-Internal-Username': host.get('username', '')}, timeout=2)
                except:
                    pass
            session['command_buffer'] = ''
        elif data_str == '\x7f':
            session['command_buffer'] = buf[:-1]
            session['channel'].send(data_str)
        elif data_str == '\x03' or data_str == '\x04':
            session['command_buffer'] = ''
            session['channel'].send(data_str)
        elif len(data_str) == 1 and 0x20 <= ord(data_str) <= 0x7e:
            session['command_buffer'] = buf + data_str
            session['channel'].send(data_str)
        else:
            session['channel'].send(data_str)
    except Exception:
        pass


@socketio.on('ssh_confirm_command')
def on_ssh_confirm_command(data):
    sid = request.sid
    session = ssh_sessions.get(sid)
    if not session:
        return

    try:
        channel = session['channel']
        if channel.closed:
            return

        command = data.get('command') or session.get('pending_command')
        if not command:
            return
        channel.send('\x15')
        for char in command:
            channel.send(char)
        channel.send('\r')

        host = session['host']
        try:
            import requests as _req
            _req.post('http://localhost:9080/api/ssh-history',
                json={
                    'host_id': host['id'],
                    'host_name': host['name'],
                    'host_ip': host['ip_address'],
                    'platform_user': session.get('platform_user', ''),
                    'command': command,
                },
                headers={'X-Internal-Username': host.get('username', '')}, timeout=2)
        except:
            pass

        session['pending_command'] = None
        session['command_buffer'] = ''
    except Exception:
        pass


@socketio.on('ssh_cancel_command')
def on_ssh_cancel_command():
    sid = request.sid
    session = ssh_sessions.get(sid)
    if not session or not session.get('pending_command'):
        return

    try:
        channel = session['channel']
        if not channel.closed:
            channel.send('\x03')
        session['pending_command'] = None
        session['command_buffer'] = ''
    except Exception:
        pass


@socketio.on('ssh_resize')
def on_ssh_resize(data):
    sid = request.sid
    session = ssh_sessions.get(sid)
    if session and not session['channel'].closed:
        try:
            session['channel'].resize_pty(
                width=data.get('cols', 80),
                height=data.get('rows', 24)
            )
        except:
            pass
