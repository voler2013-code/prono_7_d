// =====================================================================
// Prono térmico — lógica y pantalla. La configuración está en config.js
// =====================================================================
(function (root) {
  "use strict";

  const C = root.CONFIG;
  const U = C.umbrales;
  const TZ = "America/Argentina/Buenos_Aires";
  const DIR16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const NIVELES_STD = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];
  const NOMBRE_MODELO = {
    icon_seamless: "ICON", gfs_seamless: "GFS", meteofrance_seamless: "Météo-France",
    ecmwf_ifs025: "ECMWF", ukmo_seamless: "UKMO", gem_seamless: "GEM",
    cma_grapes_global: "CMA",
  };

  // -------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------
  const esNum = (x) => typeof x === "number" && isFinite(x);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const r1 = (x) => (esNum(x) ? Math.round(x * 10) / 10 : null);
  const pad = (h) => String(h).padStart(2, "0");

  function mediana(a) {
    const v = a.filter(esNum).sort((x, y) => x - y);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function desvio(a) {
    const v = a.filter(esNum);
    if (v.length < 2) return 0;
    const mu = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length);
  }
  const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  const dirLabel = (d) => (esNum(d) ? DIR16[Math.round((((d % 360) + 360) % 360) / 22.5) % 16] : "—");
  function dirCentro(lbl) {
    const i = DIR16.indexOf(String(lbl).trim().toUpperCase());
    return i < 0 ? null : i * 22.5;
  }
  // Viento a componentes (de dónde viene → vector hacia dónde va)
  function aUV(ws, wd) {
    const r = (wd * Math.PI) / 180;
    return [-ws * Math.sin(r), -ws * Math.cos(r)];
  }
  function deUV(u, v) {
    if (Math.abs(u) < 1e-6 && Math.abs(v) < 1e-6) return null;
    return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  }
  // Punto de rocío (Magnus), igual que en prono_termico3.py
  function rocio(T, RH) {
    if (!esNum(T) || !esNum(RH) || RH <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(Math.min(RH, 100) / 100) + (a * T) / (b + T);
    return (b * g) / (a - g);
  }
  // Altura aproximada de atmósfera estándar (solo si falta el geopotencial)
  const zISA = (p) => 44330.8 * (1 - Math.pow(p / 1013.25, 0.190263));

  // Pendiente por mínimos cuadrados (°C por km)
  function pendiente(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    return den > 0 ? num / den : null;
  }

  // -------------------------------------------------------------------
  // Descarga Open-Meteo: una petición por modelo con los 6 lugares y 7 días
  // -------------------------------------------------------------------
  function variables(reducido) {
    const niv = reducido ? C.niveles.filter((p) => NIVELES_STD.includes(p)) : C.niveles;
    const v = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m",
      "wind_direction_10m", "wind_gusts_10m", "precipitation",
      "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high"];
    if (!reducido) v.push("cape");
    niv.forEach((p) => {
      v.push(`temperature_${p}hPa`, `relative_humidity_${p}hPa`, `wind_speed_${p}hPa`,
        `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
      if (!reducido) v.push(`cloud_cover_${p}hPa`);
    });
    return v;
  }

  function urlModelo(modelo, reducido) {
    const lat = C.lugares.map((l) => l.lat).join(",");
    const lon = C.lugares.map((l) => l.lon).join(",");
    return "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=${variables(reducido).join(",")}` +
      `&models=${modelo}&timezone=${encodeURIComponent(TZ)}` +
      `&forecast_days=${C.dias}&wind_speed_unit=kmh`;
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function pedir(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      let j = null;
      try { j = await r.json(); } catch (e) { /* respuesta sin JSON */ }
      return { status: r.status, json: j };
    } catch (e) {
      return { status: 0, error: e.name === "AbortError" ? "tiempo agotado" : "sin conexión" };
    } finally {
      clearTimeout(t);
    }
  }

  // Consulta aparte y chica: calor sensible del suelo y radiación solar (para la térmica).
  // Si el modelo no tiene alguna variable, se prueba solo con la radiación; si falla, se ignora.
  function urlExtra(modelo, vars) {
    const lat = C.lugares.map((l) => l.lat).join(",");
    const lon = C.lugares.map((l) => l.lon).join(",");
    return "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}&hourly=${vars.join(",")}` +
      `&models=${modelo}&timezone=${encodeURIComponent(TZ)}&forecast_days=${C.dias}`;
  }
  async function descargarExtra(modelo) {
    for (const vars of [["sensible_heat_flux", "shortwave_radiation"], ["shortwave_radiation"]]) {
      const res = await pedir(urlExtra(modelo, vars));
      if (res.status === 200 && res.json) return Array.isArray(res.json) ? res.json : [res.json];
      if (res.status !== 400) return null;
    }
    return null;
  }

  async function descargarModelo(modelo, aviso) {
    let reducido = false;
    for (let intento = 0; intento < 4; intento++) {
      const res = await pedir(urlModelo(modelo, reducido));
      if (res.status === 200 && res.json) {
        let extra = null;
        try { extra = await descargarExtra(modelo); } catch (e) { extra = null; }
        return { datos: Array.isArray(res.json) ? res.json : [res.json], reducido, extra };
      }
      // Variable no disponible en ese modelo → se reintenta con niveles estándar
      if (res.status === 400 && !reducido) { reducido = true; continue; }
      if (res.status === 429) {
        for (let s = 65; s > 0; s--) { aviso(`Límite de la API: reintento en ${s} s`); await esperar(1000); }
        continue;
      }
      if (res.status === 0 && intento < 2) { await esperar(2000); continue; }
      throw new Error((res.json && res.json.reason) || res.error || `error ${res.status}`);
    }
    throw new Error("no respondió");
  }

  async function descargarTodo(onProg) {
    const ok = {}, err = {}, estado = {};
    const cola = C.modelos.slice();
    let hechos = 0;
    C.modelos.forEach((m) => (estado[m] = "espera"));
    async function trabajador() {
      while (cola.length) {
        const m = cola.shift();
        estado[m] = "bajando";
        onProg(hechos, estado);
        try {
          ok[m] = await descargarModelo(m, (msg) => onProg(hechos, estado, msg));
          estado[m] = "ok";
        } catch (e) {
          err[m] = e.message;
          estado[m] = "error";
        }
        hechos++;
        onProg(hechos, estado);
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    return { ok, err };
  }

  // Próxima actualización recomendada: para cada modelo, última disponibilidad
  // + intervalo entre corridas + margen; se elige el horario en que ya se
  // actualizó la mayoría (por defecto 5 de 7). Devuelve ms o null.
  async function proximaActualizacion() {
    const P = C.proximaActualizacion;
    if (!P) return null;
    const ahora = Date.now() / 1000, margen = (P.margenMin || 0) * 60;
    const ts = (await Promise.all(C.modelos.map(async (m) => {
      const d = P.dominios[m];
      if (!d) return null;
      const r = await pedir(P.url.replace("{dominio}", d));
      const j = r.status === 200 ? r.json : null;
      if (!j || !esNum(j.last_run_availability_time) || !esNum(j.update_interval_seconds)) return null;
      const t = j.last_run_availability_time + j.update_interval_seconds + margen;
      return t < ahora ? ahora + margen : t; // modelo demorado: puede salir en cualquier momento
    }))).filter(esNum).sort((a, b) => a - b);
    if (!ts.length) return null;
    const k = Math.min(ts.length, Math.max(1, Math.ceil((ts.length * P.minModelos) / C.modelos.length)));
    return Math.round(ts[k - 1] * 1000);
  }

  // -------------------------------------------------------------------
  // Procesamiento: perfil por modelo → interpolación → medianas
  // -------------------------------------------------------------------
  // Completa alturas faltantes interpolando en ln(p) (niveles de 1000 a 500)
  function completarZ(niv) {
    const conZ = niv.map((o, i) => (esNum(o.z) ? i : -1)).filter((i) => i >= 0);
    niv.forEach((o, i) => {
      if (esNum(o.z)) return;
      const a = conZ.filter((k) => k < i).pop();
      const b = conZ.find((k) => k > i);
      if (a !== undefined && b !== undefined) {
        const f = (Math.log(niv[a].p) - Math.log(o.p)) / (Math.log(niv[a].p) - Math.log(niv[b].p));
        o.z = niv[a].z + f * (niv[b].z - niv[a].z);
      } else if (a !== undefined || b !== undefined) {
        const k = a !== undefined ? a : b;
        o.z = zISA(o.p) + (niv[k].z - zISA(niv[k].p));
      } else {
        o.z = zISA(o.p);
      }
    });
  }

  // Interpolación lineal en altura de los niveles que el modelo no entrega
  function interpolarEnZ(niv, k) {
    const val = niv.map((o, i) => (esNum(o[k]) ? i : -1)).filter((i) => i >= 0);
    if (val.length < 2) return;
    niv.forEach((o, i) => {
      if (esNum(o[k])) return;
      const a = val.filter((j) => j < i).pop();
      const b = val.find((j) => j > i);
      if (a === undefined || b === undefined) return;
      const za = niv[a].z, zb = niv[b].z;
      if (!(zb > za)) return;
      o[k] = niv[a][k] + ((o.z - za) / (zb - za)) * (niv[b][k] - niv[a][k]);
    });
  }

  function perfilModelo(h, t) {
    const g = (k) => { const a = h[k]; return a && esNum(a[t]) ? a[t] : null; };
    const niv = C.niveles.map((p) => {
      const o = {
        p, z: g(`geopotential_height_${p}hPa`), T: g(`temperature_${p}hPa`),
        RH: g(`relative_humidity_${p}hPa`), ws: g(`wind_speed_${p}hPa`),
        wd: g(`wind_direction_${p}hPa`), cc: g(`cloud_cover_${p}hPa`), u: null, v: null,
      };
      if (esNum(o.RH)) o.RH = Math.max(0, Math.min(100, o.RH));
      if (esNum(o.ws) && esNum(o.wd)) [o.u, o.v] = aUV(o.ws, o.wd);
      return o;
    });
    completarZ(niv);
    ["T", "RH", "ws", "u", "v", "cc"].forEach((k) => interpolarEnZ(niv, k));
    niv.forEach((o) => {
      o.RH = esNum(o.RH) ? Math.max(0, Math.min(100, o.RH)) : null;
      o.Td = rocio(o.T, o.RH);
    });
    return niv;
  }

  function superficieModelo(h, t) {
    const g = (k) => { const a = h[k]; return a && esNum(a[t]) ? a[t] : null; };
    return {
      T: g("temperature_2m"), RH: g("relative_humidity_2m"), ws: g("wind_speed_10m"),
      wd: g("wind_direction_10m"), gust: g("wind_gusts_10m"), pp: g("precipitation"),
      cl: g("cloud_cover_low"), cm: g("cloud_cover_mid"), ch: g("cloud_cover_high"),
      cape: g("cape"),
    };
  }

  function agregarHora(perfiles, sups, nivelesViento) {
    const niv = C.niveles.map((p, k) => {
      const col = perfiles.map((pr) => pr.niv[k]);
      const m = (key) => mediana(col.map((o) => o[key]));
      // Dirección: mediana de cada componente → E si dicen ENE, E y ESE
      const u = m("u"), v = m("v");
      return {
        p, z: r1(m("z")), T: r1(m("T")), Td: r1(m("Td")), RH: r1(m("RH")),
        ws: r1(m("ws")), wd: esNum(u) && esNum(v) ? r1(deUV(u, v)) : null,
        cc: r1(m("cc")), n: col.filter((o) => esNum(o.T)).length,
      };
    });

    const sv = (k) => mediana(sups.map((s) => s[k]));
    const uv10 = sups.filter((s) => esNum(s.ws) && esNum(s.wd)).map((s) => aUV(s.ws, s.wd));
    const sup = {
      T: r1(sv("T")), Td: r1(mediana(sups.map((s) => rocio(s.T, s.RH)))), RH: r1(sv("RH")),
      ws: r1(sv("ws")),
      wd: uv10.length ? r1(deUV(mediana(uv10.map((a) => a[0])), mediana(uv10.map((a) => a[1])))) : null,
      gust: r1(sv("gust")), pp: r1(sv("pp")), cl: r1(sv("cl")), cm: r1(sv("cm")),
      ch: r1(sv("ch")), cape: esNum(sv("cape")) ? Math.round(sv("cape")) : null,
      rad: esNum(sv("rad")) ? Math.round(sv("rad")) : null,
      calor: esNum(sv("calor")) ? Math.round(sv("calor")) : null,
    };

    // Viento de cada modelo en los niveles configurados (para la confianza)
    const vm = {};
    nivelesViento.forEach((p) => {
      const k = C.niveles.indexOf(p);
      if (k < 0) return;
      vm[p] = perfiles.map((pr) => {
        const o = pr.niv[k];
        return esNum(o.ws) && esNum(o.u) ? [r1(o.ws), r1(deUV(o.u, o.v))] : null;
      }).filter(Boolean);
    });
    return { niv, sup, vm, nm: perfiles.length };
  }

  function procesar(ok) {
    const modelos = Object.keys(ok);
    const A = {
      creado: Date.now(), modelos,
      reducidos: modelos.filter((m) => ok[m].reducido), lugares: {}, dias: [],
    };
    C.lugares.forEach((L, i) => {
      const locs = modelos
        .map((m) => ({ m, d: ok[m].datos[i], e: ok[m].extra && ok[m].extra[i] }))
        .filter((x) => x.d && x.d.hourly && Array.isArray(x.d.hourly.time));
      if (!locs.length) return;
      const elev = mediana(locs.map((x) => x.d.elevation));
      const times = locs[0].d.hourly.time;
      const idx = locs.map((x) => {
        const mp = {};
        x.d.hourly.time.forEach((t, j) => (mp[t] = j));
        return mp;
      });
      const idxE = locs.map((x) => {
        const mp = {};
        if (x.e && x.e.hourly && Array.isArray(x.e.hourly.time)) x.e.hourly.time.forEach((t, j) => (mp[t] = j));
        return mp;
      });
      const pp = {};
      locs.forEach((x, j) => {
        const a = x.d.hourly.precipitation;
        pp[x.m] = times.map((t) => {
          const k = idx[j][t];
          return k !== undefined && a && esNum(a[k]) ? r1(a[k]) : null;
        });
      });
      const nivelesViento = L.viento.map((v) => v.hPa);
      const horas = {};
      times.forEach((t) => {
        const hh = +t.slice(11, 13);
        if (hh < C.horaIni || hh > C.horaFin) return;
        const perfiles = [], sups = [], tm = {};
        let gfs = null;
        locs.forEach((x, j) => {
          const k = idx[j][t];
          if (k === undefined) return;
          const s = superficieModelo(x.d.hourly, k);
          const ke = idxE[j][t];
          if (ke !== undefined) {
            const he = x.e.hourly;
            const g = (key) => (he[key] && esNum(he[key][ke]) ? he[key][ke] : null);
            s.rad = g("shortwave_radiation");
            s.shf = g("sensible_heat_flux");
          }
          s.calor = calorSuelo(s.shf, s.rad);
          if (Object.values(s).some(esNum)) sups.push(s);
          const pr = perfilModelo(x.d.hourly, k);
          if (!pr.some((o) => esNum(o.T))) return;
          perfiles.push({ m: x.m, niv: pr });
          tm[x.m] = {
            s: r1(s.T),
            sd: r1(rocio(s.T, s.RH)),
            n: pr.map((o) => (esNum(o.z) && esNum(o.T) ? [Math.round(o.z), r1(o.T), r1(o.Td)] : null)),
          };
          if (x.m === C.modeloSondeo) {
            gfs = {
              sup: { T: r1(s.T), Td: r1(rocio(s.T, s.RH)) },
              niv: pr.filter((o) => esNum(o.z) && esNum(o.T) && esNum(o.Td))
                     .map((o) => [Math.round(o.z), r1(o.T), r1(o.Td)]),
            };
          }
        });
        if (!perfiles.length) return;
        const H = agregarHora(perfiles, sups, nivelesViento);
        H.gfs = gfs;
        H.tm = tm;
        horas[t.slice(0, 13)] = H;
      });
      A.lugares[L.id] = { elev: Math.round(elev || 0), times: times.map((t) => t.slice(0, 13)), pp, horas };
    });
    const uno = Object.values(A.lugares)[0];
    if (uno) A.dias = [...new Set(uno.times.map((t) => t.slice(0, 10)))].slice(0, C.dias);
    return A;
  }

  // -------------------------------------------------------------------
  // Techo y sondeo (GFS)
  // -------------------------------------------------------------------
  function puntosSondeo(H, elev, soloMediana) {
    let pts, fuente;
    const okGfs = !soloMediana && H.gfs && H.gfs.niv.length >= 3;
    if (okGfs) {
      fuente = "GFS";
      pts = H.gfs.niv.filter((a) => a[0] > elev + 10).map((a) => ({ z: a[0], T: a[1], Td: a[2] }));
      if (esNum(H.gfs.sup.T) && esNum(H.gfs.sup.Td)) pts.push({ z: elev, T: H.gfs.sup.T, Td: H.gfs.sup.Td });
    } else {
      fuente = "mediana";
      pts = H.niv.filter((n) => esNum(n.z) && n.z > elev + 10 && esNum(n.T) && esNum(n.Td))
                 .map((n) => ({ z: n.z, T: n.T, Td: n.Td }));
      if (esNum(H.sup.T) && esNum(H.sup.Td)) pts.push({ z: elev, T: H.sup.T, Td: H.sup.Td });
    }
    pts.sort((a, b) => a.z - b.z);
    return { pts, fuente };
  }

  // Techo: primer punto (subiendo desde el suelo) donde el rocío más se acerca
  // a la temperatura y por encima vuelve a aparecer una capa seca.
  function calcularTecho(pts, elev) {
    if (pts.length < 3) return { z: elev, tipo: "sin", dif: null };
    const desde = elev + U.techoBuscarDesde, hasta = U.techoBuscarHasta;
    const D = pts.map((p) => p.T - p.Td);
    for (let i = 1; i < pts.length - 1; i++) {
      const z = pts[i].z;
      if (z < desde) continue;
      if (z > hasta) break;
      if (D[i] <= D[i - 1] && D[i] < D[i + 1]) {
        for (let j = i + 1; j < pts.length && pts[j].z - z <= U.techoValidarEn; j++) {
          if (D[j] - D[i] >= U.techoValidarSubida) {
            return { z, dif: D[i], tipo: D[i] <= U.cumulosDifMax ? "cumulos" : "validado" };
          }
        }
      }
    }
    // Sin mínimo validado
    const ven = pts.map((p, i) => (p.z >= desde && p.z <= hasta ? i : -1)).filter((i) => i >= 0);
    if (ven.length >= 2) {
      let iMin = ven[0];
      ven.forEach((i) => { if (D[i] < D[iMin]) iMin = i; });
      if (iMin === ven[ven.length - 1] && D[iMin] < D[ven[0]] - 1) {
        return { z: pts[iMin].z, dif: D[iMin], tipo: "humedo" };
      }
    }
    // Térmica azul: aire de superficie enfriándose a 9,8 °C/km hasta igualar al ambiente
    const T0 = pts[0].T, z0 = pts[0].z;
    const exceso = (p) => T0 - (9.8 * (p.z - z0)) / 1000 - p.T;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].z < desde) continue;
      const b = exceso(pts[i]);
      if (b <= 0) {
        const a = exceso(pts[i - 1]);
        const f = a > 0 && a > b ? a / (a - b) : 1;
        const z = pts[i - 1].z + f * (pts[i].z - pts[i - 1].z);
        return { z: Math.max(elev, z), dif: null, tipo: z <= elev + 100 ? "sin" : "azul" };
      }
    }
    return { z: pts[pts.length - 1].z, dif: null, tipo: "azul" };
  }

  // Calor que el suelo le da al aire (W/m²): el flujo de calor sensible del modelo
  // si existe y es razonable; si no, una fracción de la radiación solar.
  function calorSuelo(shf, rad) {
    const est = esNum(rad) ? Math.max(0, rad) * U.factorCalorRadiacion : null;
    if (esNum(shf)) {
      const h = Math.abs(shf); // algunos modelos usan signo negativo para el flujo hacia arriba
      if (!esNum(rad) || h <= Math.max(0, rad) + 50) return h;
    }
    return est;
  }

  // Térmica de Deardorff: w* = (g/T · calor/(ρ·cp) · altura de la capa)^(1/3).
  // Por altura (x = fracción de la capa): crece en el primer tramo, es plena en la
  // parte media (núcleo ≈ w*·factorNucleo) y baja hasta 0 al llegar al techo.
  // Neto = w − caída del parapente.
  function termicasDeardorff(H, elev, zTecho) {
    const out = {};
    const calor = H.sup.calor, T = H.sup.T;
    const zi = zTecho - elev;
    if (!esNum(calor) || !esNum(T) || !(zi > 50)) return null;
    const TK = T + 273.15;
    const pres = 101325 * Math.pow(1 - elev / 44330.8, 5.255);
    const rho = pres / (287 * TK);
    const wEst = Math.cbrt((9.81 / TK) * (Math.max(0, calor) / (rho * 1005)) * zi);
    const a = U.termicaPlenaDesde, b = U.termicaPlenaHasta;
    const forma = (x) => (x < a ? Math.cbrt(x / a) : x <= b ? 1 : Math.max(0, (1 - x) / (1 - b)));
    C.niveles.forEach((p, k) => {
      const nm = H.niv[k];
      if (!nm || !esNum(nm.z) || nm.z <= elev + 10 || nm.z > zTecho + 1) return;
      const x = (nm.z - elev) / zi;
      const w = wEst * U.factorNucleo * forma(x);
      out[p] = w - U.hundimientoParapente;
    });
    out._wEst = wEst;
    // Altura volable: donde la térmica (aire) baja del umbral, en el tramo que se apaga
    const wp = wEst * U.factorNucleo, um = U.alturaVolableUmbral;
    out._zVol = wp >= um ? elev + zi * (1 - ((1 - b) * um) / wp) : null;
    return out;
  }

  // Velocidad del aire en la térmica (Predelli), igual que prono_termico3.py
  function velocTermica(rocioTermica, rocio, temp) {
    const dif = rocioTermica - rocio;
    if (dif <= 0) return 0;
    const den = Math.pow(1.1, temp - rocio);
    if (!(den > 0)) return null;
    return 5.6 * Math.sqrt((Math.pow(1.1, dif) - 1) / den);
  }

  // Ascenso NETO del parapente (m/s) por nivel, hasta el techo inclusive:
  // por modelo, rocío de la térmica = rocío a 2 m − 1,8 °C/km; se resta el
  // hundimiento del parapente y se toma la mediana de los modelos.
  function termicas(H, elev, zTecho) {
    if (U.metodoTermica !== "predelli") {
      const d = termicasDeardorff(H, elev, zTecho);
      if (d) return d;
    }
    const out = {};
    if (!H.tm) return out;
    const mods = Object.values(H.tm);
    C.niveles.forEach((p, k) => {
      const nm = H.niv[k];
      if (!nm || !esNum(nm.z) || nm.z <= elev + 10 || nm.z > zTecho + 1) return;
      const vals = [];
      mods.forEach((t) => {
        const e = t.n[k];
        const td2 = esNum(t.sd) ? t.sd : H.sup.Td;
        const z = e && esNum(e[0]) ? e[0] : nm.z;
        const T = e && esNum(e[1]) ? e[1] : nm.T;
        const Td = e && esNum(e[2]) ? e[2] : nm.Td;
        if (!esNum(td2) || !esNum(T) || !esNum(Td)) return;
        const w = velocTermica(td2 - (z - elev) * 0.0018, Td, T);
        if (esNum(w)) vals.push(w - U.hundimientoParapente);
      });
      const m = mediana(vals);
      if (esNum(m)) out[p] = m;
    });
    return out;
  }

  // Descenso de temperatura del suelo al techo: mediana de las pendientes de cada modelo (°C/km)
  function descensoMediana(H, elev, zTecho) {
    if (!H.tm) return null;
    const pend = Object.values(H.tm).map((t) => {
      const pts = t.n.filter((a) => a && a[0] > elev + 10 && a[0] <= zTecho + 1).map((a) => ({ z: a[0], T: a[1] }));
      if (esNum(t.s)) pts.unshift({ z: elev, T: t.s });
      return pts.length >= 2 ? pendiente(pts.map((p) => p.z / 1000), pts.map((p) => p.T)) : null;
    });
    return mediana(pend);
  }

  // Sondeo: pendientes (regresión) de T y Td desde el suelo hasta el techo
  function calcularSondeo(pts, zTecho) {
    const tramo = pts.filter((p) => p.z <= zTecho + 1);
    if (tramo.length < 2) return { ok: false, pendT: null, pendTd: null, motivo: "techo demasiado bajo" };
    const xs = tramo.map((p) => p.z / 1000);
    const pendT = pendiente(xs, tramo.map((p) => p.T));
    const pendTd = pendiente(xs, tramo.map((p) => p.Td));
    const okT = esNum(pendT) && pendT <= U.sondeoPendTMax;
    const okTd = esNum(pendTd) && pendTd >= U.sondeoPendTdMin;
    return { ok: okT && okTd, okT, okTd, pendT, pendTd, n: tramo.length };
  }

  // -------------------------------------------------------------------
  // Puntaje de un lugar a una hora
  // -------------------------------------------------------------------
  function dirsDe(cfg) {
    if (!cfg._c) cfg._c = cfg.dirs.split(/\s+/).map(dirCentro).filter(esNum);
    return cfg._c;
  }
  function gradosFuera(wd, centros) {
    return Math.min(...centros.map((c) => Math.max(0, angDiff(wd, c) - 11.25)));
  }
  // Puntaje de dirección: 1 dentro del sector; fuera baja lineal hasta 0 en "gCero" grados.
  // Con gCero = 0, cualquier dirección fuera del sector vale 0.
  function puntajeDir(fuera, gCero) {
    if (fuera <= 0) return 1;
    return gCero > 0 ? clamp01(1 - fuera / gCero) : 0;
  }
  function puntajeCapa(cc, umbral) {
    if (!esNum(cc) || cc <= umbral) return 1;
    return clamp01((100 - cc) / (100 - umbral));
  }
  function nivelP(H, p) {
    const k = C.niveles.indexOf(p);
    return k < 0 ? null : H.niv[k];
  }
  function lluviaVentana(SL, fecha, hora) {
    const sumas = Object.values(SL.pp).map((arr) => {
      let s = 0, n = 0;
      for (let h = hora - 2; h <= hora + 3; h++) {
        const k = SL.times.indexOf(`${fecha}T${pad(h)}`);
        if (k >= 0 && esNum(arr[k])) { s += arr[k]; n++; }
      }
      return n >= 4 ? s : null;
    });
    return mediana(sumas);
  }

  // Techo "experto" con la mediana de los modelos:
  //  - tope térmico: el aire del suelo (T a 2 m) sube enfriándose 9,8 °C/km hasta
  //    quedar más frío que el ambiente;
  //    (o la capa de mezcla, si es más alta);
  //  - base de cúmulos: 125 m por cada °C de diferencia entre T y rocío en el suelo;
  //  - techo = el más bajo de los dos.
  function techoExperto(pts, elev) {
    const g = pts[0];
    if (!g || pts.length < 2) return { z: elev, tipo: "sin" };
    const T0 = g.T + U.techoExcesoParcela, z0 = g.z;
    const exceso = (p) => T0 - (9.8 * (p.z - z0)) / 1000 - p.T;
    let zTerm = pts[pts.length - 1].z;
    for (let i = 1; i < pts.length; i++) {
      const b = exceso(pts[i]);
      if (b <= 0) {
        const a = exceso(pts[i - 1]);
        const f = a > 0 && a > b ? a / (a - b) : 0;
        zTerm = pts[i - 1].z + f * (pts[i].z - pts[i - 1].z);
        break;
      }
    }
    // Capa de mezcla: desde el suelo, mientras la temperatura baje al menos
    // "lapsoMezcla" °C/km entre alturas consecutivas. Respaldo por si la T a 2 m
    // de los modelos no es coherente con el perfil.
    // (se saltea el tramo 2 m → primer nivel, que en los modelos suele ser poco fiable)
    let zMezcla = pts.length > 1 ? pts[1].z : z0;
    for (let i = 2; i < pts.length; i++) {
      const lapso = ((pts[i - 1].T - pts[i].T) * 1000) / Math.max(1, pts[i].z - pts[i - 1].z);
      if (lapso < U.lapsoMezcla) break;
      zMezcla = pts[i].z;
    }
    zTerm = Math.max(zTerm, zMezcla);
    const zBase = esNum(g.Td) ? z0 + U.lclMetrosPorGrado * Math.max(0, g.T - g.Td) : Infinity;
    if (Math.min(zTerm, zBase) <= elev + 100) return { z: elev, tipo: "sin", zTerm, zBase };
    if (zBase < zTerm) return { z: zBase, tipo: "cumulos", zTerm, zBase };
    return { z: zTerm, tipo: "azul", zTerm, zBase };
  }

  // Techo de una hora sin suavizar, con el método elegido en config.js
  function techoCrudo(SL, fecha, hora) {
    const H = SL.horas[`${fecha}T${pad(hora)}`];
    if (!H) return null;
    if (U.metodoTecho === "rocio") return calcularTecho(puntosSondeo(H, SL.elev).pts, SL.elev);
    return techoExperto(puntosSondeo(H, SL.elev, true).pts, SL.elev);
  }

  // Suavizado: mediana de la hora anterior, la actual y la siguiente
  // (elimina saltos aislados sin borrar la subida de la tarde)
  function techoSuavizado(SL, fecha, hora) {
    const actual = techoCrudo(SL, fecha, hora);
    if (!U.suavizarTecho || !actual) return actual;
    const c = [hora - 1, hora, hora + 1].map((h) => techoCrudo(SL, fecha, h)).filter(Boolean)
      .sort((a, b) => a.z - b.z);
    return c.length === 3 ? c[1] : c[0];
  }

  // Altura volable con la fórmula alternativa (sin _zVol): la altura más alta,
  // subiendo desde el suelo sin cortes, donde la térmica del aire supera el umbral
  function alturaVolable(term, H, elev) {
    if (term && "_zVol" in term) return term._zVol;
    const niv = C.niveles.map((p, k) => ({ p, z: H.niv[k] && H.niv[k].z }))
      .filter((n) => esNum(n.z) && esNum(term[n.p])).sort((x, y) => x.z - y.z);
    let ultimo = null;
    for (const n of niv) {
      if (term[n.p] + U.hundimientoParapente >= U.alturaVolableUmbral) ultimo = n.z;
      else if (ultimo !== null) break;
    }
    return ultimo;
  }

  function analizarHora(L, A, fecha, hora) {
    let term;
    const SL = A.lugares[L.id];
    if (!SL) return null;
    const H = SL.horas[`${fecha}T${pad(hora)}`];
    if (!H) return null;
    const elev = SL.elev;

    // Techo y sondeo
    const { pts, fuente } = puntosSondeo(H, elev);
    const techo = techoSuavizado(SL, fecha, hora);
    const sondeo = calcularSondeo(pts, techo.z);
    sondeo.descenso = descensoMediana(H, elev, techo.z);
    const nMin = nivelP(H, L.techoMinHPa);
    const zMin = nMin && esNum(nMin.z) ? nMin.z : zISA(L.techoMinHPa);
    const sTecho = techo.z >= zMin ? 1 : clamp01((techo.z - elev) / Math.max(1, zMin - elev));

    // Viento en los niveles configurados (sobre el terreno y hasta el techo)
    const cfgs = L.viento
      .map((cfg) => ({ cfg, n: nivelP(H, cfg.hPa) }))
      // Los niveles configurados se evalúan siempre, aunque el terreno de las
      // coordenadas quede por encima (la presión manda, como en la configuración)
      .filter((x) => x.n && esNum(x.n.z) && esNum(x.n.ws))
      .sort((a, b) => a.n.z - b.n.z);
    let evals = [];
    cfgs.forEach((x, i) => {
      const evaluado = i === 0 || x.n.z <= techo.z;
      const fuera = esNum(x.n.wd) ? gradosFuera(x.n.wd, dirsDe(x.cfg)) : 0;
      const sDir = puntajeDir(fuera, i === 0 ? U.dirGradosCeroBase : U.dirGradosCero);
      const max = x.cfg.max;
      const sVel = x.n.ws <= max ? 1 : clamp01(1 - (x.n.ws - max) / ((U.velFactorCero - 1) * max));
      evals.push({
        p: x.cfg.hPa, z: x.n.z, ws: x.n.ws, wd: x.n.wd, max, dirs: x.cfg.dirs,
        fuera, sDir, sVel, s: sDir * sVel, evaluado, base: i === 0,
      });
    });
    if (!evals.length && L.viento.length && esNum(H.sup.ws)) {
      // Todos los niveles quedaron bajo el terreno: se usa el viento a 10 m
      const cfg = L.viento[0];
      const fuera = esNum(H.sup.wd) ? gradosFuera(H.sup.wd, dirsDe(cfg)) : 0;
      const sDir = puntajeDir(fuera, U.dirGradosCeroBase);
      const sVel = H.sup.ws <= cfg.max ? 1 : clamp01(1 - (H.sup.ws - cfg.max) / ((U.velFactorCero - 1) * cfg.max));
      evals = [{ p: null, z: elev, ws: H.sup.ws, wd: H.sup.wd, max: cfg.max, dirs: cfg.dirs,
                 fuera, sDir, sVel, s: sDir * sVel, evaluado: true, base: true }];
    }
    const ev = evals.filter((e) => e.evaluado);
    const base = ev.find((e) => e.base) || null;
    // Viento en altura (calidad): promedio de los niveles evaluados por encima del despegue
    const arriba = ev.filter((e) => !e.base);
    const sVientoAltura = arriba.length ? arriba.reduce((s, e) => s + e.s, 0) / arriba.length : 1;
    // Racha en el suelo: debe ser menor que rachaSueloMax en todos los lugares
    const racha = H.sup.gust;
    const rachaFuerte = esNum(racha) && racha >= U.rachaSueloMax;

    // Nubes
    const cum = techo.tipo === "cumulos";
    let ccBajoTecho = null, sBaja;
    if (cum) {
      const bajo = H.niv.filter((n) => esNum(n.z) && n.z > elev && n.z <= techo.z - 300 && esNum(n.cc)).map((n) => n.cc);
      ccBajoTecho = bajo.length ? Math.max(...bajo) : null;
      sBaja = Math.min(puntajeCapa(ccBajoTecho, U.nubesBajas), puntajeCapa(H.sup.cl, U.nubesBajasConCumulos));
    } else {
      sBaja = puntajeCapa(H.sup.cl, U.nubesBajas);
    }
    const sMed = puntajeCapa(H.sup.cm, U.nubesMedias);
    const sAlt = puntajeCapa(H.sup.ch, U.nubesAltas);
    const wn = U.pesoNubes;
    const sNubes = (wn.bajas * sBaja + wn.medias * sMed + wn.altas * sAlt) / (wn.bajas + wn.medias + wn.altas);

    // Lluvia (para las 15 hs: acumulado 12–18 hs)
    const mm = lluviaVentana(SL, fecha, hora);
    const sLluvia = !esNum(mm) || mm < U.lluviaOk ? 1 : clamp01((U.lluviaCero - mm) / (U.lluviaCero - U.lluviaOk));

    // % = Calidad del día (suma ponderada) × Llave de despegue (el peor factor)
    const sDespegue = Math.min(base ? base.sDir : 1, base ? base.sVel : 1, rachaFuerte ? 0 : 1);
    const llave = Math.min(sDespegue, sLluvia);
    const calidadPartes = { viento: sVientoAltura, sondeo: sondeo.ok ? 1 : 0, techo: sTecho, nubes: sNubes };
    const P = C.pesos;
    const sumaP = Object.values(P).reduce((s, x) => s + x, 0) || 1;
    const calidad = Object.keys(P).reduce((s, k) => s + P[k] * (calidadPartes[k] ?? 1), 0) / sumaP;
    const pct = Math.round(100 * calidad * llave);
    const partes = { despegue: sDespegue, ...calidadPartes, lluvia: sLluvia };

    // Razones (lo que no cumple)
    const razones = [];
    ev.forEach((e) => {
      if (e.s >= 0.999) return;
      let t = `Viento a ${fmtM(e.z)}: ${dirLabel(e.wd)} ${Math.round(e.ws)} km/h`;
      const det = [];
      if (e.sDir < 0.999) det.push(`dirección no útil (útiles: ${e.dirs})`);
      if (e.sVel < 0.999) det.push(`supera ${e.max} km/h`);
      razones.push(`${t} — ${det.join(", ")}`);
    });
    if (!sondeo.ok) {
      razones.push(esNum(sondeo.descenso)
        ? `Sondeo no aprobado (descenso prom. temp. capa útil: ${fmt1(-sondeo.descenso / 10)} °C/100 m)`
        : `Sondeo no aprobado: ${sondeo.motivo || "sin datos"}`);
    }
    if (sTecho < 0.999) razones.push(`${etiquetaTecho(techo)} ${fmtTecho(techo)}, por debajo del mínimo de ${fmtM(zMin)}`);
    if (sBaja < 0.999) {
      razones.push(cum && esNum(ccBajoTecho) && ccBajoTecho > U.nubesBajas
        ? `Nubes por debajo del techo: ${Math.round(ccBajoTecho)}%`
        : `Nubes bajas: ${Math.round(H.sup.cl)}%`);
    }
    if (sMed < 0.999) razones.push(`Nubes medias: ${Math.round(H.sup.cm)}%`);
    if (sAlt < 0.999) razones.push(`Nubes altas: ${Math.round(H.sup.ch)}%`);
    if (rachaFuerte) razones.push(`Racha en el suelo: ${Math.round(racha)} km/h (debe ser menor a ${U.rachaSueloMax})`);
    if (sLluvia < 0.999) razones.push(`Lluvia ${hora - 3}–${hora + 3} hs: ${fmt1(mm)} mm`);

    return {
      hora, pct, partes, calidad, llave, razones, techo, zMin, sondeo, fuente, pts, evals, base,
      ptsMed: puntosSondeo(H, elev, true).pts,
      termicas: (term = termicas(H, elev, techo.z)),
      zVol: alturaVolable(term, H, elev),
      mm, H, elev, conf: confianza(H, base, U), cum, ccBajoTecho,
    };
  }

  // Escala de tres niveles (pulgar arriba / medio / abajo)
  function nivelParte(x) {
    return x >= U.emojiBien ? "bien" : x >= U.emojiMedio ? "medio" : "mal";
  }
  function nivelSondeo(sd) {
    return sd.ok ? "bien" : sd.okT || sd.okTd ? "medio" : "mal";
  }

  function confianza(H, base, U) {
    const lst = (base && base.p && H.vm && H.vm[base.p]) || [];
    const dirs = lst.filter((a) => a[0] >= 3 && esNum(a[1])).map((a) => a[1]);
    const spread = dirs.length && base && esNum(base.wd)
      ? dirs.reduce((s, d) => s + angDiff(d, base.wd), 0) / dirs.length : 0;
    const sig = desvio(lst.map((a) => a[0]));
    const n = H.nm;
    let nivel = "media";
    if (n >= U.confAlta.modelos && spread < U.confAlta.dirSpread && sig < U.confAlta.velSigma) nivel = "alta";
    else if (n < U.confBaja.modelos || spread > U.confBaja.dirSpread || sig > U.confBaja.velSigma) nivel = "baja";
    return { nivel, n, spread, sig };
  }

  // -------------------------------------------------------------------
  // Resumen del día (9 a 18 hs)
  // -------------------------------------------------------------------
  function rangos(horas) {
    const out = [];
    horas.forEach((h) => {
      const r = out[out.length - 1];
      if (r && h === r[1] + 1) r[1] = h; else out.push([h, h]);
    });
    return out.map(([a, b]) => (a === b ? `${a} hs` : `${a} a ${b} hs`));
  }

  // Devuelve frases [palabra principal, resto] para mostrar la principal en negrita
  function resumenDia(an) {
    const ref = an[C.horaRef];
    if (!ref) return [["Sin datos", ` para las ${C.horaRef} hs.`]];
    const F = [];
    const hs = Object.keys(an).map(Number).sort((a, b) => a - b);

    // Techo
    let t = ` a las ${C.horaRef} hs: ${fmtTecho(ref.techo)}`;
    let mejor = null;
    hs.filter((h) => h > C.horaRef).forEach((h) => {
      if (!mejor || an[h].techo.z > mejor.techo.z) mejor = an[h];
    });
    if (mejor && mejor.techo.z > ref.techo.z + 200) t += `; sube a ${fmtM(mejor.techo.z)} a las ${mejor.hora} hs`;
    else {
      const baja = hs.filter((h) => h > C.horaRef).map((h) => an[h]).find((a) => a.techo.z < ref.techo.z - 300);
      if (baja) t += `; baja a ${fmtM(baja.techo.z)} a las ${baja.hora} hs`;
    }
    F.push([etiquetaTecho(ref.techo), t + "."]);
    F.push(["Altura volable", `: ${fmtVolable(ref.zVol)}.`]);

    // Ventana volable
    const vol = hs.filter((h) => an[h].pct >= 50);
    F.push(vol.length ? ["Ventana volable", `: ${rangos(vol).join(", ")}.`] : ["Sin ventana volable", "."]);

    // Viento en el despegue
    const despegue = (a) => a.base;
    const manana = hs.filter((h) => h < C.horaRef && h >= 11 && despegue(an[h]) && despegue(an[h]).sDir === 0);
    if (manana.length) F.push(["Viento en el despegue", `: no útil hasta las ${manana[manana.length - 1]} hs.`]);
    const post = hs.filter((h) => h > C.horaRef).find((h) => despegue(an[h]) && despegue(an[h]).sDir === 0);
    if (post) {
      const b = despegue(an[post]);
      F.push(["Viento en el despegue", `: desde las ${post} hs pasa a ${dirLabel(b.wd)} ${Math.round(b.ws)} km/h (${fmtM(b.z)}), fuera de las direcciones útiles; complica aterrizar o redespegar ahí.`]);
    } else {
      const fuerte = hs.filter((h) => h > C.horaRef).find((h) => despegue(an[h]) && despegue(an[h]).sVel === 0);
      if (fuerte) F.push(["Viento en el despegue", `: sube a ${Math.round(despegue(an[fuerte]).ws)} km/h desde las ${fuerte} hs.`]);
    }

    // Cambios bruscos (cada 2 h) en los niveles configurados
    const cambios = [];
    for (const h of hs) {
      const a = an[h], b = an[h + 2];
      if (!b) continue;
      a.evals.forEach((ea) => {
        const eb = b.evals.find((e) => e.p === ea.p);
        if (!eb) return;
        const dv = Math.abs(eb.ws - ea.ws);
        const dd = esNum(ea.wd) && esNum(eb.wd) && ea.ws >= 8 && eb.ws >= 8 ? angDiff(ea.wd, eb.wd) : 0;
        if ((dv >= U.cambioVel || dd >= U.cambioDir) && cambios.length < 2 && !cambios.some((c) => c.p === ea.p)) {
          cambios.push({ p: ea.p });
          F.push(["Cambio brusco", ` a ${fmtM(ea.z)} entre las ${h} y las ${h + 2} hs: de ${dirLabel(ea.wd)} ${Math.round(ea.ws)} a ${dirLabel(eb.wd)} ${Math.round(eb.ws)} km/h.`]);
        }
      });
    }

    // Nubes
    const nub = (a) => {
      const s = a.H.sup, limB = a.cum ? U.nubesBajasConCumulos : U.nubesBajas;
      if (esNum(s.cl) && s.cl > limB) return `nubes bajas ${Math.round(s.cl)}%`;
      if (esNum(s.cm) && s.cm > U.nubesMedias) return `nubes medias ${Math.round(s.cm)}%`;
      if (esNum(s.ch) && s.ch > U.nubesAltas) return `nubes altas ${Math.round(s.ch)}%`;
      return null;
    };
    const hn = hs.find((h) => nub(an[h]));
    if (hn !== undefined) F.push(["Nublado", hn === hs[0] ? ` desde la mañana (${nub(an[hn])}).` : ` desde las ${hn} hs (${nub(an[hn])}).`]);

    // Lluvia
    const hl = hs.find((h) => esNum(an[h].H.sup.pp) && an[h].H.sup.pp >= U.lluviaHoraAviso);
    if (hl !== undefined) F.push(["Lluvia", ` desde las ${hl} hs (${fmt1(ref.mm || 0)} mm entre las 12 y las 18 hs).`]);

    // Sobredesarrollo
    const hs2 = hs.find((h) => esNum(an[h].H.sup.cape) && an[h].H.sup.cape >= U.capeSobredesarrollo &&
      (an[h].techo.tipo === "humedo" || an[h].techo.tipo === "cumulos"));
    if (hs2 !== undefined) F.push(["Sobredesarrollo", `: riesgo desde las ${hs2} hs (CAPE ${an[hs2].H.sup.cape} J/kg).`]);

    // Racha en el suelo
    if (esNum(ref.H.sup.gust)) {
      const g = Math.round(ref.H.sup.gust);
      F.push(["Racha", ` en el suelo a las ${C.horaRef} hs: ${g} km/h${ref.H.sup.gust >= U.rachaSueloMax ? ` (supera ${U.rachaSueloMax})` : ""}.`]);
    }
    return F;
  }

  function analizarTodo(A) {
    const R = {};
    C.lugares.forEach((L) => {
      R[L.id] = {};
      A.dias.forEach((f) => {
        const an = {};
        for (let h = C.horaIni; h <= C.horaFin; h++) {
          const a = analizarHora(L, A, f, h);
          if (a) an[h] = a;
        }
        R[L.id][f] = { an, resumen: resumenDia(an) };
      });
    });
    return R;
  }

  // -------------------------------------------------------------------
  // Formatos
  // -------------------------------------------------------------------
  const nf1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  function fmt1(x) { return esNum(x) ? nf1.format(x) : "—"; }
  function fmtM(z) { return esNum(z) ? `${nf0.format(Math.round(z / 100) * 100)} m` : "—"; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  const etiquetaTecho = (t) => (t.tipo === "cumulos" ? "Base nube" : "Techo");
  const fmtVolable = (z) => (esNum(z) ? fmtM(z) : "sin térmica útil");
  function fmtTecho(t) {
    switch (t.tipo) {
      case "cumulos": return fmtM(t.z);
      case "validado": return fmtM(t.z);
      case "humedo": return `${fmtM(U.techoBuscarHasta)} o más (aire húmedo en altura)`;
      case "azul": return `${fmtM(t.z)} (térmica azul)`;
      default: return "sin techo útil";
    }
  }
  const hue = (pct) => Math.round(Math.max(0, Math.min(100, pct)) * 1.2);

  // API para pruebas en Node
  const API = {
    mediana, angDiff, dirLabel, aUV, deUV, rocio, pendiente, calcularTecho, calcularSondeo,
    procesar, analizarHora, analizarTodo, resumenDia, urlModelo, variables, fmtTecho, fmtM,
  };
  root.PT = API;
  if (typeof module !== "undefined") module.exports = API;
  if (typeof document === "undefined") return;

  // ===================================================================
  // PANTALLA
  // ===================================================================
  const CLAVE = "pronoTermico:v4";
  const S = { A: null, R: null, tab: "resumen", hora: {}, ampliado: {}, cargando: false, errores: {} };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function hoyAR() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  }
  const DIAS_C = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const DIAS_L = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  function infoDia(f) {
    const [y, m, d] = f.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const hoy = hoyAR();
    const [hy, hm, hd] = hoy.split("-").map(Number);
    const dif = Math.round((dt - new Date(hy, hm - 1, hd)) / 86400000);
    const corto = dif === 0 ? "Hoy" : dif === 1 ? "Mañana" : `${cap(DIAS_C[dt.getDay()])} ${d}`;
    return { corto, largo: `${DIAS_L[dt.getDay()]} ${d}/${m}`, sub: `${DIAS_C[dt.getDay()]} ${d}/${m}` };
  }
  function diasVisibles() {
    const hoy = hoyAR();
    return S.A ? S.A.dias.filter((f) => f >= hoy) : [];
  }

  function firma() {
    return JSON.stringify([C.modelos, C.niveles, C.dias, C.horaIni, C.horaFin, C.modeloSondeo,
      C.lugares.map((l) => [l.id, l.lat, l.lon, l.viento.map((v) => v.hPa), l.techoMinHPa])]);
  }
  function leerCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CLAVE) || "null");
      return c && c.firma === firma() ? c : null;
    } catch (e) { return null; }
  }
  function guardarCache(A, errores) {
    try { localStorage.setItem(CLAVE, JSON.stringify({ firma: firma(), A, errores })); } catch (e) { /* sin espacio */ }
  }

  // ---------- Estado / progreso ----------
  function htmlEstado(hechos, estado, msg) {
    const total = C.modelos.length;
    const lista = C.modelos.map((m) => {
      const e = estado[m];
      const ic = e === "ok" ? "✓" : e === "error" ? "✗" : e === "bajando" ? "…" : "·";
      return `<span class="m m-${e}">${NOMBRE_MODELO[m] || m} ${ic}</span>`;
    }).join("");
    return `<div class="prog"><div class="prog-t">Descargando modelos ${hechos}/${total}${msg ? " · " + esc(msg) : ""}</div>
      <div class="barra"><i style="width:${(100 * hechos) / total}%"></i></div><div class="ms">${lista}</div></div>`;
  }
  function htmlEstadoListo() {
    const A = S.A;
    const hhmm = (t) => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
    const errs = Object.keys(S.errores || {});
    const viejo = Date.now() - A.creado > C.cacheMinutos * 60000;
    const prox = A.proxima ? ` · Próx. actual. recom.: ${hhmm(A.proxima)}hs` : "";
    return `<div class="listo"><span>Datos de ${hhmm(A.creado)}hs${viejo ? " (viejos)" : ""}${prox}</span>
      <button class="btn-sec" data-act="actualizar" ${S.cargando ? "disabled" : ""}>Actualizar</button></div>
      ${errs.length ? `<div class="errs">Sin datos de ${errs.map((m) => `${NOMBRE_MODELO[m] || m} (${esc(S.errores[m])})`).join(", ")}.</div>` : ""}
      ${!A.modelos.includes(C.modeloSondeo) ? `<div class="errs">GFS no respondió: el techo y el sondeo usan la mediana de los demás modelos.</div>` : ""}`;
  }

  async function actualizar() {
    if (S.cargando) return;
    S.cargando = true;
    const est = $("#estado");
    const prev = S.A ? htmlEstadoListo() : "";
    est.innerHTML = htmlEstado(0, Object.fromEntries(C.modelos.map((m) => [m, "espera"])));
    try {
      const { ok, err } = await descargarTodo((h, e, msg) => { est.innerHTML = htmlEstado(h, e, msg); });
      if (!Object.keys(ok).length) {
        const detalle = Object.entries(err).map(([m, e]) => `${NOMBRE_MODELO[m] || m}: ${esc(e)}`).join("<br>");
        est.innerHTML = `<div class="error-total"><b>No se pudieron obtener datos de Open-Meteo.</b><br>${detalle}
          <br><button class="btn" data-act="actualizar">Reintentar</button></div>` + (S.A ? `<div class="errs">Se muestran los datos anteriores.</div>` : "");
        S.cargando = false;
        if (S.A) render();
        return;
      }
      S.A = procesar(ok);
      try { S.A.proxima = await proximaActualizacion(); } catch (e) { S.A.proxima = null; }
      S.errores = err;
      S.R = analizarTodo(S.A);
      guardarCache(S.A, err);
    } catch (e) {
      est.innerHTML = `<div class="error-total"><b>Error al procesar los datos:</b> ${esc(e.message)}
        <br><button class="btn" data-act="actualizar">Reintentar</button></div>${prev}`;
      S.cargando = false;
      return;
    }
    S.cargando = false;
    render();
  }

  // ---------- Vistas ----------
  function render() {
    if (!S.A) return;
    if (!S.cargando) $("#estado").innerHTML = htmlEstadoListo();
    const dias = diasVisibles();
    if (S.tab !== "resumen" && !dias.includes(S.tab)) S.tab = "resumen";
    $("#tabs").innerHTML = [`<button data-act="tab" data-tab="resumen" class="${S.tab === "resumen" ? "on" : ""}">Resumen</button>`]
      .concat(dias.map((f) => `<button data-act="tab" data-tab="${f}" class="${S.tab === f ? "on" : ""}">${infoDia(f).corto}</button>`))
      .join("");
    $("#vista").innerHTML = S.tab === "resumen" ? htmlResumen(dias) : htmlDia(S.tab);
  }

  function ordenados(f) {
    return C.lugares
      .map((L) => ({ L, a: S.R[L.id] && S.R[L.id][f] && S.R[L.id][f].an[C.horaRef] }))
      .sort((x, y) => (y.a ? y.a.pct : -1) - (x.a ? x.a.pct : -1));
  }

  function htmlResumen(dias) {
    const filas = dias.map((f) => {
      const d = infoDia(f);
      const chips = ordenados(f).map(({ L, a }) => a
        ? `<span class="chip" style="--h:${hue(a.pct)}">${esc(L.nombre)} <b>${a.pct}</b></span>`
        : `<span class="chip sd">${esc(L.nombre)} —</span>`).join("");
      return `<li><button class="dia-fila" data-act="tab" data-tab="${f}">
        <span class="dia-n">${d.corto}<small>${d.sub}</small></span><span class="chips">${chips}</span></button></li>`;
    }).join("");
    return `<h2 class="tit">Próximos ${dias.length} días · ${C.horaRef} hs</h2>
      <p class="nota">% de vuelo por lugar, de mayor a menor. Tocá un día para ver el detalle.</p>
      <ol class="dias">${filas}</ol>`;
  }

  function htmlDia(f) {
    const d = infoDia(f);
    const cards = ordenados(f).map(({ L }) => htmlTarjeta(L, f)).join("");
    return `<h2 class="tit">${d.largo} · ${C.horaRef} hs</h2>${cards}`;
  }

  function htmlTimeline(L, f, hSel) {
    const an = S.R[L.id][f].an;
    let out = "";
    for (let h = C.horaIni; h <= C.horaFin; h++) {
      const a = an[h];
      out += a
        ? `<button class="th ${h === hSel ? "sel" : ""}" style="--h:${hue(a.pct)}" data-act="hora" data-l="${L.id}" data-f="${f}" data-h="${h}" title="${h} hs: ${a.pct}%"><b>${h}</b><span>${a.pct}</span></button>`
        : `<span class="th sd"><b>${h}</b><span>—</span></span>`;
    }
    return `<div class="timeline" aria-label="Evolución por hora">${out}</div>`;
  }

  function htmlTarjeta(L, f) {
    const D = S.R[L.id] && S.R[L.id][f];
    const a15 = D && D.an[C.horaRef];
    if (!a15) {
      return `<section class="card" id="card-${L.id}"><header class="card-h"><div class="pct sd">—</div>
        <div><h3>${esc(L.nombre)}</h3><div class="sub">Sin datos para este día</div></div></header></section>`;
    }
    const k = `${L.id}|${f}`;
    const hSel = S.hora[k] || C.horaRef;
    const a = D.an[hSel] || a15;
    const plegado = a15.pct < 50 && !S.ampliado[k];
    const head = `<header class="card-h">
      <div class="pct" style="--h:${hue(a15.pct)}">${a15.pct}<small>%</small></div>
      <div class="card-t"><h3>${esc(L.nombre)}</h3>
        <span class="sub">${etiquetaTecho(a15.techo)}: ${fmtTecho(a15.techo)} · Altura volable: ${fmtVolable(a15.zVol)} · confianza ${a15.conf.nivel} · ${a15.conf.n} modelos</span></div></header>`;

    if (plegado) {
      const raz = a15.razones.length ? a15.razones : ["Suma de parámetros parciales por debajo del 50%"];
      return `<section class="card baja" id="card-${L.id}">${head}
        <ul class="razones">${raz.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        ${htmlTimeline(L, f, null)}
        <button class="btn-sec ancho" data-act="ampliar" data-k="${k}">Ver detalle</button></section>`;
    }
    return `<section class="card" id="card-${L.id}">${head}
      ${htmlTimeline(L, f, hSel)}
      ${htmlDetalle(L, a, D.resumen)}
      ${a15.pct < 50 ? `<button class="btn-sec ancho" data-act="plegar" data-k="${k}">Ocultar detalle</button>` : ""}
    </section>`;
  }

  // La tabla muestra la velocidad del aire (como SkySight) o el ascenso neto del parapente
  const valorTermica = (neta) => (U.termicaMostrar === "neta" ? neta : Math.max(0, neta + U.hundimientoParapente));

  function flecha(wd) {
    if (!esNum(wd)) return "";
    return `<svg class="flecha" viewBox="0 0 24 24" style="transform:rotate(${Math.round((wd + 180) % 360)}deg)" aria-hidden="true"><path d="M12 2l6 9h-4v11h-4V11H6z"/></svg>`;
  }

  function htmlDetalle(L, a, resumen) {
    const nombres = { despegue: "Despegue", viento: "Viento", sondeo: "Sondeo", techo: "Techo", nubes: "Nubes", lluvia: "Lluvia" };
    const chips = Object.keys(nombres).map((k) => {
      const n = k === "sondeo" ? nivelSondeo(a.sondeo) : nivelParte(a.partes[k] ?? 1);
      const h = n === "bien" ? 110 : n === "medio" ? 50 : 5;
      return `<span class="parte" style="--h:${h}">${nombres[k]} <span class="emo">${U.emojis[n]}</span></span>`;
    }).join("");
    const nota = a.hora !== C.horaRef ? `<div class="viendo">Viendo las ${a.hora} hs · ${a.pct}% a esa hora</div>` : "";

    // Tabla: niveles sobre el terreno hasta el techo + uno por encima
    const evalPorP = {};
    a.evals.forEach((e) => { if (e.p) evalPorP[e.p] = e; });
    const sobre = a.H.niv.filter((n) => esNum(n.z) && (n.z > a.elev + 50 || (evalPorP[n.p] && evalPorP[n.p].evaluado)))
      .sort((x, y) => x.z - y.z);
    const bajoTerreno = a.base && a.base.p && a.base.z <= a.elev + 10
      ? `<p class="nota-terreno">Terreno ${fmtM(a.elev)} > despegue ${fmtM(a.base.z)}</p>` : "";
    const i0 = sobre.findIndex((n) => n.z > a.techo.z + 1);
    const vis = (i0 < 0 ? sobre : sobre.slice(0, i0 + 1)).reverse();
    let filas = "", sepPuesto = false;
    vis.forEach((n) => {
      if (!sepPuesto && n.z <= a.techo.z + 1) {
        filas += `<tr class="sep"><td colspan="5">${etiquetaTecho(a.techo)}: ${fmtTecho(a.techo)} · Altura volable: ${fmtVolable(a.zVol)}</td></tr>`;
        sepPuesto = true;
      }
      // Solo pantalla: si redondeada coincide con la del suelo, no se muestra la fila
      // (los cálculos no cambian)
      if (Math.round(n.z / 100) === Math.round(a.elev / 100)) return;
      const e = evalPorP[n.p];
      const punto = e && e.evaluado
        ? `<i class="pt" style="--h:${hue(100 * e.s)}" title="${Math.round(100 * e.s)}% · útiles: ${esc(e.dirs)} · máx ${e.max} km/h"></i>` : "";
      filas += `<tr class="${n.z > a.techo.z + 1 ? "arriba" : ""}"><td>${punto}${fmtM(n.z)}</td>
        <td>${esNum(n.ws) ? Math.round(n.ws) : "—"} <small>km/h</small></td>
        <td>${esNum(n.T) ? Math.round(n.T) + "°" : "—"}</td>
        <td><span class="dir">${flecha(n.wd)}${dirLabel(n.wd)}</span></td>
        <td class="term">${esNum(a.termicas[n.p]) ? fmt1(Math.round(valorTermica(a.termicas[n.p]) * 10) / 10 || 0) : ""}</td></tr>`;
    });
    if (!sepPuesto) filas += `<tr class="sep"><td colspan="5">${etiquetaTecho(a.techo)}: ${fmtTecho(a.techo)} · Altura volable: ${fmtVolable(a.zVol)}</td></tr>`;
    const s = a.H.sup;
    filas += `<tr class="suelo"><td>${fmtM(a.elev)} <span class="tag">suelo</span></td>
      <td>${esNum(s.ws) ? Math.round(s.ws) : "—"} <small>km/h</small>${esNum(s.gust) ? ` <small class="racha">r ${Math.round(s.gust)}</small>` : ""}</td>
      <td>${esNum(s.T) ? Math.round(s.T) + "°" : "—"}</td><td><span class="dir">${flecha(s.wd)}${dirLabel(s.wd)}</span></td><td></td></tr>`;

    const sd = a.sondeo;
    const txtSondeo = esNum(sd.descenso)
      ? `Descenso prom. temp. capa útil: <span class="nw">${fmt1(-sd.descenso / 10)} °C/100 m</span>`
      : sd.motivo || "sin datos";

    return `<div class="det">${nota}<div class="partes">${chips}</div>
      <table class="perfil"><thead><tr><th>Altura</th><th>Viento</th><th>Temp</th><th>Dir</th><th class="term">Térmica <small>m/s</small></th></tr></thead><tbody>${filas}</tbody></table>
      ${bajoTerreno}<p class="resumen">${resumen.map(([b, r]) => `<b>${esc(b)}</b>${esc(r)}`).join(" ")}</p>
      <div class="sondeo"><div class="sondeo-t">Sondeo ${a.hora} hs <span class="emo">${U.emojis[nivelSondeo(sd)]}</span> ${txtSondeo}</div>
      ${svgSondeo(a)}
      <div class="leyenda"><span class="lt">— temperatura</span><span class="ltd">— rocío</span><span class="lpa">··· aire del suelo subiendo</span></div></div></div>`;
  }

  // Sondeo inclinado (estilo skew-T simple, sin logaritmos)
  function svgSondeo(a) {
    const pts = a.ptsMed;
    if (pts.length < 2) return "";
    const W = 340, Hh = 190, ml = 36, mr = 6, mt = 6, mb = 16;
    const z0 = Math.floor(a.elev / 500) * 500, z1 = 5500;
    const SK = 8; // °C de inclinación por km
    const xv = (T, z) => T + (SK * (z - z0)) / 1000;
    const vis = pts.filter((p) => p.z <= z1 + 300);
    const xsAll = vis.flatMap((p) => [xv(p.T, p.z), xv(p.Td, p.z)]);
    let xmin = Math.floor((Math.min(...xsAll) - 3) / 5) * 5, xmax = Math.ceil((Math.max(...xsAll) + 3) / 5) * 5;
    const X = (T, z) => ml + ((xv(T, z) - xmin) / (xmax - xmin)) * (W - ml - mr);
    const Y = (z) => mt + (1 - (z - z0) / (z1 - z0)) * (Hh - mt - mb);
    let g = "", txt = "";
    for (let z = Math.ceil(z0 / 1000) * 1000; z <= z1; z += 1000) {
      g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(z)}" y2="${Y(z)}" class="gr"/>`;
      txt += `<text x="${ml - 4}" y="${Y(z) + 3}" class="ax" text-anchor="end">${nf0.format(z)}</text>`;
    }
    const tMin = Math.floor((xmin - SK * (z1 - z0) / 1000) / 5) * 5;
    for (let T = tMin; T <= xmax; T += 5) {
      const xa = X(T, z0), xb = X(T, z1);
      if (xb < ml && xa < ml) continue;
      g += `<line x1="${xa}" y1="${Y(z0)}" x2="${xb}" y2="${Y(z1)}" class="iso"/>`;
      if (xa >= ml && xa <= W - mr) txt += `<text x="${xa}" y="${Hh - 4}" class="ax" text-anchor="middle">${T}°</text>`;
    }
    const linea = (k, cls) => `<polyline class="${cls}" points="${vis.map((p) => `${X(p[k], p.z).toFixed(1)},${Y(p.z).toFixed(1)}`).join(" ")}"/>`;
    const T0 = pts[0].T, zs = pts[0].z;
    let zPa = z1;
    for (let i = 1; i < pts.length; i++) {
      if (T0 - (9.8 * (pts[i].z - zs)) / 1000 <= pts[i].T) { zPa = pts[i].z; break; }
    }
    const parcela = `<line class="pa" x1="${X(T0, zs)}" y1="${Y(zs)}" x2="${X(T0 - 9.8 * (zPa - zs) / 1000, zPa)}" y2="${Y(zPa)}"/>`;
    const suelo = `<rect x="${ml}" y="${Y(a.elev)}" width="${W - ml - mr}" height="${Math.max(0, Y(z0) - Y(a.elev))}" class="tierra"/>`;
    return `<svg class="svg-sondeo" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Sondeo">
      <defs><clipPath id="cl"><rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${Hh - mt - mb}"/></clipPath></defs>
      <g clip-path="url(#cl)">${g}${suelo}${parcela}${linea("Td", "ltd")}${linea("T", "lt")}</g>
      ${txt}<text x="${ml + 3}" y="${mt + 9}" class="ax">m</text><text x="${W - mr - 3}" y="${mt + 9}" class="ax" text-anchor="end">mediana de ${a.H.nm} modelos</text></svg>`;
  }

  // ---------- Eventos ----------
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "actualizar") actualizar();
    else if (act === "tab") {
      S.tab = b.dataset.tab;
      render();
      window.scrollTo({ top: 0 });
    } else if (act === "hora" || act === "ampliar" || act === "plegar") {
      const k = act === "hora" ? `${b.dataset.l}|${b.dataset.f}` : b.dataset.k;
      if (act === "hora") { S.hora[k] = +b.dataset.h; S.ampliado[k] = true; }
      if (act === "ampliar") S.ampliado[k] = true;
      if (act === "plegar") { S.ampliado[k] = false; delete S.hora[k]; }
      const [id, f] = k.split("|");
      const L = C.lugares.find((l) => l.id === id);
      const el = document.getElementById(`card-${id}`);
      if (el && L) el.outerHTML = htmlTarjeta(L, f);
    }
  });

  // ---------- Inicio ----------
  function iniciar() {
    const c = leerCache();
    if (c) {
      S.A = c.A;
      S.errores = c.errores || {};
      S.R = analizarTodo(S.A);
      render();
    }
    const viejo = !c || Date.now() - c.A.creado > C.cacheMinutos * 60000 || !c.A.dias.includes(hoyAR());
    if (viejo) actualizar();
  }
  iniciar();
})(typeof window !== "undefined" ? window : globalThis);
