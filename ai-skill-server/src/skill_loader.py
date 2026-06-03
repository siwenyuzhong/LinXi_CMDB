import os
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
import yaml


@dataclass
class SkillMetadata:
    name: str
    description: str
    path: str
    full_content: str
    trigger_scenarios: list = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "trigger_scenarios": self.trigger_scenarios or [],
        }


class SkillLoader:
    def __init__(self, skills_dir: str):
        self.skills_dir = Path(skills_dir)
        self._skills: dict[str, SkillMetadata] = {}
        self._load_skills()

    def _load_skills(self):
        if not self.skills_dir.exists():
            return

        for skill_path in self.skills_dir.iterdir():
            if not skill_path.is_dir():
                continue
            skill_file = skill_path / "SKILL.md"
            if not skill_file.exists():
                continue

            content = skill_file.read_text(encoding="utf-8")
            metadata = self._parse_skill_metadata(content, str(skill_path))
            if metadata:
                self._skills[metadata.name] = metadata

    def _parse_skill_metadata(self, content: str, path: str) -> Optional[SkillMetadata]:
        frontmatter_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if not frontmatter_match:
            return None

        frontmatter = frontmatter_match.group(1)
        try:
            data = yaml.safe_load(frontmatter)
            if not data:
                return None

            name = data.get("name", "")
            description = data.get("description", "")
            if not name:
                return None

            return SkillMetadata(
                name=name,
                description=description,
                path=path,
                full_content=content,
                trigger_scenarios=data.get("trigger_scenarios", []),
            )
        except Exception:
            return None

    def load_all(self) -> dict[str, SkillMetadata]:
        return self._skills

    def get_skill(self, name: str) -> Optional[SkillMetadata]:
        return self._skills.get(name)
