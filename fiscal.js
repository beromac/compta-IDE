/* ============================================================
   fiscal.js — règles et correspondances fiscales (BNC, infirmière libérale)
   Ce fichier est le SEUL à modifier quand un millésime de formulaire change.
   Sources : guides publics 2026 (impots.gouv.fr, service-public, éditeurs
   comptables). À VÉRIFIER chaque année sur la notice officielle.
   ============================================================ */

// Plafond micro-BNC (recettes HT). 83 600 € pour 2026-2028 (loi de finances 2026),
// 77 700 € auparavant.
const FISCAL_YEARS = {
  2023: { plafond: 77700 }, 2024: { plafond: 77700 }, 2025: { plafond: 77700 },
  2026: { plafond: 83600 }, 2027: { plafond: 83600 }, 2028: { plafond: 83600 },
};
const ABATTEMENT_MICRO = 0.34;   // abattement forfaitaire micro-BNC
const ABATTEMENT_MIN = 305;      // plancher de l'abattement (€)
const SEUIL_2035E = 152500;      // annexe 2035-E (CVAE) au-delà de ce montant de recettes

function fiscalFor(year) {
  const ys = Object.keys(FISCAL_YEARS).map(Number).sort((a, b) => a - b);
  const y = year < ys[0] ? ys[0] : year > ys[ys.length - 1] ? ys[ys.length - 1] : year;
  return FISCAL_YEARS[y];
}

// Numéros de ligne de la 2035-A : volontairement VIDES (les sources publiques
// divergent d'un millésime à l'autre). Renseignez-les ici ou avec votre comptable,
// ex. { recettes: '1', loyer: '15' } : ils s'afficheront alors dans le récapitulatif.
const LIGNES = {};

// ---------- Postes fiscaux ----------
// side: 'recette' | 'depense' | 'hors' (hors total de la 2035)
const POSTES = {
  recettes:      { side: 'recette', form: '2035-A', section: 'Recettes', label: 'Recettes encaissées (honoraires, IFD/IK perçues, y compris remboursements de frais)' },
  gains_divers:  { side: 'recette', form: '2035-A', section: 'Recettes', label: 'Gains divers' },

  retrocedes:    { side: 'depense', form: '2035-A', section: 'Recettes (à déduire)', label: 'Honoraires rétrocédés (remplaçante, collaboratrice)' },
  personnel:     { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Frais de personnel (salaires et charges sociales)' },
  charges_perso: { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Cotisations sociales personnelles obligatoires (URSSAF, CARPIMKO…)' },
  madelin:       { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Cotisations facultatives Madelin santé / prévoyance' },
  csg:           { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'CSG déductible' },
  impots:        { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Autres impôts et taxes (CFE, taxe foncière du local…)' },
  loyer:         { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Loyers et charges locatives' },
  loc_materiel:  { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Location de matériel et de mobilier' },
  entretien:     { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Entretien et réparations (dont blanchissage des blouses)' },
  petit_materiel:{ side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Petit outillage et matériel (< 500 € HT)' },
  achats:        { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Fournitures de soins consommables (pansements, gants, DASRI…)' },
  energie:       { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Chauffage, eau, gaz, électricité' },
  vehicule:      { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Frais de véhicule (barème kilométrique OU frais réels)' },
  deplacement:   { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Autres frais de déplacement' },
  formation:     { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Congrès, colloques et formation professionnelle' },
  reception:     { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Frais de réception, de représentation et de repas professionnels' },
  bureau:        { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Fournitures de bureau' },
  documentation: { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Documentation professionnelle et abonnements' },
  telecom:       { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Frais postaux, téléphone, internet (part professionnelle)' },
  actes:         { side: 'depense', form: '2035-A', section: 'Dépenses', label: "Frais d'actes et de contentieux" },
  honoraires:    { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Honoraires versés (expert-comptable, AGA, conseil)' },
  assurances:    { side: 'depense', form: '2035-A', section: 'Dépenses', label: "Primes d'assurances professionnelles" },
  autres:        { side: 'depense', form: '2035-A', section: 'Dépenses', label: 'Autres frais divers (cotisations ordinales, frais bancaires…)' },
  amortissement: { side: 'depense', form: '2035', section: 'Immobilisations', label: 'Dotations aux amortissements (tableau des immobilisations de la liasse 2035)' },

  csg_nd:        { side: 'hors', form: '2035', section: 'Non déductible', label: 'CSG non déductible (2,4 %) et CRDS (0,5 %) : non déductibles' },
  immo:          { side: 'hors', form: '2035', section: 'Immobilisations', label: 'Matériel > 500 € HT : à immobiliser et amortir (pas de charge directe)' },
  per:           { side: 'hors', form: '2042', section: 'Déclaration principale', label: 'Versements PER / Madelin retraite : à déduire sur la 2042 (cases 6NS / 6NT), pas sur la 2035' },
};

// ---------- Catégories de saisie ----------
// special: 'cot' (cotisation URSSAF/CARPIMKO avec détail CSG), 'immo' (durée d'amortissement)
const CATS = [
  // Recettes
  { key: 'cpam',        type: 'recette', poste: 'recettes',     label: 'Honoraires CPAM (AMI, AIS, BSI, majorations, forfaits)' },
  { key: 'ifd',         type: 'recette', poste: 'recettes',     label: 'IFD et indemnités kilométriques (IK) perçues', hint: 'Les IFD/IK remboursées sont des recettes.' },
  { key: 'compl',       type: 'recette', poste: 'recettes',     label: 'Mutuelles / part complémentaire' },
  { key: 'patients',    type: 'recette', poste: 'recettes',     label: 'Patients (dépassements, soins non remboursés)' },
  { key: 'remplacement',type: 'recette', poste: 'recettes',     label: 'Rétrocessions / remplacements perçus' },
  { key: 'divers_rec',  type: 'recette', poste: 'gains_divers', label: 'Gains divers (formation dispensée, autres)' },
  // Dépenses
  { key: 'retro',       type: 'depense', poste: 'retrocedes',   label: 'Rétrocessions versées (remplaçante / collaboratrice)' },
  { key: 'salaires',    type: 'depense', poste: 'personnel',    label: 'Salaires et charges sociales du personnel' },
  { key: 'urssaf',      type: 'depense', poste: 'charges_perso',label: 'Cotisations URSSAF (maladie, allocations familiales, CSG-CRDS, formation)', special: 'cot', org: 'URSSAF', hint: 'Indiquez ci-dessous la part de CSG-CRDS comprise dans ce paiement : seule la CSG déductible (6,8 %) est déductible.' },
  { key: 'carpimko',    type: 'depense', poste: 'charges_perso',label: 'Cotisations CARPIMKO (retraite, invalidité-décès, ASV)', special: 'cot', org: 'CARPIMKO' },
  { key: 'madelin',     type: 'depense', poste: 'madelin',      label: 'Madelin santé / prévoyance' },
  { key: 'per',         type: 'depense', poste: 'per',          label: 'PER / Madelin retraite', hint: 'Déduit sur la 2042, pas sur la 2035.' },
  { key: 'csg',         type: 'depense', poste: 'csg',          label: 'CSG déductible (6,8 %), si saisie à part', hint: 'Inutile si vous détaillez la CSG dans le paiement URSSAF.' },
  { key: 'impots',      type: 'depense', poste: 'impots',       label: 'CFE, taxe foncière du local, autres taxes', hint: "L'impôt sur le revenu n'est jamais déductible." },
  { key: 'loyer',       type: 'depense', poste: 'loyer',        label: 'Loyer et charges du cabinet / local' },
  { key: 'loc_mat',     type: 'depense', poste: 'loc_materiel', label: 'Location / leasing de matériel' },
  { key: 'entretien',   type: 'depense', poste: 'entretien',    label: 'Entretien, réparations, blanchissage des blouses' },
  { key: 'petit_mat',   type: 'depense', poste: 'petit_materiel',label: 'Petit matériel < 500 € HT (tensiomètre, ciseaux, sacoche…)' },
  { key: 'soins',       type: 'depense', poste: 'achats',       label: 'Fournitures de soins (pansements, gants, compresses, DASRI…)' },
  { key: 'energie',     type: 'depense', poste: 'energie',      label: 'Eau, gaz, électricité, chauffage (part pro)' },
  { key: 'veh_reel',    type: 'depense', poste: 'vehicule',     label: 'Véhicule : frais réels (carburant, assurance, entretien…)', hint: 'Compté seulement si la méthode « frais réels » est choisie pour l\'année (Réglages). Avec le barème kilométrique, ces frais sont déjà inclus dans le forfait.' },
  { key: 'deplacement', type: 'depense', poste: 'deplacement',  label: 'Parking, péage, transports en commun', hint: 'Péages et parkings se déduisent en plus du barème kilométrique.' },
  { key: 'formation',   type: 'depense', poste: 'formation',    label: 'Formation, congrès (DPC, FAF…)' },
  { key: 'reception',   type: 'depense', poste: 'reception',    label: 'Repas professionnels / réception', hint: "Gardez le nom de l'invité et l'objet du repas." },
  { key: 'bureau',      type: 'depense', poste: 'bureau',       label: 'Fournitures de bureau' },
  { key: 'doc',         type: 'depense', poste: 'documentation',label: 'Documentation, revues, abonnements professionnels' },
  { key: 'telecom',     type: 'depense', poste: 'telecom',      label: 'Téléphone, internet, frais postaux (part pro)', hint: 'Indiquez la part professionnelle (%).' },
  { key: 'actes',       type: 'depense', poste: 'actes',        label: "Frais d'actes et contentieux" },
  { key: 'compta',      type: 'depense', poste: 'honoraires',   label: 'Expert-comptable, AGA / OGA, conseil' },
  { key: 'assurance',   type: 'depense', poste: 'assurances',   label: 'Assurance RC pro, protection juridique, local' },
  { key: 'ordre',       type: 'depense', poste: 'autres',       label: 'Cotisation Ordre infirmier, syndicat, association' },
  { key: 'banque',      type: 'depense', poste: 'autres',       label: 'Frais bancaires professionnels' },
  { key: 'logiciel',    type: 'depense', poste: 'autres',       label: 'Logiciels (facturation, télétransmission, tournées)' },
  { key: 'immo',        type: 'depense', poste: 'immo',         label: 'Achat de matériel > 500 € HT (immobilisation)', special: 'immo', hint: 'Sera amorti sur plusieurs années, pas déduit en une fois.' },
  { key: 'autres_dep',  type: 'depense', poste: 'autres',       label: 'Autres frais professionnels' },
];

CATS.push({ key: 'km_pro', type: 'km', poste: 'vehicule', label: 'Kilomètres professionnels (tournées)' });

const catByKey = (k) => CATS.find((c) => c.key === k);

// ---------- Calculs ----------
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Montant déductible d'une dépense = montant payé × part pro (%)
function deductible(e) {
  if (e.type !== 'depense') return 0;
  const pct = e.pct == null || e.pct === '' ? 100 : Number(e.pct);
  return round2((Number(e.amount) || 0) * Math.min(Math.max(pct, 0), 100) / 100);
}

// Dotation d'amortissement linéaire d'un bien pour l'année Y (prorata mensuel la 1re année)
function dotation(e, year) {
  const value = deductible(e);
  const dur = Math.max(1, Number(e.duree) || 5);
  const d = new Date(e.date + 'T00:00:00');
  const y0 = d.getFullYear();
  if (year < y0) return 0;
  const annual = value / dur;
  const firstMonths = 12 - d.getMonth(); // mois d'acquisition inclus
  const planned = (yr) => (yr === y0 ? annual * firstMonths / 12 : annual);
  let cum = 0;
  for (let yr = y0; yr < year; yr++) cum += planned(yr);
  const remaining = Math.max(0, value - cum);
  return round2(Math.min(planned(year), remaining));
}

// ---------- Barème kilométrique (forfait) ----------
// Barème reconduit à l'identique pour 2025 et 2026 selon les guides consultés.
// d = kilomètres professionnels de l'année. Tranches : [lim1, lim2], coefficients a, b (+ c fixe), e.
// Pour une autre année, ajoutez une entrée dans BAREME_KM_PAR_ANNEE (même structure que BAREME_KM).
const BAREME_KM = {
  auto3:   { label: 'Voiture 3 CV et moins',  lim1: 5000, lim2: 20000, a: 0.529, b: 0.316, c: 1065, e: 0.370 },
  auto4:   { label: 'Voiture 4 CV',           lim1: 5000, lim2: 20000, a: 0.606, b: 0.340, c: 1330, e: 0.407 },
  auto5:   { label: 'Voiture 5 CV',           lim1: 5000, lim2: 20000, a: 0.636, b: 0.357, c: 1395, e: 0.427 },
  auto6:   { label: 'Voiture 6 CV',           lim1: 5000, lim2: 20000, a: 0.665, b: 0.374, c: 1457, e: 0.447 },
  auto7:   { label: 'Voiture 7 CV et plus',   lim1: 5000, lim2: 20000, a: 0.697, b: 0.394, c: 1515, e: 0.470 },
  cyclo:   { label: 'Cyclomoteur (≤ 50 cm³)', lim1: 3000, lim2: 6000,  a: 0.315, b: 0.079, c: 711,  e: 0.198 },
  moto12:  { label: 'Moto 1 ou 2 CV',         lim1: 3000, lim2: 6000,  a: 0.395, b: 0.099, c: 891,  e: 0.248 },
  moto345: { label: 'Moto 3, 4 ou 5 CV',      lim1: 3000, lim2: 6000,  a: 0.468, b: 0.082, c: 1158, e: 0.275 },
  moto6:   { label: 'Moto plus de 5 CV',      lim1: 3000, lim2: 6000,  a: 0.606, b: 0.079, c: 1583, e: 0.343 },
};
const BAREME_KM_PAR_ANNEE = {};
const MAJORATION_ELEC = 0.20; // véhicule électrique : +20 %

// Indemnité kilométrique annuelle pour d km (forfait). Retourne 0 si d <= 0.
function ikAmount(d, vehKey, elec, year) {
  d = Number(d) || 0;
  if (d <= 0) return 0;
  const table = (year && BAREME_KM_PAR_ANNEE[year]) || BAREME_KM;
  const t = table[vehKey] || table.auto5;
  let v = d <= t.lim1 ? d * t.a : d <= t.lim2 ? d * t.b + t.c : d * t.e;
  if (elec) v *= 1 + MAJORATION_ELEC;
  return round2(v);
}

// opts : { vehMethod: 'bareme' | 'reel', vehType: clé de BAREME_KM, elec: bool }
function computeYear(entries, year, opts = {}) {
  const method = opts.vehMethod === 'reel' ? 'reel' : 'bareme';
  const vehType = opts.vehType || 'auto5';
  const elec = !!opts.elec;
  const ys = String(year);
  const list = entries.filter((e) => e.date && e.date.startsWith(ys));
  const byPoste = {};
  const months = Array.from({ length: 12 }, () => ({ rec: 0, dep: 0, km: 0, ik: 0 }));
  let rec = 0, dep = 0, per = 0, missing = 0, totalKm = 0, vehReel = 0, vehReelIgnore = 0;
  const cot = { URSSAF: { paid: 0, csgDed: 0, csgND: 0, count: 0 }, CARPIMKO: { paid: 0, csgDed: 0, csgND: 0, count: 0 } };

  const addPoste = (poste, amount) => {
    byPoste[poste] = byPoste[poste] || { total: 0, count: 0 };
    byPoste[poste].total = round2(byPoste[poste].total + amount);
  };
  const addDep = (poste, amount, m) => { addPoste(poste, amount); dep += amount; months[m].dep += amount; };

  for (const e of list) {
    const m = Number(e.date.slice(5, 7)) - 1;
    if (e.type === 'km') { const k = Number(e.km) || 0; months[m].km += k; totalKm += k; continue; }
    const cat = catByKey(e.cat);
    if (!cat) continue;
    const poste = cat.poste;
    if (e.type === 'depense' && !e.nFiles) missing++;

    if (e.type === 'recette') {
      const a = Number(e.amount) || 0;
      addPoste(poste, a); byPoste[poste].count++; rec += a; months[m].rec += a;
      continue;
    }
    const amount = deductible(e);

    if (cat.special === 'cot') {
      // Cotisations obligatoires : on isole la CSG déductible et la CSG-CRDS non déductible.
      const total = Number(e.amount) || 0;
      const csgDed = Math.min(Math.max(Number(e.csgDed) || 0, 0), total);
      const csgND = Math.min(Math.max(Number(e.csgND) || 0, 0), total - csgDed);
      const base = round2(total - csgDed - csgND);
      const c = cot[cat.org];
      c.paid = round2(c.paid + total); c.csgDed = round2(c.csgDed + csgDed); c.csgND = round2(c.csgND + csgND); c.count++;
      addDep('charges_perso', base, m); byPoste.charges_perso.count++;
      if (csgDed > 0) { addDep('csg', csgDed, m); byPoste.csg.count++; }
      if (csgND > 0) { addPoste('csg_nd', csgND); byPoste.csg_nd.count = (byPoste.csg_nd.count || 0) + 1; }
      continue;
    }
    if (cat.key === 'veh_reel') {
      vehReel = round2(vehReel + amount);
      if (method === 'bareme') { vehReelIgnore = round2(vehReelIgnore + amount); continue; } // inclus dans le forfait
    }
    addPoste(poste, amount); byPoste[poste].count++;
    if (poste === 'per') per += amount;
    else if (poste === 'immo') { /* amorti à part */ }
    else { dep += amount; months[m].dep += amount; }
  }

  // Forfait kilométrique : calculé sur le total annuel, réparti par mois au prorata cumulé
  const ikTotal = ikAmount(totalKm, vehType, elec, year);
  if (method === 'bareme' && totalKm > 0) {
    let cumKm = 0, prev = 0;
    for (let m = 0; m < 12; m++) {
      cumKm += months[m].km;
      const cumIk = ikAmount(cumKm, vehType, elec, year);
      months[m].ik = round2(cumIk - prev); prev = cumIk;
      months[m].dep += months[m].ik;
    }
    addPoste('vehicule', ikTotal); byPoste.vehicule.count = list.filter((e) => e.type === 'km').length;
    dep += ikTotal;
  }

  // Amortissements de tous les biens acquis jusqu'à l'année Y
  let amort = 0;
  const immos = [];
  for (const e of entries) {
    const cat = catByKey(e.cat);
    if (!cat || cat.poste !== 'immo' || !e.date || e.date.slice(0, 4) > ys) continue;
    const dot = dotation(e, year);
    immos.push({ id: e.id, label: e.label, date: e.date, valeur: deductible(e), duree: Number(e.duree) || 5, dotation: dot });
    amort += dot;
  }
  if (amort > 0) byPoste.amortissement = { total: round2(amort), count: immos.length };

  // Les montants mensuels sont arrondis pour que leur somme reste exacte
  months.forEach((mm) => { mm.rec = round2(mm.rec); mm.dep = round2(mm.dep); });
  rec = round2(rec); dep = round2(dep); amort = round2(amort); per = round2(per);
  const resultat = round2(rec - dep - amort);
  const sociales = round2(cot.URSSAF.paid + cot.CARPIMKO.paid);
  return {
    rec, dep, amort, per, resultat, byPoste, months, immos, missing,
    count: list.length,
    veh: { method, type: vehType, elec, totalKm, ik: ikTotal, reel: vehReel, ignoreReel: vehReelIgnore },
    cot, sociales,
  };
}

// Comparaison micro-BNC / déclaration contrôlée (base imposable avant cotisations sociales)
function compareRegimes(R, year) {
  const f = fiscalFor(year);
  const abatt = Math.max(R.rec * ABATTEMENT_MICRO, R.rec > 0 ? ABATTEMENT_MIN : 0);
  const baseMicro = round2(Math.max(0, R.rec - abatt));
  const baseReel = R.resultat;
  return {
    plafond: f.plafond,
    depassePlafond: R.rec > f.plafond,
    abatt: round2(abatt),
    baseMicro,
    baseReel,
    meilleur: baseReel < baseMicro ? 'reel' : 'micro',
    ecart: round2(Math.abs(baseReel - baseMicro)),
    ratioCharges: R.rec > 0 ? (R.dep + R.amort) / R.rec : 0,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { BAREME_KM, ikAmount, CATS, POSTES, catByKey, computeYear, compareRegimes, deductible, dotation, fiscalFor, ABATTEMENT_MICRO, ABATTEMENT_MIN, SEUIL_2035E };
}
