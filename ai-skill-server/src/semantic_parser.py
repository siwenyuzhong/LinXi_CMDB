import json
import os
from typing import Optional, Dict, Any

import yaml
from openai import OpenAI
from pydantic import BaseModel, Field


class SkillFunction(BaseModel):
    skill_name: str = Field(description="匹配到的技能名称")
    confidence: float = Field(ge=0.0, le=1.0, description="匹配置信度 (0.0-1.0)")
    reasoning: str = Field(description="选择该技能的理由")
    extracted_params: dict = Field(
        default_factory=dict, description="从用户输入中提取的参数"
    )


class SemanticParser:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str = "gpt-4o",
        temperature: float = 0.0,
        max_tokens: int = 10280,
        routing_rules: Optional[list[dict]] = None,
    ):
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.routing_rules = routing_rules or self._load_routing_rules()

    def _load_routing_rules(self) -> list[dict]:
        config_path = os.environ.get("CONFIG_PATH", "config.yaml")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = yaml.safe_load(f)
                return config.get("SKILL_ROUTING_RULES", [])
        return []

    def _format_routing_rules(self) -> str:
        if not self.routing_rules:
            return "无自定义规则"
        lines = []
        for rule in self.routing_rules:
            keywords = rule.get("keywords", [])
            skill = rule.get("skill", "unknown")
            lines.append(f"- {', '.join(keywords)} -> {skill}")
        return "\n".join(lines)

    def parse(
        self,
        user_input: str,
        skills_metadata: list[dict],
    ) -> Optional[SkillFunction]:
        results = self._call_with_tool_choice(
            user_input, skills_metadata, max_results=1
        )
        return results[0] if results else None

    def parse_multi(
        self,
        user_input: str,
        skills_metadata: list[dict],
        max_candidates: int = 3,
        context: Optional[Dict[str, Any]] = None,
    ) -> list[SkillFunction]:
        return self._call_with_tool_choice(
            user_input, skills_metadata, max_results=max_candidates, context=context
        )

    def _call_with_tool_choice(
        self,
        user_input: str,
        skills_metadata: list[dict],
        max_results: int = 3,
        context: Optional[Dict[str, Any]] = None,
    ) -> list[SkillFunction]:
        skill_names = [s["name"] for s in skills_metadata]
        skill_list = "\n".join(
            [
                f"- {s['name']}: {s['description']} (触发场景: {', '.join(s.get('trigger_scenarios', [])[:10])})"
                for s in skills_metadata
            ]
        )

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "route_skills",
                    "description": "根据用户输入匹配技能，并提取目标服务器IP等参数",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "matches": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "skill_name": {
                                            "type": "string",
                                            "enum": skill_names,
                                            "description": "技能名称，必须从可用技能中选择",
                                        },
                                        "confidence": {
                                            "type": "number",
                                            "description": "置信度 0.0-1.0",
                                        },
                                        "reasoning": {
                                            "type": "string",
                                            "description": "匹配理由",
                                        },
                                        "extracted_params": {
                                            "type": "object",
                                            "properties": {
                                                "hosts": {
                                                    "type": "array",
                                                    "items": {"type": "string"},
                                                    "description": "目标服务器IP地址列表，如 ['10.1.4.8', '10.1.4.222']",
                                                }
                                            },
                                            "description": "提取的参数，包含目标服务器 IPs",
                                        },
                                    },
                                    "required": [
                                        "skill_name",
                                        "confidence",
                                        "reasoning",
                                        "extracted_params",
                                    ],
                                },
                                "description": f"最多返回{max_results}个匹配结果",
                            }
                        },
                        "required": ["matches"],
                    },
                },
            }
        ]

        # Build context information if provided
        context_info = ""
        if context:
            context_info = f"""
当前对话上下文:
- 会话轮数: {context.get("turn_count", "unknown")}
- 活跃目标: {", ".join(context.get("goals", []))}
- 已完成任务: {len(context.get("completed_tasks", []))}
- 最近记忆: {context.get("recent_memory", "none")}
"""

        system_prompt = f"""你是智能技能路由器，负责分析用户需求并选择最合适的技能执行策略。

{context_info}用户输入: "{user_input}"

从以下技能中选择最多{max_results}个最匹配的：

{skill_list}

重要规则：
1. skill_name 必须是上述技能名称之一
2. 【关键】必须从用户输入中提取所有目标服务器 IP 地址、主机名或路径信息
3. 【重要】如果用户输入中包含ip地址的时候，才用远程执行命令，否则都是本地执行，比如查询名为xxx的时候，也是本地执行
4. extracted_params 必须包含 relevant 字段，如 hosts、path、username 等
5. 如果信息不足，extracted_params 应包含 missing_fields 标记
6. 置信度评分应该基于技能匹配度和参数完整性 (0.0-1.0)
7. 对于复杂任务，可以返回多个相关技能供组合使用
8. 当询问的问题与运维知识、开发知识工作不相关时，告诉用户这不在你的职责范围内
9. 考虑对话历史上下文来选择最合适的技能序列

技能区分规则：
{self._format_routing_rules()}

请返回结构化的匹配结果，便于后续的React-style推理和执行。"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input},
        ]

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
            results = []
            valid_names = set(skill_names)
            for item in arguments.get("matches", []):
                if item.get("skill_name") in valid_names:
                    # Enhanced parameter extraction for React mode
                    extracted_params = item.get("extracted_params", {})

                    # Ensure required fields exist
                    if "hosts" not in extracted_params:
                        extracted_params["hosts"] = []

                    # Add missing information tracking
                    if context and context.get("missing_info"):
                        extracted_params["missing_fields"] = context.get(
                            "missing_info", []
                        )

                    item["extracted_params"] = extracted_params
                    results.append(SkillFunction(**item))

            # Sort by confidence and relevance for React-style reasoning
            return sorted(
                results,
                key=lambda x: (x.confidence, len(x.extracted_params)),
                reverse=True,
            )

        return []
