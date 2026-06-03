from typing import Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import paramiko

# 超时时间 300 s
TIMEOUT = 300


@dataclass
class SSHConfig:
    host: str
    port: int = 22
    username: str = "root"
    password: Optional[str] = None
    key_path: Optional[str] = None
    timeout: int = TIMEOUT


class SSHExecutor:
    def __init__(
            self,
            default_user: str = "root",
            default_port: int = 22,
            key_path: Optional[str] = None,
            timeout: int = TIMEOUT,
            credential_store=None,
    ):
        self.default_user = default_user
        self.default_port = default_port
        self.key_path = key_path
        self.timeout = timeout
        self.credential_store = credential_store

    def _get_credential(self, host: str) -> Optional[any]:
        if self.credential_store:
            return self.credential_store.get(host)
        return None

    def execute(self, config: SSHConfig, command: str) -> dict:
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": config.host,
                "port": config.port,
                "username": config.username,
                "timeout": config.timeout,
            }

            if config.password:
                connect_kwargs["password"] = config.password
                connect_kwargs["allow_agent"] = False
            elif config.key_path:
                connect_kwargs["key_filename"] = config.key_path
                connect_kwargs["look_for_keys"] = False
                connect_kwargs["allow_agent"] = False

            client.connect(**connect_kwargs)

            stdin, stdout, stderr = client.exec_command(command)
            exit_code = stdout.channel.recv_exit_status()

            output = stdout.read().decode("utf-8")
            error = stderr.read().decode("utf-8")

            client.close()

            return {
                "output": output.strip(),
                "error": error.strip(),
                "returncode": exit_code,
                "success": exit_code == 0,
            }
        except Exception as e:
            return {
                "output": "",
                "error": str(e),
                "returncode": -1,
                "success": False,
            }

    def upload_file(
            self, config: SSHConfig, local_content: bytes, remote_path: str
    ) -> dict:
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": config.host,
                "port": config.port,
                "username": config.username,
                "timeout": config.timeout,
            }

            if config.password:
                connect_kwargs["password"] = config.password
                connect_kwargs["allow_agent"] = False
            elif config.key_path:
                connect_kwargs["key_filename"] = config.key_path
                connect_kwargs["allow_agent"] = False
            else:
                connect_kwargs["look_for_keys"] = True
                connect_kwargs["allow_agent"] = False

            client.connect(**connect_kwargs)
            sftp = client.open_sftp()
            with sftp.file(remote_path, "w") as f:
                f.write(local_content.decode("utf-8"))
            sftp.close()
            client.close()

            return {"success": True, "error": ""}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def execute_command_with_skill(
            self,
            config: SSHConfig,
            skill_name: str,
            skill_scripts: dict[str, str],
            command: str,
    ) -> dict:
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": config.host,
                "port": config.port,
                "username": config.username,
                "timeout": config.timeout,
            }

            if config.password:
                connect_kwargs["password"] = config.password
                connect_kwargs["allow_agent"] = False
            elif config.key_path:
                connect_kwargs["key_filename"] = config.key_path
                connect_kwargs["allow_agent"] = False
            else:
                connect_kwargs["look_for_keys"] = True
                connect_kwargs["allow_agent"] = False

            client.connect(**connect_kwargs)
            sftp = client.open_sftp()

            temp_dir = f"/tmp/skill_{skill_name}_{int(__import__('time').time())}"
            sftp.mkdir(temp_dir)
            scripts_dir = f"{temp_dir}/scripts"
            sftp.mkdir(scripts_dir)

            for script_name, script_content in skill_scripts.items():
                remote_path = f"{scripts_dir}/{script_name}"
                with sftp.file(remote_path, "w") as f:
                    f.write(script_content)
            sftp.chmod(f"{scripts_dir}/{list(skill_scripts.keys())[0]}", 0o755)

            command = command.replace("scripts/", f"{temp_dir}/scripts/")

            if not command.startswith(f"{temp_dir}"):
                command = f"cd {temp_dir} && {command}"

            stdin, stdout, stderr = client.exec_command(command)
            exit_code = stdout.channel.recv_exit_status()
            output = stdout.read().decode("utf-8")
            error = stderr.read().decode("utf-8")

            sftp = client.open_sftp()
            try:
                sftp.rmdir(temp_dir)
            except:
                pass
            sftp.close()
            client.close()

            return {
                "output": output.strip(),
                "error": error.strip(),
                "returncode": exit_code,
                "success": exit_code == 0,
            }
        except Exception as e:
            return {
                "output": "",
                "error": str(e),
                "returncode": -1,
                "success": False,
            }

    def execute_multi(
            self,
            hosts: list[str],
            command: str,
            default_user: Optional[str] = None,
            default_port: int = 22,
            password: Optional[str] = None,
            key_path: Optional[str] = None,
            max_workers: int = 20,
    ) -> dict:
        user = default_user or self.default_user
        results = {}

        def _exec(host: str) -> tuple[str, dict]:
            cred = self._get_credential(host)
            if cred:
                config = SSHConfig(
                    host=host,
                    port=cred.port,
                    username=cred.username,
                    password=cred.password,
                    key_path=cred.key_path,
                    timeout=self.timeout,
                )
            else:
                config = SSHConfig(
                    host=host,
                    port=default_port,
                    username=user,
                    password=password,
                    key_path=key_path or self.key_path,
                    timeout=self.timeout,
                )
            return host, self.execute(config, command)

        with ThreadPoolExecutor(max_workers=min(len(hosts), max_workers)) as pool:
            futures = {pool.submit(_exec, h): h for h in hosts}
            for future in as_completed(futures):
                host, result = future.result()
                results[host] = result

        return results

