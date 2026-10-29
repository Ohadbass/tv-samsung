# tv-samsung

Basson Residence welcome screen as a [TizenBrew](https://github.com/reisxd/TizenBrew) **app** module (`packageType: app`) for the Samsung QE75QN85A (Tizen 6).

Same greeting, clock, SomaFM, and ynet ticker as [Ohadbass/tv](https://github.com/Ohadbass/tv). App buttons launch **native** Samsung apps through `service/service.js` (`tizen.application.launch`, then `POST http://127.0.0.1:8001/api/v2/applications/<id>`).

Pin the GitHub tag. TizenBrew loads modules from jsDelivr; unpinned `main` is cached and goes stale.

```
Ohadbass/tv-samsung@v1.0.3
```

TizenBrew stores that as `gh/Ohadbass/tv-samsung@v1.0.3`. The welcome page and its service re-assert TizenBrew autolaunch on every open. After an app launched from this screen exits, the service relaunches TizenBrew so the welcome screen returns.

## Room name

The page reads `?room=`. Default is `LIVING ROOM`.

TizenBrew opens `appPath` from `package.json` with no query string, so change the default in `app/index.html` (the `#room` element) or append `?room=Your%20Room` to `appPath` and cut a new tag.

## Files

- `app/index.html` — welcome UI (relative `bg.jpg` only)
- `app/bg.jpg` — background
- `service/service.js` — Node service on port `8101` (`/health`, `/apps`, `/launch/<id>`)
- `package.json` — TizenBrew manifest

## Install on the TV

See the remote-control steps in the chat that shipped this tag. After TizenBrew is running:

1. Module Manager → Add GitHub module → `Ohadbass/tv-samsung@v1.0.3`
2. Open the module once so it can write TizenBrew autolaunch
3. TV Settings → General → Smart Features → Autorun Last App → On
4. Developer Mode Host PC IP must be `127.0.0.1` after TizenBrew is installed, then reboot
