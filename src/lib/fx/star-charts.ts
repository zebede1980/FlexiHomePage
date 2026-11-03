// Real constellations for the Constellation background to trace now and then.
// Positions are the stars' actual right ascension and declination (degrees),
// projected flat around each figure's centre, so the shapes are true to the sky.

export interface ChartStar {
  /** Position with the figure's longer side scaled to 1, centred on 0,0; y grows downwards. */
  x: number;
  y: number;
  /** Apparent magnitude: lower is brighter. */
  mag: number;
  /** Index into the engine's star colours (0 blue-white … 4 orange). */
  tint: number;
}

export interface Chart {
  name: string;
  gloss: string;
  stars: ChartStar[];
  /** Pairs of indices into `stars`, in the order they are drawn. */
  lines: [number, number][];
}

/** [ra°, dec°, magnitude, tint] */
type Raw = [number, number, number, number];

const RAW: { name: string; gloss: string; stars: Raw[]; lines: [number, number][] }[] = [
  {
    name: 'The Plough',
    gloss: 'Ursa Major',
    // Alkaid, Mizar, Alioth, Megrez, Phecda, Merak, Dubhe
    stars: [
      [206.89, 49.31, 1.9, 0],
      [200.98, 54.93, 2.2, 1],
      [193.51, 55.96, 1.8, 1],
      [183.86, 57.03, 3.3, 1],
      [178.46, 53.69, 2.4, 1],
      [165.46, 56.38, 2.4, 1],
      [165.93, 61.75, 1.8, 3],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
  },
  {
    name: 'Orion',
    gloss: 'The Hunter',
    // Meissa, Betelgeuse, Bellatrix, Alnitak, Alnilam, Mintaka, Saiph, Rigel
    stars: [
      [83.78, 9.93, 3.4, 0],
      [88.79, 7.41, 0.5, 4],
      [81.28, 6.35, 1.6, 0],
      [85.19, -1.94, 1.8, 0],
      [84.05, -1.2, 1.7, 0],
      [83.0, -0.3, 2.2, 0],
      [86.94, -9.67, 2.1, 0],
      [78.63, -8.2, 0.1, 0],
    ],
    lines: [
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [3, 6],
      [5, 7],
    ],
  },
  {
    name: 'Cassiopeia',
    gloss: 'The Queen',
    // Caph, Schedar, Gamma Cas, Ruchbah, Segin
    stars: [
      [2.29, 59.15, 2.3, 1],
      [10.13, 56.54, 2.2, 3],
      [14.18, 60.72, 2.4, 0],
      [21.45, 60.24, 2.7, 1],
      [28.6, 63.67, 3.4, 0],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
  {
    name: 'Cygnus',
    gloss: 'The Swan',
    // Deneb, Sadr, Albireo, Delta Cyg, Gienah, Zeta Cyg
    stars: [
      [310.36, 45.28, 1.3, 1],
      [305.56, 40.26, 2.2, 3],
      [292.68, 27.96, 3.1, 3],
      [296.24, 45.13, 2.9, 0],
      [311.55, 33.97, 2.5, 3],
      [318.23, 30.23, 3.2, 3],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [3, 1],
      [1, 4],
      [4, 5],
    ],
  },
  {
    name: 'Leo',
    gloss: 'The Lion',
    // Mu, Ras Elased, Adhafera, Algieba, Eta Leo, Regulus, Chertan, Denebola, Zosma
    stars: [
      [148.19, 26.01, 3.9, 4],
      [146.46, 23.77, 3.0, 3],
      [154.17, 23.42, 3.4, 1],
      [154.99, 19.84, 2.0, 3],
      [151.83, 16.76, 3.5, 1],
      [152.09, 11.97, 1.4, 0],
      [168.56, 15.43, 3.3, 1],
      [177.26, 14.57, 2.1, 1],
      [168.53, 20.52, 2.6, 1],
    ],
    lines: [
      [1, 0],
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 3],
    ],
  },
  {
    name: 'Lyra',
    gloss: 'The Lyre',
    // Vega, Epsilon Lyr, Zeta Lyr, Delta Lyr, Sulafat, Sheliak
    stars: [
      [279.23, 38.78, 0.0, 0],
      [281.08, 39.67, 4.7, 1],
      [281.19, 37.61, 4.3, 1],
      [283.63, 36.9, 4.3, 4],
      [284.74, 32.69, 3.2, 0],
      [282.52, 33.36, 3.5, 0],
    ],
    lines: [
      [0, 1],
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 2],
    ],
  },
  {
    name: 'Gemini',
    gloss: 'The Twins',
    // Castor, Pollux, Mebsuta, Tejat, Wasat, Alhena
    stars: [
      [113.65, 31.89, 1.6, 1],
      [116.33, 28.03, 1.1, 3],
      [100.98, 25.13, 3.0, 3],
      [95.74, 22.51, 2.9, 4],
      [110.03, 21.98, 3.5, 1],
      [99.43, 16.4, 1.9, 1],
    ],
    lines: [
      [0, 1],
      [0, 2],
      [2, 3],
      [1, 4],
      [4, 5],
    ],
  },
];

/** Flat projection around the figure's centre: east is to the left, as when looking up. */
function project(raw: Raw[]): ChartStar[] {
  const ra0 = raw.reduce((s, r) => s + r[0], 0) / raw.length;
  const dec0 = raw.reduce((s, r) => s + r[1], 0) / raw.length;
  const k = Math.cos((dec0 * Math.PI) / 180);
  const pts = raw.map(([ra, dec]) => [-(ra - ra0) * k, -(dec - dec0)]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return pts.map(([x, y], i) => ({ x: (x - cx) / span, y: (y - cy) / span, mag: raw[i][2], tint: raw[i][3] }));
}

export const CHARTS: Chart[] = RAW.map((c) => ({ name: c.name, gloss: c.gloss, stars: project(c.stars), lines: c.lines }));
