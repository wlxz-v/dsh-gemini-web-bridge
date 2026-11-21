import os
import sys
import re
import json
import urllib.request

def refresh_tokens(bin_dir=r'D:\DSH\dsh-gemini-web-bridge\bin', proxy='http://127.0.0.1:7890'):
    cookie_file = os.path.join(bin_dir, 'cookie.txt')
    config_file = os.path.join(bin_dir, 'config.json')

    if not os.path.exists(cookie_file):
        print(f"Error: Cookie file not found at {cookie_file}", file=sys.stderr)
        return False

    with open(cookie_file, 'r', encoding='utf-8') as f:
        cookie_str = f.read().strip()

    proxy_handler = urllib.request.ProxyHandler({'https': proxy, 'http': proxy})
    opener = urllib.request.build_opener(proxy_handler)

    req = urllib.request.Request(
        'https://gemini.google.com/app',
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Cookie': cookie_str,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
    )

    try:
        with opener.open(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='ignore')

        snl = re.findall(r'"SNlM0e":"(.*?)"', html)
        if not snl:
            print("Error: SNlM0e not found in page HTML", file=sys.stderr)
            return False

        snlm0e = snl[0]
        bl_match = re.findall(r'boq_gemini-web-uiserver[^"\'\s]*', html) or re.findall(r'"cfb2h":"(.*?)"', html)
        bl = bl_match[0] if bl_match else 'boq_gemini-web-uiserver_20261118.14_p0'

        config = {}
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except:
                pass

        config['port'] = config.get('port', 51130)
        config['host'] = '0.0.0.0'
        config['retry_attempts'] = 3
        config['retry_delay_sec'] = 2
        config['request_timeout_sec'] = 180
        config['gemini_bl'] = bl
        config['xsrf_token'] = snlm0e
        config['cookie_file'] = cookie_file.replace('\\', '/')
        config['proxy'] = proxy
        config['impersonate'] = 'chrome_124'
        config['log_requests'] = False

        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2)

        print(json.dumps({'ok': True, 'snlm0e': snlm0e, 'bl': bl}))
        return True
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    refresh_tokens()
