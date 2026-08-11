/**
 * CUNY subject codes mapped to the department names Rate My Professors uses.
 *
 * This is only ever a *hint*: a matching department nudges a candidate up the
 * ranking, a mismatch costs nothing. Professors frequently teach outside their
 * listed department, so this must never be treated as authoritative.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const SUBJECT_DEPARTMENTS = {
    ACC: 'Accounting', ACCT: 'Accounting',
    AFR: 'African American Studies', AFST: 'African American Studies',
    ANTH: 'Anthropology', ANT: 'Anthropology',
    ARB: 'Arabic', ARAB: 'Arabic',
    ART: 'Fine Arts', ARTH: 'Art History',
    AST: 'Astronomy', ASTR: 'Astronomy',
    BIO: 'Biology', BIOL: 'Biology', BSCI: 'Biology',
    BUS: 'Business', BPL: 'Business',
    CHE: 'Chemistry', CHEM: 'Chemistry',
    CHI: 'Chinese', CHIN: 'Chinese',
    CIS: 'Computer Science', CSC: 'Computer Science', CSCI: 'Computer Science',
    CMP: 'Computer Science', CS: 'Computer Science', CIS_: 'Computer Science',
    COM: 'Communication', COMM: 'Communication', SPE: 'Communication',
    CRJ: 'Criminal Justice', CJBS: 'Criminal Justice', CRJU: 'Criminal Justice',
    ECO: 'Economics', ECON: 'Economics',
    EDU: 'Education', EDUC: 'Education', SEYS: 'Education', EDC: 'Education',
    ENG: 'English', ENGL: 'English',
    ENV: 'Environmental Science', EES: 'Earth Science',
    FIN: 'Finance', FNC: 'Finance',
    FRE: 'French', FREN: 'French',
    GEO: 'Geography', GEOL: 'Geology', GEOG: 'Geography',
    GER: 'German', GERM: 'German',
    GRK: 'Greek',
    HEB: 'Hebrew',
    HIS: 'History', HIST: 'History',
    HLT: 'Health Science', HED: 'Health Science', HSC: 'Health Science',
    HUM: 'Humanities',
    ITL: 'Italian', ITAL: 'Italian',
    JPN: 'Japanese',
    JRN: 'Journalism', JOUR: 'Journalism',
    KOR: 'Korean',
    LAT: 'Latin',
    LAW: 'Law', BLW: 'Business Law',
    LIB: 'Library Science',
    LIN: 'Linguistics', LING: 'Linguistics',
    MAT: 'Mathematics', MATH: 'Mathematics', MTH: 'Mathematics',
    MED: 'Medicine',
    MGT: 'Management', MGMT: 'Management', MHR: 'Management',
    MKT: 'Marketing', MKTG: 'Marketing',
    MUS: 'Music', MUSC: 'Music',
    NUR: 'Nursing', NURS: 'Nursing',
    PHI: 'Philosophy', PHIL: 'Philosophy',
    PHY: 'Physics', PHYS: 'Physics',
    POL: 'Political Science', POLS: 'Political Science', POL_: 'Political Science',
    PSC: 'Political Science', PSCI: 'Political Science',
    PSY: 'Psychology', PSYC: 'Psychology', PSYCH: 'Psychology',
    PUB: 'Public Administration', PAF: 'Public Affairs', PA: 'Public Administration',
    REL: 'Religion', RELI: 'Religion',
    RUS: 'Russian',
    SOC: 'Sociology', SOCI: 'Sociology',
    SPA: 'Spanish', SPAN: 'Spanish',
    STA: 'Statistics', STAT: 'Statistics', STT: 'Statistics',
    THE: 'Theater', THEA: 'Theater', TH: 'Theater',
    WGS: 'Women’s Studies', WS: 'Women’s Studies',
    ENGR: 'Engineering', ENGI: 'Engineering', ME: 'Mechanical Engineering',
    EE: 'Electrical Engineering', CE: 'Civil Engineering',
  };

  /** Pull "ACC 3202" / "CSCI-135" style codes out of arbitrary text. */
  const COURSE_CODE_PATTERN = /\b([A-Z]{2,5})[\s\-_]?\d{3,5}[A-Z]?\b/;

  function subjectFromText(text) {
    if (!text) return null;
    const match = COURSE_CODE_PATTERN.exec(String(text).toUpperCase());
    return match ? match[1] : null;
  }

  function departmentForSubject(subjectCode) {
    if (!subjectCode) return null;
    return SUBJECT_DEPARTMENTS[String(subjectCode).toUpperCase()] || null;
  }

  /** Convenience: text in, RMP-style department name out (or null). */
  function departmentFromText(text) {
    return departmentForSubject(subjectFromText(text));
  }

  RMPX.subjects = {
    SUBJECT_DEPARTMENTS: SUBJECT_DEPARTMENTS,
    subjectFromText: subjectFromText,
    departmentForSubject: departmentForSubject,
    departmentFromText: departmentFromText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.subjects;
})(typeof self !== 'undefined' ? self : globalThis);
