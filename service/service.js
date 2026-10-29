// TizenBrew module service. ES5 only: TizenBrew may run this in Node 4.
// The welcome page has no tizen API and cannot call the TV local REST API
// (401 from the WebView). This process lists installed apps and launches them.
var http = require('http');
var urlLib = require('url');

var PORT = 8099;
var HAS_TIZEN = typeof tizen !== 'undefined' && tizen.application;
var CONFIG_PATH = '/home/owner/share/tizenbrewConfig.json';
var MODULE_NEEDLE = 'Ohadbass/tv-samsung';
var MODULE_FALLBACK = 'gh/Ohadbass/tv-samsung@v1.0.1';

function cors(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function launchRest(id, done) {
  var req = http.request({
    hostname: '127.0.0.1',
    port: 8001,
    path: '/api/v2/applications/' + encodeURIComponent(id),
    method: 'POST',
    headers: { 'Content-Length': '0' }
  }, function (r) {
    var body = '';
    r.on('data', function (c) { body += c; });
    r.on('end', function () {
      if (r.statusCode >= 200 && r.statusCode < 300) done(null, { via: 'rest', status: r.statusCode });
      else done(new Error('REST HTTP ' + r.statusCode + ' ' + body));
    });
  });
  req.on('error', function (e) { done(e); });
  req.setTimeout(8000, function () { req.abort(); done(new Error('REST timeout')); });
  req.end();
}

function launch(id, done) {
  if (HAS_TIZEN) {
    try {
      tizen.application.launch(id, function () {
        done(null, { via: 'tizen' });
      }, function (e) {
        launchRest(id, done);
      });
      return;
    } catch (e) {}
  }
  launchRest(id, done);
}

var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') return cors(res, 204, {});
  var path = (urlLib.parse(req.url).pathname) || '/';

  if (path === '/' || path === '/health') {
    return cors(res, 200, { ok: true, service: 'tv-samsung', port: PORT, tizen: !!HAS_TIZEN });
  }

  if (path === '/apps') {
    if (!HAS_TIZEN) return cors(res, 502, { ok: false, error: 'tizen API unavailable' });
    try {
      tizen.application.getAppsInfo(function (infos) {
        var apps = [];
        for (var i = 0; i < infos.length; i++) {
          var info = infos[i];
          apps.push({
            id: info.id,
            name: info.name,
            icon: info.iconPath || '',
            show: info.show !== false
          });
        }
        cors(res, 200, { ok: true, apps: apps });
      }, function (e) {
        cors(res, 502, { ok: false, error: String(e && e.message ? e.message : e) });
      });
    } catch (e) {
      cors(res, 502, { ok: false, error: String(e) });
    }
    return;
  }

  var m = path.match(/^\/launch\/([^\/?]+)$/);
  if (m) {
    var id = decodeURIComponent(m[1]);
    return launch(id, function (err, info) {
      if (err) cors(res, 502, { ok: false, id: id, error: String(err && err.message ? err.message : err) });
      else cors(res, 200, { ok: true, id: id, info: info });
    });
  }

  cors(res, 404, { ok: false, error: 'not found' });
});

function claimAutolaunch() {
  var fs;
  try { fs = require('fs'); } catch (e) { fs = null; }
  var fullName = MODULE_FALLBACK;
  var cfg = null;
  if (fs) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { cfg = null; }
  }
  if (cfg && cfg.modules) {
    var i;
    for (i = 0; i < cfg.modules.length; i++) {
      if (String(cfg.modules[i]).indexOf(MODULE_NEEDLE) !== -1) {
        fullName = cfg.modules[i];
        break;
      }
    }
  }
  var shortName = fullName.indexOf('/') >= 0 ? fullName.substring(fullName.indexOf('/') + 1) : fullName;
  if (fs) {
    if (!cfg) {
      cfg = { modules: [fullName], autoLaunchServiceList: [], autoLaunchModule: '' };
    }
    var changed = cfg.autoLaunchModule !== fullName;
    cfg.autoLaunchModule = fullName;
    var list = cfg.autoLaunchServiceList || [];
    var has = false;
    var j;
    for (j = 0; j < list.length; j++) {
      if (list[j] === shortName || list[j] === fullName) has = true;
    }
    if (!has) {
      list.push(shortName);
      cfg.autoLaunchServiceList = list;
      changed = true;
    }
    if (changed) {
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4)); } catch (e) {}
    }
  }
  var WS = null;
  try { WS = require('ws-new'); } catch (e1) {
    try { WS = require('ws-old'); } catch (e2) {
      try { WS = require('ws'); } catch (e3) { WS = null; }
    }
  }
  if (!WS) return;
  try {
    var ws = new WS('ws://127.0.0.1:8081');
    ws.on('open', function () {
      ws.send(JSON.stringify({ type: 10, payload: { action: 'autolaunch', module: fullName } }));
      setTimeout(function () { try { ws.close(); } catch (e) {} }, 400);
    });
    ws.on('error', function () {});
  } catch (e) {}
}

server.on('error', function () {});
server.listen(PORT, '127.0.0.1');
claimAutolaunch();
