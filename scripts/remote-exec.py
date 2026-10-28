#!/usr/bin/env python3
"""远端执行/SFTP 薄助手（scripts/release.mjs 消费；2026-10-26 裁-6 发布流水线件）。

paramiko 单点封装——形态平移自 bsh 树 scripts/stack-image/common/remote-exec.py
（2026-10-08 部署轮实证可用），差异：env 路径参数化（本仓 .env → bsh 树根 .env
探测序，先例是硬编码）；只留 release.mjs 消费的 exec/put 两操作。

用法（stdin 收 JSON 指令，stdout 回 JSON——mjs 侧零 python 逻辑）：
  echo '{"op":"exec","cmd":"docker ps"}' | python remote-exec.py [env路径]
  echo '{"op":"put","local":"D:/x.tar","remote":"/tmp/x.tar"}' | python remote-exec.py

凭据键：DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_PW（gitignored 不入库）。
"""
import io
import json
import os
import sys

try:
    import paramiko
except ImportError:
    paramiko = None

# env 探测序：命令行参数 > 本仓 .env > bsh 树根 .env（凭据实际存放处）
ENV_CANDIDATES = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'),
    r'C:/workspace/deepseek-harness/scratch-plugin/bsh-scratch-plugin/.env',
]


def load_env(path):
    env = {}
    for line in io.open(path, encoding='utf-8').read().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"')
    return env


def main():
    # 通道编码钉 UTF-8（先例坑 72：Windows 管道 stdin 缺省随 locale（cp936）解码，
    # UTF-8 中文命令上远端成乱码——reconfigure 归一）
    try:
        sys.stdin.reconfigure(encoding='utf-8')
    except Exception:
        pass
    req = json.loads(sys.stdin.read())
    if paramiko is None:
        print(json.dumps({'ok': False, 'error': 'paramiko 未安装（pip install paramiko）'}))
        return
    env_path = sys.argv[1] if len(sys.argv) > 1 else next(
        (p for p in ENV_CANDIDATES if os.path.exists(p)), None)
    if env_path is None:
        print(json.dumps({'ok': False, 'error': 'env 文件缺席（探测序：%s）' % ', '.join(ENV_CANDIDATES)}))
        return
    env = load_env(env_path)
    host = env.get('DEPLOY_SSH_HOST', '')
    user = env.get('DEPLOY_SSH_USER', 'root')
    pw = env.get('DEPLOY_SSH_PW', '')
    if not host or not pw:
        print(json.dumps({'ok': False, 'error': '.env 缺 DEPLOY_SSH_HOST/DEPLOY_SSH_PW（%s）' % env_path}))
        return
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=pw, allow_agent=False, look_for_keys=False, timeout=20)
    try:
        op = req.get('op')
        if op == 'exec':
            # channel 级 timeout 不设（先例坑：读通道静默超时是假性失败——docker build
            # 长静默段 stdout 无数据即抛 socket.timeout；总墙由调用侧 mjs 承担）
            _, out, err = ssh.exec_command(req['cmd'], timeout=None)
            o = out.read().decode('utf-8', 'replace')
            e = err.read().decode('utf-8', 'replace')
            code = out.channel.recv_exit_status()
            print(json.dumps({'ok': code == 0, 'code': code, 'stdout': o[-req.get('tail', 6000):], 'stderr': e[-2000:]}))
        elif op == 'put':
            import posixpath
            # 远端父目录先建（sftp.put 不建目录——/opt/ling-coris 首用即 ENOENT 实证）
            rdir = posixpath.dirname(req['remote'])
            if rdir:
                ssh.exec_command('mkdir -p %s' % rdir)
            sftp = ssh.open_sftp()
            sftp.put(req['local'], req['remote'])
            print(json.dumps({'ok': True, 'done': req['remote']}))
        else:
            print(json.dumps({'ok': False, 'error': '未知 op: %s' % op}))
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
