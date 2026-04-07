// === CONFIGURATION ET DONNÉES (valeurs locales par défaut) ===
let config = {
  crews: ['Crew Victor', 'Crew Alex', 'Crew Andy'],
  rigs: ['Rig 1', 'Rig 2', 'Rig 3'],
  cars: {
    '32': { number: 32, color: 'rouge' },
    '777': { number: 777, color: 'blanc' },
    '30': { number: 30, color: 'bleu-clair' },
  },
  pitstopTypes: {
    Sprint: { name: 'Sprint', color: 'tires' },
    emergency: { name: 'Emergency', color: 'repair' },
    Long: { name: 'Long Stop', color: 'fuel' },
    Short: { name: 'Short Fuel', color: 'fuel' },
  },
};

let pitstopData = [
  // Exemple vide par défaut
];

let currentLap = 1;
let refreshTimer = 30;
let nextId = 4;
let editingPitstopId = null;

// === Penalty / ESP32 arm state ===
let armedPenaltyIds = new Set();   // ids des pitstops considérés "armés" (ESP32 = penalty)
let pendingPenaltyMs = null;       // si on a cliqué "Set", la valeur demandée (ms) en attente de confirmation
const PENALTY_MATCH_TOLERANCE_MS = 500; // tolérance pour considérer que les valeurs "matchent"


// === SOCKET.IO ===
const socket = io();

// Désactive les alert() (remplacées par console.log)
window.alert = function () { /* no-op */ };

// === OUTILS ===
function recalcNextId() {
  const maxId = pitstopData.reduce((m, p) => (typeof p.id === 'number' && p.id > m ? p.id : m), 0);
  nextId = maxId + 1;
}

function parseExpectedTimeToSeconds(t) {
  // t attendu: "HH:MM" ou "HH:MM:SS"
  if (!t || typeof t !== 'string') return NaN;
  const parts = t.split(':').map(Number);
  if (parts.length < 2) return NaN;
  const [hh, mm, ss = 0] = parts;
  if (![hh, mm, ss].every((x) => Number.isFinite(x) && x >= 0)) return NaN;
  return hh * 3600 + mm * 60 + ss;
}

// --- UTILITAIRES POUR LA PÉNALITÉ / FORMATAGE ---
/**
 * Normalise une valeur time "HH:MM" ou "HH:MM:SS" ou valeur vide -> retourne null ou la chaîne normalisée "HH:MM" ou "HH:MM:SS"
 */
function normalizeTimeString(t) {

  if (!t) return null;
  if (typeof t !== 'string') return null;
  // autorise "HH:MM" ou "HH:MM:SS"
  const parts = t.split(':').map((x) => x.toString().padStart(2, '0'));
  if (parts.length === 2) return `${parts[0]}:${parts[1]}`;
  if (parts.length === 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
  return null;
}

// ----- Ajout ---- 

// Convertit "HH:MM" ou "HH:MM:SS" -> millisecondes (Number) ou NaN
function parseTimeStringToMs(t) {
  if (!t || typeof t !== 'string') return NaN;
  const parts = t.split(':').map(Number);
  if (parts.length < 2) return NaN;
  const [hh, mm, ss = 0] = parts;
  if (![hh, mm, ss].every((x) => Number.isFinite(x) && x >= 0)) return NaN;
  return ((hh * 3600) + (mm * 60) + ss) * 1000;
}

// Met à jour armedPenaltyIds selon la valeur actuelle du timer (ms)
function updateArmedPenaltiesFromESP(currentDelayMs) {
  armedPenaltyIds.clear();

  if (!Number.isFinite(currentDelayMs)) {
    pendingPenaltyMs = pendingPenaltyMs && pendingPenaltyMs;
    refreshPitstopDisplays();
    return;
  }

  if (pendingPenaltyMs !== null && Math.abs(currentDelayMs - pendingPenaltyMs) <= PENALTY_MATCH_TOLERANCE_MS) {
    pendingPenaltyMs = null;
  }

  // Comparaison simple : penalty en secondes
  for (const p of pitstopData) {
    const pSec = Number(p.penalty); // seconds
    if (Number.isFinite(pSec) && Math.abs(pSec * 1000 - currentDelayMs) <= PENALTY_MATCH_TOLERANCE_MS) {
      if (p.id != null) armedPenaltyIds.add(p.id);
    }
  }

  refreshPitstopDisplays();
}


// Appelé quand on clique sur "Set" pour mémoriser la valeur demandée (ms)
function markPenaltyPending(ms) {
  if (!Number.isFinite(ms)) {
    pendingPenaltyMs = null;
  } else {
    pendingPenaltyMs = ms;
    // on garde pending jusqu'à confirmation par updateArmedPenaltiesFromESP
    refreshPitstopDisplays();
    // Timeout de sécurité : si pas confirmé après 10s, on supprime pending
    setTimeout(() => {
      if (pendingPenaltyMs !== null) {
        pendingPenaltyMs = null;
        refreshPitstopDisplays();
      }
    }, 10000);
  }
}

/**
 * Transforme un temps en secondes au format "HH:MM:SS" 
 */
function formatSecondsToHMS(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return null;
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = Math.floor(totalSeconds % 60);
  return `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`;
}

/**
 * Formate un temps sous forme "MM:SS.t" (minutes:secondes:dixièmes)
 */
function formatSecondsToMinSecTenths(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return 'None';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}


/**
 * Affichage de pénalité lisible : renvoie 'None' si absent sinon la chaîne normalisée.
 */
function formatPenaltyDisplay(penaltyStr) {
  const n = normalizeTimeString(penaltyStr);
  return n ? n : 'None';
}

function formatPenaltySecondsToMS(val) {
  if (!Number.isFinite(val)) return 'None';
  const totalSeconds = Math.floor(val);
  const tenth = Math.round((val - totalSeconds) * 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${tenth}s`;
}



// ------ Ajout --------

function getTypeLabel(type) {
  return config.pitstopTypes[type]?.name || type;
}

function getCarColorClass(carNumber) {
  const car = config.cars[carNumber?.toString()];
  return car ? `car-${car.color}` : '';
}

// === TRI DES PITSTOPS ===
// Règles demandées :
// 1) 'scheduled' au-dessus de 'done'
// 2) Dans chaque groupe : prochain en HAUT
//    - s'il y a une heure => tri ascendant par heure
//    - sinon => tri ascendant par numéro de tour
// 3) Égalités gérées de façon stable/fallback
function sortPitstopsForDisplay(a, b) {
  const rank = (p) => (p.status === 'done' ? 1 : 0); // scheduled (0) avant done (1)
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;

  const sa = parseExpectedTimeToSeconds(a.expectedTime);
  const sb = parseExpectedTimeToSeconds(b.expectedTime);
  const aHasTime = Number.isFinite(sa);
  const bHasTime = Number.isFinite(sb);

  // clé de tri : [flagTemps, valeur]
  // flagTemps = 0 si on a une heure, 1 sinon (les entrées avec heure passent avant celles sans heure)
  const keyA = aHasTime ? [0, sa] : [1, a.stopLap ?? Number.POSITIVE_INFINITY];
  const keyB = bHasTime ? [0, sb] : [1, b.stopLap ?? Number.POSITIVE_INFINITY];

  if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];    // heure avant pas d'heure
  if (keyA[1] !== keyB[1]) return keyA[1] - keyB[1];    // ascendant

  // Fallback : par id croissant pour stabilité
  return (a.id ?? 0) - (b.id ?? 0);
}

// === SYNC ===
function syncPitstopsToServer() {
  socket.emit('updatePitstops', pitstopData);
}
function syncConfigToServer() {
  socket.emit('updateConfig', config);
}
function syncAllToServer() {
  socket.emit('updateAll', {
    config,
    pitstops: pitstopData,
    currentLap,
  });
}

// === SOCKET LISTENERS ===
socket.on('init', (serverState) => {
  if (serverState && typeof serverState === 'object') {
    if (Array.isArray(serverState.pitstops)) pitstopData = serverState.pitstops;
    if (serverState.config && typeof serverState.config === 'object') config = serverState.config;
    if (Number.isFinite(Number(serverState.currentLap))) currentLap = Number(serverState.currentLap);
  } else if (Array.isArray(serverState)) {
    pitstopData = serverState; // compat
  }
  recalcNextId();
  refreshAllDisplays();
});

socket.on('updatePitstops', (payload) => {
  pitstopData = Array.isArray(payload) ? payload : [];
  recalcNextId();
  refreshPitstopDisplays();
});

socket.on('updateConfig', (newConfig) => {
  if (newConfig && typeof newConfig === 'object') {
    config = newConfig;
    refreshAllDisplays();
  }
});

socket.on('updateCurrentLap', (lap) => {
  const n = Number(lap);
  if (Number.isFinite(n)) {
    currentLap = n;
    refreshPitstopDisplays();
  }
});

socket.on('updateAll', (state) => {
  if (!state || typeof state !== 'object') return;
  if (Array.isArray(state.pitstops)) pitstopData = state.pitstops;
  if (state.config && typeof state.config === 'object') config = state.config;
  if (Number.isFinite(Number(state.currentLap))) currentLap = Number(state.currentLap);
  recalcNextId();
  refreshAllDisplays();
});

// === RENDUS ===
function updateDisplay() {
  const scheduleBody = document.getElementById('scheduleBody');
  if (!scheduleBody) return;

  scheduleBody.innerHTML = '';

  [...pitstopData].sort(sortPitstopsForDisplay).forEach((pitstop) => {
    const row = document.createElement('tr');

// ----- Ajout ----
    const isArmed = pitstop.id != null && armedPenaltyIds.has(pitstop.id);
    let isPending = false;

    // On stocke toujours penalty en secondes (Number)
    const pitstopPenalty = Number(pitstop.penalty); // seconds
    const pendingPenaltySec = pendingPenaltyMs != null ? pendingPenaltyMs / 1000 : null;

    if (pendingPenaltySec !== null && Number.isFinite(pitstopPenalty) && Math.abs(pitstopPenalty - pendingPenaltySec) <= PENALTY_MATCH_TOLERANCE_MS / 1000) {
      isPending = true;
    }


    if (isArmed) {
      row.classList.add('row-penalty-armed');
    }
  

// ----- Ajout ----

    let statusText = 'Scheduled';
    let statusClass = '';
    if (pitstop.status === 'done') {
      statusText = 'Done';
      statusClass = 'row-done';
    } else if (pitstop.stopLap <= currentLap) {
      statusText = 'Completed';
      row.style.opacity = '0.6';
    } else if (pitstop.stopLap <= currentLap + 3) {
      statusText = 'Imminent';
      row.style.background = 'rgba(255,107,53,0.2)';
      row.style.fontWeight = 'bold';
    }
    if (statusClass) row.className = statusClass;

    row.innerHTML = `
      <td><span class="car-number ${getCarColorClass(pitstop.carNumber)}">#${pitstop.carNumber}</span></td>
      <td><strong>${pitstop.stopLap}</strong></td>
      <td>${pitstop.expectedTime || '-'}</td>
      <td><span class="pitstop-type type-${config.pitstopTypes[pitstop.type]?.color || 'fuel'}">${getTypeLabel(pitstop.type)}</span></td>
      <td>${pitstop.crew || 'Not assigned'}</td>
      <td>${pitstop.rig || 'Not assigned'}</td>
<!-- Ajout -->
      <td>
        ${formatPenaltySecondsToMS(pitstop.penalty)}
        ${isArmed ? '<span class="penalty-armed-icon" title="Armed on timer">⚡</span>' : (isPending ? '<span class="penalty-pending-icon" title="Pending confirmation">…</span>' : '')}
      </td>
<!-- Ajout -->
      <td>${statusText}</td>
    `;
    scheduleBody.appendChild(row);
  });
}

function optionList(items, selectedValue, placeholder = null) {
  const arr = [];
  if (placeholder !== null) {
    arr.push(`<option value="">${placeholder}</option>`);
  }
  for (const item of items) {
    const sel = item === selectedValue ? 'selected' : '';
    arr.push(`<option value="${item}" ${sel}>${item}</option>`);
  }
  return arr.join('');
}

// ——— ÉDITION DIRECTE DANS LE BACKEND ———
function updatePitstopField(id, field, value) {
  const p = pitstopData.find((x) => x.id === id);
  if (!p) return;

  if (field === 'stopLap') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return; // ignore invalid
    p.stopLap = n;
  } else if (field === 'expectedTime') {
    // autorise chaîne vide (null), sinon "HH:MM[:SS]"
    if (!value) {
      p.expectedTime = null;
    } else {
      const s = parseExpectedTimeToSeconds(value);
      if (!Number.isFinite(s)) return; // ignore invalid
      p.expectedTime = value;
    }
  } else if (field === 'crew') {
    p.crew = value || null;
  } else if (field === 'rig') {
    p.rig = value || null;
  } else if (field === 'status') {
    p.status = value === 'done' ? 'done' : 'scheduled';
  } else if (field === 'type') {
    if (!config.pitstopTypes[value]) return;
    p.type = value;
  /*} else if (field === 'penalty' || field === 'expectedDelai') {
    // value attendu : "HH:MM" ou "HH:MM:SS" ou empty -> null
    p.penalty = normalizeTimeString(value) ; // stocke soit une chaîne normalisée soit null
  }*/
  } else if (field === 'penalty') {
  const n = parseFloat(value);
  if (Number.isFinite(n) && n >= 0) {
    p.penalty = n; // secondes (float)
  } else {
    p.penalty = null;
    }
  }

  syncPitstopsToServer();
  refreshPitstopDisplays();
}

function updateManagement() {
  const managementBody = document.getElementById('managementBody');
  if (!managementBody) return;

  managementBody.innerHTML = '';

  [...pitstopData].sort(sortPitstopsForDisplay).forEach((p) => {
    const row = document.createElement('tr');

    if (p.status === 'done') row.className = 'row-done';

    const statusBadgeClass = p.status === 'done' ? 'status-done' : 'status-scheduled';
    const statusText = p.status === 'done' ? 'Done' : 'Scheduled';
    const toggleButtonText = p.status === 'done' ? 'Mark Scheduled' : 'Mark Done';
    const toggleButtonClass = p.status === 'done' ? 'btn-warning' : 'btn-success';

    // Select Type
    const typeOptions = optionList(
      Object.keys(config.pitstopTypes).map((k) => k),
      p.type
    ).replace(/>(.*?)</g, (m, code) => `>${config.pitstopTypes[code]?.name || code}<`);

    // Select Crew & Rig
    const crewOptions = optionList(config.crews, p.crew, 'Not assigned');
    const rigOptions = optionList(config.rigs, p.rig, 'Not assigned');

    row.innerHTML = `
      <td><span class="car-number ${getCarColorClass(p.carNumber)}">#${p.carNumber}</span></td>

      <td>
        <input
          type="number"
          min="1"
          value="${p.stopLap ?? ''}"
          style="width:80px"
          onchange="updatePitstopField(${p.id}, 'stopLap', this.value)"
          title="Stop lap"
        />
      </td>

      <td>
        <input
          type="time"
          step="1"
          value="${p.expectedTime ?? ''}"
          style="width:130px"
          onchange="updatePitstopField(${p.id}, 'expectedTime', this.value)"
          title="Expected pit-in (HH:MM[:SS])"
        />
      </td>

      <td>
        <select
          onchange="updatePitstopField(${p.id}, 'type', this.value)"
          title="Pitstop type"
        >
          ${typeOptions}
        </select>
      </td>

      <td>
        <select
          onchange="updatePitstopField(${p.id}, 'crew', this.value)"
          title="Crew"
        >
          ${crewOptions}
        </select>
      </td>

      <td>
        <select
          onchange="updatePitstopField(${p.id}, 'rig', this.value)"
          title="Rig"
        >
          ${rigOptions}
        </select>
      </td>

      <td>
        <input
          type="number"
          step="0.1"
          min="0"
          value="${p.penalty ?? ''}"
          style="width:100px; text-align:right"
          onchange="updatePitstopField(${p.id}, 'penalty', this.value)"
          title="Penalty duration (seconds)"
          placeholder="0.0"
        />
      </td>


      <td>
        <select
          onchange="updatePitstopField(${p.id}, 'status', this.value)"
          title="Status"
        >
          <option value="scheduled" ${p.status !== 'done' ? 'selected' : ''}>Scheduled</option>
          <option value="done" ${p.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </td>

      <td>
        <div class="action-buttons">
          <button class="btn btn-small ${toggleButtonClass}" onclick="togglePitstopStatus(${p.id})">${toggleButtonText}</button>
          <button class="delete-btn" onclick="deletePitstop(${p.id})">Delete</button>
        </div>
      </td>
    `;
    managementBody.appendChild(row);
  });
}

function updateConfigurationDisplay() {
  // Cars
  const carConfigList = document.getElementById('carConfigList');
  if (carConfigList) {
    carConfigList.innerHTML = '';
    Object.values(config.cars).forEach((car) => {
      const div = document.createElement('div');
      div.className = 'config-item';
      div.innerHTML = `
        <div>
          <span class="config-item-name">#${car.number}</span>
          <div class="config-item-details">
            <span class="car-number car-${car.color}" style="font-size:0.8em;padding:2px 6px;margin-left:5px;">${car.color}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-small" onclick="removeCar('${car.number}')">Delete</button>
      `;
      carConfigList.appendChild(div);
    });
  }


  // Crews
  const crewConfigList = document.getElementById('crewConfigList');
  if (crewConfigList) {
    crewConfigList.innerHTML = '';
    config.crews.forEach((crew) => {
      const div = document.createElement('div');
      div.className = 'config-item';
      div.innerHTML = `
        <span class="config-item-name">${crew}</span>
        <button class="btn btn-danger btn-small" onclick="removeCrew('${crew}')">Delete</button>
      `;
      crewConfigList.appendChild(div);
    });
  }

  // Rigs
  const rigConfigList = document.getElementById('rigConfigList');
  if (rigConfigList) {
    rigConfigList.innerHTML = '';
    config.rigs.forEach((rig) => {
      const div = document.createElement('div');
      div.className = 'config-item';
      div.innerHTML = `
        <span class="config-item-name">${rig}</span>
        <button class="btn btn-danger btn-small" onclick="removeRig('${rig}')">Delete</button>
      `;
      rigConfigList.appendChild(div);
    });
  }

  // Types
  const typeConfigList = document.getElementById('typeConfigList');
  if (typeConfigList) {
    typeConfigList.innerHTML = '';
    Object.keys(config.pitstopTypes).forEach((typeCode) => {
      const type = config.pitstopTypes[typeCode];
      const div = document.createElement('div');
      div.className = 'config-item';
      div.innerHTML = `
        <div>
          <div class="config-item-name">${type.name}</div>
          <div class="config-item-details">Code: ${typeCode} | Color: ${type.color}</div>
        </div>
        <button class="btn btn-danger btn-small" onclick="removePitstopType('${typeCode}')">Delete</button>
      `;
      typeConfigList.appendChild(div);
    });
  }
}

function updateFormSelects() {
  // Cars
  const carSelect = document.getElementById('carNumber');
  if (carSelect) {
    carSelect.innerHTML = '<option value="">Select a car...</option>';
    Object.values(config.cars).forEach((car) => {
      const option = document.createElement('option');
      option.value = car.number;
      option.textContent = `#${car.number}`;
      carSelect.appendChild(option);
    });
  }


  // Types
  const pitstopTypeSelect = document.getElementById('pitstopType');
  if (pitstopTypeSelect) {
    pitstopTypeSelect.innerHTML = '<option value="">Select...</option>';
    Object.keys(config.pitstopTypes).forEach((typeCode) => {
      const option = document.createElement('option');
      option.value = typeCode;
      option.textContent = config.pitstopTypes[typeCode].name;
      pitstopTypeSelect.appendChild(option);
    });
  }

  // Crew assign (section supprimée côté HTML -> on laisse sans impact)
  const assignCrewSelect = document.getElementById('assignCrew');
  if (assignCrewSelect) {
    assignCrewSelect.innerHTML = '<option value="">Select a crew...</option>';
    config.crews.forEach((crew) => {
      const option = document.createElement('option');
      option.value = crew;
      option.textContent = crew;
      assignCrewSelect.appendChild(option);
    });
  }

  // Rig assign
  const assignRigSelect = document.getElementById('assignRig');
  if (assignRigSelect) {
    assignRigSelect.innerHTML = '<option value="">Select a rig...</option>';
    config.rigs.forEach((rig) => {
      const option = document.createElement('option');
      option.value = rig;
      option.textContent = rig;
      assignRigSelect.appendChild(option);
    });
  }

  // Edit selects (form “New Scheduled Pitstop”)
  const editCrewSelect = document.getElementById('editCrew');
  if (editCrewSelect) {
    editCrewSelect.innerHTML = '<option value="">Not assigned</option>';
    config.crews.forEach((crew) => {
      const option = document.createElement('option');
      option.value = crew;
      option.textContent = crew;
      editCrewSelect.appendChild(option);
    });
  }

  const editRigSelect = document.getElementById('editRig');
  if (editRigSelect) {
    editRigSelect.innerHTML = '<option value="">Not assigned</option>';
    config.rigs.forEach((rig) => {
      const option = document.createElement('option');
      option.value = rig;
      option.textContent = rig;
      editRigSelect.appendChild(option);
    });
  }
}

function refreshPitstopDisplays() {
  updateDisplay();
  updateManagement();
}
function refreshConfigDisplays() {
  updateConfigurationDisplay();
  updateFormSelects();
}
function refreshAllDisplays() {
  refreshPitstopDisplays();
  refreshConfigDisplays();
}

// === NAVIGATION + HORLOGE ===
function ensureClock() {
  const modeBar = document.querySelector('.mode-selector');
  if (!modeBar) return;
  if (document.getElementById('liveClock')) return;

  const clock = document.createElement('div');
  clock.id = 'liveClock';
  clock.style.marginLeft = 'auto';
  clock.style.fontWeight = 'bold';
  clock.style.fontSize = '70px';
  clock.style.padding = '10px 14px';
  clock.style.borderRadius = '12px';
  clock.style.background = 'rgba(255,255,255,0.15)';
  clock.style.border = '1px solid rgba(255,255,255,0.25)';
  clock.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
  clock.textContent = '--:--:--';
  modeBar.appendChild(clock);
}
function tickClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function setupHeaderLayout() {
  const header = document.querySelector('.header');
  if (!header) return;

  const firstRow = header.querySelector('div');
  const logo = firstRow?.querySelector('img');
  const title = firstRow?.querySelector('h1');
  const clock = document.getElementById('liveClock');
  if (!firstRow || !logo || !title || !clock) return;

  const subtitle = header.querySelector('p');
  if (subtitle) subtitle.remove();

  // Remove racing flag from title as requested.
  title.textContent = 'PITSTOP MANAGER';

  firstRow.classList.add('header-main-row');
  logo.classList.add('header-logo');
  title.classList.add('header-title-right');
  clock.classList.add('header-clock-center');

  let centerSlot = firstRow.querySelector('.header-center-slot');
  if (!centerSlot) {
    centerSlot = document.createElement('div');
    centerSlot.className = 'header-center-slot';
    firstRow.insertBefore(centerSlot, title);
  }
  centerSlot.appendChild(clock);
}

function switchMode(button, mode) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(mode)?.classList.add('active');
  if (button) button.classList.add('active');

  if (mode === 'configuration') {
    updateConfigurationDisplay();
  }
  updateFormSelects();
}

// === STATUTS ===
function togglePitstopStatus(id) {
  const pitstop = pitstopData.find((p) => p.id === id);
  if (!pitstop) return;
  pitstop.status = pitstop.status === 'scheduled' ? 'done' : 'scheduled';
  syncPitstopsToServer();
  refreshPitstopDisplays();
}

// === EXPORT / IMPORT GLOBAL (données) ===
function exportData() {
  const saveData = {
    config,
    pitstopData,
    currentLap,
    timestamp: new Date().toISOString(),
    version: 'v21',
  };
  const dataStr = JSON.stringify(saveData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);

  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    '_' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

  link.download = `pitstop_data_${ts}.json`;
  link.click();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && imported.config && imported.pitstopData) {
        if (confirm('Load this data for ALL users? This will replace current data.')) {
          config = imported.config;
          pitstopData = imported.pitstopData || [];
          currentLap = imported.currentLap || 1;
          recalcNextId();
          syncAllToServer();
          refreshAllDisplays();
        }
      } else {
        alert('Invalid data file format');
      }
    } catch (err) {
      alert('Error loading data: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// === CONFIG EXPORT / IMPORT (section configuration) ===
function exportConfig() {
  const configData = { config, pitstopData, currentLap };
  const dataStr = JSON.stringify(configData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = 'pitstop_config.json';
  link.click();
}

function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && imported.config) {
        if (confirm('Import this configuration for ALL users?')) {
          config = imported.config;
          pitstopData = imported.pitstopData || pitstopData;
          currentLap = imported.currentLap || currentLap;
          recalcNextId();
          syncAllToServer();
          refreshAllDisplays();
        }
      } else {
        alert('Invalid configuration file');
      }
    } catch (err) {
      alert('Error importing configuration: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// === CARS ===
function addCar() {
  const carNumber = parseInt(document.getElementById('newCarNumber').value, 10);
  const carColor = document.getElementById('newCarColor').value;
  if (!carNumber || carNumber < 1 || carNumber > 999) return alert('Please enter a valid car number (1-999)');
  if (config.cars[carNumber.toString()]) return alert('This car number already exists');

  config.cars[carNumber.toString()] = { number: carNumber, color: carColor };
  document.getElementById('newCarNumber').value = '';
  document.getElementById('newCarColor').value = 'rouge';

  syncConfigToServer();
  refreshConfigDisplays();
}

function removeCar(carNumber) {
  if (!confirm(`Delete car #${carNumber}?`)) return;
  delete config.cars[carNumber.toString()];
  pitstopData = pitstopData.filter((p) => p.carNumber !== parseInt(carNumber, 10));
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

function resetCars() {
  if (!confirm('Reset all cars? This will delete all scheduled pitstops.')) return;
  config.cars = {
    '30': { number: 30, color: 'bleu-clair' },
    '32': { number: 32, color: 'rouge' },
    '777': { number: 777, color: 'blanc' },
    '31': { number: 31, color: 'jaune' },
    '46': { number: 46, color: 'vert' },
  };
  pitstopData = [];
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

// === CREWS ===
function addCrew() {
  const newCrewName = document.getElementById('newCrewName')?.value.trim();
  if (!newCrewName) return alert('Please enter a crew name');
  if (config.crews.includes(newCrewName)) return alert('This crew already exists');

  config.crews.push(newCrewName);
  const inp = document.getElementById('newCrewName');
  if (inp) inp.value = '';
  syncConfigToServer();
  refreshConfigDisplays();
}

function removeCrew(crewName) {
  if (!confirm(`Delete crew "${crewName}"?`)) return;
  config.crews = config.crews.filter((c) => c !== crewName);
  pitstopData.forEach((p) => {
    if (p.crew === crewName) p.crew = null;
  });
  syncAllToServer();
  refreshAllDisplays();
}

function resetCrews() {
  if (!confirm('Reset all crews? This will delete all scheduled pitstops.')) return;
  config.crews = ['Crew Alpha', 'Crew Beta', 'Crew Gamma', 'Crew Delta'];
  pitstopData = [];
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

// === RIGS ===
function addRig() {
  const newRigName = document.getElementById('newRigName')?.value.trim();
  if (!newRigName) return alert('Please enter a rig name');
  if (config.rigs.includes(newRigName)) return alert('This rig already exists');

  config.rigs.push(newRigName);
  const inp = document.getElementById('newRigName');
  if (inp) inp.value = '';
  syncConfigToServer();
  refreshConfigDisplays();
}

function removeRig(rigName) {
  if (!confirm(`Delete rig "${rigName}"?`)) return;
  config.rigs = config.rigs.filter((r) => r !== rigName);
  pitstopData.forEach((p) => {
    if (p.rig === rigName) p.rig = null;
  });
  syncAllToServer();
  refreshAllDisplays();
}

function resetRigs() {
  if (!confirm('Reset all rigs? This will delete all scheduled pitstops.')) return;
  config.rigs = ['Rig 1', 'Rig 2', 'Rig 3', 'Rig 4'];
  pitstopData = [];
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

// === TYPES DE PITSTOP ===
function addPitstopType() {
  const name = document.getElementById('newTypeName')?.value.trim();
  const code = document.getElementById('newTypeCode')?.value.trim();
  const color = document.getElementById('newTypeColor')?.value;
  if (!name || !code) return alert('Please enter both name and code');
  if (config.pitstopTypes[code]) return alert('This type code already exists');

  config.pitstopTypes[code] = { name, color };
  const n1 = document.getElementById('newTypeName');
  const n2 = document.getElementById('newTypeCode');
  const n3 = document.getElementById('newTypeColor');
  if (n1) n1.value = '';
  if (n2) n2.value = '';
  if (n3) n3.value = 'fuel';

  syncConfigToServer();
  refreshConfigDisplays();
}

function removePitstopType(typeCode) {
  if (!confirm(`Delete type "${config.pitstopTypes[typeCode].name}"?`)) return;
  delete config.pitstopTypes[typeCode];
  pitstopData = pitstopData.filter((p) => p.type !== typeCode);
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

function resetPitstopTypes() {
  if (!confirm('Reset all pitstop types? This will delete all scheduled pitstops.')) return;
  config.pitstopTypes = {
    fuel: { name: 'Fuel Only', color: 'fuel' },
    tires: { name: 'Tires Only', color: 'tires' },
    both: { name: 'Fuel + Tires', color: 'both' },
    repair: { name: 'Repair', color: 'repair' },
  };
  pitstopData = [];
  recalcNextId();
  syncAllToServer();
  refreshAllDisplays();
}

// === GESTION DES PITSTOPS (form + actions) ===
function editPitstop(id) {
  const pitstop = pitstopData.find((p) => p.id === id);
  if (!pitstop) return;

  editingPitstopId = id;

  const carNumberInput = document.getElementById('carNumber');
  const stopLapInput = document.getElementById('stopLap');
  const pitstopTypeSelect = document.getElementById('pitstopType');
  const editCrewSelect = document.getElementById('editCrew');
  const editRigSelect = document.getElementById('editRig');
  const pitstopStatusSelect = document.getElementById('pitstopStatus');
  const expectedTimeInput = document.getElementById('expectedTime');
  const expectedDelaiInput = document.getElementById('expectedDelai');

  if (carNumberInput) carNumberInput.value = pitstop.carNumber;
  if (stopLapInput) stopLapInput.value = pitstop.stopLap;
  if (pitstopTypeSelect) pitstopTypeSelect.value = pitstop.type;
  if (editCrewSelect) editCrewSelect.value = pitstop.crew || '';
  if (editRigSelect) editRigSelect.value = pitstop.rig || '';
  if (pitstopStatusSelect) pitstopStatusSelect.value = pitstop.status || 'scheduled';
  if (expectedTimeInput) expectedTimeInput.value = pitstop.expectedTime || '';
  if (expectedDelaiInput) expectedDelaiInput.value = pitstop.penalty || '';

  const submitBtn = document.querySelector('#pitstopForm button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = 'Update';
    submitBtn.style.background = '#FF9800';
  }

  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';

  const pitstopForm = document.getElementById('pitstopForm');
  pitstopForm?.scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingPitstopId = null;
  document.getElementById('pitstopForm')?.reset();

  const submitBtn = document.querySelector('#pitstopForm button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = 'Add Pitstop';
    submitBtn.style.background = '#ff6b35';
  }
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function deletePitstop(id) {
  if (!confirm('Are you sure you want to delete this pitstop?')) return;
  pitstopData = pitstopData.filter((p) => p.id !== id);
  recalcNextId();
  syncPitstopsToServer();
  refreshPitstopDisplays();
  if (editingPitstopId === id) cancelEdit();
}

// === FORM LISTENERS ===
document.addEventListener('DOMContentLoaded', () => {
  // Form add/edit pitstop
  const pitstopForm = document.getElementById('pitstopForm');
  if (pitstopForm) {
    pitstopForm.addEventListener('submit', function (e) {
      e.preventDefault();

      const formData = {
        carNumber: parseInt(document.getElementById('carNumber')?.value, 10),
        stopLap: parseInt(document.getElementById('stopLap')?.value, 10),
        type: document.getElementById('pitstopType')?.value,
        crew: document.getElementById('editCrew')?.value || null,
        rig: document.getElementById('editRig')?.value || null,
        status: document.getElementById('pitstopStatus')?.value || 'scheduled',
        //expectedTime: document.getElementById('expectedTime')?.value || null, // "HH:MM" ou "HH:MM:SS"
        //penalty: normalizeTimeString(document.getElementById('expectedDelai')?.value) // new: penalty as "HH:MM" or "HH:MM:SS" or null
        penalty: (() => {
          const val = parseFloat(document.getElementById('expectedDelai')?.value);
          return Number.isFinite(val) && val > 0 ? val : null; // valeur en secondes (décimale)
        })(),
      };

      if (!formData.carNumber || !formData.stopLap || !formData.type) {
        alert('Please fill in all required fields');
        return;
      }

      if (editingPitstopId) {
        const pitstop = pitstopData.find((p) => p.id === editingPitstopId);
        if (pitstop) {
          Object.assign(pitstop, formData);
          syncPitstopsToServer();
          cancelEdit();
        }
      } else {
        const newPitstop = { id: nextId++, ...formData };
        pitstopData.push(newPitstop);
        syncPitstopsToServer();
        this.reset();
      }

      refreshPitstopDisplays();
    });
  }

  // Init affichages
  refreshAllDisplays();

  // Timers
  setInterval(() => {
    refreshTimer -= 1;
    const el = document.getElementById('refreshTimer');
    if (el) el.textContent = refreshTimer;
    if (refreshTimer <= 0) {
      refreshTimer = 30;
      updateDisplay();
    }
  }, 1000);

  // Horloge
  ensureClock();
  setupHeaderLayout();
  tickClock();
  setInterval(tickClock, 1000);

  // Raccourci F5 pour refresh "soft"
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
      updateDisplay();
    }
  });
});

// === SIMULATION ===
function simulateLapProgression() {
  currentLap++;
  socket.emit('updateCurrentLap', currentLap);
  updateDisplay();
}

// Expose globalement (appelés depuis HTML généré)
window.switchMode = switchMode;
window.togglePitstopStatus = togglePitstopStatus;
window.cancelEdit = cancelEdit;
window.editPitstop = editPitstop;
window.deletePitstop = deletePitstop;
window.updatePitstopField = updatePitstopField;

window.exportData = exportData;
window.importData = importData;

window.exportConfig = exportConfig;
window.importConfig = importConfig;

window.addCar = addCar;
window.removeCar = removeCar;
window.resetCars = resetCars;

window.addCrew = addCrew;
window.removeCrew = removeCrew;
window.resetCrews = resetCrews;

window.addRig = addRig;
window.removeRig = removeRig;
window.resetRigs = resetRigs;

window.addPitstopType = addPitstopType;
window.removePitstopType = removePitstopType;
window.resetPitstopTypes = resetPitstopTypes;

window.simulateLapProgression = simulateLapProgression;
