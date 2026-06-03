import threading
import uuid as uuid_mod
import logging
from flask import Blueprint, request, jsonify, Response, stream_with_context
import uuid
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import time
from src.executor import SSHExecutor, SSHConfig
from openai import OpenAI
from skill_router import get_skill_router_manager

hosts_bp = Blueprint('hosts', __name__)

# 默认超时时间
TIMEOUT = 300


def _get_auth_header():
    try:
        from flask import request
        auth = request.headers.get('Authorization')
        return auth or ''
    except Exception:
        return ''


def _check_permission(permission_code, resource_type='', resource_id=''):
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')
        auth = _get_auth_header()
        url = f'{cmdb_base}/api/check-permission?resource_type={resource_type}&resource_id={resource_id}&permission={permission_code}'
        req = Request(url, method='GET')
        if auth:
            req.add_header('Authorization', auth)
        with urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode())
        if isinstance(result, dict) and result.get('allowed') is True:
            return True
    except Exception:
        pass
    return False


def _get_host_credentials_from_cmdb(host_id):
    """从 Go cmdb API 获取主机凭证（包含密码）"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')
        req = Request(f'{cmdb_base}/api/hosts/{host_id}/credentials', method='GET')
        req.add_header('Content-Type', 'application/json')
        auth = _get_auth_header()
        if auth:
            req.add_header('Authorization', auth)
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception:
        return None


def _get_host_from_cmdb(host_id):
    """从 Go cmdb API 获取主机基本信息"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')
        req = Request(f'{cmdb_base}/api/hosts/{host_id}', method='GET')
        req.add_header('Content-Type', 'application/json')
        auth = _get_auth_header()
        if auth:
            req.add_header('Authorization', auth)
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception:
        return None


def _init_inspect_tasks_table():
    """Initialize inspect_tasks table in the same debug_tasks.db"""
    try:
        conn = sqlite3.connect(str(_DB_PATH))
        conn.execute("""CREATE TABLE IF NOT EXISTS inspect_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT DEFAULT '',
            host_id TEXT NOT NULL,
            host_name TEXT DEFAULT '',
            host_ip TEXT DEFAULT '',
            status TEXT DEFAULT 'running',
            error TEXT DEFAULT '',
            duration_ms INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP
        )""")
        conn.commit()
        conn.close()
    except Exception:
        pass


def _run_inspect_task(task_id: str, host_id: str, host: dict, auth_header: str = ''):
    """Run inspection in background thread, write results to inspect_tasks."""
    db_conn = sqlite3.connect(str(_DB_PATH))
    try:
        db_conn.execute("UPDATE inspect_tasks SET status='running' WHERE id=?", (task_id,))
        db_conn.commit()

        start_time = time.time()
        h_name = host['name']
        h_ip = host['ip_address']
        h_port = host.get('port', 22) or 22
        h_username = host.get('username', 'root') or 'root'
        h_password = host.get('password')
        h_auth_type = host.get('auth_type', 'password')
        h_private_key = host.get('private_key', '')

        with open(SCRIPT_PATH, 'r', encoding='utf-8') as f:
            script_content = f.read()

        is_local = h_ip.strip() in LOCAL_IPS
        output_lines = []
        error_text = ''

        if is_local:
            try:
                proc = subprocess.Popen(
                    ['python3', SCRIPT_PATH],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                for line in iter(proc.stdout.readline, ''):
                    if line:
                        stripped = line.rstrip()
                        output_lines.append({'type': 'output', 'text': stripped})
                proc.stdout.close()
                return_code = proc.wait()
                if return_code != 0:
                    stderr_output = proc.stderr.read()
                    if stderr_output:
                        error_text = stderr_output.strip()
            except Exception as e:
                error_text = str(e)
        else:
            config = SSHConfig(
                host=h_ip,
                port=h_port,
                username=h_username,
                password=h_password,
            )
            if h_auth_type == 'key' and h_private_key:
                with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False) as key_file:
                    key_file.write(h_private_key)
                    key_file.flush()
                    config.key_path = key_file.name
                    config.password = None

            executor = SSHExecutor(timeout=TIMEOUT)
            upload_result = executor.upload_file(config, script_content.encode(), '/tmp/richangxunjian.py')
            if upload_result['success']:
                exec_result = executor.execute(config, 'python3 /tmp/richangxunjian.py')
                if exec_result['output']:
                    for line in exec_result['output'].split('\n'):
                        if line.strip():
                            output_lines.append({'type': 'output', 'text': line})
                if exec_result['error']:
                    error_text = exec_result['error']
            else:
                error_text = upload_result.get('error', '上传脚本失败')

            if h_auth_type == 'key' and h_private_key:
                try:
                    os.unlink(config.key_path)
                except Exception:
                    pass

        output_text = '\n'.join(l['text'] for l in output_lines)
        full_analysis = ''

        if output_text.strip() or error_text:
            try:
                router_manager = get_skill_router_manager()
                ai_config = router_manager.config.get('AI_MODEL', {})
                llm_client = OpenAI(
                    base_url=ai_config.get('base_url', 'https://api.openai.com/v1'),
                    api_key=ai_config.get('api_key', ''),
                )
                llm_model = ai_config.get('model', 'gpt-4o')
                llm_temperature = ai_config.get('temperature', 0.0)
                llm_max_tokens = ai_config.get('max_tokens', 10280)

                system_prompt = '你是一个专业的系统运维专家。请根据以下服务器巡检结果，给出简明扼要的分析结论。直接用以下格式：\n\n【结论】\n系统状态是否正常\n\n【发现的问题】\n列出发现的问题（如无问题则写"未发现异常"）\n\n【建议】\n给出优化建议（如无则写"无需优化"）'
                user_content = f'以下是巡检脚本的输出内容：\n\n{output_text}'
                if error_text:
                    user_content += f'\n\n此外，执行过程中出现以下错误信息：\n{error_text}'

                response = llm_client.chat.completions.create(
                    model=llm_model,
                    messages=[
                        {'role': 'system', 'content': system_prompt},
                        {'role': 'user', 'content': user_content}
                    ],
                    temperature=llm_temperature,
                    max_tokens=llm_max_tokens,
                    stream=True,
                )
                for chunk in response:
                    if chunk.choices and len(chunk.choices) > 0 and chunk.choices[0].delta and chunk.choices[0].delta.content:
                        full_analysis += chunk.choices[0].delta.content
            except Exception as e:
                error_text = (error_text + '\n' if error_text else '') + f'AI分析失败: {str(e)}'

        duration_ms = int((time.time() - start_time) * 1000)
        status = 'completed' if not error_text else 'failed'

        _save_inspection_history(host_id, host, output_lines, error_text, full_analysis, duration_ms, auth_header)

        db_conn.execute(
            "UPDATE inspect_tasks SET status=?, error=?, duration_ms=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (status, error_text[:500] if error_text else '', duration_ms, task_id)
        )
        db_conn.commit()
    except Exception as e:
        try:
            db_conn.execute("UPDATE inspect_tasks SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?", (str(e)[:500], task_id))
            db_conn.commit()
        except Exception:
            pass
    finally:
        db_conn.close()


def _save_inspection_history(host_id, host, output_lines, error_text, analysis, duration_ms, auth_header=''):
    """将巡检记录保存到 CMDB"""
    router_manager = get_skill_router_manager()
    cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')
    data = json.dumps({
        'host_id': host_id,
        'host_name': host.get('name', ''),
        'host_ip': host.get('ip_address', ''),
        'status': 'completed',
        'output': {'lines': output_lines},
        'error': error_text,
        'analysis': analysis,
        'duration_ms': duration_ms,
    }).encode()
    req = Request(f'{cmdb_base}/api/inspection-history', data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    if auth_header:
        req.add_header('Authorization', auth_header)
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


import sqlite3

# 并发控制：最多同时执行 3 个调试任务
DEBUG_SEMAPHORE = threading.Semaphore(3)

# in-memory 只存 proc 对象（用于 kill），元数据全部存 SQLite
_DEBUG_PROCS: dict[str, subprocess.Popen] = {}
_DEBUG_PROCS_LOCK = threading.Lock()

_DB_PATH = Path(__file__).parent.parent.parent / 'data' / 'debug_tasks.db'


def _get_db():
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS debug_tasks (
        id TEXT PRIMARY KEY,
        script_id TEXT,
        script_name TEXT DEFAULT '',
        script_type TEXT DEFAULT 'python',
        content TEXT DEFAULT '',
        status TEXT DEFAULT 'running',
        output TEXT DEFAULT '',
        error TEXT DEFAULT '',
        return_code INTEGER,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP
    )""")
    conn.commit()
    return conn


# 启动时清理上一次残留的运行中任务
_cleanup_conn = _get_db()
_cleanup_conn.execute(
    "UPDATE debug_tasks SET status='failed', error='服务重启，任务中断', finished_at=CURRENT_TIMESTAMP WHERE status='running'")
_cleanup_conn.commit()
_cleanup_conn.close()

# 初始化 inspect_tasks 表，清理残留的运行中任务
try:
    _init_inspect_tasks_table()
    _cleanup2 = sqlite3.connect(str(_DB_PATH))
    _cleanup2.execute(
        "UPDATE inspect_tasks SET status='failed', error='服务重启，任务中断', finished_at=CURRENT_TIMESTAMP WHERE status='running'")
    _cleanup2.commit()
    _cleanup2.close()
except Exception:
    pass

# 调试日志: logs/scripts/YYYY-MM-DD.log
_script_log_dir = Path(__file__).parent.parent.parent / 'logs' / 'scripts'
_script_log_dir.mkdir(parents=True, exist_ok=True)
_script_log_file = _script_log_dir / f"{datetime.now().strftime('%Y-%m-%d')}.log"

_script_logger = logging.getLogger('script_debug')
_script_logger.setLevel(logging.DEBUG)
if not _script_logger.handlers:
    _fh = logging.FileHandler(str(_script_log_file), encoding='utf-8')
    _fh.setLevel(logging.DEBUG)
    _fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    _script_logger.addHandler(_fh)


def _run_debug_task(task_id: str, script_type: str, content: str, fpath: str):
    """在后台线程中执行脚本，结果写入 SQLite。"""
    db = _get_db()
    row = db.execute("SELECT script_name FROM debug_tasks WHERE id=?", (task_id,)).fetchone()
    script_name = row['script_name'] if row else ''

    try:
        if script_type == 'python':
            interpreters = ['python3', 'python', 'python2']
            proc = None
            for interp in interpreters:
                try:
                    proc = subprocess.Popen([interp, fpath], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    break
                except FileNotFoundError:
                    continue
            if proc is None:
                db.execute(
                    "UPDATE debug_tasks SET status='failed', error='未找到 Python 解释器', return_code=-1, finished_at=CURRENT_TIMESTAMP WHERE id=?",
                    (task_id,))
                db.commit()
                db.close()
                _script_logger.error("调试失败 | 任务ID: %s | 脚本: %s | 原因: 未找到 Python 解释器", task_id,
                                     script_name)
                return
        else:
            proc = subprocess.Popen(['bash', fpath], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        with _DEBUG_PROCS_LOCK:
            _DEBUG_PROCS[task_id] = proc

        stdout, stderr = proc.communicate(timeout=TIMEOUT)
        status = 'completed' if proc.returncode == 0 else 'failed'
        db.execute(
            "UPDATE debug_tasks SET status=?, output=?, error=?, return_code=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (status, stdout, stderr, proc.returncode, task_id))
        db.commit()
        log_status = '通过' if proc.returncode == 0 else '失败'
        _script_logger.info("调试结束 | 任务ID: %s | 脚本: %s | 状态: %s | 返回码: %s", task_id, script_name,
                            log_status, proc.returncode)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
            proc.wait()
        except Exception:
            pass
        db.execute(
            "UPDATE debug_tasks SET status='failed', error='执行超时（30秒）', return_code=-1, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (task_id,))
        db.commit()
        _script_logger.warning("调试超时 | 任务ID: %s | 脚本: %s", task_id, script_name)
    except Exception as e:
        db.execute(
            "UPDATE debug_tasks SET status='failed', error=?, return_code=-1, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            (str(e), task_id))
        db.commit()
        _script_logger.error("调试异常 | 任务ID: %s | 脚本: %s | 错误: %s", task_id, script_name, str(e))
    finally:
        with _DEBUG_PROCS_LOCK:
            _DEBUG_PROCS.pop(task_id, None)
        try:
            os.unlink(fpath)
        except Exception:
            pass
        db.close()
        DEBUG_SEMAPHORE.release()


@hosts_bp.route('/api/debug-script', methods=['POST'])
def start_debug_script():
    if not _check_permission('script-debug:execute', 'script-debug', '*'):
        return jsonify({'error': '无权限执行调试'}), 403
    data = request.get_json()
    script_type = data.get('type', 'python')
    content = data.get('content', '')
    script_name = (data.get('name') or '').strip()
    script_id = (data.get('script_id') or '').strip()

    if not content.strip():
        return jsonify({'output': '', 'error': '脚本内容为空'})

    if not DEBUG_SEMAPHORE.acquire(blocking=False):
        return jsonify({'error': '调试任务过多，请稍后再试', 'return_code': -1})

    task_id = str(uuid_mod.uuid4())
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py' if script_type == 'python' else '.sh', delete=False) as f:
        f.write(content)
        f.flush()
        fpath = f.name

    db = _get_db()
    db.execute(
        """INSERT INTO debug_tasks (id, script_id, script_name, script_type, content, status, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)""",
        (task_id, script_id, script_name, script_type, content))
    db.commit()
    db.close()

    _script_logger.info("调试开始 | 任务ID: %s | 脚本: %s | 类型: %s", task_id, script_name, script_type)

    t = threading.Thread(target=_run_debug_task, args=(task_id, script_type, content, fpath), daemon=True)
    t.start()

    return jsonify({'task_id': task_id})


@hosts_bp.route('/api/debug-script/running', methods=['GET'])
def list_running_debug_tasks():
    if not _check_permission('script-debug:read', 'script-debug', '*'):
        return jsonify({'error': '无权限查看调试任务'}), 403
    db = _get_db()
    rows = db.execute(
        "SELECT id, script_id, script_name, status, started_at FROM debug_tasks WHERE status='running' ORDER BY started_at DESC").fetchall()
    db.close()
    return jsonify({'items': [dict(r) for r in rows]})


@hosts_bp.route('/api/debug-script/history', methods=['GET'])
def list_debug_script_history():
    if not _check_permission('script-debug:read', 'script-debug', '*'):
        return jsonify({'error': '无权限查看调试历史'}), 403
    script_id = request.args.get('script_id', '')
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 10, type=int)
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    offset = (page - 1) * page_size
    db = _get_db()

    if script_id:
        row = db.execute("SELECT COUNT(*) AS cnt FROM debug_tasks WHERE script_id=?", (script_id,)).fetchone()
        rows = db.execute(
            "SELECT id, script_id, script_name, script_type, status, output, error, return_code, started_at, finished_at "
            "FROM debug_tasks WHERE script_id=? ORDER BY started_at DESC LIMIT ? OFFSET ?",
            (script_id, page_size, offset)).fetchall()
    else:
        row = db.execute("SELECT COUNT(*) AS cnt FROM debug_tasks").fetchone()
        rows = db.execute(
            "SELECT id, script_id, script_name, script_type, status, output, error, return_code, started_at, finished_at "
            "FROM debug_tasks ORDER BY started_at DESC LIMIT ? OFFSET ?",
            (page_size, offset)).fetchall()
    total = row['cnt'] if row else 0
    db.close()
    return jsonify({
        'items': [dict(r) for r in rows],
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': max(1, (total + page_size - 1) // page_size),
    })


@hosts_bp.route('/api/debug-script/<task_id>', methods=['GET'])
def get_debug_script(task_id):
    if not _check_permission('script-debug:read', 'script-debug', task_id):
        return jsonify({'error': '无权限查看调试任务'}), 403
    db = _get_db()
    row = db.execute("SELECT id, status, output, error, return_code FROM debug_tasks WHERE id=?", (task_id,)).fetchone()
    db.close()
    if not row:
        return jsonify({'error': '任务不存在'}), 404
    return jsonify({
        'done': row['status'] != 'running',
        'output': row['output'] or '',
        'error': row['error'] or '',
        'return_code': row['return_code'],
    })


@hosts_bp.route('/api/debug-script/<task_id>', methods=['DELETE'])
def cancel_debug_script(task_id):
    with _DEBUG_PROCS_LOCK:
        proc = _DEBUG_PROCS.pop(task_id, None)
    if proc and proc.poll() is None:
        try:
            proc.kill()
            proc.wait()
        except Exception:
            pass

    db = _get_db()
    db.execute("UPDATE debug_tasks SET status='cancelled', error='用户取消', finished_at=CURRENT_TIMESTAMP WHERE id=?",
               (task_id,))
    db.commit()
    db.close()

    _script_logger.warning("调试取消 | 任务ID: %s", task_id)
    return jsonify({'ok': True})


SCRIPT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools', 'richangxunjian.py')

LOCAL_IPS = {'localhost', '127.0.0.1', '0.0.0.0'}


@hosts_bp.route('/api/hosts', methods=['GET', 'OPTIONS'])
def list_hosts():
    """Proxy to CMDB: list all hosts (with pagination)"""
    if request.method == 'OPTIONS':
        return '', 204
    if not _check_permission('host:read', 'host', '*'):
        return jsonify({'error': '无权限查看主机'}), 403
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')
        auth = _get_auth_header()
        query = request.query_string.decode('utf-8') if request.query_string else ''
        url = f'{cmdb_base}/api/hosts' + (f'?{query}' if query else '')
        req = Request(url, method='GET')
        if auth:
            req.add_header('Authorization', auth)
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        return jsonify(data)
    except HTTPError as e:
        body = e.read().decode() if e.fp else '{}'
        return jsonify(json.loads(body) if body else {'error': str(e)}), e.code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@hosts_bp.route('/api/hosts/<host_id>/inspect', methods=['POST'])
def start_inspect(host_id):
    """异步启动巡检，返回 task_id，后台执行巡检脚本"""
    if not _check_permission('inspection:use', 'inspection', host_id):
        return jsonify({'error': '无权限执行AI巡检'}), 403
    try:
        host = _get_host_credentials_from_cmdb(host_id)
        if not host:
            return jsonify({'error': '主机不存在'}), 404
        if not os.path.exists(SCRIPT_PATH):
            return jsonify({'error': f'巡检脚本不存在: {SCRIPT_PATH}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    task_id = str(uuid_mod.uuid4())
    db = sqlite3.connect(str(_DB_PATH))
    db.execute(
        "INSERT INTO inspect_tasks (id, user_id, host_id, host_name, host_ip, status) VALUES (?, ?, ?, ?, ?, 'running')",
        (task_id, '', host_id, host.get('name', ''), host.get('ip_address', ''))
    )
    db.commit()
    db.close()

    auth_header = request.headers.get('Authorization', '')
    t = threading.Thread(target=_run_inspect_task, args=(task_id, host_id, host, auth_header), daemon=True)
    t.start()

    return jsonify({'task_id': task_id, 'status': 'running'})


@hosts_bp.route('/api/inspect-tasks', methods=['GET'])
def list_inspect_tasks():
    """获取所有巡检任务状态"""
    if not _check_permission('inspection:use', 'inspection', '*'):
        return jsonify({'error': '无权限查看巡检任务'}), 403
    host_id = request.args.get('host_id', '')
    status_filter = request.args.get('status', '')
    db = sqlite3.connect(str(_DB_PATH))
    db.row_factory = sqlite3.Row
    query = "SELECT * FROM inspect_tasks WHERE 1=1"
    params = []
    if host_id:
        query += " AND host_id=?"
        params.append(host_id)
    if status_filter:
        query += " AND status=?"
        params.append(status_filter)
    query += " ORDER BY created_at DESC LIMIT 50"
    rows = db.execute(query, params).fetchall()
    tasks = [dict(r) for r in rows]
    db.close()
    return jsonify({'tasks': tasks})


@hosts_bp.route('/api/inspect-tasks/<task_id>', methods=['GET'])
def get_inspect_task(task_id):
    """获取单个巡检任务详情"""
    if not _check_permission('inspection:use', 'inspection', task_id):
        return jsonify({'error': '无权限查看巡检任务'}), 403
    db = sqlite3.connect(str(_DB_PATH))
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT * FROM inspect_tasks WHERE id=?", (task_id,)).fetchone()
    db.close()
    if not row:
        return jsonify({'error': '任务不存在'}), 404
    return jsonify(dict(row))


@hosts_bp.route('/api/hosts/<host_id>/inspect', methods=['GET'])
def inspect_host(host_id):
    """对指定主机执行巡检脚本，支持SSE实时输出"""
    if not _check_permission('inspection:use', 'inspection', host_id):
        return jsonify({'error': '无权限执行AI巡检'}), 403
    try:
        host = _get_host_credentials_from_cmdb(host_id)
        if not host:
            return jsonify({'error': '主机不存在'}), 404

        if not os.path.exists(SCRIPT_PATH):
            return jsonify({'error': f'巡检脚本不存在: {SCRIPT_PATH}'}), 500

        router_manager = get_skill_router_manager()
        ai_config = router_manager.config.get('AI_MODEL', {})
        llm_client = OpenAI(
            base_url=ai_config.get('base_url', 'https://api.openai.com/v1'),
            api_key=ai_config.get('api_key', ''),
        )
        llm_model = ai_config.get('model', 'gpt-4o')
        llm_temperature = ai_config.get('temperature', 0.0)
        llm_max_tokens = ai_config.get('max_tokens', 10280)

        def generate():
            start_time = time.time()
            h_name = host['name']
            h_ip = host['ip_address']
            h_port = host.get('port', 22) or 22
            h_username = host.get('username', 'root') or 'root'
            h_password = host.get('password')
            h_auth_type = host.get('auth_type', 'password')
            h_private_key = host.get('private_key', '')
            with open(SCRIPT_PATH, 'r', encoding='utf-8') as f:
                script_content = f.read()

            is_local = h_ip.strip() in LOCAL_IPS

            yield f"data: {json.dumps({'type': 'info', 'text': f'目标主机: {h_name} ({h_ip})'})}\n\n"
            yield f"data: {json.dumps({'type': 'info', 'text': '执行方式: ' + ('本地执行' if is_local else '远程SSH执行')})}\n\n"

            output_lines = []
            error_text = ''

            if is_local:
                yield f"data: {json.dumps({'type': 'info', 'text': '正在本地执行巡检脚本...'})}\n\n"
                try:
                    proc = subprocess.Popen(
                        ['python3', SCRIPT_PATH],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )
                    for line in iter(proc.stdout.readline, ''):
                        if line:
                            stripped = line.rstrip()
                            output_lines.append({'type': 'output', 'text': stripped})
                            yield f"data: {json.dumps({'type': 'output', 'text': stripped})}\n\n"
                    proc.stdout.close()
                    return_code = proc.wait()
                    if return_code != 0:
                        stderr_output = proc.stderr.read()
                        if stderr_output:
                            error_text = stderr_output.strip()
                            yield f"data: {json.dumps({'type': 'error', 'text': error_text})}\n\n"
                except Exception as e:
                    error_text = str(e)
                    yield f"data: {json.dumps({'type': 'error', 'text': f'本地执行失败: {error_text}'})}\n\n"
            else:
                config = SSHConfig(
                    host=h_ip,
                    port=h_port,
                    username=h_username,
                    password=h_password,
                )
                if h_auth_type == 'key' and h_private_key:
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False) as key_file:
                        key_file.write(h_private_key)
                        key_file.flush()
                        config.key_path = key_file.name
                        config.password = None

                executor = SSHExecutor(timeout=TIMEOUT)
                yield f"data: {json.dumps({'type': 'info', 'text': '正在上传脚本到远程主机...'})}\n\n"
                upload_result = executor.upload_file(config, script_content.encode(), '/tmp/richangxunjian.py')
                if not upload_result['success']:
                    err_msg = upload_result['error']
                    yield f"data: {json.dumps({'type': 'error', 'text': f'上传脚本失败: {err_msg}'})}\n\n"
                    return

                yield f"data: {json.dumps({'type': 'info', 'text': '正在远程执行巡检脚本...'})}\n\n"
                exec_result = executor.execute(config, 'python3 /tmp/richangxunjian.py')
                if exec_result['output']:
                    for line in exec_result['output'].split('\n'):
                        if line.strip():
                            output_lines.append({'type': 'output', 'text': line})
                            yield f"data: {json.dumps({'type': 'output', 'text': line})}\n\n"
                if exec_result['error']:
                    error_text = exec_result['error']
                    yield f"data: {json.dumps({'type': 'error', 'text': error_text})}\n\n"

                if h_auth_type == 'key' and h_private_key:
                    try:
                        os.unlink(config.key_path)
                    except:
                        pass

            output_text = '\n'.join(l['text'] for l in output_lines)
            full_analysis = ''

            if output_text.strip() or error_text:
                try:
                    system_prompt = '你是一个专业的系统运维专家。请根据以下服务器巡检结果，给出简明扼要的分析结论。直接从分析结论开始回复，不要客套，不要前置说明。用以下格式：\n\n【结论】\n系统状态是否正常\n\n【发现的问题】\n列出发现的问题（如无问题则写"未发现异常"）\n\n【建议】\n给出优化建议（如无则写"无需优化"）'

                    user_content = f'以下是巡检脚本的输出内容：\n\n{output_text}'
                    if error_text:
                        user_content += f'\n\n此外，执行过程中出现以下错误信息：\n{error_text}'

                    response = llm_client.chat.completions.create(
                        model=llm_model,
                        messages=[
                            {'role': 'system', 'content': system_prompt},
                            {'role': 'user', 'content': user_content}
                        ],
                        temperature=llm_temperature,
                        max_tokens=llm_max_tokens,
                        stream=True,
                    )

                    for chunk in response:
                        if chunk.choices and len(chunk.choices) > 0 and chunk.choices[0].delta and chunk.choices[
                            0].delta.content:
                            content = chunk.choices[0].delta.content
                            full_analysis += content
                            yield f"data: {json.dumps({'type': 'analysis', 'text': content})}\n\n"

                    yield f"data: {json.dumps({'type': 'analysis_done', 'text': full_analysis})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'text': f'AI分析失败: {str(e)}'})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'text': '巡检完成'})}\n\n"

            duration_ms = int((time.time() - start_time) * 1000)
        _save_inspection_history(host_id, host, output_lines, error_text, full_analysis, duration_ms, auth_header)

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@hosts_bp.route('/api/hosts/<host_id>/ai-ssh', methods=['POST'])
def ai_ssh(host_id):
    """在目标主机上执行SSH命令，流式返回输出"""
    if not _check_permission('host:ssh', 'host', host_id):
        return jsonify({'error': '无权限执行SSH命令'}), 403
    try:
        host = _get_host_from_cmdb(host_id)
        if not host:
            return jsonify({'error': '主机不存在'}), 404

        data = request.get_json()
        command = data.get('command', '').strip()
        if not command:
            return jsonify({'error': '命令不能为空'}), 400

        def generate():
            h_name = host['name']
            h_ip = host['ip_address']
            h_port = host.get('port', 22) or 22
            h_username = host.get('username', 'root') or 'root'
            h_password = host.get('password')
            h_auth_type = host.get('auth_type', 'password')
            h_private_key = host.get('private_key', '')
            is_local = h_ip.strip() in LOCAL_IPS
            yield f"data: {json.dumps({'type': 'info', 'text': f'目标主机: {h_name} ({h_ip})'})}\n\n"
            yield f"data: {json.dumps({'type': 'info', 'text': f'执行命令: {command}'})}\n\n"
            yield f"data: {json.dumps({'type': 'info', 'text': '执行方式: ' + ('本地执行' if is_local else '远程SSH执行')})}\n\n"

            if is_local:
                try:
                    proc = subprocess.Popen(
                        command,
                        shell=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )
                    for line in iter(proc.stdout.readline, ''):
                        if line:
                            yield f"data: {json.dumps({'type': 'output', 'text': line.rstrip()})}\n\n"
                    proc.stdout.close()
                    return_code = proc.wait()
                    if return_code != 0:
                        stderr_output = proc.stderr.read()
                        if stderr_output:
                            yield f"data: {json.dumps({'type': 'error', 'text': stderr_output.strip()})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'text': f'本地执行失败: {str(e)}'})}\n\n"
            else:
                config = SSHConfig(
                    host=h_ip,
                    port=h_port,
                    username=h_username,
                    password=h_password or None,
                )
                if h_auth_type == 'key' and h_private_key:
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False) as key_file:
                        key_file.write(h_private_key)
                        key_file.flush()
                        config.key_path = key_file.name
                elif h_auth_type == 'key' and not h_private_key:
                    config.key_path = None

                executor = SSHExecutor(timeout=TIMEOUT)
                yield f"data: {json.dumps({'type': 'info', 'text': '正在执行远程命令...'})}\n\n"
                try:
                    exec_result = executor.execute(config, command)
                    if exec_result.get('output'):
                        for line in exec_result['output'].split('\n'):
                            if line.strip():
                                yield f"data: {json.dumps({'type': 'output', 'text': line})}\n\n"
                    if exec_result.get('error'):
                        yield f"data: {json.dumps({'type': 'error', 'text': exec_result['error']})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'text': f'远程执行失败: {str(e)}'})}\n\n"
                finally:
                    if h_auth_type == 'key' and h_private_key:
                        try:
                            os.unlink(config.key_path)
                        except:
                            pass

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
