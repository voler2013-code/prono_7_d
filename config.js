// =====================================================================
// CONFIGURACIÓN — se puede editar sin tocar la lógica (app.js)
// =====================================================================
// Velocidades en km/h. Presiones en hPa (solo internas: en pantalla
// siempre se muestran metros, calculados con la altura geopotencial del día).
// Direcciones útiles con la rosa de 16 puntos en castellano:
// N NNE NE ENE E ESE SE SSE S SSO SO OSO O ONO NO NNO

window.CONFIG = {
  // API paga de Open-Meteo: se usa primero; si falla, la gratuita.
  // Recomendado: dejar apiKey vacío y cargar la clave desde la app (abajo de todo,
  // "Clave API"): queda guardada solo en el teléfono. Si se escribe acá, queda
  // pública en GitHub y cualquiera podría usar tu cupo.
  apiPaga: { host: "customer-api.open-meteo.com" },
  apiKey: "",

  // Modelos de Open-Meteo para las medianas
  modelos: [
    "icon_seamless",
    "gfs_seamless",
    "meteofrance_seamless",
    "ecmwf_ifs025",
    "ukmo_seamless",
    "gem_seamless",
    "cma_grapes_global",
  ],
  // Único modelo para techo y sondeo
  modeloSondeo: "gfs_seamless",

  // Niveles de presión pedidos (de 1000 a 500 hPa)
  niveles: [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725,
            700, 675, 650, 625, 600, 575, 550, 525, 500],

  dias: 7,          // hoy + 6
  horaRef: 15,      // hora del % de cada lugar
  horaIni: 9,       // evolución del día
  horaFin: 18,
  cacheMinutos: 120,

  // Próxima actualización recomendada (metadatos de Open-Meteo, no cuentan para el límite)
  proximaActualizacion: {
    url: "https://api.open-meteo.com/data/{dominio}/static/meta.json",
    dominios: {
      icon_seamless: "dwd_icon",
      gfs_seamless: "ncep_gfs025",
      meteofrance_seamless: "meteofrance_arpege_world025",
      ecmwf_ifs025: "ecmwf_ifs025",
      ukmo_seamless: "ukmo_global_deterministic_10km",
      gem_seamless: "cmc_gem_gdps",
      cma_grapes_global: "cma_grapes_global",
    },
    minModelos: 5,   // de 7: horario en que ya se actualizó la mayoría
    margenMin: 10,   // Open-Meteo recomienda esperar 10 min tras la disponibilidad
  },

  lugares: [
    {
      id: "merlo", nombre: "Merlo", lat: -32.369, lon: -64.947, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 14, dirs: "NO ONO O OSO" },
        { hPa: 800, max: 21, dirs: "N NNO NO ONO O OSO" },
      ],
    },
    {
      id: "npaula", nombre: "N.Paula", lat: -31.738, lon: -64.924, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 15, dirs: "NNO NO ONO O OSO" },
        { hPa: 800, max: 18, dirs: "NNE N NNO NO ONO O OSO" },
      ],
    },
    {
      id: "pedernera", nombre: "Pedernera", lat: -31.606, lon: -64.687, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 19, dirs: "ENE E ESE SE" },
        { hPa: 800, max: 18, dirs: "NNE NE ENE E ESE SE SSE" },
      ],
    },
    {
      id: "valpina", nombre: "V.Alpina", lat: -31.969, lon: -64.824, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 19, dirs: "ENE E ESE SE" },
        { hPa: 800, max: 18, dirs: "N NNE NE ENE E ESE SE SSE S" },
      ],
    },
    {
      id: "sjorge", nombre: "S.Jorge", lat: -31.318, lon: -64.350, techoMinHPa: 850,
      viento: [
        { hPa: 950, max: 19, dirs: "E ESE SE" },
        { hPa: 925, max: 20, dirs: "N NNE NE ENE E ESE SE SSE" },
        { hPa: 900, max: 21, dirs: "N NNE NE ENE E ESE SE SSE S" },
        { hPa: 850, max: 21, dirs: "N NNE NE ENE E ESE SE SSE S" },
      ],
    },
    {
      id: "ccorral", nombre: "C.Corral", lat: -30.966, lon: -64.586, techoMinHPa: 800,
      viento: [
        { hPa: 900, max: 18, dirs: "NNO NO ONO O" },
        { hPa: 850, max: 21, dirs: "NE NNE N NNO NO ONO O" },
        { hPa: 800, max: 21, dirs: "ENE NE NNE N NNO NO ONO O" },
      ],
    },
  ],

  // % = Calidad del día × Llave de despegue
  // Calidad del día (suma ponderada, suman 100). "viento" = niveles por encima del despegue.
  // La llave de despegue (0 a 1) es el peor de: dirección y velocidad en el despegue,
  // racha en el suelo y lluvia 12–18 hs. Si no se puede despegar, el lugar da 0%.
  pesos: { viento: 30, sondeo: 25, techo: 25, nubes: 20 },

  umbrales: {
    // Viento: puntaje completo dentro del sector y hasta "max";
    // llega a 0 a estos grados fuera del sector / a este múltiplo de "max".
    dirGradosCero: 45,         // en altura
    dirGradosCeroBase: 0,      // en el nivel más bajo (despegue): 0 = fuera del sector vale 0
    velFactorCero: 1.5,
    rachaSueloMax: 30,         // km/h: racha en el suelo igual o mayor → llave de despegue 0

    // Nubes (% de cobertura). Pesos internos dentro del parámetro nubes.
    nubesBajas: 60, nubesMedias: 70, nubesAltas: 80,
    pesoNubes: { bajas: 0.5, medias: 0.3, altas: 0.2 },

    // Lluvia acumulada 12–18 hs (mm)
    lluviaOk: 5, lluviaCero: 10,

    // Techo
    // "experto": con la mediana de los modelos, el más bajo entre el tope térmico
    //   (aire del suelo subiendo a 9,8 °C/km) y la base de cúmulos (125 m por °C
    //   de diferencia entre temperatura y rocío en el suelo).
    // "rocio": el método anterior (primer mínimo T−Td con capa seca arriba, GFS).
    metodoTecho: "experto",
    techoExcesoParcela: 0,     // °C extra del aire del suelo (más = techo más alto)
    lclMetrosPorGrado: 125,
    lapsoMezcla: 7,            // °C/km: capa de mezcla mientras la T baje al menos esto
    suavizarTecho: true,       // mediana de hora anterior, actual y siguiente

    // Solo para metodoTecho "rocio" (GFS)
    techoBuscarDesde: 200,     // m sobre el terreno
    techoBuscarHasta: 4500,    // m s.n.m.
    techoValidarSubida: 2,     // °C que T−Td debe volver a subir...
    techoValidarEn: 800,       // ...dentro de estos metros por encima
    cumulosDifMax: 1.5,        // T−Td en el techo para "base de cúmulos"

    // Sondeo (equivale a tus pendientes -1400..0 y 0..1900)
    sondeoPendTMax: -5.71,     // °C/km: la T debe bajar más que esto
    sondeoPendTdMin: -4.47,    // °C/km: el Td debe bajar menos que esto

    // Pulgares de cada parámetro: arriba desde emojiBien, medio desde emojiMedio
    emojis: { bien: "👍", medio: "🤏", mal: "👎" },
    emojiBien: 0.9, emojiMedio: 0.5,

    // Térmica
    // "deardorff": según el calor que el sol le da al suelo y la altura de la capa (techo).
    // "predelli": la fórmula del script original (contraste de rocío).
    metodoTermica: "deardorff",
    factorCalorRadiacion: 0.35, // si el modelo no da el calor del suelo: % de la radiación solar
    factorNucleo: 0.9,          // ascenso máximo del aire = w* × esto (calibrado con SkySight)
    termicaMostrar: "aire",     // "aire": velocidad del aire (como SkySight) · "neta": menos la caída del parapente
    alturaVolableUmbral: 0.9,   // m/s de aire: altura volable = donde la térmica baja de esto (como SkySight)
    termicaPlenaDesde: 0.1,     // fracción de la capa (suelo→techo) donde la térmica ya es plena...
    termicaPlenaHasta: 0.8,     // ...y desde donde empieza a apagarse hasta 0 en el techo
    hundimientoParapente: 1.1,  // caída del parapente girando (m/s), se resta al ascenso

    // Resumen
    capeSobredesarrollo: 1000, // J/kg
    cambioVel: 10,             // km/h en 2 h
    cambioDir: 45,             // grados en 2 h
    lluviaHoraAviso: 0.5,      // mm/h

    // Confianza
    confAlta: { modelos: 5, dirSpread: 30, velSigma: 5 },
    confBaja: { modelos: 3, dirSpread: 60, velSigma: 10 },
  },
};
