// TizenBrew module service. ES5 only: TizenBrew may run this in Node 4.
// The welcome page has no tizen API and cannot call the TV local REST API
// (401 from the WebView). This process lists installed apps, launches them,
// and brings TizenBrew back when an app launched FROM the welcome screen exits.
var http = require('http');
var urlLib = require('url');

var PORT = 8101;
var HAS_TIZEN = typeof tizen !== 'undefined' && tizen.application;
var CONFIG_PATH = '/home/owner/share/tizenbrewConfig.json';
var MODULE_NEEDLE = 'Ohadbass/tv-samsung';
var MODULE_FALLBACK = 'gh/Ohadbass/tv-samsung@v1.0.3';
var TIZENBREW_ID = 'xvvl3S1bvH.TizenBrewStandalone';
var POLL_MS = 2000;
var ARM_TIMEOUT_MS = 25000;
var NEED_MISSED = 2;

// Samsung REST visible flags are reliable on numeric store IDs, not Tizen pkg IDs.
var ALIASES = {
  '9Ur5IzDKqV.TizenYouTube': ['111299001912'],
  '111299001912': ['9Ur5IzDKqV.TizenYouTube'],
  'org.tizen.netflixapp': ['3201907018807'],
  'org.tizen.netflix-app': ['3201907018807'],
  '3201907018807': []
};

var KNOWN_APP_IDS = [
  '111299001912',
  '9Ur5IzDKqV.TizenYouTube',
  '3201907018807',
  'MCmYXNxgcu.DisneyPlus',
  'rJeHak5zRg.Spotify',
  '3202010022079',
  '3201506003716',
  '3201803015997',
  '3201812017600',
  '3201905018499',
  TIZENBREW_ID
];

var vuIds = [];
var watch = null;

function isVuName(name, id) {
  var blob = ((name || '') + ' ' + (id || '')).toLowerCase();
  if (blob.indexOf('vudu') !== -1) return false;
  if (blob.indexOf('vuplayer') !== -1 || blob.indexOf('vu player') !== -1 || blob.indexOf('vu pro') !== -1) return true;
  return /(^|[^a-z0-9])vu([^a-z0-9]|$)/.test(blob);
}

function rememberVuFromApps(apps) {
  var i, a;
  for (i = 0; i < apps.length; i++) {
    a = apps[i];
    if (!a || !isVuName(a.name, a.id)) continue;
    if (vuIds.indexOf(a.id) === -1) vuIds.push(a.id);
    if (KNOWN_APP_IDS.indexOf(a.id) === -1) KNOWN_APP_IDS.push(a.id);
  }
}

function discoverVuApps() {
  if (!HAS_TIZEN) return;
  try {
    tizen.application.getAppsInfo(function (infos) {
      rememberVuFromApps(infos);
    }, function () {});
  } catch (e) {}
}

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

function jsonGet(path, done) {
  var req = http.request({
    hostname: '127.0.0.1',
    port: 8001,
    path: path,
    method: 'GET'
  }, function (r) {
    var body = '';
    r.on('data', function (c) { body += c; });
    r.on('end', function () {
      if (r.statusCode < 200 || r.statusCode >= 300) return done(null);
      try { done(JSON.parse(body)); } catch (e) { done(null); }
    });
  });
  req.on('error', function () { done(null); });
  req.setTimeout(4000, function () { try { req.abort(); } catch (e) {} done(null); });
  req.end();
}

function unique(list) {
  var out = [];
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && out.indexOf(list[i]) === -1) out.push(list[i]);
  }
  return out;
}

function idsFor(id, extra) {
  var list = [id];
  if (extra) list.push(extra);
  var aliases = ALIASES[id];
  var i;
  if (aliases) {
    for (i = 0; i < aliases.length; i++) list.push(aliases[i]);
  }
  if (extra && ALIASES[extra]) {
    for (i = 0; i < ALIASES[extra].length; i++) list.push(ALIASES[extra][i]);
  }
  if (vuIds.indexOf(id) !== -1 || (extra && vuIds.indexOf(extra) !== -1) || isVuName('', id) || isVuName('', extra)) {
    for (i = 0; i < vuIds.length; i++) list.push(vuIds[i]);
  }
  return unique(list);
}

function isWatched(id) {
  return !!(watch && watch.ids && watch.ids.indexOf(id) !== -1);
}

function stopWatch() {
  if (watch && watch.timer) clearInterval(watch.timer);
  watch = null;
}

function isHdmiOrLiveTv() {
  try {
    if (typeof webapis === 'undefined') return false;
    var src = null;
    if (webapis.tvwindow && typeof webapis.tvwindow.getSource === 'function') {
      src = webapis.tvwindow.getSource();
    }
    if (!src && webapis.tv && webapis.tv.window && typeof webapis.tv.window.getSource === 'function') {
      src = webapis.tv.window.getSource();
    }
    if (!src) return false;
    var t = src.type;
    var name = String(src.name || src.id || '');
    if (/HDMI|COMP|AV|SCART|PC|DVI/i.test(name)) return true;
    var HDMI = 5;
    try {
      if (webapis.avinfo && webapis.avinfo.AvInputType && typeof webapis.avinfo.AvInputType.HDMI === 'number') {
        HDMI = webapis.avinfo.AvInputType.HDMI;
      }
    } catch (e) {}
    if (typeof t === 'number' && t === HDMI) return true;
    if (typeof t === 'string' && /HDMI/i.test(t)) return true;
  } catch (e) {}
  return false;
}

function contextRunning(ids, done) {
  if (!HAS_TIZEN) return done(false, false);
  try {
    tizen.application.getAppsContext(function (ctxs) {
      var i, j, found = false;
      for (i = 0; i < ctxs.length; i++) {
        for (j = 0; j < ids.length; j++) {
          if (ctxs[i].appId === ids[j]) found = true;
        }
      }
      done(found, true);
    }, function () { done(false, false); });
  } catch (e) { done(false, false); }
}

function anyVisible(ids, done) {
  var left = ids.length;
  var found = false;
  var ok = false;
  if (!left) return done(false, false);
  ids.forEach(function (id) {
    jsonGet('/api/v2/applications/' + encodeURIComponent(id), function (info) {
      if (info) {
        ok = true;
        if (info.visible === true) found = true;
      }
      left -= 1;
      if (!left) {
        if (found || ok) return done(found, ok);
        contextRunning(ids, done);
      }
    });
  });
}

function otherKnownVisible(done) {
  var ids = [];
  var i;
  for (i = 0; i < KNOWN_APP_IDS.length; i++) {
    if (!isWatched(KNOWN_APP_IDS[i])) ids.push(KNOWN_APP_IDS[i]);
  }
  anyVisible(ids, function (found) { done(found); });
}

function relaunchWelcome() {
  stopWatch();
  launch(TIZENBREW_ID, function () {});
}

function tickWatch() {
  if (!watch) return;
  anyVisible(watch.ids, function (visible, ok) {
    if (!watch) return;
    if (!ok) return;
    var now = Date.now();
    if (visible) {
      watch.seenVisible = true;
      watch.missed = 0;
      return;
    }
    if (!watch.seenVisible) {
      if (now - watch.started > ARM_TIMEOUT_MS) stopWatch();
      return;
    }
    watch.missed += 1;
    if (watch.missed < NEED_MISSED) return;
    if (isHdmiOrLiveTv()) {
      stopWatch();
      return;
    }
    otherKnownVisible(function (other) {
      if (!watch) return;
      if (other) {
        stopWatch();
        return;
      }
      relaunchWelcome();
    });
  });
}

function startWatch(ids) {
  stopWatch();
  var filtered = [];
  var i;
  for (i = 0; i < ids.length; i++) {
    if (ids[i] && ids[i] !== TIZENBREW_ID) filtered.push(ids[i]);
  }
  filtered = unique(filtered);
  if (!filtered.length) return;
  watch = {
    ids: filtered,
    seenVisible: false,
    missed: 0,
    started: Date.now(),
    timer: setInterval(tickWatch, POLL_MS)
  };
  setTimeout(tickWatch, 400);
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
  var parsed = urlLib.parse(req.url, true);
  var path = parsed.pathname || '/';

  if (path === '/' || path === '/health') {
    return cors(res, 200, {
      ok: true,
      service: 'tv-samsung',
      port: PORT,
      tizen: !!HAS_TIZEN,
      vuIds: vuIds,
      watch: watch ? { ids: watch.ids, seenVisible: watch.seenVisible, missed: watch.missed } : null
    });
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
        rememberVuFromApps(apps);
        cors(res, 200, { ok: true, apps: apps, vuIds: vuIds });
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
    var also = parsed.query && parsed.query.also ? String(parsed.query.also) : '';
    return launch(id, function (err, info) {
      if (err) cors(res, 502, { ok: false, id: id, error: String(err && err.message ? err.message : err) });
      else {
        startWatch(idsFor(id, also));
        cors(res, 200, { ok: true, id: id, info: info, watch: watch ? watch.ids : [] });
      }
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
server.listen(PORT);
claimAutolaunch();
discoverVuApps();
