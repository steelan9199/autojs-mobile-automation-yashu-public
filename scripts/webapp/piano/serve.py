# -*- coding: utf-8 -*-
"""万能音效钢琴 - 局域网服务启动器

流程：获取本机局域网 IP -> 尝试放行防火墙 -> 启动 HTTP 服务 -> 打开电脑浏览器。
手机与电脑连同一 WiFi，用浏览器打开打印出的地址即可弹奏。
"""
import socket
import subprocess
import webbrowser
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8080


def get_lan_ip():
    """通过 UDP 探测出网 IP，比解析 ipconfig 更可靠。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('223.5.5.5', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


def allow_firewall():
    """尝试放行 8080 入站（需管理员权限，失败则静默跳过，靠提示手动放行）。"""
    try:
        subprocess.run(
            ['netsh', 'advfirewall', 'firewall', 'add', 'rule',
             'name=PianoApp_8080', 'dir=in', 'action=allow',
             'protocol=TCP', 'localport=%d' % PORT],
            capture_output=True, check=False, timeout=10)
    except Exception:
        pass


def main():
    ip = get_lan_ip()
    line = '=' * 44
    print(line)
    print('  万能音效钢琴 - 局域网服务启动器')
    print(line)
    print('  本机局域网 IP  : %s' % ip)
    print('  服务端口       : %d' % PORT)
    print('  手机浏览器打开 : http://%s:%d' % (ip, PORT))
    print('  电脑浏览器打开 : http://127.0.0.1:%d' % PORT)
    print('  关闭本窗口(Ctrl+C) 即停止服务')
    print(line)

    allow_firewall()
    webbrowser.open('http://127.0.0.1:%d' % PORT)

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(('0.0.0.0', PORT), SimpleHTTPRequestHandler)
    print('  服务已启动，等待访问...')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  服务已停止')
        server.server_close()


if __name__ == '__main__':
    main()
