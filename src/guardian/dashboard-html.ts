export const GUARDIAN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guardian Console</title>
  <style>
    :root { color-scheme: dark; --bg:#07111f; --card:#0d1b2a; --muted:#89a3bd; --line:#1d3557; --ok:#52b788; --warn:#f4a261; --bad:#e76f51; --text:#f1faee; --accent:#8ecae6; }
    * { box-sizing:border-box; } body { margin:0; font-family:"Avenir Next","Noto Sans TC",sans-serif; background:radial-gradient(circle at top,#16324f 0%,#07111f 55%); color:var(--text); }
    .shell { max-width:1200px; margin:0 auto; padding:32px 20px 48px; } .hero { display:flex; justify-content:space-between; gap:20px; align-items:end; margin-bottom:24px; }
    .title { font-size:38px; font-weight:700; letter-spacing:0.02em; } .subtitle { color:var(--muted); margin-top:8px; max-width:640px; line-height:1.6; }
    .meta { color:var(--accent); font-size:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; margin-bottom:20px; }
    .card { background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01)); border:1px solid rgba(142,202,230,0.15); border-radius:22px; padding:18px; backdrop-filter:blur(10px); box-shadow:0 18px 40px rgba(0,0,0,0.18); }
    .label { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:0.08em; } .value { font-size:32px; font-weight:700; margin-top:8px; }
    .services { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; } .row { display:flex; justify-content:space-between; align-items:center; margin-top:10px; }
    .pill { padding:6px 10px; border-radius:999px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; }
    .healthy { background:rgba(82,183,136,0.18); color:#7ef0af; } .warning { background:rgba(244,162,97,0.18); color:#ffd29c; } .cooldown,.paused { background:rgba(142,202,230,0.18); color:#bfe7ff; } .restarting,.missing { background:rgba(231,111,81,0.18); color:#ffb3a0; }
    .spark { width:100%; height:72px; margin-top:14px; display:block; background:rgba(255,255,255,0.02); border-radius:14px; }
    .events { margin-top:24px; } .event { padding:12px 0; border-top:1px solid rgba(255,255,255,0.06); } .event:first-child { border-top:none; } .event small { color:var(--muted); display:block; margin-bottom:4px; }
    button { background:linear-gradient(90deg,#3a86ff,#00b4d8); color:white; border:none; border-radius:12px; padding:10px 14px; font-weight:700; cursor:pointer; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <div class="title">Guardian Console</div>
        <div class="subtitle">Watch local AI runtimes, visualize pressure, and recover automatically before swap drag turns your Mac into glue.</div>
      </div>
      <div class="meta" id="meta">loading...</div>
    </div>
    <div class="grid" id="summary"></div>
    <div class="services" id="services"></div>
    <div class="card events">
      <div class="label">Recent Events</div>
      <div id="events"></div>
    </div>
  </div>
  <script>
    const fmt = (ts) => new Date(ts).toLocaleString();
    const spark = (samples) => {
      if (!samples.length) return '';
      const max = Math.max(...samples.map(s => s.rssGb), 1);
      const points = samples.map((s, i) => [i * (260 / Math.max(samples.length - 1, 1)), 64 - (s.rssGb / max) * 56]);
      return '<svg class="spark" viewBox="0 0 260 72" preserveAspectRatio="none"><polyline fill="none" stroke="#8ecae6" stroke-width="3" points="' + points.map(p => p.join(',')).join(' ') + '"/></svg>';
    };
    async function refresh() {
      const res = await fetch('/api/guardian/status');
      const data = await res.json();
      document.getElementById('meta').textContent = 'Updated ' + fmt(data.generatedAt);
      const services = Object.entries(data.services);
      const totalRss = services.reduce((sum, [, svc]) => sum + (svc.lastSample?.rssGb || 0), 0).toFixed(2);
      const warnings = services.filter(([, svc]) => svc.status !== 'healthy').length;
      document.getElementById('summary').innerHTML = [
        ['Monitored Services', services.length],
        ['Total RSS (GB)', totalRss],
        ['Active Alerts', warnings],
      ].map(([label, value]) => '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>').join('');
      document.getElementById('services').innerHTML = services.map(([id, svc]) => '<div class="card"><div class="row"><div><div class="label">' + id + '</div><div class="value" style="font-size:28px">' + (svc.lastSample?.rssGb?.toFixed(2) || '0.00') + ' GB</div></div><span class="pill ' + svc.status + '">' + svc.status + '</span></div><div class="row"><span>Swap</span><strong>' + (svc.lastSample?.swapUsedGb?.toFixed(2) || '0.00') + ' GB</strong></div><div class="row"><span>Breaches</span><strong>' + svc.consecutiveBreaches + '</strong></div><div class="row"><span>Last restart</span><strong>' + (svc.lastRestartAt ? fmt(svc.lastRestartAt) : 'never') + '</strong></div><div class="row"><button data-service="' + id + '">Restart now</button></div>' + spark(svc.samples || []) + '</div>').join('');
      document.getElementById('events').innerHTML = services.flatMap(([, svc]) => svc.events).sort((a, b) => b.ts - a.ts).slice(0, 12).map((event) => '<div class="event"><small>' + fmt(event.ts) + ' · ' + event.serviceId + ' · ' + event.kind + '</small><div>' + event.message + '</div></div>').join('');
      document.querySelectorAll('button[data-service]').forEach((btn) => btn.onclick = async () => {
        await fetch('/api/guardian/actions/restart/' + btn.dataset.service, { method: 'POST' });
        setTimeout(refresh, 800);
      });
    }
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
