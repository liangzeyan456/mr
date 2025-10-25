/**
 * 华住会
 * Author mourG
 * 小程序：华住会酒店预订汉庭全季桔子
 * 路径： 会员 -> 签到   抓点击签到后的完整url 例：https://hweb-minilogin.huazhu.com/bridge/jump?redirectUrl=*********
 * 环境变量：hzh_url，多个账号&连接
 * export hzh_url="url1&nurl2"
 * 定时规则：cron: 30 12 * * *
 */

const $ = new Env('华住会');
const axios = require('axios');
const {
  wrapper
} = require('axios-cookiejar-support');
const tough = require('tough-cookie');

let sendNotify;

(async () => {
  const urls = process.env.hzh_url;
  if (!urls) {
    $.log('⚠️ 提示：请先在环境变量中配置 hzh_url');
    await $.msg($.name, '配置缺失', '请先在环境变量中配置 hzh_url');
    return;
  }

  const urlList = urls.split('\n').filter(url => url.trim() !== '');
  $.log(`ℹ️ 检测到 ${urlList.length} 个账号，开始处理...`);

  const notificationSummaries = [];
  for (let i = 0; i < urlList.length; i++) {
    $.log(`\n- - - - - - - - 账号 ${i + 1} - - - - - - - -`);
    const summary = await processAccount(urlList[i], i + 1);
    notificationSummaries.push(summary);
  }

  const notifyBody = notificationSummaries.join('\n');
  await $.msg($.name, `处理完成，共 ${urlList.length} 个账号`, notifyBody);

})()
.catch(async (err) => {
  $.logErr(err);
  const errorMessage = err instanceof Error ? err.message : String(err);
  await $.msg($.name, '脚本执行异常', errorMessage);
})
.finally(() => {
  $.done();
});

async function processAccount(url, accountIndex) {
  const miniUuid = getParameterByName(url, 'miniUuid') || '未知';
  const accountId = `账号${accountIndex}[${miniUuid.slice(-4)}]`;
  const instance = createAxiosInstance();
  try {
    $.log(`  [1/4] 正在验证身份...`);
    const loginResponse = await instance.get(url);
    if (loginResponse.status !== 200) throw new Error(`身份验证失败，状态码: ${loginResponse.status}`);
    $.log(`  ✅ 身份验证成功`);
    $.log(`  [2/4] 正在查询签到状态...`);
    const hasSigned = await checkSignInStatus(instance);
    let signInMsg = '今日已签,无需重复';
    if (!hasSigned) {
      $.log(`  [3/4] 尚未签到，执行签到...`);
      const signInResult = await doSignIn(instance);
      signInMsg = `签到成功,获得 ${signInResult.point} 积分,年签 ${signInResult.yearSignInCount} 次`;
    } else {
      $.log(`  [3/4] 今日已签到，跳过签到步骤。`);
    }
    $.log(`  [4/4] 正在查询最终积分...`);
    const totalPoints = await queryPoints(instance);
    $.log(`  💰 当前可用积分: ${totalPoints}`);
    return `${accountId}: ${signInMsg}, 当前总分: ${totalPoints}`;
  } catch (error) {
    $.log(`  ❌ ${accountId} 处理失败: ${error.message}`);
    return `${accountId}: 处理失败, 原因: ${error.message}`;
  }
}

async function checkSignInStatus(instance) {
  try {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const {
      data
    } = await instance.get(`https://appgw.huazhu.com/game/sign_in_calendar?year=${year}&month=${month}`);
    if (data.code !== 200) throw new Error(`API响应异常: ${data.message || data.code}`);
    const today = `${month}.${new Date().getDate()}`;
    const todaySignData = data.content.signInDataList.find(item => item.date === today);
    const signed = todaySignData ? todaySignData.signToday : false;
    $.log(`  ✅ 查询状态成功, 今日签到状态: ${signed ? '已签' : '未签'}`);
    return signed;
  } catch (e) {
    throw new Error(`查询签到日历失败 - ${e.message}`);
  }
}

async function doSignIn(instance) {
  try {
    const signTimestamp = Math.floor(Date.now() / 1000);
    const {
      data
    } = await instance.get(`https://appgw.huazhu.com/game/sign_in?date=${signTimestamp}`);
    if (data.code !== 200 || !data.content.signResult) throw new Error(`API响应异常: ${data.message || '签到结果异常'}`);
    const {
      point,
      yearSignInCount
    } = data.content;
    $.log(`  🎉 签到成功! 获得 ${point} 积分, 年度累计 ${yearSignInCount} 次`);
    return {
      point,
      yearSignInCount
    };
  } catch (e) {
    throw new Error(`执行签到失败 - ${e.message}`);
  }
}

async function queryPoints(instance) {
  try {
    const {
      data
    } = await instance.get('https://appgw.huazhu.com/game/sign_header?');
    if (data.code !== 200) throw new Error(`API响应异常: ${data.message || '状态码非200'}`);
    return data.content.memberPoint;
  } catch (e) {
    throw new Error(`查询积分失败 - ${e.message}`);
  }
}

function createAxiosInstance() {
  return wrapper(axios.create({
    jar: new tough.CookieJar(),
    withCredentials: true,
    maxRedirects: 5,
    headers: {
      'Origin': 'https://cdn.huazhu.com',
      'Referer': 'https://cdn.huazhu.com/',
      'Client-Platform': 'WX-MP',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800312f) NetType/WIFI Language/zh_CN miniProgram/wx286efc12868f2559'
    }
  }));
}

function getParameterByName(url, name) {
  const decodedUrl = decodeURIComponent(url);
  const regex = new RegExp(`[?&]${name}=([^&]*)`);
  const results = regex.exec(decodedUrl);
  return results ? results[1] : null;
}

function Env(name, opts) {
  class Http {
    constructor(env) {
      this.env = env;
    }
    send(options, method = 'GET') {
      options = typeof options === 'string' ? {
        url: options
      } : options;
      return new Promise((resolve, reject) => {
        this.env.send(options, (error, response, body) => {
          if (error) reject(error);
          else resolve(response);
        }, method);
      });
    }
    get(options) {
      return this.send(options, 'GET');
    }
    post(options) {
      return this.send(options, 'POST');
    }
  }
  return new(class {
    constructor(name, opts) {
      this.name = name;
      this.http = new Http(this);
      this.data = null;
      this.dataFile = 'box.dat';
      this.logs = [];
      this.isMute = false;
      this.isNeedRewrite = false;
      this.logSeparator = '\n';
      this.startTime = new Date().getTime();
      Object.assign(this, opts);
    }
    isNode() {
      return 'undefined' !== typeof module && !!module.exports;
    }
    isQuanX() {
      return 'undefined' !== typeof $task;
    }
    isSurge() {
      return 'undefined' !== typeof $httpClient && 'undefined' === typeof $loon;
    }
    isLoon() {
      return 'undefined' !== typeof $loon;
    }
    isQL() {
      return 'undefined' !== typeof QLAPI;
    }
    toObj(str, defaultValue = null) {
      try {
        return JSON.parse(str);
      } catch {
        return defaultValue;
      }
    }
    toStr(obj, defaultValue = null) {
      try {
        return JSON.stringify(obj);
      } catch {
        return defaultValue;
      }
    }
    getJson(key, defaultValue) {
      let val = this.getVal(key);
      if (val) {
        try {
          val = JSON.parse(this.getVal(key));
        } catch {}
      }
      return val ? val : defaultValue;
    }
    setJson(val, key) {
      try {
        return this.setVal(JSON.stringify(val), key);
      } catch {
        return false;
      }
    }
    getScript(url) {
      return new Promise(resolve => {
        this.get({
          url
        }, (error, response, body) => resolve(body));
      });
    }
    runScript(script, runOpts) {
      return new Promise(resolve => {
        let httpApi = this.getVal("@chavy_boxjs_userCfgs.httpApi");
        httpApi = httpApi ? httpApi.replace(/\n/g, "").trim() : httpApi;
        let httpApi_timeout = this.getVal("@chavy_boxjs_userCfgs.httpApi_timeout");
        httpApi_timeout = httpApi_timeout ? 1 * httpApi_timeout : 20;
        httpApi_timeout = runOpts && runOpts.timeout ? runOpts.timeout : httpApi_timeout;
        const [key, host] = httpApi.split("@");
        const options = {
          url: `http://${host}/v1/scripting/evaluate`,
          body: {
            script_text: script,
            mock_type: "cron",
            timeout: httpApi_timeout
          },
          headers: {
            "X-Key": key,
            "Accept": "*/*"
          }
        };
        this.post(options, (error, response, body) => resolve(this.toObj(body)));
      }).catch(e => this.logErr(e));
    }
    getVal(key) {
      if (this.isSurge() || this.isLoon()) {
        return $persistentStore.read(key);
      } else if (this.isQuanX()) {
        return $prefs.valueForKey(key);
      } else if (this.isNode()) {
        this.data = this.loadData();
        return this.data[key];
      } else {
        return this.data && this.data[key] || null;
      }
    }
    setVal(val, key) {
      if (this.isSurge() || this.isLoon()) {
        return $persistentStore.write(val, key);
      } else if (this.isQuanX()) {
        return $prefs.setValueForKey(val, key);
      } else if (this.isNode()) {
        this.data = this.loadData();
        this.data[key] = val;
        this.writeData();
        return true;
      } else {
        return this.data && (this.data[key] = val) && true || false;
      }
    }
    initGotEnv(opts) {
      this.got = this.got ? this.got : require("got");
      this.cktough = this.cktough ? this.cktough : require("tough-cookie");
      this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar;
      if (opts) {
        opts.headers = opts.headers ? opts.headers : {};
        if (void 0 === opts.headers.Cookie && void 0 === opts.cookieJar) {
          opts.cookieJar = this.ckjar;
        }
      }
    }
    send(options, callback, method = 'GET') {
      if (this.isNode()) {
        this.initGotEnv(options);
        const {
          url,
          ...otherOptions
        } = options;
        this.got[method.toLowerCase()](url, otherOptions).then(response => {
          const {
            statusCode,
            headers,
            body
          } = response;
          callback(null, {
            status: statusCode,
            statusCode,
            headers,
            body
          }, body);
        }, error => {
          const {
            message,
            response
          } = error;
          callback(message, response, response && response.body);
        });
      } else if (this.isSurge() || this.isLoon() || this.isQuanX()) {
        if (this.isSurge() && this.isNeedRewrite) {
          options.headers = options.headers || {};
          Object.assign(options.headers, {
            "X-Surge-Skip-Scripting": false
          });
        }
        const fn = this.isQuanX() ? $task.fetch : $httpClient[method.toLowerCase()];
        fn(options, (error, response, body) => {
          if (response) {
            response.status = response.statusCode;
          }
          if (this.isQuanX() && !error) {
            const {
              statusCode,
              headers,
              body: respBody
            } = response;
            callback(null, {
              status: statusCode,
              statusCode,
              headers,
              body: respBody
            }, respBody);
          } else {
            callback(error, response, body);
          }
        });
      }
    }
    async msg(title = name, subTitle = '', body = '', options) {
      if (this.isMute) return;
      if (this.isQL() && typeof QLAPI.systemNotify === 'function') {
        try {
          const content = [subTitle, body].filter(Boolean).join('\n');
          const result = await QLAPI.systemNotify({
            title,
            content
          });
          if (result && result.code === 200) {
            console.log('✅ 青龙 API 通知发送成功！');
          } else {
            console.log(`❌ 青龙 API 通知发送失败: ${result ? result.message : '未知错误'}`);
          }
        } catch (e) {
          console.log(`❌ 调用青龙 API 异常: ${e.message}`);
        }
        return;
      }
      if (this.isNode()) {
        if (!sendNotify) {
          try {
            sendNotify = require('./sendNotify').sendNotify;
          } catch (e) {
            console.log('加载 sendNotify.js 失败，Node.js 环境通知功能受限。');
            sendNotify = null;
          }
        }
        if (sendNotify) {
          console.log('在非青龙 Node.js 环境下，回退使用 sendNotify.js 发送通知。');
          const desp = [subTitle, body].filter(Boolean).join('\n');
          await sendNotify(title, desp, options);
        }
        return;
      }
      const formatOptions = (opts) => {
        if (!opts) return opts;
        if (typeof opts === 'string') {
          if (this.isLoon()) return opts;
          else if (this.isQuanX()) return {
            'open-url': opts
          };
          else if (this.isSurge()) return {
            url: opts
          };
        }
        return opts;
      };
      if (this.isSurge() || this.isLoon()) {
        $notification.post(title, subTitle, body, formatOptions(options));
      } else if (this.isQuanX()) {
        $notify(title, subTitle, body, formatOptions(options));
      }
    }
    log(...message) {
      if (message.length > 0) this.logs = [...this.logs, ...message];
      console.log(message.join(this.logSeparator));
    }
    logErr(error, stack) {
      const isPrintStack = !this.isSurge() && !this.isQuanX() && !this.isLoon();
      this.log('', `❌ ${this.name}, 错误!`, isPrintStack && error.stack ? error.stack : error);
    }
    wait(time) {
      return new Promise(resolve => setTimeout(resolve, time));
    }
    done(val = {}) {
      if (this.isSurge() || this.isQuanX() || this.isLoon()) $done(val);
    }
  })(name, opts);
}
