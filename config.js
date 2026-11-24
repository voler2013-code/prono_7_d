// =====================================================================
// CONFIGURACIÓN — se puede editar sin tocar la lógica (app.js)
// =====================================================================
// Velocidades en km/h. Presiones en hPa (solo internas: en pantalla
// siempre se muestran metros, calculados con la altura geopotencial del día).
// Direcciones útiles con la rosa de 16 puntos en castellano:
// N NNE NE ENE E ESE SE SSE S SSO SO OSO O ONO NO NNO

window.CONFIG = {
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

  lugares: [
    {
      id: "merlo", nombre: "Merlo", lat: -32.34, lon: -64.98, techoMinHPa: 800,
      viento: [
        { hPa: 900, max: 14, dirs: "NO ONO O OSO" },
        { hPa: 850, max: 21, dirs: "N NNO NO ONO O OSO" },
        { hPa: 800, max: 21, dirs: "N NNO NO ONO O OSO" },
      ],
    },
    {
      id: "npaula", nombre: "N.Paula", lat: -31.72, lon: -65.00, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 15, dirs: "NNO NO ONO O OSO" },
        { hPa: 800, max: 18, dirs: "NNE N NNO NO ONO O OSO" },
      ],
    },
    {
      id: "pedernera", nombre: "Pedernera", lat: -31.76, lon: -64.65, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 19, dirs: "ENE E ESE SE" },
        { hPa: 800, max: 18, dirs: "NNE NE ENE E ESE SE SSE" },
      ],
    },
    {
      id: "valpina", nombre: "V.Alpina", lat: -32.02, lon: -64.81, techoMinHPa: 800,
      viento: [
        { hPa: 850, max: 19, dirs: "ENE E ESE SE" },
        { hPa: 800, max: 18, dirs: "N NNE NE ENE E ESE SE SSE S" },
      ],
    },
    {
      id: "sjorge", nombre: "S.Jorge", lat: -31.32, lon: -64.34, techoMinHPa: 850,
      viento: [
        { hPa: 950, max: 19, dirs: "E ESE SE" },
        { hPa: 925, max: 20, dirs: "N NNE NE ENE E ESE SE SSE" },
        { hPa: 900, max: 21, dirs: "N NNE NE ENE E ESE SE SSE S" },
        { hPa: 850, max: 21, dirs: "N NNE NE ENE E ESE SE SSE S" },
      ],
    },
    {
      id: "ccorral", nombre: "C.Corral", lat: -30.99, lon: -64.71, techoMinHPa: 800,
      viento: [
        { hPa: 900, max: 18, dirs: "NNO NO ONO O" },
        { hPa: 850, max: 21, dirs: "NE NNE N NNO NO ONO O" },
        { hPa: 800, max: 21, dirs: "ENE NE NNE N NNO NO ONO O" },
      ],
    },
  ],

  // Pesos del % (suman 100)
  pesos: { viento: 35, sondeo: 20, techo: 15, nubes: 15, lluvia: 15 },

  umbrales: {
    // Viento: puntaje completo dentro del sector y hasta "max";
    // llega a 0 a estos grados fuera del sector / a este múltiplo de "max".
    dirGradosCero: 45,         // en altura
    dirGradosCeroBase: 0,      // en el nivel más bajo (despegue): 0 = fuera del sector vale 0
    velFactorCero: 1.5,
    pesoNivelBase: 2,          // el nivel más bajo sobre el terreno pesa doble

    // Nubes (% de cobertura). Pesos internos dentro del parámetro nubes.
    nubesBajas: 60, nubesMedias: 70, nubesAltas: 80,
    nubesBajasConCumulos: 85,  // tolerancia si el techo es base de cúmulos
    pesoNubes: { bajas: 0.5, medias: 0.3, altas: 0.2 },

    // Lluvia acumulada 12–18 hs (mm)
    lluviaOk: 5, lluviaCero: 10,

    // Techo (GFS)
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

    // Tope de % ante fallas graves
    topeFallaGrave: 30,

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
