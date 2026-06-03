import os
import sys
import json
import yaml
import re
import glob
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI

# 并行执行最大主机数
PARALLEL_WORKERS = 10

from urllib.request import Request, urlopen
from urllib.error import HTTPError

# 添加 linxi_skill_server 目录及其父目录到 Python 路径
linxi_dir = Path(__file__).parent
project_root = linxi_dir.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(linxi_dir))

# 日志配置: logs/ai-skills/YYYY-MM-DD.log
log_dir = project_root / 'logs' / 'ai-skills'
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / f"{datetime.now().strftime('%Y-%m-%d')}.log"

logger = logging.getLogger('skill_router')
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    fh = logging.FileHandler(str(log_file), encoding='utf-8')
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    logger.addHandler(fh)

from src.skill_loader import SkillLoader
from src.semantic_parser import SemanticParser
from src.executor import SSHExecutor, SSHConfig

_cmdb_token = None


def _ensure_cmdb_token():
    global _cmdb_token
    if _cmdb_token:
        return _cmdb_token
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        data = json.dumps({"username": "admin", "password": "admin123456"}).encode()
        req = Request(f'{cmdb_base}/api/auth/login', data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        with urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read().decode())
            _cmdb_token = body.get('token')
            return _cmdb_token
    except Exception:
        return None


def _cmdb_api_get(path):
    token = _ensure_cmdb_token()
    if token:
        sep = '&' if '?' in path else '?'
        path = f'{path}{sep}token={token}'
    req = Request(path, method='GET')
    req.add_header('Content-Type', 'application/json')
    try:
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def _get_cmdb_host_by_ip(ip_address):
    """从 Go cmdb API 按 IP 查找主机（不含密码/私钥）"""
    try:
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        data = _cmdb_api_get(f'{cmdb_base}/api/hosts?ip={ip_address}&per_page=1')
        if not data:
            return None
        hosts = data if isinstance(data, list) else data.get('hosts', [])
        for h in hosts:
            if h.get('ip_address') == ip_address:
                return h
    except Exception:
        pass
    return None


def _get_cmdb_host_credentials_by_ip(ip_address):
    """从 Go cmdb API 按 IP 查找主机凭证（含密码/私钥）"""
    try:
        host = _get_cmdb_host_by_ip(ip_address)
        if not host or not host.get('id'):
            return None
        router_manager = get_skill_router_manager()
        cmdb_base = router_manager.config.get('CMDB_API_BASE', 'http://127.0.0.1:9080')
        return _cmdb_api_get(f'{cmdb_base}/api/hosts/{host["id"]}/credentials')
    except Exception:
        return None


@dataclass
class RoutingResult:
    skill_name: str
    confidence: float
    reasoning: str
    extracted_params: dict
    skill_path: Optional[str] = None

    def is_valid(self, threshold: float = 0.6) -> bool:
        return self.skill_name is not None and self.confidence >= threshold


class SkillRouterManager:
    _instance = None

    @classmethod
    def get_instance(cls, skills_dir: str = None, config_path: str = None):
        if cls._instance is None:
            cls._instance = cls(skills_dir, config_path)
        return cls._instance

    def __init__(self, skills_dir: str = None, config_path: str = None):
        self.skills_dir = skills_dir or str(project_root / "skills")
        self.config_path = config_path or str(project_root / "config.yaml")
        self.config = self._load_config()
        self.loader = SkillLoader(self.skills_dir)
        self.semantic_parser = None
        self.ssh_executor = SSHExecutor()
        self.last_results = None
        self.react_agent = None
        self.confidence_threshold = 0.6
        self._init_components()

    def _load_config(self) -> dict:
        if os.path.exists(self.config_path):
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f) or {}
        return {}

    def _init_components(self):
        ai_config = self.config.get('AI_MODEL', {})
        self.base_url = ai_config.get('base_url', 'https://api.openai.com/v1')
        self.api_key = ai_config.get('api_key', '')
        self.model = ai_config.get('model', 'gpt-4o')
        self.temperature = ai_config.get('temperature', 0.0)
        self.max_tokens = ai_config.get('max_tokens', 10280)
        self.client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        self.semantic_parser = SemanticParser(
            base_url=ai_config.get('base_url', 'https://api.openai.com/v1'),
            api_key=ai_config.get('api_key', ''),
            model=ai_config.get('model', 'gpt-4o'),
            temperature=ai_config.get('temperature', 0.0),
            max_tokens=ai_config.get('max_tokens', 10280),
            routing_rules=self.config.get('SKILL_ROUTING_RULES')
        )

    def _init_react_agent(self):
        if self.react_agent is None:
            self.react_agent = ReactAgent(router=self)

    def start_conversation(self, initial_input: str) -> str:
        self._init_react_agent()
        return self.react_agent.start_conversation(initial_input)

    def continue_conversation(self, user_input: str) -> str:
        self._init_react_agent()
        return self.react_agent.continue_conversation(user_input)

    def get_conversation_status(self) -> dict:
        self._init_react_agent()
        return self.react_agent.get_conversation_status()

    def route(self, user_input: str, context: Optional[Dict[str, Any]] = None) -> List[RoutingResult]:
        """路由用户输入到匹配的技能"""
        try:
            skills = self.loader.load_all()
            skills_metadata = [s.to_dict() for s in skills.values()]
            # print("skills_metadata: ",skills_metadata)
            candidates = self.semantic_parser.parse_multi(
                user_input, skills_metadata, max_candidates=3, context=context
            )

            logger.debug("user_input: %s", user_input)
            logger.debug("candidates: %s", candidates)

            results = []
            for candidate in candidates:
                # print("candidate: ", candidate)
                skill = self.loader.get_skill(candidate.skill_name)
                results.append(
                    RoutingResult(
                        skill_name=candidate.skill_name,
                        confidence=candidate.confidence,
                        reasoning=candidate.reasoning,
                        extracted_params=candidate.extracted_params,
                        skill_path=skill.path if skill else None,
                    )
                )
            return results
        except Exception as e:
            print(f"[ERROR] 路由失败: {e}")
            return self._fallback_route(user_input)

    def route_best(self, user_input: str, context: Optional[Dict[str, Any]] = None) -> Optional[RoutingResult]:
        """路由到最佳匹配的技能"""
        try:
            results = self.route(user_input, context)
            if results and results[0].is_valid():
                return results[0]
            return None
        except Exception as e:
            print(f"[ERROR] 最佳路由失败: {e}")
            return None

    def _fallback_route(self, user_input: str) -> List[RoutingResult]:
        """回退路由：基于关键词匹配"""
        skills = self.loader.load_all()
        results = []
        user_input_lower = user_input.lower()

        for skill_name, skill in skills.items():
            trigger_scenarios = skill.trigger_scenarios or []
            for scenario in trigger_scenarios:
                if scenario.lower() in user_input_lower:
                    results.append(
                        RoutingResult(
                            skill_name=skill_name,
                            confidence=0.7,
                            reasoning=f"关键词匹配: {scenario}",
                            extracted_params={},
                            skill_path=skill.path,
                        )
                    )
                    break

        return sorted(results, key=lambda x: x.confidence, reverse=True)

    def execute(self, skill_name: str, user_input: str, extracted_params: Optional[dict] = None) -> dict:
        return self.execute_skill_with_ssh(skill_name, user_input, extracted_params)

    def execute_skill_with_ssh(self, skill_name: str, user_input: str, extracted_params: Optional[dict] = None) -> dict:
        """使用SSH执行技能（支持远程脚本传输）"""
        hosts = extracted_params.get('hosts', []) if extracted_params else []

        # 获取技能目录
        skill_dir = os.path.join(self.skills_dir, skill_name)

        # 收集技能脚本
        scripts_dir = os.path.join(skill_dir, 'scripts')
        skill_scripts = {}

        if os.path.exists(scripts_dir):
            for script_file in glob.glob(os.path.join(scripts_dir, '*')):
                if os.path.isfile(script_file):
                    script_name = os.path.basename(script_file)
                    with open(script_file, 'r', encoding='utf-8') as f:
                        skill_scripts[script_name] = f.read()

        # 读取SKILL.md并生成执行计划
        skill_md_path = os.path.join(skill_dir, 'SKILL.md')
        if not os.path.exists(skill_md_path):
            return {
                'type': 'local',
                'command': '',
                'output': '',
                'error': f'SKILL.md not found in {skill_dir}',
                'returncode': -1,
                'success': False
            }

        with open(skill_md_path, encoding='utf-8') as file:
            skill_content = file.read()

        plan = self._generate_execution_plan(
            skill_content, user_input, extracted_params
        )

        if not plan:
            return {
                'type': 'local',
                'command': '',
                'output': '',
                'error': '生成执行计划失败',
                'returncode': -1,
                'success': False
            }

        logger.debug("plan: %s", plan)

        if not plan.get('need_execution'):
            return {
                'type': 'local',
                'command': '',
                'output': '无需执行命令',
                'error': '',
                'returncode': 0,
                'success': True
            }

        commands = plan.get('commands', [])

        # 过滤掉localhost和127.0.0.1
        remote_hosts = [h for h in hosts if h not in ('localhost', '127.0.0.1', '::1')]

        if remote_hosts:
            return self._execute_remote_on_hosts(skill_name, skill_scripts, commands, remote_hosts, skill_dir)
        else:
            return self._execute_local_commands(commands, skill_dir)

    def reload_skills(self):
        """重新加载技能"""
        self.loader = SkillLoader(self.skills_dir)

    def _execute_on_single_host(self, host, skill_name, skill_scripts, execute_command, skill_dir):
        """在单台主机上执行命令（供 ThreadPoolExecutor 调用）"""
        import tempfile

        host_info = _get_cmdb_host_credentials_by_ip(host)

        if host_info:
            if host_info.get('auth_type') == 'key' and host_info.get('private_key'):
                with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.pem') as key_file:
                    key_file.write(host_info['private_key'])
                    key_path = key_file.name

                config = SSHConfig(
                    host=host,
                    port=host_info.get('port', 22) or 22,
                    username=host_info.get('username', 'root'),
                    key_path=key_path,
                    timeout=300
                )
            else:
                config = SSHConfig(
                    host=host,
                    port=host_info.get('port', 22) or 22,
                    username=host_info.get('username', 'root'),
                    password=host_info.get('password'),
                    timeout=300
                )
        else:
            return host, {
                'output': '',
                'error': f"主机 {host} 未在 CMDB 数据库中找到，请先在 CMDB 中添加该主机并配置认证信息",
                'returncode': -1,
                'success': False
            }

        if skill_scripts:
            result = self.ssh_executor.execute_command_with_skill(
                config=config,
                skill_name=skill_name,
                skill_scripts=skill_scripts,
                command=execute_command
            )
        else:
            result = self.ssh_executor.execute(config, execute_command)

        if isinstance(result, dict):
            if 'success' not in result:
                result['success'] = result.get('returncode', -1) == 0
            return host, result
        else:
            return host, {
                'output': str(result),
                'error': '',
                'returncode': 0,
                'success': True
            }

    def _execute_remote_on_hosts(self, skill_name, skill_scripts, commands, remote_hosts, skill_dir):
        """在远程主机上并行执行命令"""
        execute_command = ' && '.join(commands) if commands else 'bash scripts/tool.sh'
        results = {}

        with ThreadPoolExecutor(max_workers=min(len(remote_hosts), PARALLEL_WORKERS)) as pool:
            futures = {
                pool.submit(self._execute_on_single_host, host, skill_name, skill_scripts, execute_command, skill_dir): host
                for host in remote_hosts
            }
            for future in as_completed(futures):
                host, result = future.result()
                results[host] = result

        all_success = all(r.get('success', False) for r in results.values())

        return {
            'type': 'remote',
            'hosts': remote_hosts,
            'command': execute_command,
            'results': results,
            'success': all_success,
            'output': '\n'.join([f"{host}: {r.get('output', '')}" for host, r in results.items()]),
            'error': '\n'.join([f"{host}: {r.get('error', '')}" for host, r in results.items() if r.get('error')])
        }

    def _execute_local_commands(self, commands, skill_dir):
        """本地执行命令"""
        import subprocess

        if not commands:
            return {
                'type': 'local',
                'command': '',
                'output': '',
                'error': '没有可执行的命令',
                'returncode': -1,
                'success': False
            }

        results = []
        for cmd in commands:
            try:
                result = subprocess.run(
                    cmd,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    cwd=skill_dir
                )
                results.append({
                    'command': cmd,
                    'output': result.stdout.strip(),
                    'error': result.stderr.strip(),
                    'returncode': result.returncode,
                })
            except subprocess.TimeoutExpired:
                results.append({
                    'command': cmd,
                    'output': '',
                    'error': f'命令执行超时 (300s)',
                    'returncode': -1,
                })
            except Exception as e:
                results.append({
                    'command': cmd,
                    'output': '',
                    'error': str(e),
                    'returncode': -1,
                })

        combined_output = '\n'.join([r['output'] for r in results if r['output']]).strip()
        combined_error = '\n'.join([r['error'] for r in results if r['error']]).strip()
        all_success = all(r['returncode'] == 0 for r in results)

        return {
            'type': 'local',
            'command': ' && '.join(commands),
            'output': combined_output,
            'error': combined_error,
            'results': results,
            'returncode': 0 if all_success else -1,
            'success': all_success
        }

    def _generate_execution_plan(self, skill_content: str, user_input: str,
                                 extracted_params: Optional[dict] = None) -> Optional[dict]:
        params_str = (
            json.dumps(extracted_params, ensure_ascii=False)
            if extracted_params
            else "无"
        )

        system_prompt = f"""你是一个技能执行器。根据以下技能内容和用户输入，生成执行计划。

技能内容:
{skill_content}

用户输入:
{user_input}

提取的参数:
{params_str}

规则:
1. 执行技能下scripts目录下的脚本，严格按照技能中说明的参数格式
2. 如果用户指定了目标服务器，使用技能里面的工具中的方法，而不要自己尝试解析命令
3. 【重要】如果用户输入中包含ip地址的时候，才用远程执行命令，否则都是本地执行，比如查询名为xxx的时候，也是本地执行
4. 如果没有指定目标服务器（hosts为空），则在本地执行命令
5. 只返回需要执行的命令列表，不要包含 ssh 连接命令
6. 【重要】只需要返回1-2个最必要的命令，不要返回多个功能重复的命令
7. 【重要】命令参数必须与技能中说明的格式完全匹配，参数数量不能多也不能少
8. 【重要】命令必须是纯命令行格式，不能包含 Python 函数调用语法如 get_process_by_name("xxx")，应该使用 positional 参数
9. 当询问的问题与运维知识、开发知识工作不相关时，告诉用户这不在你的职责范围内
"""

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "generate_execution_plan",
                    "description": "生成技能执行计划",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "commands": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "要执行的命令列表",
                            },
                            "explanation": {
                                "type": "string",
                                "description": "执行计划说明",
                            },
                            "need_execution": {
                                "type": "boolean",
                                "description": "是否需要执行命令",
                            },
                        },
                        "required": ["commands", "explanation", "need_execution"],
                    },
                },
            }
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"用户输入: {user_input}\n提取的参数: {params_str}",
            },
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                tool_choice="required",
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            choice = response.choices[0]
            if choice.message.tool_calls:
                tool_call = choice.message.tool_calls[0]
                arguments = json.loads(tool_call.function.arguments)
                return arguments
        except Exception as e:
            return {
                "commands": [],
                "explanation": f"生成执行计划失败: {str(e)}",
                "need_execution": False,
            }

        return None


def get_skill_router_manager(skills_dir: str = None, config_path: str = None) -> SkillRouterManager:
    """获取技能路由器管理器实例"""
    return SkillRouterManager.get_instance(skills_dir, config_path)
