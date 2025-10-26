// yaduo_miniapp_allinone.js
// 用法：同一脚本既可“抓参/抓抽奖URL”（script-request-header/script-request-body 触发），也可“执行签到与抽奖”（定时任务触发）[参考原脚本的抓取再重放思路]。
// 键名：yaduo_miniapp_params / yaduo_miniapp_cookie / yaduo_miniapp_ua / yaduo_miniapp_draw
// 适配：miniapp.yaduo.com 下 atourlife/ 接口，参数来自你的截图：token、clientId、platType=6、appVer=4.3.2、channelId=300001 等 [r 动态]。

(function () {
  const KEY_PARAMS = 'yaduo_miniapp_params';
  const KEY_COOKIE = 'yaduo_miniapp_cookie';
  const KEY_UA     = 'yaduo_miniapp_ua';
  const KEY_DRAW   = 'yaduo_miniapp_draw';

  const isRequest = typeof $request !== 'undefined';
  const now = () => new Date().toISOString().replace('T',' ').replace(/\..+/,'');

  if (isRequest) {
    // 抓取分支：1) 用户/签到信息接口 -> 保存 query 参数；2) 抽奖类接口 -> 保存完整 URL/方法/可选 body
    try {
      const reqUrl = $request.url || '';
      const headers = $request.headers || {};
      const method = ($request.method || 'GET').toUpperCase();
      const body = $request.body || '';

      // 1) 抓取 token 等参数（来自 getUserCenterInfo/indexInfoV2/signIn）
      const hitParams = /https:\/\/miniapp\.yaduo\.com\/atourlife\/(user\/getUserCenterInfo|signIn\/indexInfoV2|signIn\/signIn)/.test(reqUrl);
      if (hitParams) {
        const u = new URL(reqUrl);
        const get = k => u.searchParams.get(k) || '';
        const params = {
          token: get('token'),
          clientId: get('clientId'),
          appVer: get('appVer') || '4.3.2',
          platType: get('platType') || '6',
          channelId: get('channelId') || '300001',
          activitySource: get('activitySource') || '',
          activityId: get('activityId') || '',
          activeId: get('activeId') || '',
          updatedAt: now()
        };
        $prefs.setValueForKey(JSON.stringify(params), KEY_PARAMS);

        const ck = headers['Cookie'] || headers['cookie'] || '';
        if (ck) $prefs.setValueForKey(ck, KEY_COOKIE);

        const ua = headers['User-Agent'] || headers['user-agent'] || '';
        if (ua) $prefs.setValueForKey(ua, KEY_UA);

        $notify('亚朵-小程序', '抓取成功', `token=${(params.token||'').slice(0,6)}... | clientId=${(params.clientId||'').slice(0,8)}... | ${params.updatedAt}`);
      }

      // 2) 抓取抽奖接口（不猜路径，直接记录你手动抽奖时真实调用的 URL/方法/可选 body）
      const hitDraw = /https:\/\/miniapp\.yaduo\.com\/atourlife\/.*(lottery|draw|prize)/i.test(reqUrl);
      if (hitDraw) {
        const draw = {
          url: reqUrl,
          method,
          // 仅在 POST 时保存 body
          body: method === 'POST' ? body : '',
          // 保存与发送相关的 Content-Type 以保证复现一致
          contentType: headers['Content-Type'] || headers['content-type'] || '',
          updatedAt: now()
        };
        $prefs.setValueForKey(JSON.stringify(draw), KEY_DRAW);
        $notify('亚朵-小程序', '抽奖URL已记录', `${method} ${reqUrl.split('?')[0]} | ${draw.updatedAt}`);
      }

      return $done({ headers });
    } catch (e) {
      $notify('亚朵-小程序', '抓取异常', String(e));
      return $done({ headers: $request.headers });
    }
  } else {
    // 执行分支：先签到，再尝试抽奖（若已记录抽奖 URL）
    (async () => {
      const raw = $prefs.valueForKey(KEY_PARAMS) || '{}';
      let params = {};
      try { params = JSON.parse(raw); } catch { params = {}; }

      const ck = $prefs.valueForKey(KEY_COOKIE) || '';
      const ua = $prefs.valueForKey(KEY_UA) || 'Mozilla/5.0 MicroMessenger MiniProgram';

      if (!params.token || !params.clientId) {
        $notify('亚朵-任务', '缺少参数', '请先打开微信小程序触发重写，抓取 token/clientId 等参数');
        return $done();
      }

      // 1) 签到
      const signKv = {
        r: Math.random().toString(),
        token: params.token,
        platType: params.platType || '6',
        appVer: params.appVer || '4.3.2',
        channelId: params.channelId || '300001',
        activitySource: params.activitySource || '',
        activityId: params.activityId || '',
        activeId: params.activeId || '',
        clientId: params.clientId
      };
      const signQs = Object.keys(signKv)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(signKv[k])}`)
        .join('&');

      const signReq = {
        url: 'https://miniapp.yaduo.com/atourlife/signIn/signIn?' + signQs,
        method: 'GET',
        headers: {
          'User-Agent': ua,
          'Origin': 'https://mobile.yaduo.com',
          'Referer': 'https://mobile.yaduo.com/',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
          'Cookie': ck
        },
        timeout: 10000
      };

      const signRes = await httpFetch(signReq);
      notifyByResp('亚朵-签到', signRes);

      // 2) 抽奖（可选）：需要你先手动抽一次以记录真实 URL/方法/参数，然后这里重放
      const drawRaw = $prefs.valueForKey(KEY_DRAW) || '';
      if (drawRaw) {
        try {
          const draw = JSON.parse(drawRaw);
          const drawReq = {
            url: draw.url,
            method: (draw.method || 'GET').toUpperCase(),
            headers: {
              'User-Agent': ua,
              'Origin': 'https://mobile.yaduo.com',
              'Referer': 'https://mobile.yaduo.com/',
              'Accept-Encoding': 'gzip, deflate, br',
              'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
              'Cookie': ck,
              ...(draw.contentType ? { 'Content-Type': draw.contentType } : {})
            },
            body: draw.method === 'POST' ? (draw.body || '') : undefined,
            timeout: 10000
          };
          const drawRes = await httpFetch(drawReq);
          notifyByResp('亚朵-抽奖', drawRes);
        } catch (e) {
          $notify('亚朵-抽奖', '重放失败', String(e));
        }
      } else {
        $notify('亚朵-抽奖', '未记录抽奖URL', '请在打开重写的情况下手动抽奖一次以记录接口');
      }

      $done();
    })();
  }

  // 适配 QX/Surge/Loon 的请求封装
  function httpFetch(opt) {
    return new Promise((resolve, reject) => {
      if (typeof $task !== 'undefined' && $task.fetch) {
        $task.fetch(opt).then(res => {
          resolve({ statusCode: res.statusCode, body: res.body });
        }, err => reject(err));
      } else if (typeof $httpClient !== 'undefined') {
        const cb = (err, resp, body) => {
          if (err) reject(err);
          else resolve({ statusCode: resp && (resp.status || resp.statusCode), body });
        };
        if ((opt.method || 'GET').toUpperCase() === 'POST') $httpClient.post(opt, cb);
        else $httpClient.get(opt, cb);
      } else {
        reject(new Error('当前环境不支持网络请求 API'));
      }
    });
  }

  function notifyByResp(tag, res) {
    const sc = res && res.statusCode || 0;
    let body = res && res.body || '';
    try { body = JSON.parse(body); } catch {}
    if (sc === 200) $notify(tag, '成功', typeof body === 'object' ? JSON.stringify(body) : String(body));
    else $notify(tag, `HTTP ${sc}`, typeof body === 'object' ? JSON.stringify(body) : String(body));
  }
})();
