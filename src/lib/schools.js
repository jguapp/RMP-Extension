/**
 * The CUNY campus registry.
 *
 * Rate My Professors identifies a school by an opaque base64 GraphQL node id
 * (for example "U2Nob29sLTEyNTA="). Those ids are not documented and do change,
 * so nothing here hardcodes one -- each campus carries the text we feed to
 * RMP's school search, and the resolved id is cached in chrome.storage.
 *
 * `aliases` are used to sniff the current campus from the page itself, which
 * matters because a student at one college can browse another's catalogue.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const SCHOOLS = [
    {
      key: 'baruch',
      name: 'Baruch College',
      searchText: 'Baruch College',
      aliases: ['baruch', 'bb', 'zicklin'],
      codes: ['BAR', 'BB'],
    },
    {
      key: 'brooklyn',
      name: 'Brooklyn College',
      searchText: 'Brooklyn College',
      aliases: ['brooklyn college'],
      codes: ['BKL', 'BC'],
    },
    {
      key: 'ccny',
      name: 'The City College of New York',
      searchText: 'City College of New York',
      aliases: ['city college of new york', 'ccny', 'city college', 'grove school'],
      codes: ['CTY', 'CC'],
    },
    {
      key: 'csi',
      name: 'College of Staten Island',
      searchText: 'College of Staten Island',
      aliases: ['college of staten island', 'csi', 'staten island'],
      codes: ['CSI', 'SI'],
    },
    {
      key: 'hunter',
      name: 'Hunter College',
      searchText: 'Hunter College',
      aliases: ['hunter college', 'hunter'],
      codes: ['HTR', 'HC'],
    },
    {
      key: 'johnjay',
      name: 'John Jay College of Criminal Justice',
      searchText: 'John Jay College of Criminal Justice',
      aliases: ['john jay', 'criminal justice'],
      codes: ['JJC', 'JJ'],
    },
    {
      key: 'lehman',
      name: 'Lehman College',
      searchText: 'Lehman College',
      aliases: ['lehman college', 'lehman'],
      codes: ['LEH', 'LC'],
    },
    {
      key: 'medgar',
      name: 'Medgar Evers College',
      searchText: 'Medgar Evers College',
      aliases: ['medgar evers', 'medgar'],
      codes: ['MEC', 'ME'],
    },
    {
      key: 'citytech',
      name: 'New York City College of Technology',
      searchText: 'New York City College of Technology',
      aliases: ['city tech', 'citytech', 'college of technology', 'nyctc'],
      codes: ['NYT', 'NY'],
    },
    {
      key: 'queens',
      name: 'Queens College',
      searchText: 'Queens College',
      aliases: ['queens college'],
      codes: ['QNS', 'QC'],
    },
    {
      key: 'york',
      name: 'York College',
      searchText: 'York College CUNY',
      aliases: ['york college'],
      codes: ['YRK', 'YC'],
    },
    {
      key: 'macaulay',
      name: 'Macaulay Honors College',
      searchText: 'Macaulay Honors College',
      aliases: ['macaulay'],
      codes: ['MHC'],
    },
    {
      key: 'sps',
      name: 'CUNY School of Professional Studies',
      searchText: 'CUNY School of Professional Studies',
      aliases: ['school of professional studies', 'cuny sps'],
      codes: ['SPS'],
    },
    {
      key: 'bmcc',
      name: 'Borough of Manhattan Community College',
      searchText: 'Borough of Manhattan Community College',
      aliases: ['borough of manhattan', 'bmcc'],
      codes: ['BMC', 'BM'],
    },
    {
      key: 'bcc',
      name: 'Bronx Community College',
      searchText: 'Bronx Community College',
      aliases: ['bronx community'],
      codes: ['BCC', 'BX'],
    },
    {
      key: 'guttman',
      name: 'Stella and Charles Guttman Community College',
      searchText: 'Guttman Community College',
      aliases: ['guttman'],
      codes: ['GUT'],
    },
    {
      key: 'hostos',
      name: 'Hostos Community College',
      searchText: 'Hostos Community College',
      aliases: ['hostos'],
      codes: ['HOS', 'HO'],
    },
    {
      key: 'kbcc',
      name: 'Kingsborough Community College',
      searchText: 'Kingsborough Community College',
      aliases: ['kingsborough', 'kbcc'],
      codes: ['KCC', 'KB'],
    },
    {
      key: 'laguardia',
      name: 'LaGuardia Community College',
      searchText: 'LaGuardia Community College',
      aliases: ['laguardia', 'la guardia'],
      codes: ['LAG', 'LG'],
    },
    {
      key: 'qcc',
      name: 'Queensborough Community College',
      searchText: 'Queensborough Community College',
      aliases: ['queensborough', 'qcc'],
      codes: ['QCC', 'QB'],
    },
    {
      key: 'gradcenter',
      name: 'CUNY Graduate Center',
      searchText: 'CUNY Graduate Center',
      aliases: ['graduate center', 'gc cuny'],
      codes: ['GRD', 'GC'],
    },
    {
      key: 'law',
      name: 'CUNY School of Law',
      searchText: 'CUNY School of Law',
      aliases: ['school of law', 'cuny law'],
      codes: ['LAW'],
    },
    {
      key: 'journalism',
      name: 'Craig Newmark Graduate School of Journalism',
      searchText: 'CUNY Graduate School of Journalism',
      aliases: ['newmark', 'school of journalism'],
      codes: ['JOU'],
    },
    {
      key: 'publichealth',
      name: 'CUNY Graduate School of Public Health and Health Policy',
      searchText: 'CUNY Graduate School of Public Health',
      aliases: ['public health and health policy', 'sph cuny'],
      codes: ['SPH'],
    },
    {
      key: 'slu',
      name: 'CUNY School of Labor and Urban Studies',
      searchText: 'CUNY School of Labor and Urban Studies',
      aliases: ['labor and urban studies'],
      codes: ['SLU'],
    },
    {
      key: 'medicine',
      name: 'CUNY School of Medicine',
      searchText: 'CUNY School of Medicine',
      aliases: ['school of medicine'],
      codes: ['SOM'],
    },
  ];

  const BY_KEY = new Map(SCHOOLS.map(function (s) { return [s.key, s]; }));

  function getSchool(key) {
    return BY_KEY.get(key) || null;
  }

  function listSchools() {
    return SCHOOLS.slice();
  }

  /**
   * Guess the campus from arbitrary page text.
   *
   * Longer aliases are tested first so "college of staten island" wins over a
   * stray "college". Returns { key, alias, index } or null.
   */
  function detectSchoolFromText(text) {
    if (!text) return null;
    const haystack = String(text).toLowerCase();

    const candidates = [];
    SCHOOLS.forEach(function (school) {
      school.aliases.forEach(function (alias) {
        // Very short aliases would fire on almost anything; require a word
        // boundary and at least three characters.
        if (alias.length < 3) return;
        const index = haystack.indexOf(alias);
        if (index === -1) return;
        const before = index === 0 ? ' ' : haystack[index - 1];
        const after = haystack[index + alias.length] || ' ';
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) return;
        candidates.push({ key: school.key, alias: alias, index: index, length: alias.length });
      });
    });

    if (candidates.length === 0) return null;

    candidates.sort(function (a, b) {
      if (b.length !== a.length) return b.length - a.length;
      return a.index - b.index;
    });
    return candidates[0];
  }

  /** Detect from a CUNYfirst institution code such as "BAR01" or "HTR01". */
  function detectSchoolFromCode(code) {
    if (!code) return null;
    const upper = String(code).toUpperCase().replace(/[^A-Z]/g, '');
    if (!upper) return null;
    let found = null;
    SCHOOLS.forEach(function (school) {
      school.codes.forEach(function (candidate) {
        if (found) return;
        if (upper === candidate || upper.startsWith(candidate)) found = school.key;
      });
    });
    return found;
  }

  RMPX.schools = {
    SCHOOLS: SCHOOLS,
    getSchool: getSchool,
    listSchools: listSchools,
    detectSchoolFromText: detectSchoolFromText,
    detectSchoolFromCode: detectSchoolFromCode,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.schools;
})(typeof self !== 'undefined' ? self : globalThis);
