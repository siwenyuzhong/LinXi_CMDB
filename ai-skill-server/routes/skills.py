from flask import Blueprint, request, jsonify, Response, stream_with_context
import json
import os
import re
import uuid
import time
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# 导入技能路由器
from skill_router import get_skill_router_manager
from openai import OpenAI

skills_bp = Blueprint('skills', __name__)

# 技能目录基础路径
SKILLS_BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'skills')


def validate_skill_name(name):
    """验证技能名称：只允许英文字母、数字、下划线、连字符"""
    pattern = r'^[a-zA-Z0-9_-]+$'
    return bool(re.match(pattern, name))


def get_skill_directory(skill_name):
    """返回技能对应的本地目录路径"""
    if not validate_skill_name(skill_name):
        return None
    return os.path.join(SKILLS_BASE_DIR, skill_name)


def increment_version(version):
    """将版本号的补丁号(Patch)加1，例如 1.0.0 -> 1.0.1"""
    try:
        parts = version.split('.')
        if len(parts) >= 3:
            major, minor, patch = parts[0], parts[1], int(parts[2])
            return f"{major}.{minor}.{patch + 1}"
        else:
            return f"{version}.1"
    except (ValueError, TypeError):
        return "1.0.1"


def create_skill_directory(skill_name):
    """创建技能目录结构，使用技能名称作为目录名"""
    skill_dir = os.path.join(SKILLS_BASE_DIR, skill_name)

    # 创建主目录
    os.makedirs(skill_dir, exist_ok=True)

    # 创建子目录
    os.makedirs(os.path.join(skill_dir, 'assets'), exist_ok=True)
    os.makedirs(os.path.join(skill_dir, 'references'), exist_ok=True)
    os.makedirs(os.path.join(skill_dir, 'scripts'), exist_ok=True)

    # 创建 SKILL.md 文件
    skill_md_content = f"""---
name: "{skill_name}"
description: "这是一个技能描述文件"
trigger_scenarios: []
---

# {skill_name}

## 描述
这是一个技能描述文件。

## 使用方法
请在此处描述如何使用此技能。

## 目录结构
- `assets/` - 存放技能资源文件
- `references/` - 存放参考资料
- `scripts/` - 存放脚本文件

## 版本历史
- v1.0.0 - 初始版本
"""
    with open(os.path.join(skill_dir, 'SKILL.md'), 'w', encoding='utf-8') as f:
        f.write(skill_md_content)

    return skill_dir


def get_directory_tree(dir_path, base_path=None):
    """获取目录树结构"""
    if base_path is None:
        base_path = dir_path

    tree = []

    if not os.path.exists(dir_path):
        return tree

    for item in sorted(os.listdir(dir_path)):
        if item.startswith('.'):
            continue

        item_path = os.path.join(dir_path, item)
        is_dir = os.path.isdir(item_path)

        # 返回相对路径
        rel_path = os.path.relpath(item_path, base_path)

        node = {
            'name': item,
            'type': 'directory' if is_dir else 'file',
            'path': rel_path,
        }

        if is_dir:
            node['children'] = get_directory_tree(item_path, base_path)

        tree.append(node)

    return tree


# ---- CMDB API helpers for skill_dev sessions/messages ----

def _get_cmdb_base():
    from skill_router import get_skill_router_manager
    return get_skill_router_manager().config.get('CMDB_API_BASE', 'http://127.0.0.1:5003')


def _api_call(method, path, body=None):
    """Call CMDB API and return parsed JSON response"""
    url = f'{_get_cmdb_base()}{path}'
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    auth = request.headers.get('Authorization')
    if auth:
        req.add_header('Authorization', auth)
    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = e.read().decode()
        if e.code == 404:
            return None
        if e.code == 403:
            try:
                return json.loads(body)
            except Exception:
                return {'_error': 'forbidden'}
        try:
            return json.loads(body)
        except Exception:
            return None


def _cmdb_create_session(user_id, title='新对话'):
    return _api_call('POST', '/api/skill-dev/sessions', {'user_id': user_id or '', 'title': title})


def _cmdb_create_message(session_id, role, content, matched_skills='[]', reasoning_steps='[]'):
    return _api_call('POST', '/api/skill-dev/messages', {
        'session_id': session_id,
        'role': role,
        'content': content,
        'matched_skills': matched_skills,
        'reasoning_steps': reasoning_steps,
    })


def _cmdb_update_session(session_id, title=None):
    data = {}
    if title:
        data['title'] = title
    return _api_call('PATCH', f'/api/skill-dev/sessions/{session_id}', data) if data else None


# ---- CMDB API helpers for skills CRUD ----

def _cmdb_list_skills():
    return _api_call('GET', '/api/skills')


def _cmdb_get_skill(skill_id):
    return _api_call('GET', f'/api/skills/{skill_id}')


def _cmdb_create_skill(data):
    return _api_call('POST', '/api/skills', data)


def _cmdb_update_skill(skill_id, data):
    return _api_call('PUT', f'/api/skills/{skill_id}', data)


def _cmdb_delete_skill(skill_id):
    return _api_call('DELETE', f'/api/skills/{skill_id}')


def _cmdb_check_permission(permission_code, resource_type='skill', resource_id=''):
    """Check if current user has a specific permission via CMDB."""
    result = _api_call('GET',
                       f'/api/check-permission?resource_type={resource_type}&resource_id={resource_id}&permission={permission_code}')
    if isinstance(result, dict) and result.get('allowed') is True:
        return True
    return False


def _cmdb_get_sessions(user_id=None):
    qs = f'?user_id={user_id}' if user_id else ''
    return _api_call('GET', f'/api/skill-dev/sessions{qs}') or []


def _cmdb_get_session(session_id, user_id=None):
    qs = f'?user_id={user_id}' if user_id else ''
    return _api_call('GET', f'/api/skill-dev/sessions/{session_id}{qs}')


def _cmdb_delete_session(session_id, user_id=None):
    qs = f'?user_id={user_id}' if user_id else ''
    return _api_call('DELETE', f'/api/skill-dev/sessions/{session_id}{qs}')


def _extract_result(resp):
    if resp is None:
        return None
    if isinstance(resp, dict) and 'error' in resp:
        return resp
    return resp


@skills_bp.route('/api/skills', methods=['GET'])
def get_skills():
    if not _cmdb_check_permission('skill:read', 'skill', '*'):
        return jsonify({'error': '无权限查看技能'}), 403
    try:
        skills = _cmdb_list_skills()
        if skills is None:
            skills = []
        return jsonify(skills)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>', methods=['GET'])
def get_skill(skill_id):
    if not _cmdb_check_permission('skill:read', 'skill', skill_id):
        return jsonify({'error': '无权限查看技能'}), 403
    try:
        result = _cmdb_get_skill(skill_id)
        if result is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(result, dict) and 'error' in result:
            return jsonify(result), 403
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills', methods=['POST'])
def create_skill():
    if not _cmdb_check_permission('skill:create', 'skill', '*'):
        return jsonify({'error': '无权限创建技能'}), 403
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求数据为空'}), 400

        name = data.get('name', '').strip()
        if not name:
            return jsonify({'error': 'Skill名称不能为空'}), 400

        if not validate_skill_name(name):
            return jsonify({'error': '技能名称只能包含英文字母、数字、下划线和连字符'}), 400

        skill = _cmdb_create_skill(data)
        if skill is None:
            return jsonify({'error': '创建失败'}), 500
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        create_skill_directory(name)

        return jsonify(skill), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>', methods=['PUT'])
def update_skill(skill_id):
    if not _cmdb_check_permission('skill:update', 'skill', skill_id):
        return jsonify({'error': '无权限更新技能'}), 403
    try:
        skill = _cmdb_get_skill(skill_id)
        if not skill:
            return jsonify({'error': 'Skill不存在'}), 404

        data = request.get_json()
        if not data:
            return jsonify({'error': '请求数据为空'}), 400

        updated = _cmdb_update_skill(skill_id, data)
        if updated is None:
            return jsonify({'error': '更新失败'}), 500
        if isinstance(updated, dict) and 'error' in updated:
            return jsonify(updated), 403

        return jsonify(updated)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>', methods=['DELETE'])
def delete_skill(skill_id):
    if not _cmdb_check_permission('skill:delete', 'skill', skill_id):
        return jsonify({'error': '无权限删除技能'}), 403
    try:
        skill = _cmdb_get_skill(skill_id)
        if skill is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        result = _cmdb_delete_skill(skill_id)
        if result is not None and isinstance(result, dict) and 'error' in result:
            return jsonify(result), 403

        import shutil
        skill_dir = get_skill_directory(skill.get('name', ''))
        if skill_dir and os.path.exists(skill_dir):
            shutil.rmtree(skill_dir)

        return jsonify({'message': '删除成功'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>/file', methods=['POST'])
def create_file(skill_id):
    """在指定目录下创建文件"""
    try:
        skill = _cmdb_get_skill(skill_id)
        if skill is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        if not _cmdb_check_permission('skill:update', 'skill', skill_id):
            return jsonify({'error': '无权限创建文件'}), 403

        data = request.get_json()
        file_path = data.get('file_path', '')
        content = data.get('content', '')
        skill_name = data.get('skill_name', '') or skill.get('name', '')

        if not file_path:
            return jsonify({'error': '文件路径不能为空'}), 400
        if not skill_name or not validate_skill_name(skill_name):
            return jsonify({'error': '无效的技能名称'}), 400

        # 安全检查：防止路径遍历攻击
        if '..' in file_path or file_path.startswith('/'):
            return jsonify({'error': '无效的文件路径'}), 400

        skill_dir = os.path.join(SKILLS_BASE_DIR, skill_name)
        full_path = os.path.join(skill_dir, file_path)

        # 确保目录存在
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        # 创建文件
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

        return jsonify({'message': '文件创建成功', 'file_path': file_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>/file', methods=['GET'])
def read_file(skill_id):
    """读取文件内容"""
    if not _cmdb_check_permission('skill:read', 'skill', skill_id):
        return jsonify({'error': '无权限读取文件'}), 403
    try:
        skill = _cmdb_get_skill(skill_id)
        if skill is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        file_path = request.args.get('file_path', '')
        skill_name = request.args.get('skill_name', '') or skill.get('name', '')

        if not file_path:
            return jsonify({'error': '文件路径不能为空'}), 400
        if not skill_name or not validate_skill_name(skill_name):
            return jsonify({'error': '无效的技能名称'}), 400

        # 安全检查
        if '..' in file_path or file_path.startswith('/'):
            return jsonify({'error': '无效的文件路径'}), 400

        skill_dir = os.path.join(SKILLS_BASE_DIR, skill_name)
        full_path = os.path.join(skill_dir, file_path)

        if not os.path.exists(full_path):
            return jsonify({'error': '文件不存在'}), 404

        if os.path.isdir(full_path):
            return jsonify({'error': '不能读取目录'}), 400

        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return jsonify({'file_path': file_path, 'content': content})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>/file', methods=['PUT'])
def update_file(skill_id):
    """更新文件内容"""
    try:
        skill = _cmdb_get_skill(skill_id)
        if skill is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        if not _cmdb_check_permission('skill:update', 'skill', skill_id):
            return jsonify({'error': '无权限编辑文件'}), 403

        data = request.get_json()
        file_path = data.get('file_path', '')
        content = data.get('content', '')
        skill_name = data.get('skill_name', '') or skill.get('name', '')

        if not file_path:
            return jsonify({'error': '文件路径不能为空'}), 400
        if not skill_name or not validate_skill_name(skill_name):
            return jsonify({'error': '无效的技能名称'}), 400

        # 安全检查
        if '..' in file_path or file_path.startswith('/'):
            return jsonify({'error': '无效的文件路径'}), 400

        skill_dir = os.path.join(SKILLS_BASE_DIR, skill_name)
        full_path = os.path.join(skill_dir, file_path)

        if not os.path.exists(full_path):
            return jsonify({'error': '文件不存在'}), 404

        if os.path.isdir(full_path):
            return jsonify({'error': '不能写入目录'}), 400

        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

        return jsonify({'message': '文件更新成功', 'file_path': file_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skills/<skill_id>/tree', methods=['GET'])
def get_skill_tree(skill_id):
    """获取技能目录树结构"""
    if not _cmdb_check_permission('skill:read', 'skill', skill_id):
        return jsonify({'error': '无权限查看技能目录'}), 403
    try:
        skill = _cmdb_get_skill(skill_id)
        if skill is None:
            return jsonify({'error': 'Skill不存在'}), 404
        if isinstance(skill, dict) and 'error' in skill:
            return jsonify(skill), 403

        skill_name = request.args.get('skill_name', '') or skill.get('name', '')
        if not skill_name or not validate_skill_name(skill_name):
            return jsonify({'error': '无效的技能名称'}), 400

        skill_dir = os.path.join(SKILLS_BASE_DIR, skill_name)
        tree = get_directory_tree(skill_dir)

        return jsonify({
            'skill_id': skill_id,
            'skill_name': skill_name,
            'tree': tree
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/chat', methods=['POST'])
def skill_development_chat():
    """处理技能开发对话 - 使用ReactAgent和SemanticParser（流式返回）"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求数据为空'}), 400

        user_message = data.get('message', '').strip()
        session_id = data.get('session_id')
        user_id = data.get('user_id')

        if not user_message:
            return jsonify({'error': '消息不能为空'}), 400

        # 获取或创建会话（通过 CMDB API）
        chat_session = None
        if session_id:
            resp = _cmdb_get_session(session_id, user_id)
            if resp and resp.get('session'):
                chat_session = resp['session']

        # 去除粘贴前缀（如 "[Pasted ~4 lines]"）
        import re
        cleaned_message = (re.sub(r'^\[Pasted?[^\]]*\]?\s*', '', user_message) if user_message.startswith(
            '[Paste') else user_message).strip()

        if not chat_session:
            title = cleaned_message[:50] + ('...' if len(cleaned_message) > 50 else '')
            chat_session = _cmdb_create_session(user_id, title)
            if not chat_session:
                return jsonify({'error': '创建会话失败'}), 500

        _cmdb_create_message(chat_session['id'], 'user', cleaned_message)

        router_manager = get_skill_router_manager()

        def generate():
            nonlocal chat_session
            matched_skills = []
            all_reasoning_steps = []
            response_message = ""
            execution_result = None
            try:
                yield f"data: {json.dumps({'type': 'session', 'session_id': chat_session['id']})}\n\n"

                yield f"data: {json.dumps({'type': 'step', 'step': 'parse', 'status': 'loading', 'title': '正在语义解析...', 'icon': '🔄'})}\n\n"

                routing_results = router_manager.route(user_message)

                for result in routing_results:
                    if result.skill_name:
                        skill = router_manager.loader.get_skill(result.skill_name)
                        matched_skills.append({
                            'skill': {
                                'name': result.skill_name,
                                'description': skill.description if skill else '',
                                'category': '技能',
                                'icon': '🔧'
                            },
                            'score': result.confidence,
                            'reason': result.reasoning,
                            'extracted_params': result.extracted_params
                        })

                if matched_skills and matched_skills[0]['score'] >= 0.5:
                    best_match = matched_skills[0]
                    skill_name = best_match['skill']['name']
                    extracted_params = best_match.get('extracted_params', {})
                    hosts = extracted_params.get('hosts', [])

                    yield f"data: {json.dumps({'type': 'step', 'step': 'parse', 'status': 'done', 'title': '语义解析完成', 'detail': f'匹配技能: {skill_name}', 'icon': '✅'})}\n\n"

                    if hosts:
                        hosts_str = ', '.join(hosts)
                        yield f"data: {json.dumps({'type': 'step', 'step': 'extract', 'status': 'done', 'title': '提取参数', 'detail': f'目标主机: {hosts_str}', 'icon': '✅'})}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'step', 'step': 'extract', 'status': 'done', 'title': '提取参数', 'detail': '目标主机: 无', 'icon': '✅'})}\n\n"

                    if hosts:
                        yield f"data: {json.dumps({'type': 'step', 'step': 'detail', 'status': 'done', 'title': '命令详情', 'detail': f'远程命令将执行 ({len(hosts)}台主机)', 'icon': '✅'})}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'step', 'step': 'detail', 'status': 'done', 'title': '命令详情', 'detail': '本地命令已执行', 'icon': '✅'})}\n\n"

                    yield f"data: {json.dumps({'type': 'step', 'step': 'execute', 'status': 'loading', 'title': '正在执行命令...', 'icon': '🔄'})}\n\n"

                    try:
                        skill_dir = get_skill_directory(skill_name)
                        if skill_dir and os.path.exists(skill_dir):
                            execution_result = router_manager.execute_skill_with_ssh(
                                skill_name=skill_name,
                                user_input=user_message,
                                extracted_params=extracted_params
                            )
                            execute_command = execution_result.get('command', 'unknown')
                            if execution_result.get('success', False):
                                yield f"data: {json.dumps({'type': 'step', 'step': 'execute', 'status': 'done', 'title': '执行命令', 'detail': execute_command, 'icon': '✅'})}\n\n"
                            else:
                                error_msg = execution_result.get('error', 'unknown')
                                yield f"data: {json.dumps({'type': 'step', 'step': 'execute', 'status': 'error', 'title': '执行命令', 'detail': f'执行失败: {error_msg}', 'icon': '❌'})}\n\n"
                        else:
                            yield f"data: {json.dumps({'type': 'step', 'step': 'execute', 'status': 'error', 'title': '执行命令', 'detail': '技能不存在', 'icon': '❌'})}\n\n"
                    except Exception as e:
                        yield f"data: {json.dumps({'type': 'step', 'step': 'execute', 'status': 'error', 'title': '执行命令', 'detail': f'执行失败: {str(e)}', 'icon': '❌'})}\n\n"

                    response_message = ""
                    execution_output = ""
                    if execution_result:
                        exec_type = execution_result.get('type', 'unknown')
                        if exec_type == 'remote':
                            results = execution_result.get('results', {})
                            for host, result in results.items():
                                if result.get('success', False):
                                    execution_output = result.get('output', '')
                                    response_message += f"\n【{host}】执行结果:\n{execution_output}\n\n"
                                else:
                                    response_message += f"\n【{host}】执行失败:\n{result.get('error', '')}\n\n"
                        else:
                            if execution_result.get('success', False):
                                execution_output = execution_result.get('output', '')
                                response_message += f"\n执行结果:\n{execution_output}"
                            else:
                                response_message += f"\n执行失败:\n{execution_result.get('error', '')}"
                    else:
                        response_message = f"❌技能执行失败\n\n错误信息: 执行异常"

                    yield f"data: {json.dumps({'type': 'message', 'content': response_message, 'matched_skills': matched_skills})}\n\n"

                    has_summary = False
                    if execution_output and execution_result and execution_result.get('success', False):
                        yield f"data: {json.dumps({'type': 'step', 'step': 'summary', 'status': 'loading', 'title': '正在分析结果...', 'icon': '🔄'})}\n\n"
                        try:
                            from src.semantic_parser import SemanticParser
                            ai_config = router_manager.config.get('AI_MODEL', {})
                            parser = SemanticParser(
                                base_url=ai_config.get('base_url', 'https://api.openai.com/v1'),
                                api_key=ai_config.get('api_key', ''),
                                model=ai_config.get('model', 'gpt-4o'),
                                temperature=ai_config.get('temperature', 0.0),
                                max_tokens=ai_config.get('max_tokens', 10280)
                            )
                            summary_prompt = f"""请根据以下命令执行结果，给出简洁的总结和结论：

用户需求: {user_message}
执行命令: {execution_result.get('command', 'unknown')}
执行结果:
{execution_output}
请提供：
1. 结果解读：这些数据说明了什么
2. 结论：系统状态是否正常
3. 建议：如果需要的话，给出优化建议

请用简洁明了的语言回答。"""
                            summary_response = parser.client.chat.completions.create(
                                model=parser.model,
                                messages=[
                                    {"role": "system",
                                     "content": "你是一个专业的系统运维分析师，负责分析命令执行结果并给出专业的总结和建议。"},
                                    {"role": "user", "content": summary_prompt}
                                ],
                                temperature=0.3,
                                max_tokens=10280
                            )
                            summary_content = summary_response.choices[0].message.content
                            response_message += f"\n📊 **结果分析**\n{summary_content}"
                            has_summary = True
                            yield f"data: {json.dumps({'type': 'step', 'step': 'summary', 'status': 'done', 'title': '结果分析', 'detail': '已完成', 'icon': '✅'})}\n\n"
                            yield f"data: {json.dumps({'type': 'message_update', 'content': response_message})}\n\n"
                        except Exception as e:
                            print(f"[WARN] 大模型总结失败: {e}")
                            yield f"data: {json.dumps({'type': 'step', 'step': 'summary', 'status': 'error', 'title': '结果分析', 'detail': f'分析失败: {str(e)}', 'icon': '❌'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'step', 'step': 'parse', 'status': 'done', 'title': '语义解析完成', 'detail': '未找到匹配的技能', 'icon': '⚠️'})}\n\n"
                    response_message = "抱歉，我没有找到与您需求匹配的技能。请尝试描述更具体的需求，或者查看技能管理中的可用技能。"
                    yield f"data: {json.dumps({'type': 'message', 'content': response_message, 'matched_skills': matched_skills})}\n\n"

                yield f"data: {json.dumps({'type': 'done'})}\n\n"

                # --- 后处理：构建推理步骤并保存到 CMDB ---
                try:
                    if matched_skills:
                        best_match = matched_skills[0]
                        skill_name = best_match['skill']['name']
                        extracted_params = best_match.get('extracted_params', {})
                        hosts = extracted_params.get('hosts', [])

                        all_reasoning_steps.append({'step': 'parse', 'status': 'done', 'title': '语义解析完成',
                                                    'detail': f'匹配技能: {skill_name}', 'icon': '✅'})

                        if hosts:
                            all_reasoning_steps.append({'step': 'extract', 'status': 'done', 'title': '提取参数',
                                                        'detail': f'目标主机: {", ".join(hosts)}', 'icon': '✅'})
                        else:
                            all_reasoning_steps.append(
                                {'step': 'extract', 'status': 'done', 'title': '提取参数', 'detail': '目标主机: 无',
                                 'icon': '✅'})

                        if hosts:
                            all_reasoning_steps.append({'step': 'detail', 'status': 'done', 'title': '命令详情',
                                                        'detail': f'远程命令将执行 ({len(hosts)}台主机)', 'icon': '✅'})
                        else:
                            all_reasoning_steps.append(
                                {'step': 'detail', 'status': 'done', 'title': '命令详情', 'detail': '本地命令已执行',
                                 'icon': '✅'})

                        if execution_result:
                            execute_command = execution_result.get('command', 'unknown')
                            if execution_result.get('success', False):
                                all_reasoning_steps.append({'step': 'execute', 'status': 'done', 'title': '执行命令',
                                                            'detail': execute_command, 'icon': '✅'})
                                if has_summary:
                                    all_reasoning_steps.append(
                                        {'step': 'summary', 'status': 'done', 'title': '结果分析', 'detail': '已完成',
                                         'icon': '✅'})
                            else:
                                error_msg = execution_result.get('error', 'unknown')
                                all_reasoning_steps.append({'step': 'execute', 'status': 'error', 'title': '执行命令',
                                                            'detail': f'执行失败: {error_msg}', 'icon': '❌'})
                    else:
                        all_reasoning_steps.append(
                            {'step': 'parse', 'status': 'done', 'title': '语义解析完成', 'detail': '未找到匹配的技能',
                             'icon': '⚠️'})

                    # 通过 CMDB API 保存助手消息
                    _cmdb_create_message(
                        chat_session['id'], 'assistant', response_message,
                        matched_skills=json.dumps(matched_skills),
                        reasoning_steps=json.dumps(all_reasoning_steps),
                    )
                except Exception as post_err:
                    print(f"[WARN] 后处理异常（不影响前端）: {post_err}")

            except Exception as e:
                error_message = f"执行失败: {str(e)}"
                print(f"[ERROR] 对话处理异常: {e}")
                try:
                    _cmdb_create_message(
                        chat_session['id'], 'assistant', error_message,
                        matched_skills=json.dumps(matched_skills),
                        reasoning_steps=json.dumps(all_reasoning_steps),
                    )
                except Exception:
                    pass
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        return Response(stream_with_context(generate()), mimetype='text/event-stream')

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/sessions', methods=['GET'])
def get_chat_sessions():
    """获取所有对话会话列表"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        user_id = request.args.get('user_id')
        sessions = _cmdb_get_sessions(user_id)
        return jsonify(sessions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/sessions/<session_id>', methods=['GET'])
def get_chat_session(session_id):
    """获取指定会话的详情和消息"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        user_id = request.args.get('user_id')
        resp = _cmdb_get_session(session_id, user_id)
        if resp is None:
            return jsonify({'error': '会话不存在'}), 404
        if resp.get('_error') == 'forbidden':
            return jsonify({'error': '无权访问此会话'}), 403

        session_data = resp['session']
        messages = resp['messages']

        # 转为前端需要的格式（合并 to_dict 逻辑）
        session = {
            'id': session_data['id'],
            'user_id': session_data.get('user_id', ''),
            'title': session_data.get('title', '新对话'),
            'created_at': session_data.get('created_at', ''),
            'updated_at': session_data.get('updated_at', ''),
            'message_count': len(messages),
        }
        msg_list = []
        for m in messages:
            try:
                ms = json.loads(m.get('matched_skills', '[]'))
            except Exception:
                ms = []
            try:
                rs = json.loads(m.get('reasoning_steps', '[]'))
            except Exception:
                rs = []
            msg_list.append({
                'id': m['id'],
                'session_id': m['session_id'],
                'role': m['role'],
                'content': m.get('content', ''),
                'matched_skills': ms,
                'reasoning_steps': rs,
                'created_at': m.get('created_at', ''),
            })

        return jsonify({'session': session, 'messages': msg_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/sessions/<session_id>', methods=['DELETE'])
def delete_chat_session(session_id):
    """删除对话会话"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        user_id = request.args.get('user_id')
        resp = _cmdb_delete_session(session_id, user_id)
        if resp is None:
            return jsonify({'error': '会话不存在'}), 404
        if resp.get('_error') == 'forbidden':
            return jsonify({'error': '无权删除此会话'}), 403
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/history/<session_id>', methods=['GET'])
def get_skill_development_history(session_id):
    """获取技能开发对话历史"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        resp = _cmdb_get_session(session_id)
        if resp is None:
            return jsonify({'error': '会话不存在'}), 404

        session_data = resp['session']
        messages = resp['messages']

        msg_list = []
        for m in messages:
            try:
                ms = json.loads(m.get('matched_skills', '[]'))
            except Exception:
                ms = []
            try:
                rs = json.loads(m.get('reasoning_steps', '[]'))
            except Exception:
                rs = []
            msg_list.append({
                'id': m['id'],
                'session_id': m['session_id'],
                'role': m['role'],
                'content': m.get('content', ''),
                'matched_skills': ms,
                'reasoning_steps': rs,
                'created_at': m.get('created_at', ''),
            })

        return jsonify({
            'session_id': session_id,
            'messages': msg_list,
            'created_at': session_data.get('created_at', ''),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/skill-development/execute', methods=['POST'])
def execute_skill_action():
    """执行技能动作 - 使用技能路由器，并将执行记录保存到对话历史"""
    if not _cmdb_check_permission('skill-dev:use', 'skill-dev', '*'):
        return jsonify({'error': '无权限使用对话运维'}), 403
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求数据为空'}), 400

        skill_id = data.get('skill_id')
        action = data.get('action', 'default')
        parameters = data.get('parameters', {})
        user_input = data.get('user_input', '')
        session_id = data.get('session_id')
        user_id = data.get('user_id')

        if not skill_id:
            return jsonify({'error': '技能ID不能为空'}), 400

        skill = _cmdb_get_skill(skill_id)
        if not skill:
            return jsonify({'error': '技能不存在'}), 404

        # 获取或创建对话会话（通过 CMDB API）
        chat_session = None
        if session_id:
            resp = _cmdb_get_session(session_id, user_id)
            if resp and resp.get('session'):
                chat_session = resp['session']

        if not chat_session:
            skill_name = skill.get('name', '')
            title = f"执行技能: {skill_name}"
            chat_session = _cmdb_create_session(user_id, title)
            if not chat_session:
                return jsonify({'error': '创建会话失败'}), 500

        skill_name = skill.get('name', '')
        # 保存用户执行请求消息
        user_msg_content = user_input or f"请执行技能 {skill_name}"
        _cmdb_create_message(chat_session['id'], 'user', user_msg_content)

        router_manager = get_skill_router_manager()

        success = False
        error_message = None
        execution_output = None

        try:
            execution_result = router_manager.execute_skill(
                skill_name=skill_name,
                user_input=user_input or f"执行{skill_name}技能",
                extracted_params=parameters
            )
            if execution_result and execution_result.get('success', False):
                success = True
                execution_output = execution_result.get('output', '')
            else:
                error_message = execution_result.get('error',
                                                     '执行失败，请检查技能配置') if execution_result else '执行返回为空'
        except Exception as exec_err:
            error_message = str(exec_err)

        if success:
            response_content = f"✅ 技能 \"{skill_name}\" 已成功执行！\n\n"
            if execution_output:
                response_content += f"执行结果:\n{execution_output}"
            else:
                response_content += "技能执行完成。"
            reasoning_steps = json.dumps([
                {'step': 'execute', 'status': 'done', 'title': '执行命令', 'detail': skill_name, 'icon': '✅'}
            ])
        else:
            response_content = f"❌技能 \"{skill_name}\" 执行失败"
            if error_message:
                response_content += f"\n\n错误信息: {error_message}"
            reasoning_steps = json.dumps([
                {'step': 'execute', 'status': 'error', 'title': '执行命令', 'detail': error_message or '未知错误',
                 'icon': '❌'}
            ])

        skill_desc = skill.get('description', '')
        skill_icon = skill.get('icon', '')
        skill_category = skill.get('category', '')
        # 保存助手响应到 CMDB
        _cmdb_create_message(
            chat_session['id'], 'assistant', response_content,
            matched_skills=json.dumps([{
                'skill': {'name': skill_name, 'description': skill_desc, 'category': skill_category,
                          'icon': skill_icon},
                'score': 100,
                'reason': '手动执行'
            }]),
            reasoning_steps=reasoning_steps,
        )

        result = {
            'skill_id': skill_id,
            'skill_name': skill_name,
            'action': action,
            'parameters': parameters,
            'session_id': chat_session['id'],
            'status': 'success' if success else 'error',
            'output': execution_output or '',
            'message': response_content,
            'timestamp': datetime.utcnow().isoformat()
        }

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@skills_bp.route('/api/ai/command-suggest', methods=['POST'])
def command_suggest():
    if not _cmdb_check_permission('command-suggest:use', 'command-suggest', '*'):
        return jsonify({'error': '无权限使用命令建议'}), 403
    try:
        data = request.get_json()
        current_input = data.get('current_input', '').strip()
        host_info = data.get('host_info', {})

        if not current_input:
            return jsonify({'suggestions': []})

        router_manager = get_skill_router_manager()
        ai_config = router_manager.config.get('AI_MODEL', {})

        base_url = ai_config.get('base_url', 'https://api.openai.com/v1').rstrip('/')
        if '/chat/completions' in base_url:
            base_url = base_url.replace('/chat/completions', '')

        api_key = ai_config.get('api_key', '')
        model = ai_config.get('model', 'qwen2.5-coder')

        client = OpenAI(base_url=base_url, api_key=api_key, timeout=5)

        os_type = host_info.get('os_type', 'Linux')
        system_prompt = (
            f"你是一个 {os_type} 系统运维专家。根据用户输入的部分命令，给出 5 个命令补全建议。\n"
            "规则：\n"
            "1. 只输出 JSON 数组，如 [\"cmd1\", \"cmd2\", \"cmd3\", \"cmd4\", \"cmd5\"]\n"
            "2. 不要任何解释、序号或 Markdown 格式\n"
            "3. 每个建议必须是完整可执行的命令\n"
            "4. 建议从简到繁排列：前面是基础命令，后面带上更多参数/选项\n"
            "5. 如果输入为空或不明确，返回 []"
        )

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"当前输入: {current_input}"}
            ],
            temperature=0.4,
            max_tokens=300,
            timeout=5,
        )

        content = response.choices[0].message.content.strip()
        content = content.removeprefix('```json').removesuffix('```').strip()
        content = content.removeprefix('```').removesuffix('```').strip()

        suggestions = json.loads(content) if content else []
        if not isinstance(suggestions, list):
            suggestions = []

        return jsonify({'suggestions': suggestions[:5]})

    except Exception as e:
        return jsonify({'suggestions': [], 'error': str(e)})
