// TizenBrew module service. ES5 only: TizenBrew may run this in Node 4.
// The welcome page has no tizen API and cannot call the TV local REST API
// (401 from the WebView). This process lists installed apps and launches them.
var http = require('http');
var urlLib = require('url');

var PORT = 8098;
var HAS_TIZEN = typeof tizen !== 'undefined' && tizen.application;

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

server.on('error', function () {});
server.listen(PORT, '127.0.0.1');
