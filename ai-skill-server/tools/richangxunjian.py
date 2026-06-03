# -*- coding: utf-8 -*-
import os
import re
import sys
import socket
import subprocess
from datetime import datetime


def run_cmd(cmd):
    """执行shell命令并返回结果，带错误捕获"""
    try:
        result = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, timeout=10, universal_newlines=True)
        return result.strip()
    except subprocess.CalledProcessError as e:
        return f"命令执行失败: {e.output.strip()}"
    except Exception as e:
        return f"异常: {str(e)}"


def get_cpu_info():
    """CPU使用率与负载均衡"""
    print("\n========== 系统性能与负载 ==========")

    # CPU核心数
    core_num = run_cmd("grep -c '^processor' /proc/cpuinfo")
    print(f"CPU核心数: {core_num}")

    # 1/5/15分钟平均负载
    load_avg = run_cmd("uptime | awk -F'load average:' '{print $2}'")
    print(f"系统负载(1/5/15min): {load_avg}")

    # CPU整体使用率（取1秒采样）
    cpu_usage = run_cmd("top -bn1 | grep '^%Cpu' | awk '{print 100 - $8}'")
    try:
        cpu_usage_val = float(cpu_usage)
        if cpu_usage_val > 80:
            cpu_status = "警告: 持续高于80%，需关注"
        else:
            cpu_status = "正常"
    except:
        cpu_status = "无法获取"
    print(f"CPU整体使用率: {cpu_usage}%  {cpu_status}")

    # 负载判断
    try:
        load1 = float(load_avg.split(',')[0].strip())
        core = int(core_num)
        if load1 > core:
            load_warn = "警告: 负载超过CPU核心数，任务堆积"
        else:
            load_warn = "正常"
    except:
        load_warn = "无法判断"
    print(f"负载状态: {load_warn}")


def get_mem_info():
    """内存与Swap、OOM检查"""
    print("\n========== 内存使用情况 ==========")

    # 内存信息
    mem_info = run_cmd("free -h | awk 'NR==2{print \"总内存:\"$2\", 可用:\"$7\", Swap总:\"$3\", Swap可用:\"$7}'")
    print(mem_info)

    # Swap使用警告
    swap_used = run_cmd("free | awk 'NR==3{print $3}'")
    if int(swap_used) > 0:
        print("警告: 检测到Swap使用，物理内存可能不足")
    else:
        print("Swap未使用，内存状态正常")

    # OOM检查（近24小时）
    oom_kill = run_cmd("grep -i 'out of memory' /var/log/messages /var/log/syslog 2>/dev/null | tail -20")
    if oom_kill and "out of memory" in oom_kill.lower():
        print("警告: 检测到OOM内存杀手记录")
        print("OOM日志:\n{oom_kill}")
    else:
        print("未检测到OOM进程终止记录")


def get_disk_io():
    """磁盘I/O瓶颈检查"""
    print("\n========== 磁盘I/O状态 ==========")

    # I/O等待
    io_wait = run_cmd("top -bn1 | grep '^%Cpu' | awk '{print $10}'")
    try:
        io_val = float(io_wait)
        if io_val > 20:
            io_warn = f"警告: I/O等待过高，磁盘为性能瓶颈"
        else:
            io_warn = f"正常"
    except:
        io_warn = "无法判断"
    print(f"CPU I/O等待: {io_wait}%  {io_warn}")

    # 磁盘利用率
    disk_util = run_cmd("df -h | grep -vE 'tmpfs|loop|udev' | awk 'NR>1{print $1\":\"$5\" 挂载点:\"$6}'")
    print(f"磁盘分区利用率:\n{disk_util}")


def get_disk_space():
    """磁盘空间与Inode、只读状态"""
    print("\n========== 磁盘空间与文件系统 ==========")

    # 分区使用率预警 >85%
    disk_warn = run_cmd(
        "df -h | grep -vE 'tmpfs|loop' | awk 'NR>1{gsub(/%/,$0); if($5>85) print \"警告:\"$1\" 使用率:\"$5\"% 挂载点:\"$6}'")
    if disk_warn:
        print(f"{disk_warn}")
    else:
        print(f"所有分区使用率均低于85%")

    # Inode使用率
    inode_warn = run_cmd(
        "df -i | grep -vE 'tmpfs|loop' | awk 'NR>1{gsub(/%/,$0); if($5>85) print \"警告:\"$1\" Inode使用率:\"$5\"%\"}'")
    if inode_warn:
        print(f"Inode高使用率:\n{inode_warn}")
    else:
        print(f"Inode使用率正常")

    # 只读挂载检查
    ro_disk = run_cmd("mount | grep -vE 'tmpfs|proc|sysfs' | grep ro,")
    if ro_disk:
        print("警告: 检测到只读挂载分区(ro)")
        print(ro_disk)
    else:
        print("所有分区均为读写状态(rw)")


def check_process():
    """关键进程、僵尸进程、端口监听"""
    print("\n========== 关键进程与服务 ==========")

    # 僵尸进程
    zombie = run_cmd("ps aux | awk '{if($8==\"Z\") print}' | wc -l")
    if int(zombie) > 0:
        print(f"警告: 发现僵尸进程 {zombie} 个")
    else:
        print(f"僵尸进程数量: 0 (正常)")

    # 核心服务检查
    services = ["nginx", "mysql", "mysqld", "redis-server", "redis", "docker"]
    for s in services:
        status = run_cmd(f"systemctl is-active {s} 2>/dev/null")
        if status == "active":
            print(f"{s}: 运行中")
        elif "failed" in status or status == "inactive":
            print(f"{s}: 未运行")

    # 关键端口监听
    ports = ["80", "443", "3306", "6379", "22"]
    print(f"\n关键端口监听状态:")
    for p in ports:
        res = run_cmd(f"ss -tuln | grep \':{p}\'")
        if res:
            print(f"端口 {p}: 正常监听")
        else:
            print(f"端口 {p}: 未监听")


def check_network():
    """网络流量、丢包、连接状态"""
    print("\n========== 网络连接 ==========")

    # 网卡错误/丢包
    net_err = run_cmd(
        "ip -s link | grep -A5 'RX:' | grep -E 'errors|dropped' | grep -v '0 errors' | grep -v '0 dropped'")
    if net_err:
        print(f"网卡异常(errors/dropped):\n{net_err}")
    else:
        print(f"网卡无错误与丢包")

    # TCP连接堆积
    time_wait = run_cmd("ss -tan | grep TIME-WAIT | wc -l")
    syn_recv = run_cmd("ss -tan | grep SYN-RECV | wc -l")
    print(f"TIME_WAIT连接: {time_wait}")
    print(f"SYN_RECV连接: {syn_recv}")
    if int(time_wait) > 10000:
        print(f"警告: TIME_WAIT连接过多，可能耗尽端口")
    if int(syn_recv) > 100:
        print(f"警告: SYN_RECV过多，可能遭受SYN攻击")

    # 网关连通性
    gateway = run_cmd("ip route show default | awk '/default/ {print $3}'")
    if gateway:
        ping_res = run_cmd(f"ping -c 2 -W 1 {gateway} | grep 'time=' | tail -1")
        print(f"网关连通性: {ping_res}")


def check_logs():
    """系统日志、安全日志、硬件日志"""
    print("\n========== 系统日志与安全 ==========")

    # 关键错误日志
    keywords = ["kernel panic", "segfault", "out of memory", "error"]
    for kw in keywords:
        log = run_cmd(f"grep -i '{kw}' /var/log/messages /var/log/syslog 2>/dev/null | tail -10")
        if log and kw in log.lower():
            print(f"检测到关键字 [{kw}] 日志:\n{log}")

    # SSH暴力破解检查
    ssh_brute = run_cmd("grep 'Failed password' /var/log/auth.log /var/log/secure 2>/dev/null | tail -10")
    if ssh_brute:
        print(f"SSH登录失败记录:\n{ssh_brute}")
    else:
        print(f"未发现大量SSH暴力破解")

    # 硬件错误(dmesg)
    hardware_err = run_cmd("dmesg | grep -iE 'error|fail|disk|memory|pcie' | tail -10")
    if hardware_err:
        print(f"硬件相关错误:\n{hardware_err}")


def check_ntp():
    """时间同步检查"""
    print("\n========== 时间同步 ==========")

    print(f"系统当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # NTP同步状态
    ntp_stat = run_cmd("timedatectl | grep 'NTP synchronized'")
    chrony_stat = run_cmd("systemctl is-active chronyd ntp 2>/dev/null | grep active")
    print(f"NTP同步状态: {ntp_stat}")
    if chrony_stat:
        print("NTP服务运行正常")
    else:
        print("NTP服务未运行，可能存在时间漂移")


def main():
    """主函数"""
    host_name = socket.gethostname()
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("========== 服务器巡检报告 ==========")

    print(f"主机名: {host_name}")
    print(f"巡检时间: {current_time}")
    print("================================")

    # 执行所有巡检项
    get_cpu_info()
    get_mem_info()
    get_disk_io()
    get_disk_space()
    check_process()
    check_network()
    check_logs()
    check_ntp()

    print("========== 巡检完成 ==========")



if __name__ == '__main__':
    # 必须root权限运行
    # if not os.geteuid() == 0:
    #     print(f"错误: 请使用root权限运行此脚本 (sudo python3 {sys.argv[0]})")
    #     sys.exit(1)
    main()
