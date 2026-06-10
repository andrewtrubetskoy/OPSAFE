let missions = [];
let currentMissionId = null;
let missionCounter = 1;
const DEFAULT_MISSION_NAME = "Ми спалимо вам все нахуй";

console.log("APP.JS STARTING. Database opsafeDb active:", typeof opsafeDb !== 'undefined');


// --- MAP ENGINE ---
const map = L.map('map', { center: [47.749631, 35.919113], zoom: 11, zoomControl: false });
const satTile = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
}).addTo(map);

let activeLayers = L.layerGroup().addTo(map);
let markersLayer = L.layerGroup().addTo(map);
let frontlineLayer = L.layerGroup().addTo(map);
let baseRoutesLayer = L.layerGroup().addTo(map);

// Add standard Leaflet Layer Control
const layerControl = L.control.layers(null, {
    "Маршрути та Загрози": L.layerGroup([activeLayers, markersLayer]).addTo(map),
    "Базові маршрути": baseRoutesLayer,
    "Лінія зіткнення (DeepState)": frontlineLayer
}, { position: 'topright', collapsed: false }).addTo(map);

// Inject "Без підписів" checkbox into layer control panel
function injectCheckboxIntoLayerControl(control) {
    const container = control.getContainer();
    if (!container) return;
    
    let overlaysList = container.querySelector('.leaflet-control-layers-overlays');
    if (!overlaysList) {
        overlaysList = container.querySelector('form') || container;
    }
    
    const separator = document.createElement('div');
    separator.className = 'leaflet-control-layers-separator';
    separator.style.margin = '6px 0';
    separator.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    overlaysList.appendChild(separator);
    
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.marginTop = '6px';
    label.style.cursor = 'pointer';
    label.className = 'select-none text-[11px] font-bold text-slate-300 hover:text-white';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'accent-emerald-500';
    checkbox.checked = window.amplifiersDisabled;
    checkbox.style.cursor = 'pointer';
    checkbox.onchange = (e) => {
        toggleAmplifiers(e.target.checked);
    };
    
    const span = document.createElement('span');
    span.innerText = 'Без підписів';
    
    label.appendChild(checkbox);
    label.appendChild(span);
    overlaysList.appendChild(label);
}

injectCheckboxIntoLayerControl(layerControl);

let isDrawing = false, drawingMode = null, drawPoints = [], tempGraphic = null, tempLatLng = null;
let contextMenuLatLng = null;
let contextMenuTargetLayer = null;
let contextMenuThreat = null;
let isPlacingThreat = false;

window.amplifiersDisabled = false;
function toggleAmplifiers(disabled) {
    window.amplifiersDisabled = disabled;
    const labels = document.querySelectorAll('.label-threat');
    labels.forEach(lbl => {
        if (disabled) lbl.classList.add('hidden');
        else lbl.classList.remove('hidden');
    });
}

function showContextMenu(latlng, originalEvent, targetLayer = null) {
    contextMenuLatLng = latlng;
    contextMenuTargetLayer = targetLayer || findNearestLayer(latlng, 45);
    contextMenuThreat = null;

    const menu = document.getElementById('map-context-menu');
    if (!menu) return;

    // Restore standard buttons visibility and handle delete shape text/visibility
    Array.from(menu.children).forEach(btn => {
        if (btn.id === 'menu-delete-shape-btn') {
            if (contextMenuTargetLayer) {
                btn.classList.remove('hidden');
                const deleteText = document.getElementById('menu-delete-shape-text');
                if (deleteText) {
                    deleteText.innerText = (contextMenuTargetLayer instanceof L.Polygon) ? "Видалити район" : "Видалити маршрут";
                }
            } else {
                btn.classList.add('hidden');
            }
        } else {
            btn.classList.remove('hidden');
        }
    });

    menu.style.left = `${originalEvent.pageX}px`;
    menu.style.top = `${originalEvent.pageY}px`;
    menu.classList.remove('hidden');
}

function showThreatContextMenu(pid, sidx, event) {
    contextMenuThreat = { pid, sidx };
    contextMenuTargetLayer = null;

    const menu = document.getElementById('map-context-menu');
    if (!menu) return;

    // Hide drawing actions, show only the appropriate delete threat action
    Array.from(menu.children).forEach(btn => {
        if (btn.id === 'menu-delete-shape-btn') {
            btn.classList.remove('hidden');
            const deleteText = document.getElementById('menu-delete-shape-text');
            if (deleteText) {
                deleteText.innerText = sidx === null ? "Видалити загрозу" : "Видалити фактор";
            }
        } else {
            btn.classList.add('hidden');
        }
    });

    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;
    menu.classList.remove('hidden');
}

// Context Menu Event Listeners
map.on('contextmenu', (e) => {
    const target = e.originalEvent.target;
    // If clicking on a marker (such as a Geoman vertex handle), let Leaflet/Geoman handle it (right-click deletes vertex)
    if (target.closest('.leaflet-marker-icon')) {
        return;
    }

    e.originalEvent.preventDefault();
    showContextMenu(e.latlng, e.originalEvent);
});

map.on('click', (e) => {
    if (isRulerMeasuring) {
        rulerPoints.push(e.latlng);
        if (!rulerGraphic) {
            rulerGraphic = L.polyline(rulerPoints, { color: '#eab308', weight: 4, dashArray: '6, 6' }).addTo(map);
            rulerTempLine = L.polyline([e.latlng, e.latlng], { color: '#eab308', weight: 3, dashArray: '6, 6', opacity: 0.7 }).addTo(map);
        } else {
            rulerGraphic.setLatLngs(rulerPoints);
        }

        const totalDist = getRouteLength(rulerPoints);
        if (rulerActiveTooltip) {
            rulerActiveTooltip.setLatLng(e.latlng);
            rulerActiveTooltip.setContent(formatLength(totalDist));
        } else {
            rulerActiveTooltip = L.tooltip({
                permanent: true,
                direction: 'top',
                className: 'ruler-length-tooltip'
            }).setLatLng(e.latlng).setContent(formatLength(totalDist)).addTo(map);
        }
        return;
    }

    if (isPlacingThreat) {
        const clickedLatLng = e.latlng;
        stopThreatPlacement();
        triggerThreatModal(clickedLatLng);
        return;
    }

    hideContextMenu();
});

map.on('mousemove', (e) => {
    if (isRulerMeasuring && rulerPoints.length > 0 && rulerTempLine) {
        const lastPt = rulerPoints[rulerPoints.length - 1];
        rulerTempLine.setLatLngs([lastPt, e.latlng]);

        const tempPoints = [...rulerPoints, e.latlng];
        const tempDist = getRouteLength(tempPoints);
        if (rulerActiveTooltip) {
            rulerActiveTooltip.setLatLng(e.latlng);
            rulerActiveTooltip.setContent(formatLength(tempDist));
        }
    }
});

map.on('dblclick', (e) => {
    if (isRulerMeasuring) {
        L.DomEvent.stopPropagation(e);
        if (rulerPoints.length >= 2) {
            finalizeRuler();
        } else {
            stopRulerMeasurement();
        }
        return;
    }

    const nearest = findNearestLayer(e.latlng, 45);
    if (nearest) {
        map.doubleClickZoom.disable();
        setTimeout(() => {
            map.doubleClickZoom.enable();
        }, 100);

        if (nearest.pm.enabled()) {
            nearest.pm.disable();
        } else {
            nearest.pm.enable({ allowSelfIntersection: true, draggable: true });
        }
    }
});

document.addEventListener('click', (e) => {
    const menu = document.getElementById('map-context-menu');
    if (menu && !menu.contains(e.target)) {
        hideContextMenu();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        activeLayers.eachLayer((layer) => {
            if (layer.pm && layer.pm.enabled()) {
                layer.pm.disable();
            }
        });
        if (currentMissionId) {
            const m = missions.find(x => x.id === currentMissionId);
            if (m) {
                m.data.database.forEach(item => {
                    item.editing = false;
                    item.secondaries.forEach(sec => {
                        sec.editing = false;
                    });
                });
                renderMarkers();
            }
        }
        stopDrawing();
        stopThreatPlacement();
        stopRulerMeasurement();
    }
});

function hideContextMenu() {
    const menu = document.getElementById('map-context-menu');
    if (menu) menu.classList.add('hidden');
}

function handleContextMenuAction(mode) {
    hideContextMenu();
    if (mode === 'threat') {
        triggerThreatModal(contextMenuLatLng);
    } else if (mode === 'delete_shape') {
        if (contextMenuThreat) {
            const { pid, sidx } = contextMenuThreat;
            if (sidx === null) {
                confirmDeleteObj(pid);
            } else {
                confirmDeleteSec(pid, sidx);
            }
            contextMenuThreat = null;
        } else {
            deleteShape(contextMenuTargetLayer);
        }
    } else {
        validateDrawing(mode, contextMenuLatLng);
    }
}

function confirmDeleteRoute(index) {
    if (confirm("Ви дійсно бажаєте видалити цей маршрут?")) {
        const m = missions.find(x => x.id === currentMissionId);
        if (m) {
            m.data.routes.splice(index, 1);
            saveMissions();
            handleMissionChange(currentMissionId);
        }
    }
}

function confirmDeleteArea(index) {
    if (confirm("Ви дійсно бажаєте видалити цей район позицій?")) {
        const m = missions.find(x => x.id === currentMissionId);
        if (m) {
            m.data.areas.splice(index, 1);
            saveMissions();
            handleMissionChange(currentMissionId);
        }
    }
}

function deleteShape(layer) {
    if (!layer || !currentMissionId) return;
    const m = missions.find(x => x.id === currentMissionId);
    if (!m) return;

    const layerCoords = getFlatLatLngs(layer);

    if (layer instanceof L.Polygon) {
        if (confirm("Ви дійсно бажаєте видалити цей район позицій?")) {
            m.data.areas = m.data.areas.filter(areaCoords => {
                const flat = areaCoords.map(c => L.latLng(c));
                if (flat.length !== layerCoords.length) return true;
                for (let i = 0; i < flat.length; i++) {
                    if (flat[i].distanceTo(layerCoords[i]) > 0.1) return true;
                }
                return false;
            });
            activeLayers.removeLayer(layer);
            saveMissions();
            handleMissionChange(currentMissionId);
        }
    } else if (layer instanceof L.Polyline) {
        if (confirm("Ви дійсно бажаєте видалити цей маршрут?")) {
            m.data.routes = m.data.routes.filter(routeCoords => {
                const flat = routeCoords.map(c => L.latLng(c));
                if (flat.length !== layerCoords.length) return true;
                for (let i = 0; i < flat.length; i++) {
                    if (flat[i].distanceTo(layerCoords[i]) > 0.1) return true;
                }
                return false;
            });
            activeLayers.removeLayer(layer);
            saveMissions();
            handleMissionChange(currentMissionId);
        }
    }
}

// --- MISSION LOGIC ---
function saveMissions() {
    localStorage.setItem('opsafe_missions', JSON.stringify(missions));
    localStorage.setItem('opsafe_current_mission_id', currentMissionId || '');
    localStorage.setItem('opsafe_mission_counter', missionCounter);
}

function loadMissions() {
    const savedMissions = localStorage.getItem('opsafe_missions');
    const savedCurrentId = localStorage.getItem('opsafe_current_mission_id');
    const savedCounter = localStorage.getItem('opsafe_mission_counter');

    if (savedMissions) {
        try {
            missions = JSON.parse(savedMissions);
            if (!Array.isArray(missions)) {
                missions = [];
            }
            // Reset transient editing state on load
            missions.forEach(m => {
                if (m.data && m.data.database) {
                    m.data.database.forEach(item => {
                        item.editing = false;
                        if (item.secondaries) {
                            item.secondaries.forEach(sec => {
                                sec.editing = false;
                            });
                        }
                    });
                }
            });
            const exists = missions.some(x => x.id === savedCurrentId);
            currentMissionId = exists ? savedCurrentId : (missions.length > 0 ? missions[0].id : null);
            missionCounter = savedCounter ? parseInt(savedCounter) : 1;
        } catch (e) {
            console.error("Error loading missions from localStorage:", e);
            initDefaultMission();
        }
    } else {
        initDefaultMission();
    }
}

function initDefaultMission() {
    missions = [
        {
            id: "m_test",
            name: "Тестова місія",
            type: "Рекогностування",
            data: {
                routes: [
                    [
                        { lat: 47.694463, lng: 36.086256 },
                        { lat: 47.705000, lng: 36.100000 },
                        { lat: 47.715000, lng: 36.120000 }
                    ]
                ],
                areas: [
                    [
                        { lat: 47.680000, lng: 36.050000 },
                        { lat: 47.690000, lng: 36.050000 },
                        { lat: 47.690000, lng: 36.070000 },
                        { lat: 47.680000, lng: 36.070000 }
                    ]
                ],
                database: [
                    {
                        id: 123456789,
                        name: "Ураження FPV \\ баражуючий боєприпас",
                        tag: "#критично",
                        severity: "критично",
                        rel: [0, 1, 2, 3, 4, 6],
                        latlng: { lat: 47.705000, lng: 36.100000 },
                        measures: ["Постійний моніторинг ефіру", "Використання засобів окопного РЕБ"],
                        secondaries: [],
                        type: "primary"
                    }
                ]
            }
        }
    ];
    currentMissionId = "m_test";
    missionCounter = 1;
    saveMissions();
}

function openNewMissionModal() {
    document.getElementById('mission-name-input').value = `${DEFAULT_MISSION_NAME} #${missionCounter}`;
    document.getElementById('modal-new-mission').classList.remove('hidden');
}

function createMission() {
    const nameInput = document.getElementById('mission-name-input');
    const name = nameInput.value.trim();
    const type = document.getElementById('mission-type-select').value;
    if (!name) return alert("Вкажіть назву місії");
    const id = "m_" + Date.now();
    currentMissionId = id;
    missions.push({ id, name, type, data: { routes: [], areas: [], database: [] } });
    missionCounter++;
    saveMissions();
    closeModals();
    updateMissionSelect();
    handleMissionChange(id);
}

function deleteCurrentMission() {
    if (!currentMissionId) return alert("Оберіть місію для видалення");

    const idx = missions.findIndex(x => x.id === currentMissionId);
    if (idx === -1) {
        currentMissionId = null;
        saveMissions();
        updateMissionSelect();
        handleMissionChange(null);
        return;
    }

    const m = missions[idx];

    if (confirm(`Ви дійсно бажаєте видалити місію "${m.name}"?`)) {
        missions.splice(idx, 1);
        currentMissionId = missions.length > 0 ? missions[0].id : null;

        saveMissions();
        updateMissionSelect();
        handleMissionChange(currentMissionId);
    }
}

function updateMissionSelect() {
    const select = document.getElementById('mission-combo-box');
    select.innerHTML = '<option value="">-- Оберіть місію із списку --</option>';
    missions.forEach((m, idx) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = `#${idx + 1} ${m.type}: ${m.name}`;
        if (m.id === currentMissionId) opt.selected = true;
        select.appendChild(opt);
    });
}

function handleMissionChange(id) {
    currentMissionId = id;
    const routeBtn = document.getElementById('draw-btn-route');
    const areaBtn = document.getElementById('draw-btn-area');
    const deleteBtn = document.getElementById('delete-mission-btn');
    const boxSelectBtn = document.getElementById('box-select-btn');
    const threatBtn = document.getElementById('draw-btn-threat');
    const rulerBtn = document.getElementById('ruler-btn');
    const sidebarContent = document.getElementById('sidebar-content');
    if (!id) {
        routeBtn.classList.add('btn-disabled');
        areaBtn.classList.add('btn-disabled');
        if (deleteBtn) deleteBtn.classList.add('btn-disabled');
        if (boxSelectBtn) boxSelectBtn.classList.add('btn-disabled');
        if (threatBtn) threatBtn.classList.add('btn-disabled');
        if (rulerBtn) rulerBtn.classList.add('btn-disabled');
        clearAllRulerResults();
        activeLayers.clearLayers();
        markersLayer.clearLayers();
        document.getElementById('header-status').innerHTML = 'Очікування...<br>RECO_ENGINE: READY';
        document.getElementById('mission-combo-box').value = "";
        if (sidebarContent) {
            sidebarContent.innerHTML = '<p class="text-slate-500 italic text-center py-20 text-[9px]">Оберіть місію та об\'єкт</p>';
        }
        saveMissions();
        return;
    }
    routeBtn.classList.remove('btn-disabled');
    areaBtn.classList.remove('btn-disabled');
    if (deleteBtn) deleteBtn.classList.remove('btn-disabled');
    if (boxSelectBtn) boxSelectBtn.classList.remove('btn-disabled');
    if (threatBtn) threatBtn.classList.remove('btn-disabled');
    if (rulerBtn) rulerBtn.classList.remove('btn-disabled');
    clearAllRulerResults();

    const m = missions.find(x => x.id === id);
    document.getElementById('header-status').innerHTML = `АКТИВНА МІСІЯ: ${m.name}<br>ТИП: ${m.type}`;

    // Sync the combo-box select value
    document.getElementById('mission-combo-box').value = id;

    if (sidebarContent) {
        sidebarContent.innerHTML = '<p class="text-slate-500 italic text-center py-20 text-[9px]">Оберіть об\'єкт для перегляду заходів</p>';
    }

    activeLayers.clearLayers();
    markersLayer.clearLayers();
    m.data.routes.forEach((c, index) => renderRoute(c, index));
    m.data.areas.forEach((c, index) => renderArea(c, index));
    renderMarkers();
    saveMissions();
}

// --- TOOLBAR ACTIVE STATES ---
function updateToolbarActiveStates() {
    const routeBtn = document.getElementById('draw-btn-route');
    const areaBtn = document.getElementById('draw-btn-area');
    const threatBtn = document.getElementById('draw-btn-threat');
    const boxSelectBtn = document.getElementById('box-select-btn');
    const rulerBtn = document.getElementById('ruler-btn');

    const setActive = (btn, isActive) => {
        if (!btn) return;
        if (isActive) {
            btn.classList.add('bg-emerald-600/40', 'border-emerald-500', 'text-emerald-300');
            btn.classList.remove('bg-slate-900/50', 'border-white/5', 'text-slate-400');
        } else {
            btn.classList.remove('bg-emerald-600/40', 'border-emerald-500', 'text-emerald-300');
            btn.classList.add('bg-slate-900/50', 'border-white/5', 'text-slate-400');
        }
    };

    setActive(routeBtn, isDrawing && drawingMode === 'route');
    setActive(areaBtn, isDrawing && drawingMode === 'area');
    setActive(threatBtn, isPlacingThreat);
    setActive(boxSelectBtn, isBoxSelecting);
    setActive(rulerBtn, isRulerMeasuring);
}

// --- THREAT PLACEMENT ---
function startThreatPlacement() {
    if (!currentMissionId) return alert("Створіть або оберіть місію!");

    if (isDrawing) stopDrawing();
    if (isRulerMeasuring) stopRulerMeasurement();
    if (isBoxSelecting) {
        isBoxSelecting = false;
        map.dragging.enable();
        map.doubleClickZoom.enable();
        document.getElementById('map').style.cursor = '';
        const hint = document.getElementById('draw-hint');
        if (hint) hint.classList.add('hidden');
        if (boxSelectRect) {
            map.removeLayer(boxSelectRect);
            boxSelectRect = null;
        }
    }

    isPlacingThreat = true;
    document.getElementById('map').style.cursor = 'crosshair';
    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.innerText = "Клікніть на карті, щоб додати загрозу";
        hint.classList.remove('hidden');
    }
    updateToolbarActiveStates();
}

function stopThreatPlacement() {
    isPlacingThreat = false;
    document.getElementById('map').style.cursor = '';
    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.classList.add('hidden');
    }
    updateToolbarActiveStates();
}

// --- BOX SELECTION & BATCH DELETION ---
let isBoxSelecting = false;
let boxSelectStartLatLng = null;
let boxSelectRect = null;
let selectedObjects = { routes: [], areas: [], threats: [] };

function startBoxSelect() {
    if (!currentMissionId) return alert("Створіть або оберіть місію!");
    if (isPlacingThreat) stopThreatPlacement();
    if (isDrawing) stopDrawing();
    if (isRulerMeasuring) stopRulerMeasurement();

    isBoxSelecting = true;
    selectedObjects = { routes: [], areas: [], threats: [] };

    // Disable dragging and zoom to allow drawing rectangle
    map.dragging.disable();
    map.doubleClickZoom.disable();
    if (map.boxZoom) map.boxZoom.disable();

    document.getElementById('map').style.cursor = 'crosshair';

    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.innerText = "Затисніть та тягніть мишу для виділення області";
        hint.classList.remove('hidden');
    }
    updateToolbarActiveStates();
}

// --- RULER / DISTANCE MEASUREMENT ---
let isRulerMeasuring = false;
let rulerPoints = [];
let rulerGraphic = null;
let rulerTempLine = null;
let rulerActiveTooltip = null;
let rulerResults = []; // List of finished ruler groups: { line, tooltip, marker }

function startRulerMeasurement() {
    if (!currentMissionId) return alert("Створіть або оберіть місію!");
    if (isPlacingThreat) stopThreatPlacement();
    if (isDrawing) stopDrawing();
    if (isBoxSelecting) {
        isBoxSelecting = false;
        map.dragging.enable();
        map.doubleClickZoom.enable();
        document.getElementById('map').style.cursor = '';
        const hint = document.getElementById('draw-hint');
        if (hint) hint.classList.add('hidden');
        if (boxSelectRect) {
            map.removeLayer(boxSelectRect);
            boxSelectRect = null;
        }
    }

    if (isRulerMeasuring) {
        stopRulerMeasurement();
        return;
    }

    isRulerMeasuring = true;
    rulerPoints = [];

    map.doubleClickZoom.disable();
    document.getElementById('map').style.cursor = 'crosshair';

    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.innerText = "Клікніть на карті для точок вимірювання. Подвійний клік для завершення.";
        hint.classList.remove('hidden');
    }

    updateToolbarActiveStates();
}

function stopRulerMeasurement() {
    isRulerMeasuring = false;
    map.doubleClickZoom.enable();
    document.getElementById('map').style.cursor = '';

    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.classList.add('hidden');
    }

    if (rulerGraphic) {
        map.removeLayer(rulerGraphic);
        rulerGraphic = null;
    }
    if (rulerTempLine) {
        map.removeLayer(rulerTempLine);
        rulerTempLine = null;
    }
    if (rulerActiveTooltip) {
        map.removeLayer(rulerActiveTooltip);
        rulerActiveTooltip = null;
    }
    rulerPoints = [];

    updateToolbarActiveStates();
}

function finalizeRuler() {
    if (rulerPoints.length < 2) {
        stopRulerMeasurement();
        return;
    }

    const finalPoints = [...rulerPoints];
    const totalDist = getRouteLength(finalPoints);

    // Create permanent finalized polyline
    const line = L.polyline(finalPoints, { color: '#eab308', weight: 4, dashArray: '6, 6' }).addTo(map);

    // Create permanent tooltip at the last point with an embedded close button
    const lastPt = finalPoints[finalPoints.length - 1];
    const resultIndex = rulerResults.length;
    const tooltip = L.tooltip({
        permanent: true,
        direction: 'top',
        className: 'ruler-length-tooltip',
        interactive: true
    }).setLatLng(lastPt).setContent(`${formatLength(totalDist)} <span onclick="L.DomEvent.stopPropagation(event); deleteRulerResult(${resultIndex})" style="color:#ef4444; font-weight:900; margin-left:6px; cursor:pointer; font-size:12px; display:inline-block;" title="Видалити вимірювання">×</span>`).addTo(map);

    const result = { line, tooltip };
    rulerResults.push(result);

    stopRulerMeasurement();
}

function deleteRulerResult(idx) {
    const res = rulerResults[idx];
    if (res) {
        if (res.line) map.removeLayer(res.line);
        if (res.tooltip) map.removeLayer(res.tooltip);
        rulerResults[idx] = null;
    }
}

function clearAllRulerResults() {
    rulerResults.forEach((res, idx) => {
        deleteRulerResult(idx);
    });
    rulerResults = [];
}

map.on('mousedown', (e) => {
    if (isBoxSelecting) {
        e.originalEvent.preventDefault();
        boxSelectStartLatLng = e.latlng;
        if (boxSelectRect) map.removeLayer(boxSelectRect);

        boxSelectRect = L.rectangle([e.latlng, e.latlng], {
            color: '#38bdf8',
            weight: 1.5,
            fillOpacity: 0.15,
            dashArray: '4, 4'
        }).addTo(map);
    }
});

map.on('mousemove', (e) => {
    if (isBoxSelecting && boxSelectStartLatLng && boxSelectRect) {
        boxSelectRect.setBounds(L.latLngBounds(boxSelectStartLatLng, e.latlng));
    }
});

map.on('mouseup', (e) => {
    if (isBoxSelecting && boxSelectStartLatLng && boxSelectRect) {
        const bounds = boxSelectRect.getBounds();

        // Find all objects inside the bounds
        findObjectsInBounds(bounds);

        // Cleanup selection rectangle
        map.removeLayer(boxSelectRect);
        boxSelectRect = null;
        boxSelectStartLatLng = null;

        // Restore map behaviors
        isBoxSelecting = false;
        map.dragging.enable();
        map.doubleClickZoom.enable();
        document.getElementById('map').style.cursor = '';

        const hint = document.getElementById('draw-hint');
        if (hint) {
            hint.classList.add('hidden');
        }

        updateToolbarActiveStates();

        // Show delete prompt
        showSelectionDeleteDialog();
    }
});

function findObjectsInBounds(bounds) {
    selectedObjects = { routes: [], areas: [], threats: [] };
    const m = missions.find(x => x.id === currentMissionId);
    if (!m) return;

    // Check threats
    m.data.database.forEach(item => {
        const latlng = L.latLng(item.latlng);
        if (bounds.contains(latlng)) {
            selectedObjects.threats.push(item.id);
        }
    });

    // Check routes
    m.data.routes.forEach((routeCoords, idx) => {
        const inside = routeCoords.some(c => bounds.contains(L.latLng(c)));
        if (inside) {
            selectedObjects.routes.push(idx);
        }
    });

    // Check areas
    m.data.areas.forEach((areaCoords, idx) => {
        const inside = areaCoords.some(c => bounds.contains(L.latLng(c)));
        if (inside) {
            selectedObjects.areas.push(idx);
        }
    });
}

function showSelectionDeleteDialog() {
    const totalCount = selectedObjects.routes.length + selectedObjects.areas.length + selectedObjects.threats.length;
    if (totalCount === 0) {
        alert("У виділеній області не знайдено жодного об'єкта.");
        return;
    }

    const message = `Виділено об'єктів:
- Маршрутів: ${selectedObjects.routes.length}
- Районів позицій: ${selectedObjects.areas.length}
- Загроз: ${selectedObjects.threats.length}

Ви дійсно бажаєте видалити всі ці об'єкти (${totalCount} шт.)?`;

    if (confirm(message)) {
        deleteSelectedObjects();
    }
}

function deleteSelectedObjects() {
    const m = missions.find(x => x.id === currentMissionId);
    if (!m) return;

    // Delete threats
    m.data.database = m.data.database.filter(item => !selectedObjects.threats.includes(item.id));

    // Delete routes (filter by index)
    m.data.routes = m.data.routes.filter((_, idx) => !selectedObjects.routes.includes(idx));

    // Delete areas (filter by index)
    m.data.areas = m.data.areas.filter((_, idx) => !selectedObjects.areas.includes(idx));

    selectedObjects = { routes: [], areas: [], threats: [] };

    saveMissions();
    handleMissionChange(currentMissionId);
}

// --- DRAWING ---
function validateDrawing(mode, startLatLng = null) {
    if (!currentMissionId) return alert("Створіть місію!");
    startDrawing(mode, startLatLng);
}

function startDrawing(mode, startLatLng = null) {
    if (isPlacingThreat) stopThreatPlacement();
    if (isBoxSelecting) {
        isBoxSelecting = false;
        map.dragging.enable();
        map.doubleClickZoom.enable();
        document.getElementById('map').style.cursor = '';
        const hint = document.getElementById('draw-hint');
        if (hint) hint.classList.add('hidden');
        if (boxSelectRect) {
            map.removeLayer(boxSelectRect);
            boxSelectRect = null;
        }
    }

    isDrawing = true;
    drawingMode = mode;
    drawPoints = startLatLng ? [startLatLng] : [];
    if (tempGraphic) map.removeLayer(tempGraphic);

    tempGraphic = mode === 'route'
        ? L.polyline(drawPoints, { color: '#22c55e', weight: 3, dashArray: '5, 5' }).addTo(map)
        : L.polygon(drawPoints, { color: '#10b981', weight: 2, dashArray: '5, 5', fillOpacity: 0.2 }).addTo(map);

    map.doubleClickZoom.disable();
    document.getElementById('map').style.cursor = 'crosshair';
    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.innerText = "Double-Click для фіксації";
        hint.classList.remove('hidden');
    }
    updateToolbarActiveStates();
}

map.on('click', (e) => {
    if (isDrawing) {
        drawPoints.push(e.latlng);
        tempGraphic.setLatLngs(drawPoints);
    }
});

map.on('mousemove', (e) => {
    if (isDrawing && drawPoints.length > 0) {
        tempGraphic.setLatLngs([...drawPoints, e.latlng]);
    }
});

map.on('dblclick', () => {
    if (!isDrawing || drawPoints.length < 2) return;
    const m = missions.find(x => x.id === currentMissionId);
    if (drawingMode === 'route') {
        m.data.routes.push(drawPoints);
        renderRoute(drawPoints, m.data.routes.length - 1);
    } else {
        m.data.areas.push(drawPoints);
        renderArea(drawPoints, m.data.areas.length - 1);
    }
    saveMissions();
    stopDrawing();
});

function stopDrawing() {
    isDrawing = false;
    map.doubleClickZoom.enable();
    document.getElementById('map').style.cursor = '';
    const hint = document.getElementById('draw-hint');
    if (hint) {
        hint.classList.add('hidden');
    }
    if (tempGraphic) map.removeLayer(tempGraphic);
    tempGraphic = null;
    updateToolbarActiveStates();
}

function getRouteLength(coords) {
    if (!coords || coords.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = L.latLng(coords[i]);
        const p2 = L.latLng(coords[i + 1]);
        length += p1.distanceTo(p2);
    }
    return length;
}

function formatLength(meters) {
    if (meters < 1000) {
        return `${Math.round(meters)} м`;
    } else {
        return `${(meters / 1000).toFixed(2)} км`;
    }
}

function getFlatLatLngs(layer) {
    let latlngs = layer.getLatLngs();
    while (Array.isArray(latlngs) && latlngs.length > 0 && Array.isArray(latlngs[0])) {
        latlngs = latlngs[0];
    }
    return latlngs;
}

// Distance from point p to line segment p1-p2 in pixels
function getDistanceToSegment(p, p1, p2) {
    const x = p.x, y = p.y;
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) {
        param = dot / len_sq;
    }

    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// Check if point p is inside polygon vs
function isPointInPolygon(p, vs) {
    const x = p.x, y = p.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, yi = vs[i].y;
        const xj = vs[j].x, yj = vs[j].y;
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Find closest route or area within a pixel threshold
function findNearestLayer(latlng, thresholdPx = 45) {
    let closestLayer = null;
    let minDistance = Infinity;

    const clickPoint = map.latLngToLayerPoint(latlng);

    activeLayers.eachLayer((layer) => {
        if (layer instanceof L.Polyline) {
            const latlngs = getFlatLatLngs(layer);
            const points = latlngs.map(ll => map.latLngToLayerPoint(ll));
            if (points.length < 2) return;

            if (layer instanceof L.Polygon) {
                // If clicked inside the polygon, distance is 0
                const bounds = layer.getBounds();
                if (bounds.contains(latlng)) {
                    if (isPointInPolygon(clickPoint, points)) {
                        closestLayer = layer;
                        minDistance = 0;
                        return;
                    }
                }
            }

            // Calculate minimum distance to polygon/polyline boundary segments
            for (let i = 0; i < points.length; i++) {
                if (i === points.length - 1 && !(layer instanceof L.Polygon)) {
                    continue;
                }
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];

                const dist = getDistanceToSegment(clickPoint, p1, p2);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestLayer = layer;
                }
            }
        }
    });

    if (minDistance <= thresholdPx) {
        return closestLayer;
    }
    return null;
}


function renderRoute(coords, index) {
    const poly = L.polyline(coords, { color: '#22c55e', weight: 5, dashArray: '8, 8' }).addTo(activeLayers);

    // Stop click propagation to prevent map click handler from disabling edit mode
    poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
    });

    // Bind length tooltip to the polyline
    const len = getRouteLength(coords);
    poly.bindTooltip(formatLength(len), {
        permanent: true,
        direction: 'center',
        className: 'route-length-tooltip',
        interactive: false
    });

    // Create delete marker near the first point
    let deleteMarker = null;
    const flat = getFlatLatLngs(poly);
    if (flat && flat.length > 0) {
        const deleteMarkerHtml = `<div class="threat-marker-wrapper">
            <div class="btn-ui btn-close" style="left:-22px; top:-22px;" onclick="confirmDeleteRoute(${index})">×</div>
        </div>`;
        deleteMarker = L.marker(flat[0], {
            icon: L.divIcon({ html: deleteMarkerHtml, className: 'threat-div-icon', iconSize: [0, 0] })
        });
        if (poly.pm.enabled()) {
            deleteMarker.addTo(activeLayers);
        }
    }

    poly.on('pm:enable', () => {
        if (deleteMarker) deleteMarker.addTo(activeLayers);
    });
    poly.on('pm:disable', () => {
        if (deleteMarker) deleteMarker.remove();
    });

    const updateRouteCoords = () => {
        const newCoords = getFlatLatLngs(poly);
        const m = missions.find(x => x.id === currentMissionId);
        if (m) m.data.routes[index] = newCoords;

        // Update length tooltip content dynamically
        const newLen = getRouteLength(newCoords);
        poly.setTooltipContent(formatLength(newLen));

        // Update delete marker position
        const updatedFlat = getFlatLatLngs(poly);
        if (deleteMarker && updatedFlat && updatedFlat.length > 0) {
            deleteMarker.setLatLng(updatedFlat[0]);
        }

        saveMissions();
    };

    // Listen for edit changes to update database coordinates
    poly.on('pm:edit', updateRouteCoords);
    poly.on('pm:update', updateRouteCoords);
    poly.on('pm:dragend', updateRouteCoords);

    // Toggle editing via double-click
    poly.on('dblclick', (e) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) {
            L.DomEvent.stopPropagation(e.originalEvent);
        }
        if (poly.pm.enabled()) {
            poly.pm.disable();
        } else {
            poly.pm.enable({
                allowSelfIntersection: true,
                draggable: true
            });
        }
    });

    // Right-click opens custom context menu
    poly.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
        }
        showContextMenu(e.latlng, e.originalEvent, poly);
    });
}

function renderArea(coords, index) {
    const area = L.polygon(coords, { color: '#10b981', weight: 2, dashArray: '5, 5', fillOpacity: 0.25 }).addTo(activeLayers);

    // Stop click propagation to prevent map click handler from disabling edit mode
    area.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
    });

    // Create delete marker near the first point
    let deleteMarker = null;
    const flat = getFlatLatLngs(area);
    if (flat && flat.length > 0) {
        const deleteMarkerHtml = `<div class="threat-marker-wrapper">
            <div class="btn-ui btn-close" style="left:-22px; top:-22px;" onclick="confirmDeleteArea(${index})">×</div>
        </div>`;
        deleteMarker = L.marker(flat[0], {
            icon: L.divIcon({ html: deleteMarkerHtml, className: 'threat-div-icon', iconSize: [0, 0] })
        });
        if (area.pm.enabled()) {
            deleteMarker.addTo(activeLayers);
        }
    }

    area.on('pm:enable', () => {
        if (deleteMarker) deleteMarker.addTo(activeLayers);
    });
    area.on('pm:disable', () => {
        if (deleteMarker) deleteMarker.remove();
    });

    const updateAreaCoords = () => {
        const newCoords = getFlatLatLngs(area);
        const m = missions.find(x => x.id === currentMissionId);
        if (m) m.data.areas[index] = newCoords;

        // Update delete marker position
        const updatedFlat = getFlatLatLngs(area);
        if (deleteMarker && updatedFlat && updatedFlat.length > 0) {
            deleteMarker.setLatLng(updatedFlat[0]);
        }

        saveMissions();
    };

    // Listen for edit changes to update database coordinates
    area.on('pm:edit', updateAreaCoords);
    area.on('pm:update', updateAreaCoords);
    area.on('pm:dragend', updateAreaCoords);

    // Toggle editing via double-click
    area.on('dblclick', (e) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) {
            L.DomEvent.stopPropagation(e.originalEvent);
        }
        if (area.pm.enabled()) {
            area.pm.disable();
        } else {
            area.pm.enable({
                allowSelfIntersection: true,
                draggable: true
            });
        }
    });

    // Right-click opens custom context menu
    area.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
        }
        showContextMenu(e.latlng, e.originalEvent, area);
    });
}

function triggerThreatModal(latlng) {
    tempLatLng = latlng;
    document.getElementById('modal-threat').classList.remove('hidden');
    toggleThreatTab('primary');
}

// --- THREAT LOGIC ---

function toggleThreatTab(tab) {
    const list = document.getElementById('threat-list');
    list.innerHTML = '';
    const isP = tab === 'primary';
    const src = isP ? PRIMARY_THREATS : SECONDARY_TITLES;

    src.forEach(t => {
        const b = document.createElement('button');
        b.className = "w-full text-left p-2.5 glass-panel border-white/10 hover:bg-emerald-900/40 flex justify-between items-center mb-1 active:scale-95";
        b.innerHTML = isP
            ? `<span class="text-xs font-bold uppercase">${getThreatIcon(t.name)} ${t.name}</span> <span class="text-[9px] font-black opacity-50 px-2 py-1 bg-black/40 rounded">${t.tag}</span>`
            : `<span class="text-xs font-bold text-orange-400 uppercase">${getThreatIcon(t)} ${t}</span>`;

        b.onclick = () => {
            const m = missions.find(x => x.id === currentMissionId);
            m.data.database.push({
                ...(isP ? t : { name: t }),
                id: Date.now(),
                latlng: tempLatLng,
                measures: [],
                secondaries: [],
                type: isP ? 'primary' : 'secondary_indep'
            });
            renderMarkers();
            saveMissions();
            closeModals();
        };
        list.appendChild(b);
    });

    document.getElementById('tab-primary').style.borderBottomColor = isP ? '#10b981' : 'transparent';
    document.getElementById('tab-primary').classList.toggle('text-white', isP);
    document.getElementById('tab-primary').classList.toggle('text-slate-500', !isP);

    document.getElementById('tab-secondary').style.borderBottomColor = !isP ? '#10b981' : 'transparent';
    document.getElementById('tab-secondary').classList.toggle('text-white', !isP);
    document.getElementById('tab-secondary').classList.toggle('text-slate-500', isP);
}

function getProbabilityColorStyle(prob) {
    switch (prob) {
        case 'Дуже часто': return 'color: #ff3333; font-weight: 900; background-color: #374151;'; // Bright red
        case 'Висока ймовірність': return 'color: #dc2626; font-weight: 700; background-color: #374151;'; // Red
        case 'Можливо': return 'color: #f97316; font-weight: 700; background-color: #374151;'; // Orange
        case 'Рідко': return 'color: #facc15; font-weight: 700; background-color: #374151;'; // Yellow
        case 'Малоймовірно': return 'color: #60a5fa; font-weight: 700; background-color: #374151;'; // Blue
        default: return 'color: #cbd5e1; font-weight: bold; background-color: #374151;';
    }
}

function getProbabilityBadgeHtml(prob) {
    if (!prob) return '';
    let color = '';
    switch (prob) {
        case 'Дуже часто': color = '#ff3333'; break;
        case 'Висока ймовірність': color = '#dc2626'; break;
        case 'Можливо': color = '#f97316'; break;
        case 'Рідко': color = '#facc15'; break;
        case 'Малоймовірно': color = '#60a5fa'; break;
        default: color = '#cbd5e1';
    }
    return ` <span style="color: ${color};" class="text-[8px] font-black">[${prob}]</span>`;
}

function renderMarkers() {
    markersLayer.clearLayers();
    if (!currentMissionId) return;
    const m = missions.find(x => x.id === currentMissionId);

    m.data.database.forEach(item => {
        const isP = item.type === 'primary';
        const hasMeasures = item.measures && item.measures.length > 0;
        const diamondClass = isP ? 'sev-' + item.severity : 'sec-diamond';
        const extraClass = hasMeasures ? ' secured' : '';

        const probBadge = getProbabilityBadgeHtml(item.probability);
        const closeBtnHtml = item.editing ? `<div class="btn-ui btn-close" style="left:-28px; top:-28px;" onclick="confirmDeleteObj(${item.id})">×</div>` : '';

        let html = `<div class="threat-marker-wrapper">
            <div class="diamond ${diamondClass}${extraClass}" onclick="L.DomEvent.stopPropagation(event); ${isP ? `viewCombined(${item.id})` : `viewSingle(${item.id}, null)`}" ondblclick="L.DomEvent.stopPropagation(event); toggleThreatEdit(${item.id}, null)" oncontextmenu="L.DomEvent.stopPropagation(event); event.preventDefault(); showThreatContextMenu(${item.id}, null, event)">
            </div>
            ${closeBtnHtml}
            <div class="label-threat ${isP ? 'text-white' : 'text-orange-400'}${window.amplifiersDisabled ? ' hidden' : ''}">${item.name}${probBadge}</div>
            <div class="flex" style="position:absolute; left:0; top:0;">
                ${isP ? `<div class="btn-ui btn-s-sec" style="left:20px; top:12px;" onclick="openLinked(${item.id})"><span>+</span></div>` : ''}
                <div class="btn-ui btn-ctrl" style="left:${isP ? '42px' : '20px'}; top:12px;" onclick="openControls(${item.id}, null)">+</div>
                ${item.measures.length > 0 ? `<div class="btn-ui btn-info" style="left:${isP ? '64px' : '42px'}; top:12px;" onclick="viewSingle(${item.id}, null)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>` : ''}
            </div>`;

        if (isP) {
            item.secondaries.forEach((sec, idx) => {
                const offset = (idx + 1) * 55;
                const secHasMeasures = sec.measures && sec.measures.length > 0;
                const secExtraClass = secHasMeasures ? ' secured' : '';
                const secProbBadge = getProbabilityBadgeHtml(sec.probability);
                const secCloseBtnHtml = sec.editing ? `<div class="btn-ui btn-close" style="left:-25px; top:-25px; width:12px; height:12px;" onclick="confirmDeleteSec(${item.id}, ${idx})">×</div>` : '';

                html += `<div style="position:absolute; top:-${offset}px; left:0;">
                    <div class="diamond sec-diamond${secExtraClass}" onclick="L.DomEvent.stopPropagation(event); viewSingle(${item.id}, ${idx})" ondblclick="L.DomEvent.stopPropagation(event); toggleThreatEdit(${item.id}, ${idx})" oncontextmenu="L.DomEvent.stopPropagation(event); event.preventDefault(); showThreatContextMenu(${item.id}, ${idx}, event)">
                    </div>
                    ${secCloseBtnHtml}
                    <div class="label-threat text-orange-300 italic${window.amplifiersDisabled ? ' hidden' : ''}">${sec.name}${secProbBadge}</div>
                    <div class="flex" style="position:absolute; left:0; top:0;">
                        <div class="btn-ui btn-ctrl" style="left:20px; top:12px;" onclick="openControls(${item.id}, ${idx})">+</div>
                        ${sec.measures.length > 0 ? `<div class="btn-ui btn-info" style="left:42px; top:12px;" onclick="viewSingle(${item.id}, ${idx})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>` : ''}
                    </div>
                </div>`;
            });
        }
        html += `</div>`;

        const marker = L.marker(item.latlng, {
            icon: L.divIcon({ html, className: 'threat-div-icon', iconSize: [0, 0] }),
            draggable: true
        }).addTo(markersLayer);

        marker.on('dragend', () => {
            const newLatLng = marker.getLatLng();
            item.latlng = { lat: newLatLng.lat, lng: newLatLng.lng };
            saveMissions();
        });
    });
}

function toggleThreatEdit(pid, sidx) {
    const m = missions.find(x => x.id === currentMissionId);
    if (!m) return;
    const parent = m.data.database.find(d => d.id === pid);
    if (!parent) return;
    const target = (sidx === null) ? parent : parent.secondaries[sidx];
    if (target) {
        target.editing = !target.editing;
        renderMarkers();
    }
}

// --- BUTTONS LOGIC ---
function openControls(pid, sidx) {
    const m = missions.find(x => x.id === currentMissionId);
    const parent = m.data.database.find(d => d.id === pid);
    const target = (sidx === null) ? parent : parent.secondaries[sidx];

    document.getElementById('controls-title').innerText = target.name;
    const area = document.getElementById('controls-selection-area');
    area.innerHTML = '';

    // Фільтрація по індексу загрози
    const tIdx = THREAT_NAMES.indexOf(target.name);
    const valid = ALL_MEASURES.filter(v => v.rel.includes(tIdx));
    const cats = [...new Set(valid.map(v => v.cat))];

    cats.forEach(cat => {
        const box = document.createElement('div');
        box.className = "mb-6";
        box.innerHTML = `<h4 class="text-emerald-400 font-black uppercase text-[10px] border-b border-emerald-950/30 pb-1 mb-3">${cat}</h4>`;

        const grid = document.createElement('div');
        grid.className = "grid grid-cols-2 lg:grid-cols-4 gap-2";

        valid.filter(v => v.cat === cat).forEach(me => {
            const active = target.measures.includes(me.name);
            const b = document.createElement('button');
            b.className = `p-2 text-[10px] border font-bold text-left rounded transition-colors duration-150 ${active ? 'bg-emerald-600 text-white border-emerald-400' : 'glass-panel border-white/10 text-slate-400 hover:bg-slate-800'}`;
            b.innerText = me.name;
            b.onclick = () => {
                if (!active) {
                    target.measures.push(me.name);
                } else {
                    target.measures = target.measures.filter(x => x !== me.name);
                }
                openControls(pid, sidx); // Reload modal list
                renderMarkers();
                saveMissions();
            };
            grid.appendChild(b);
        });
        box.appendChild(grid);
        area.appendChild(box);
    });
    document.getElementById('modal-controls').classList.remove('hidden');
}

function viewSingle(pid, sidx) {
    const m = missions.find(x => x.id === currentMissionId);
    const parent = m.data.database.find(d => d.id === pid);
    const target = (sidx === null) ? parent : parent.secondaries[sidx];
    const content = document.getElementById('sidebar-content');

    let html = `<div class="bg-slate-800 p-2 border-l-4 border-emerald-500 mb-2 font-bold text-white uppercase text-[10px] tracking-widest">${getThreatIcon(target.name)} ${target.name}</div>`;

    html += `<div class="mb-4 px-3 py-1 bg-slate-900/60 border border-white/5 rounded flex items-center justify-between gap-2">
        <span class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Ймовірність:</span>
        <select onchange="updateSingleThreatProbability(${pid}, ${sidx}, this.value)" style="${getProbabilityColorStyle(target.probability)}" class="probability-select bg-slate-700 text-[11px] outline-none cursor-pointer border border-white/10 rounded px-2 py-0.5 w-44 font-bold">
            <option value="" style="color: #cbd5e1; background-color: #374151;" ${!target.probability ? 'selected' : ''}>-- Не вказано --</option>
            <option value="Дуже часто" style="color: #ff3333; font-weight: 900; background-color: #374151;" ${target.probability === 'Дуже часто' ? 'selected' : ''}>Дуже часто</option>
            <option value="Висока ймовірність" style="color: #dc2626; font-weight: 700; background-color: #374151;" ${target.probability === 'Висока ймовірність' ? 'selected' : ''}>Висока ймовірність</option>
            <option value="Можливо" style="color: #f97316; font-weight: 700; background-color: #374151;" ${target.probability === 'Можливо' ? 'selected' : ''}>Можливо</option>
            <option value="Рідко" style="color: #facc15; font-weight: 700; background-color: #374151;" ${target.probability === 'Рідко' ? 'selected' : ''}>Рідко</option>
            <option value="Малоймовірно" style="color: #60a5fa; font-weight: 700; background-color: #374151;" ${target.probability === 'Малоймовірно' ? 'selected' : ''}>Малоймовірно</option>
        </select>
    </div>`;

    target.measures.forEach(item => {
        html += `<div class="sidebar-item">● ${item}</div>`;
    });

    const linkedTools = opsafeDb.identTools ? opsafeDb.identTools.filter(t => t.threatRelations && t.threatRelations.includes(target.name)) : [];
    if (linkedTools.length > 0) {
        html += `<div class="bg-slate-800/60 px-2.5 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-4 mb-2 border-b border-white/5">Інструменти ідентифікації</div>`;
        linkedTools.forEach(tool => {
            html += `<div class="sidebar-item" style="border-left-color: #6366f1; border-radius: 0 4px 4px 0; background: rgba(99, 102, 241, 0.05);">🔍 ${tool.name}</div>`;
        });
    }

    content.innerHTML = html;
}

function viewCombined(pid) {
    const m = missions.find(x => x.id === currentMissionId);
    const item = m.data.database.find(d => d.id === pid);
    const content = document.getElementById('sidebar-content');

    let html = `<div class="bg-emerald-950/40 p-2 text-center text-[10px] font-black uppercase mb-4 border border-emerald-500/50">ЗВІТ ОБ'ЄКТА</div>`;
    html += `<div class="sidebar-item font-bold text-red-500" style="border-color:#b91c1c; border-left-width:4px; margin-bottom: 2px;">${getThreatIcon(item.name)} ${item.name}</div>`;

    html += `<div class="mb-4 px-3 py-1 bg-slate-900/60 border border-white/5 rounded flex items-center justify-between gap-2">
        <span class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Ймовірність:</span>
        <select onchange="updateSingleThreatProbability(${pid}, null, this.value)" style="${getProbabilityColorStyle(item.probability)}" class="probability-select bg-slate-700 text-[11px] outline-none cursor-pointer border border-white/10 rounded px-2 py-0.5 w-44 font-bold">
            <option value="" style="color: #cbd5e1; background-color: #374151;" ${!item.probability ? 'selected' : ''}>-- Не вказано --</option>
            <option value="Дуже часто" style="color: #ff3333; font-weight: 900; background-color: #374151;" ${item.probability === 'Дуже часто' ? 'selected' : ''}>Дуже часто</option>
            <option value="Висока ймовірність" style="color: #dc2626; font-weight: 700; background-color: #374151;" ${item.probability === 'Висока ймовірність' ? 'selected' : ''}>Висока ймовірність</option>
            <option value="Можливо" style="color: #f97316; font-weight: 700; background-color: #374151;" ${item.probability === 'Можливо' ? 'selected' : ''}>Можливо</option>
            <option value="Рідко" style="color: #facc15; font-weight: 700; background-color: #374151;" ${item.probability === 'Рідко' ? 'selected' : ''}>Рідко</option>
            <option value="Малоймовірно" style="color: #60a5fa; font-weight: 700; background-color: #374151;" ${item.probability === 'Малоймовірно' ? 'selected' : ''}>Малоймовірно</option>
        </select>
    </div>`;

    item.measures.forEach(i => {
        html += `<div class="sidebar-item">● ${i}</div>`;
    });

    const linkedToolsPrimary = opsafeDb.identTools ? opsafeDb.identTools.filter(t => t.threatRelations && t.threatRelations.includes(item.name)) : [];
    if (linkedToolsPrimary.length > 0) {
        html += `<div class="bg-slate-800/60 px-2.5 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2 mb-2 border-b border-white/5">Інструменти ідентифікації</div>`;
        linkedToolsPrimary.forEach(tool => {
            html += `<div class="sidebar-item" style="border-left-color: #6366f1; border-radius: 0 4px 4px 0; background: rgba(99, 102, 241, 0.05);">🔍 ${tool.name}</div>`;
        });
    }

    item.secondaries.forEach((sec, idx) => {
        html += `<div class="sidebar-item font-bold text-orange-400" style="border-color:#f97316; border-left-width:4px; margin-top:8px; margin-bottom: 2px;">${getThreatIcon(sec.name)} ${sec.name}</div>`;

        html += `<div class="mb-2 px-3 py-1 bg-slate-900/60 border border-white/5 rounded flex items-center justify-between gap-2">
            <span class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Ймовірність:</span>
            <select onchange="updateSingleThreatProbability(${pid}, ${idx}, this.value)" style="${getProbabilityColorStyle(sec.probability)}" class="probability-select bg-slate-700 text-[11px] outline-none cursor-pointer border border-white/10 rounded px-2 py-0.5 w-44 font-bold">
                <option value="" style="color: #cbd5e1; background-color: #374151;" ${!sec.probability ? 'selected' : ''}>-- Не вказано --</option>
                <option value="Дуже часто" style="color: #ff3333; font-weight: 900; background-color: #374151;" ${sec.probability === 'Дуже часто' ? 'selected' : ''}>Дуже часто</option>
                <option value="Висока ймовірність" style="color: #dc2626; font-weight: 700; background-color: #374151;" ${sec.probability === 'Висока ймовірність' ? 'selected' : ''}>Висока ймовірність</option>
                <option value="Можливо" style="color: #f97316; font-weight: 700; background-color: #374151;" ${sec.probability === 'Можливо' ? 'selected' : ''}>Можливо</option>
                <option value="Рідко" style="color: #facc15; font-weight: 700; background-color: #374151;" ${sec.probability === 'Рідко' ? 'selected' : ''}>Рідко</option>
                <option value="Малоймовірно" style="color: #60a5fa; font-weight: 700; background-color: #374151;" ${sec.probability === 'Малоймовірно' ? 'selected' : ''}>Малоймовірно</option>
            </select>
        </div>`;

        sec.measures.forEach(i => {
            html += `<div class="sidebar-item">○ ${i}</div>`;
        });

        const linkedToolsSec = opsafeDb.identTools ? opsafeDb.identTools.filter(t => t.threatRelations && t.threatRelations.includes(sec.name)) : [];
        if (linkedToolsSec.length > 0) {
            html += `<div class="bg-slate-800/60 px-2.5 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2 mb-2 border-b border-white/5">Інструменти ідентифікації</div>`;
            linkedToolsSec.forEach(tool => {
                html += `<div class="sidebar-item" style="border-left-color: #6366f1; border-radius: 0 4px 4px 0; background: rgba(99, 102, 241, 0.05);">🔍 ${tool.name}</div>`;
            });
        }
    });
    content.innerHTML = html;
}

function updateSingleThreatProbability(pid, sidx, val) {
    const m = missions.find(x => x.id === currentMissionId);
    if (!m) return;
    const parent = m.data.database.find(d => d.id === pid);
    if (parent) {
        const target = (sidx === null) ? parent : parent.secondaries[sidx];
        if (target) {
            target.probability = val;
            saveMissions();
            renderMarkers();
            if (sidx === null && parent.type === 'primary') {
                viewCombined(pid);
            } else {
                viewSingle(pid, sidx);
            }
        }
    }
}

function confirmDeleteObj(id) {
    if (confirm("Видалити загрозу?")) {
        const m = missions.find(x => x.id === currentMissionId);
        m.data.database = m.data.database.filter(d => d.id !== id);
        renderMarkers();
        saveMissions();
    }
}

function confirmDeleteSec(pid, idx) {
    if (confirm("Видалити загрозу?")) {
        const m = missions.find(x => x.id === currentMissionId);
        const p = m.data.database.find(d => d.id === pid);
        p.secondaries.splice(idx, 1);
        renderMarkers();
        saveMissions();
    }
}

function closeModals() {
    document.querySelectorAll('.fixed').forEach(m => m.classList.add('hidden'));
}

function openLinked(pid) {
    const m = missions.find(x => x.id === currentMissionId);
    const p = m.data.database.find(d => d.id === pid);
    const list = document.getElementById('linked-list');
    list.innerHTML = '';

    p.rel.forEach(idx => {
        const b = document.createElement('button');
        b.className = "w-full text-left p-2 glass-panel border-white/10 hover:bg-orange-950 text-[10px] mb-1 transition-colors";
        b.innerText = SECONDARY_TITLES[idx];
        b.onclick = () => {
            p.secondaries.push({ name: SECONDARY_TITLES[idx], measures: [] });
            renderMarkers();
            saveMissions();
            closeModals();
        };
        list.appendChild(b);
    });
    document.getElementById('modal-linked').classList.remove('hidden');
}

// --- DEEPSTATE MAP FRONTLINE LOADING ---
function styleFrontlineFeature(feature) {
    const geomType = feature.geometry ? feature.geometry.type : null;
    const name = (feature.properties && feature.properties.name) ? feature.properties.name : "";

    // Frontline (LineStrings or MultiLineStrings)
    if (geomType === 'LineString' || geomType === 'MultiLineString') {
        return {
            color: '#ef4444', // Bright red
            weight: 4.5,
            dashArray: '5, 5',
            opacity: 1.0
        };
    }

    // Occupied / Contested Areas (Polygons)
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        if (name === "" || name.includes('Окуповано') || name.includes('Occupied') || name.includes('Crimea') || name.includes('ОРДЛО') || name.includes('Крим')) {
            return {
                fillColor: '#dc2626', // Strong red
                fillOpacity: 0.28,
                color: '#b91c1c',
                weight: 1.5,
                opacity: 0.6
            };
        }
        if (name.includes('Звільнено') || name.includes('Liberated') || name.includes('De-occupied')) {
            return {
                fillColor: '#22c55e',
                fillOpacity: 0.1,
                color: '#16a34a',
                weight: 1,
                opacity: 0.3
            };
        }
        // Gray zone
        return {
            fillColor: '#eab308',
            fillOpacity: 0.15,
            color: '#ca8a04',
            weight: 1,
            opacity: 0.4,
            dashArray: '3, 3'
        };
    }

    return {
        color: '#707070',
        weight: 1,
        opacity: 0.5
    };
}

async function loadDeepStateFrontline() {
    const statusEl = document.getElementById('header-status');
    statusEl.innerHTML = "Очікування...<br>ЗАВАНТАЖЕННЯ ЛБЗ...";

    try {
        // Step 1: Query GitHub API for the list of files in the data directory
        const apiRes = await fetch('https://api.github.com/repos/cyterat/deepstate-map-data/contents/data');
        if (!apiRes.ok) {
            throw new Error(`GitHub API returned status ${apiRes.status}`);
        }

        const files = await apiRes.json();
        if (!Array.isArray(files) || files.length === 0) {
            throw new Error("No files returned from GitHub contents API");
        }

        // Filter for geojson files matching the pattern
        const geojsonFiles = files.filter(f => f.name.startsWith('deepstatemap_data_') && f.name.endsWith('.geojson'));
        if (geojsonFiles.length === 0) {
            throw new Error("No matching geojson files found in repository");
        }

        // Sort chronologically (alphabetical sorting matches chronological since format is YYYYMMDD)
        geojsonFiles.sort((a, b) => a.name.localeCompare(b.name));

        // The last file in the sorted array is the latest
        const latestFile = geojsonFiles[geojsonFiles.length - 1];

        // Extract the date from filename for display (e.g. deepstatemap_data_20240803.geojson)
        const dateMatch = latestFile.name.match(/deepstatemap_data_(\d{4})(\d{2})(\d{2})\.geojson/);
        const displayDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : latestFile.name;

        // Step 2: Fetch the actual GeoJSON content from the raw download URL
        const geojsonRes = await fetch(latestFile.download_url);
        if (!geojsonRes.ok) {
            throw new Error(`Failed to download GeoJSON from ${latestFile.download_url}`);
        }

        const geojsonData = await geojsonRes.json();

        // Step 3: Clear and add to map
        frontlineLayer.clearLayers();
        const geojsonGroup = L.geoJSON(geojsonData, {
            style: styleFrontlineFeature,
            onEachFeature: (feature, layer) => {
                if (feature.properties && feature.properties.name) {
                    layer.bindTooltip(feature.properties.name, { sticky: true, className: 'frontline-feature-tooltip' });
                }
            }
        }).addTo(frontlineLayer);

        // Fit bounds to frontline (Disabled to preserve default zoom configuration)
        // if (geojsonGroup.getBounds().isValid()) {
        //     map.fitBounds(geojsonGroup.getBounds());
        // }

        statusEl.innerHTML = `Очікування...<br>ЛБЗ: ЗАВАНТАЖЕНО (${displayDate})`;
    } catch (err) {
        console.error("Error loading DeepState frontline via API:", err);

        // Fallback: If GitHub API fails (e.g. rate limit), try to guess the last 5 days in YYYYMMDD format
        console.log("Attempting date-guessing fallback...");
        const dates = [];
        for (let i = 0; i < 5; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            dates.push(`${yyyy}${mm}${dd}`);
        }

        let geojsonData = null;
        let loadedDate = null;

        for (const date of dates) {
            const url = `https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${date}.geojson`;
            try {
                const res = await fetch(url);
                if (res.ok) {
                    geojsonData = await res.json();
                    loadedDate = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
                    break;
                }
            } catch (e) {
                // ignore
            }
        }

        if (geojsonData) {
            try {
                frontlineLayer.clearLayers();
                const geojsonGroup = L.geoJSON(geojsonData, {
                    style: styleFrontlineFeature,
                    onEachFeature: (feature, layer) => {
                        if (feature.properties && feature.properties.name) {
                            layer.bindTooltip(feature.properties.name, { sticky: true, className: 'frontline-feature-tooltip' });
                        }
                    }
                }).addTo(frontlineLayer);

                // Fit bounds to frontline (Disabled to preserve default zoom configuration)
                // if (geojsonGroup.getBounds().isValid()) {
                //     map.fitBounds(geojsonGroup.getBounds());
                // }

                statusEl.innerHTML = `Очікування...<br>ЛБЗ: ЗАВАНТАЖЕНО (${loadedDate})`;
                return;
            } catch (innerErr) {
                console.error("Error rendering fallback frontline:", innerErr);
            }
        }

        statusEl.innerHTML = "Очікування...<br><span class='text-red-500'>ПОМИЛКА ЛБЗ</span>";
    }
}

// Automatically load frontline on map load
loadDeepStateFrontline();

async function loadBaseRoutes() {
    try {
        let kmlText = '';
        try {
            const res = await fetch('res/logistika.kml');
            if (res.ok) {
                kmlText = await res.text();
            }
        } catch (fetchErr) {
            console.warn("Fetch failed, attempting fallback to window.logistikaKml:", fetchErr);
        }

        if (!kmlText && window.logistikaKml) {
            kmlText = window.logistikaKml;
        }

        if (!kmlText) {
            throw new Error("Could not load KML data from fetch or fallback");
        }

        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, 'text/xml');

        // Check for parsing errors
        const parserError = kmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error(`KML parsing error: ${parserError.textContent}`);
        }

        const placemarks = kmlDoc.getElementsByTagName('Placemark');
        baseRoutesLayer.clearLayers();

        for (let i = 0; i < placemarks.length; i++) {
            const placemark = placemarks[i];

            // Extract Name
            const nameEl = placemark.getElementsByTagName('name')[0];
            const name = nameEl ? nameEl.textContent.trim() : '';

            // Extract Comments
            const dataElements = placemark.getElementsByTagName('Data');
            let comment = '';
            for (let k = 0; k < dataElements.length; k++) {
                if (dataElements[k].getAttribute('name') === 'comments') {
                    const valEl = dataElements[k].getElementsByTagName('value')[0];
                    if (valEl) {
                        comment = valEl.textContent.trim();
                    }
                    break;
                }
            }

            // Extract coordinates
            const lineStrings = placemark.getElementsByTagName('LineString');
            for (let j = 0; j < lineStrings.length; j++) {
                const coordsEl = lineStrings[j].getElementsByTagName('coordinates')[0];
                if (coordsEl) {
                    const coordsText = coordsEl.textContent.trim();
                    const pts = coordsText.split(/\s+/).map(str => {
                        const parts = str.split(',');
                        if (parts.length >= 2) {
                            const lon = parseFloat(parts[0]);
                            const lat = parseFloat(parts[1]);
                            if (!isNaN(lat) && !isNaN(lon)) {
                                return [lat, lon];
                            }
                        }
                        return null;
                    }).filter(pt => pt !== null);

                    if (pts.length >= 2) {
                        const poly = L.polyline(pts, {
                            color: '#a855f7', // Purple color for base logistics routes
                            weight: 3.0,
                            dashArray: '6, 6',
                            opacity: 0.85 // Bright
                        }).addTo(baseRoutesLayer);

                        // Stop click propagation to prevent map click handler from disabling edit mode
                        poly.on('click', (e) => {
                            L.DomEvent.stopPropagation(e);
                        });

                        // Prepare tooltip
                        let tooltipText = '';
                        if (name) {
                            tooltipText += `<strong style="display:block; margin-bottom: 2px;">${name}</strong>`;
                        }
                        if (comment) {
                            tooltipText += `<span style="font-size: 10px; color: #cbd5e1; white-space: normal; display: block; max-width: 200px;">${comment}</span>`;
                        }

                        if (tooltipText) {
                            poly.bindTooltip(tooltipText, {
                                sticky: true,
                                className: 'base-route-tooltip'
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error("Error loading or parsing base routes KML:", err);
    }
}

// Automatically load base routes on map load
loadBaseRoutes();

// Load saved missions on startup
loadMissions();
updateMissionSelect();
if (currentMissionId) {
    handleMissionChange(currentMissionId);
}

// --- DATABASE SETTINGS INTERFACE ---
let currentSettingsTab = 'threats';
let editingMeasureIndex = null;
let measureFilterText = "";
let editingToolIndex = null;
let toolFilterText = "";

function openSettingsModal() {
    closeModals();
    document.getElementById('modal-settings').classList.remove('hidden');
    switchSettingsTab('threats');
}

function switchSettingsTab(tab) {
    currentSettingsTab = tab;
    const tabs = ['threats', 'measures', 'tools', 'connections'];
    
    // Check if the tab button is style-colored blue or green
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400') ||
                      document.getElementById('settings-tab-threats').classList.contains('border-emerald-500');
    const activeColor = isEmerald ? 'text-emerald-400 border-emerald-500' : 'text-blue-400 border-blue-500';
    const activeClassParts = activeColor.split(' ');
    
    tabs.forEach(t => {
        const btn = document.getElementById('settings-tab-' + t);
        if (!btn) return;
        if (t === tab) {
            btn.classList.add(activeClassParts[0], activeClassParts[1]);
            btn.classList.remove('text-slate-400', 'border-transparent');
        } else {
            btn.classList.remove(activeClassParts[0], activeClassParts[1]);
            btn.classList.add('text-slate-400', 'border-transparent');
        }
    });
    
    renderSettingsTabContent();
}

function resetDbToDefault() {
    if (confirm("Ви дійсно хочете скинути базу даних до початкових значень? Усі ваші зміни буде втрачено!")) {
        opsafeDb = JSON.parse(JSON.stringify(DEFAULT_OPSAFE_DB));
        saveOpsafeDb();
        renderSettingsTabContent();
        renderMarkers();
        if (currentMissionId) handleMissionChange(currentMissionId);
    }
}

function renderSettingsTabContent() {
    const container = document.getElementById('settings-tab-content');
    if (!container) return;
    container.innerHTML = '';
    
    if (currentSettingsTab === 'threats') {
        renderThreatsSettings(container);
    } else if (currentSettingsTab === 'measures') {
        renderMeasuresSettings(container);
    } else if (currentSettingsTab === 'tools') {
        renderToolsSettings(container);
    } else if (currentSettingsTab === 'connections') {
        renderConnectionsSettings(container);
    }
}

function renderThreatsSettings(container) {
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400');
    const accentBtn = isEmerald ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
    
    const wrapper = document.createElement('div');
    wrapper.className = "grid grid-cols-1 md:grid-cols-2 gap-6 h-full min-h-[50vh]";
    
    const colPrimary = document.createElement('div');
    colPrimary.className = "flex flex-col h-[55vh] border border-white/5 bg-slate-900/40 p-4 rounded-xl";
    colPrimary.innerHTML = `
        <div class="flex justify-between items-center mb-4 border-b border-white/10 pb-2 shrink-0">
            <h4 class="text-white font-bold text-xs uppercase tracking-wider">Основні загрози</h4>
            <button onclick="addNewPrimaryThreat()" class="${accentBtn} text-white font-bold text-[10px] px-2 py-1 rounded uppercase tracking-wider">+ Додати</button>
        </div>
        <div class="flex-1 overflow-y-auto space-y-2" id="settings-primary-threats-list"></div>
    `;
    
    const colSecondary = document.createElement('div');
    colSecondary.className = "flex flex-col h-[55vh] border border-white/5 bg-slate-900/40 p-4 rounded-xl";
    colSecondary.innerHTML = `
        <div class="flex justify-between items-center mb-4 border-b border-white/10 pb-2 shrink-0">
            <h4 class="text-white font-bold text-xs uppercase tracking-wider">Вторинні загрози</h4>
            <button onclick="addNewSecondaryThreat()" class="${accentBtn} text-white font-bold text-[10px] px-2 py-1 rounded uppercase tracking-wider">+ Додати</button>
        </div>
        <div class="flex-1 overflow-y-auto space-y-2" id="settings-secondary-threats-list"></div>
    `;
    
    wrapper.appendChild(colPrimary);
    wrapper.appendChild(colSecondary);
    container.appendChild(wrapper);
    
    const listPrimary = colPrimary.querySelector('#settings-primary-threats-list');
    opsafeDb.primaryThreats.forEach((t, index) => {
        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-slate-900/80 p-2.5 rounded border border-white/5 hover:border-white/10";
        item.innerHTML = `
            <div class="flex-1 min-w-0 pr-2">
                <div class="text-xs font-bold text-white truncate" title="${t.name}">${getThreatIcon(t.name)} ${t.name}</div>
                <div class="text-[9px] text-slate-400 uppercase font-mono">Важливість: <span class="${t.severity === 'катастрофічно' ? 'text-red-500' : t.severity === 'критично' ? 'text-orange-500' : 'text-yellow-500'} font-bold">${t.severity}</span></div>
            </div>
            <div class="flex gap-1.5 shrink-0">
                <button onclick="editPrimaryThreat(${index})" title="Редагувати" class="p-1 rounded bg-slate-800 text-blue-400 hover:text-blue-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <button onclick="deletePrimaryThreat(${index})" title="Видалити" class="p-1 rounded bg-slate-800 text-red-400 hover:text-red-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
            </div>
        `;
        listPrimary.appendChild(item);
    });
    
    const listSecondary = colSecondary.querySelector('#settings-secondary-threats-list');
    opsafeDb.secondaryThreats.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = "flex justify-between items-center bg-slate-900/80 p-2.5 rounded border border-white/5 hover:border-white/10";
        item.innerHTML = `
            <div class="flex-1 min-w-0 pr-2">
                <div class="text-xs font-bold text-white truncate" title="${name}">${getThreatIcon(name)} ${name}</div>
            </div>
            <div class="flex gap-1.5 shrink-0">
                <button onclick="editSecondaryThreat(${index})" title="Редагувати" class="p-1 rounded bg-slate-800 text-blue-400 hover:text-blue-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <button onclick="deleteSecondaryThreat(${index})" title="Видалити" class="p-1 rounded bg-slate-800 text-red-400 hover:text-red-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
            </div>
        `;
        listSecondary.appendChild(item);
    });
}

function addNewPrimaryThreat() {
    const name = prompt("Введіть назву нової основної загрози:");
    if (!name) return;
    const cleaned = name.trim();
    if (cleaned === "") return;
    
    if (opsafeDb.primaryThreats.some(t => t.name.toLowerCase() === cleaned.toLowerCase())) {
        alert("Така загроза вже існує!");
        return;
    }
    
    const severity = prompt("Вкажіть рівень важливості (помірно, критично, катастрофічно):", "критично");
    if (!severity) return;
    const sCleaned = severity.trim().toLowerCase();
    
    opsafeDb.primaryThreats.push({ name: cleaned, severity: sCleaned });
    opsafeDb.threatConnections.push({ primaryThreat: cleaned, secondaryThreats: [] });
    
    saveOpsafeDb();
    renderSettingsTabContent();
    renderMarkers();
}

function editPrimaryThreat(index) {
    const t = opsafeDb.primaryThreats[index];
    const newName = prompt("Введіть нову назву для основної загрози:", t.name);
    if (!newName) return;
    const cleaned = newName.trim();
    if (cleaned === "") return;
    
    const newSeverity = prompt("Вкажіть рівень важливості (помірно, критично, катастрофічно):", t.severity);
    if (!newSeverity) return;
    const sCleaned = newSeverity.trim().toLowerCase();
    
    opsafeDb.threatConnections.forEach(tc => {
        if (tc.primaryThreat === t.name) {
            tc.primaryThreat = cleaned;
        }
    });
    
    opsafeDb.measures.forEach(m => {
        m.threatRelations = m.threatRelations.map(n => n === t.name ? cleaned : n);
    });
    
    if (opsafeDb.identTools) {
        opsafeDb.identTools.forEach(it => {
            it.threatRelations = it.threatRelations.map(n => n === t.name ? cleaned : n);
        });
    }
    
    missions.forEach(m => {
        m.data.database.forEach(d => {
            if (d.name === t.name) {
                d.name = cleaned;
                d.severity = sCleaned;
                d.tag = "#" + sCleaned;
            }
        });
    });
    
    t.name = cleaned;
    t.severity = sCleaned;
    
    saveOpsafeDb();
    saveMissions();
    renderSettingsTabContent();
    renderMarkers();
    if (currentMissionId) handleMissionChange(currentMissionId);
}

function deletePrimaryThreat(index) {
    const t = opsafeDb.primaryThreats[index];
    if (confirm(`Ви дійсно бажаєте видалити загрозу "${t.name}"?`)) {
        opsafeDb.threatConnections = opsafeDb.threatConnections.filter(tc => tc.primaryThreat !== t.name);
        
        opsafeDb.measures.forEach(m => {
            m.threatRelations = m.threatRelations.filter(n => n !== t.name);
        });
        
        if (opsafeDb.identTools) {
            opsafeDb.identTools.forEach(it => {
                it.threatRelations = it.threatRelations.filter(n => n !== t.name);
            });
        }
        
        opsafeDb.primaryThreats.splice(index, 1);
        
        saveOpsafeDb();
        renderSettingsTabContent();
        renderMarkers();
        if (currentMissionId) handleMissionChange(currentMissionId);
    }
}

function addNewSecondaryThreat() {
    const name = prompt("Введіть назву нової вторинної загрози:");
    if (!name) return;
    const cleaned = name.trim();
    if (cleaned === "") return;
    
    if (opsafeDb.secondaryThreats.includes(cleaned)) {
        alert("Така загроза вже існує!");
        return;
    }
    
    opsafeDb.secondaryThreats.push(cleaned);
    
    saveOpsafeDb();
    renderSettingsTabContent();
    renderMarkers();
}

function editSecondaryThreat(index) {
    const oldName = opsafeDb.secondaryThreats[index];
    const newName = prompt("Введіть нову назву для вторинної загрози:", oldName);
    if (!newName) return;
    const cleaned = newName.trim();
    if (cleaned === "") return;
    
    opsafeDb.threatConnections.forEach(tc => {
        tc.secondaryThreats = tc.secondaryThreats.map(n => n === oldName ? cleaned : n);
    });
    
    opsafeDb.measures.forEach(m => {
        m.threatRelations = m.threatRelations.map(n => n === oldName ? cleaned : n);
    });
    
    if (opsafeDb.identTools) {
        opsafeDb.identTools.forEach(it => {
            it.threatRelations = it.threatRelations.map(n => n === oldName ? cleaned : n);
        });
    }
    
    missions.forEach(m => {
        m.data.database.forEach(d => {
            if (d.name === oldName) d.name = cleaned;
            d.secondaries.forEach(sec => {
                if (sec.name === oldName) sec.name = cleaned;
            });
        });
    });
    
    opsafeDb.secondaryThreats[index] = cleaned;
    
    saveOpsafeDb();
    saveMissions();
    renderSettingsTabContent();
    renderMarkers();
    if (currentMissionId) handleMissionChange(currentMissionId);
}

function deleteSecondaryThreat(index) {
    const name = opsafeDb.secondaryThreats[index];
    if (confirm(`Ви дійсно бажаєте видалити вторинну загрозу "${name}"?`)) {
        opsafeDb.threatConnections.forEach(tc => {
            tc.secondaryThreats = tc.secondaryThreats.filter(n => n !== name);
        });
        
        opsafeDb.measures.forEach(m => {
            m.threatRelations = m.threatRelations.filter(n => n !== name);
        });
        
        if (opsafeDb.identTools) {
            opsafeDb.identTools.forEach(it => {
                it.threatRelations = it.threatRelations.filter(n => n !== name);
            });
        }
        
        opsafeDb.secondaryThreats.splice(index, 1);
        
        saveOpsafeDb();
        renderSettingsTabContent();
        renderMarkers();
        if (currentMissionId) handleMissionChange(currentMissionId);
    }
}

function renderMeasuresSettings(container) {
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400') ||
                      document.getElementById('settings-tab-threats').classList.contains('border-emerald-500');
    const accentBtn = isEmerald ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
    
    const splitView = document.createElement('div');
    splitView.className = "flex flex-col lg:flex-row gap-6 h-full min-h-[50vh]";
    
    const listPane = document.createElement('div');
    listPane.className = "w-full lg:w-1/2 flex flex-col border border-white/5 bg-slate-900/40 p-4 rounded-xl h-[55vh]";
    listPane.innerHTML = `
        <div class="flex gap-2 mb-3 shrink-0">
            <input type="text" id="measure-search-input" value="${measureFilterText}" placeholder="Пошук заходів..." class="flex-1 bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500">
            <button onclick="addNewMeasure()" class="${accentBtn} text-white font-bold text-[10px] px-3 py-1.5 rounded uppercase tracking-wider shrink-0">+ Додати</button>
        </div>
        <div class="flex-1 overflow-y-auto space-y-1.5 pr-1" id="settings-measures-list"></div>
    `;
    
    const editPane = document.createElement('div');
    editPane.className = "w-full lg:w-1/2 flex flex-col border border-white/5 bg-slate-900/40 p-4 rounded-xl h-[55vh] overflow-y-auto";
    editPane.id = "settings-measure-edit-pane";
    
    splitView.appendChild(listPane);
    splitView.appendChild(editPane);
    container.appendChild(splitView);
    
    const searchInput = listPane.querySelector('#measure-search-input');
    searchInput.addEventListener('input', (e) => {
        measureFilterText = e.target.value.toLowerCase();
        populateMeasuresList(accentBtn);
    });
    
    populateMeasuresList(accentBtn);
    populateMeasureEditForm();
}

function populateMeasuresList(btnClass) {
    const listContainer = document.getElementById('settings-measures-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    opsafeDb.measures.forEach((m, idx) => {
        if (measureFilterText && !m.name.toLowerCase().includes(measureFilterText)) return;
        
        const item = document.createElement('div');
        const isActive = editingMeasureIndex === idx;
        const activeClass = isActive ? 'bg-slate-800 border-emerald-500/50' : 'bg-slate-900/80 border-white/5 hover:bg-slate-900';
        item.className = `flex justify-between items-center p-2.5 rounded border transition-all cursor-pointer ${activeClass}`;
        item.onclick = () => {
            editingMeasureIndex = idx;
            populateMeasuresList(btnClass);
            populateMeasureEditForm();
        };
        
        item.innerHTML = `
            <div class="flex-1 min-w-0 pr-2">
                <div class="text-xs font-bold text-white truncate" title="${m.name}">${m.name}</div>
                <div class="text-[9px] text-slate-400 uppercase font-mono">${m.category || 'Без категорії'}</div>
            </div>
            <div class="flex gap-2 shrink-0">
                <button onclick="event.stopPropagation(); deleteMeasure(${idx})" title="Видалити" class="p-1 rounded bg-slate-800 text-red-400 hover:text-red-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function populateMeasureEditForm() {
    const editContainer = document.getElementById('settings-measure-edit-pane');
    if (!editContainer) return;
    if (editingMeasureIndex === null || editingMeasureIndex >= opsafeDb.measures.length) {
        editContainer.innerHTML = `
            <div class="flex-1 flex items-center justify-center text-slate-500 italic text-xs">
                Оберіть захід контролю з лівого списку для редагування або натисніть "+ Додати"
            </div>
        `;
        return;
    }
    
    const m = opsafeDb.measures[editingMeasureIndex];
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400');
    const saveBtnClass = isEmerald ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
    const accentBorder = isEmerald ? 'focus:border-emerald-500' : 'focus:border-blue-500';
    
    const activeMissions = (m.missionType || '').split(',').map(x => x.trim()).filter(Boolean);
    const activeResponses = (m.responseType || '').split(',').map(x => x.trim()).filter(Boolean);
    const activeStages = (m.planningStage || '').split(',').map(x => x.trim()).filter(Boolean);

    let html = `
        <h4 class="text-white font-bold text-xs uppercase tracking-wider mb-4 border-b border-white/10 pb-2">Редагування заходу</h4>
        <div class="space-y-4">
            <div>
                <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Назва заходу</label>
                <textarea id="edit-measure-name" class="w-full bg-slate-900 border border-slate-700 p-2 text-white rounded text-xs outline-none ${accentBorder} min-h-[60px] resize-y">${m.name}</textarea>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Функціональна категорія</label>
                    <select id="edit-measure-category" class="w-full bg-slate-900 border border-slate-700 p-2 text-white rounded text-xs outline-none ${accentBorder}">
                        <option value="Тактичні" ${m.category === 'Тактичні' ? 'selected' : ''}>Тактичні</option>
                        <option value="Інформаційна безпека" ${m.category === 'Інформаційна безпека' ? 'selected' : ''}>Інформаційна безпека</option>
                        <option value="Інженерні" ${m.category === 'Інженерні' ? 'selected' : ''}>Інженерні</option>
                        <option value="Технічні" ${m.category === 'Технічні' ? 'selected' : ''}>Технічні</option>
                        <option value="Ударно-вогневі" ${m.category === 'Ударно-вогневі' ? 'selected' : ''}>Ударно-вогневі</option>
                        <option value="Розвідувально-інформаційні" ${m.category === 'Розвідувально-інформаційні' ? 'selected' : ''}>Розвідувально-інформаційні</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Категорія впровадження</label>
                    <select id="edit-measure-impl" class="w-full bg-slate-900 border border-slate-700 p-2 text-white rounded text-xs outline-none ${accentBorder}">
                        <option value="Планувальні" ${m.implementation === 'Планувальні' ? 'selected' : ''}>Планувальні</option>
                        <option value="Операційні" ${m.implementation === 'Операційні' ? 'selected' : ''}>Операційні</option>
                        <option value="Регламентні" ${m.implementation === 'Регламентні' ? 'selected' : ''}>Регламентні</option>
                        <option value="Нагляд та контроль" ${m.implementation === 'Нагляд та контроль' ? 'selected' : ''}>Нагляд та контроль</option>
                        <option value="Навчання" ${m.implementation === 'Навчання' ? 'selected' : ''}>Навчання</option>
                        <option value="Координаційні" ${m.implementation === 'Координаційні' ? 'selected' : ''}>Координаційні</option>
                    </select>
                </div>
            </div>
            
            <div class="grid grid-cols-3 gap-2">
                <div>
                    <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Тип місії</label>
                    <div class="flex flex-wrap gap-1 mt-1">
                        ${['рекон', 'маневр', 'позиція'].map(opt => {
                            const active = activeMissions.includes(opt);
                            const actCls = active ? (isEmerald ? 'bg-emerald-600 border-emerald-500 text-white font-bold active-pill' : 'bg-blue-600 border-blue-500 text-white font-bold active-pill') : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200';
                            return `<button type="button" data-val="${opt}" class="pill-mission px-2 py-0.5 rounded text-[10px] border active:scale-95 transition-all ${actCls}" onclick="this.classList.toggle('${isEmerald ? 'bg-emerald-600' : 'bg-blue-600'}'); this.classList.toggle('${isEmerald ? 'border-emerald-500' : 'border-blue-500'}'); this.classList.toggle('text-white'); this.classList.toggle('font-bold'); this.classList.toggle('bg-slate-900'); this.classList.toggle('border-slate-700'); this.classList.toggle('text-slate-400'); this.classList.toggle('hover:text-slate-200'); this.classList.toggle('active-pill');">${opt}</button>`;
                        }).join('')}
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Тип реагування</label>
                    <div class="flex flex-wrap gap-1 mt-1">
                        ${['уникнення ризику', 'зменшення ризику', 'розподіл ризику', 'перенесення ризику', 'прийняття ризику'].map(opt => {
                            const active = activeResponses.includes(opt);
                            const actCls = active ? (isEmerald ? 'bg-emerald-600 border-emerald-500 text-white font-bold active-pill' : 'bg-blue-600 border-blue-500 text-white font-bold active-pill') : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200';
                            return `<button type="button" data-val="${opt}" class="pill-response px-2 py-0.5 rounded text-[10px] border active:scale-95 transition-all ${actCls}" onclick="this.classList.toggle('${isEmerald ? 'bg-emerald-600' : 'bg-blue-600'}'); this.classList.toggle('${isEmerald ? 'border-emerald-500' : 'border-blue-500'}'); this.classList.toggle('text-white'); this.classList.toggle('font-bold'); this.classList.toggle('bg-slate-900'); this.classList.toggle('border-slate-700'); this.classList.toggle('text-slate-400'); this.classList.toggle('hover:text-slate-200'); this.classList.toggle('active-pill');">${opt}</button>`;
                        }).join('')}
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Етап планування</label>
                    <div class="flex flex-wrap gap-1 mt-1">
                        ${['плановий', 'передопераційний', 'операційний'].map(opt => {
                            const active = activeStages.includes(opt);
                            const actCls = active ? (isEmerald ? 'bg-emerald-600 border-emerald-500 text-white font-bold active-pill' : 'bg-blue-600 border-blue-500 text-white font-bold active-pill') : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200';
                            return `<button type="button" data-val="${opt}" class="pill-stage px-2 py-0.5 rounded text-[10px] border active:scale-95 transition-all ${actCls}" onclick="this.classList.toggle('${isEmerald ? 'bg-emerald-600' : 'bg-blue-600'}'); this.classList.toggle('${isEmerald ? 'border-emerald-500' : 'border-blue-500'}'); this.classList.toggle('text-white'); this.classList.toggle('font-bold'); this.classList.toggle('bg-slate-900'); this.classList.toggle('border-slate-700'); this.classList.toggle('text-slate-400'); this.classList.toggle('hover:text-slate-200'); this.classList.toggle('active-pill');">${opt}</button>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            
            <div>
                <label class="block text-[10px] text-slate-400 uppercase mb-2 font-bold">Зв'язок з загрозами (активує цей захід для загрози)</label>
                <div class="border border-white/5 bg-black/20 rounded-lg p-3 max-h-[160px] overflow-y-auto space-y-2">
    `;
    
    html += `<div class="text-[9px] text-emerald-400 font-bold uppercase tracking-wider border-b border-white/5 pb-0.5 mb-1.5">Основні загрози:</div>`;
    opsafeDb.primaryThreats.forEach(t => {
        const checked = m.threatRelations.includes(t.name) ? 'checked' : '';
        html += `
            <label class="flex items-start gap-2 text-[11px] text-slate-300 hover:text-white cursor-pointer select-none">
                <input type="checkbox" name="edit-measure-threat" value="${t.name}" ${checked} class="mt-0.5 accent-emerald-500">
                <span>${t.name}</span>
            </label>
        `;
    });
    
    html += `<div class="text-[9px] text-orange-400 font-bold uppercase tracking-wider border-b border-white/5 pb-0.5 mt-3 mb-1.5">Вторинні загрози:</div>`;
    opsafeDb.secondaryThreats.forEach(name => {
        const checked = m.threatRelations.includes(name) ? 'checked' : '';
        html += `
            <label class="flex items-start gap-2 text-[11px] text-slate-300 hover:text-white cursor-pointer select-none">
                <input type="checkbox" name="edit-measure-threat" value="${name}" ${checked} class="mt-0.5 accent-orange-500">
                <span>${name}</span>
            </label>
        `;
    });
    
    html += `
                </div>
            </div>
            
            <div class="flex gap-2 pt-2 border-t border-white/10 shrink-0">
                <button onclick="cancelMeasureEdit()" class="flex-1 py-2 text-[10px] uppercase font-bold border border-white/10 text-slate-400 rounded">Скасувати</button>
                <button onclick="saveMeasureEdit(${editingMeasureIndex})" class="flex-1 py-2 text-[10px] uppercase font-bold ${saveBtnClass} text-white rounded">Зберегти зміни</button>
            </div>
        </div>
    `;
    
    editContainer.innerHTML = html;
}

function cancelMeasureEdit() {
    editingMeasureIndex = null;
    renderSettingsTabContent();
}

function saveMeasureEdit(idx) {
    const name = document.getElementById('edit-measure-name').value.trim();
    if (name === "") return alert("Назва заходу не може бути порожньою!");
    
    const category = document.getElementById('edit-measure-category').value.trim();
    const implementation = document.getElementById('edit-measure-impl').value.trim();
    const missionType = Array.from(document.querySelectorAll('.pill-mission.active-pill')).map(p => p.getAttribute('data-val')).join(', ');
    const responseType = Array.from(document.querySelectorAll('.pill-response.active-pill')).map(p => p.getAttribute('data-val')).join(', ');
    const planningStage = Array.from(document.querySelectorAll('.pill-stage.active-pill')).map(p => p.getAttribute('data-val')).join(', ');
    
    const checkBoxes = document.getElementsByName('edit-measure-threat');
    const threatRelations = [];
    Array.from(checkBoxes).forEach(cb => {
        if (cb.checked) threatRelations.push(cb.value);
    });
    
    const m = opsafeDb.measures[idx];
    const oldName = m.name;
    
    missions.forEach(mission => {
        mission.data.database.forEach(d => {
            d.measures = d.measures.map(val => val === oldName ? name : val);
            d.secondaries.forEach(sec => {
                sec.measures = sec.measures.map(val => val === oldName ? name : val);
            });
        });
    });
    
    m.name = name;
    m.category = category;
    m.implementation = implementation;
    m.missionType = missionType;
    m.responseType = responseType;
    m.planningStage = planningStage;
    m.threatRelations = threatRelations;
    
    saveOpsafeDb();
    saveMissions();
    
    editingMeasureIndex = null;
    renderSettingsTabContent();
    if (currentMissionId) handleMissionChange(currentMissionId);
}

function addNewMeasure() {
    const name = prompt("Введіть назву нового заходу контролю:");
    if (!name) return;
    const cleaned = name.trim();
    if (cleaned === "") return;
    
    if (opsafeDb.measures.some(m => m.name.toLowerCase() === cleaned.toLowerCase())) {
        alert("Такий захід контролю вже існує!");
        return;
    }
    
    opsafeDb.measures.push({
        name: cleaned,
        category: "Тактичні",
        implementation: "Планувальні",
        missionType: "рекон, маневр, позиція",
        responseType: "зменшення ризику",
        planningStage: "плановий",
        threatRelations: []
    });
    
    editingMeasureIndex = opsafeDb.measures.length - 1;
    saveOpsafeDb();
    renderSettingsTabContent();
}

function deleteMeasure(idx) {
    const m = opsafeDb.measures[idx];
    if (confirm(`Ви дійсно бажаєте видалити захід "${m.name}"?`)) {
        missions.forEach(mission => {
            mission.data.database.forEach(d => {
                d.measures = d.measures.filter(val => val !== m.name);
                d.secondaries.forEach(sec => {
                    sec.measures = sec.measures.filter(val => val !== m.name);
                });
            });
        });
        
        opsafeDb.measures.splice(idx, 1);
        
        if (editingMeasureIndex === idx) {
            editingMeasureIndex = null;
        } else if (editingMeasureIndex > idx) {
            editingMeasureIndex--;
        }
        
        saveOpsafeDb();
        saveMissions();
        renderSettingsTabContent();
        if (currentMissionId) handleMissionChange(currentMissionId);
    }
}

function renderToolsSettings(container) {
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400') ||
                      document.getElementById('settings-tab-threats').classList.contains('border-emerald-500');
    const accentBtn = isEmerald ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
    
    const splitView = document.createElement('div');
    splitView.className = "flex flex-col lg:flex-row gap-6 h-full min-h-[50vh]";
    
    const listPane = document.createElement('div');
    listPane.className = "w-full lg:w-1/2 flex flex-col border border-white/5 bg-slate-900/40 p-4 rounded-xl h-[55vh]";
    listPane.innerHTML = `
        <div class="flex gap-2 mb-3 shrink-0">
            <input type="text" id="tool-search-input" value="${toolFilterText}" placeholder="Пошук інструментів..." class="flex-1 bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500">
            <button onclick="addNewTool()" class="${accentBtn} text-white font-bold text-[10px] px-3 py-1.5 rounded uppercase tracking-wider shrink-0">+ Додати</button>
        </div>
        <div class="flex-1 overflow-y-auto space-y-1.5 pr-1" id="settings-tools-list"></div>
    `;
    
    const editPane = document.createElement('div');
    editPane.className = "w-full lg:w-1/2 flex flex-col border border-white/5 bg-slate-900/40 p-4 rounded-xl h-[55vh] overflow-y-auto";
    editPane.id = "settings-tool-edit-pane";
    
    splitView.appendChild(listPane);
    splitView.appendChild(editPane);
    container.appendChild(splitView);
    
    const searchInput = listPane.querySelector('#tool-search-input');
    searchInput.addEventListener('input', (e) => {
        toolFilterText = e.target.value.toLowerCase();
        populateToolsList(accentBtn);
    });
    
    populateToolsList(accentBtn);
    populateToolEditForm();
}

function populateToolsList(btnClass) {
    const listContainer = document.getElementById('settings-tools-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (!opsafeDb.identTools) opsafeDb.identTools = [];
    
    opsafeDb.identTools.forEach((t, idx) => {
        if (toolFilterText && !t.name.toLowerCase().includes(toolFilterText)) return;
        
        const item = document.createElement('div');
        const isActive = editingToolIndex === idx;
        const activeClass = isActive ? 'bg-slate-800 border-emerald-500/50' : 'bg-slate-900/80 border-white/5 hover:bg-slate-900';
        item.className = `flex justify-between items-center p-2.5 rounded border transition-all cursor-pointer ${activeClass}`;
        item.onclick = () => {
            editingToolIndex = idx;
            populateToolsList(btnClass);
            populateToolEditForm();
        };
        
        item.innerHTML = `
            <div class="flex-1 min-w-0 pr-2">
                <div class="text-xs font-bold text-white truncate" title="${t.name}">${t.name}</div>
                <div class="text-[9px] text-slate-400 uppercase font-mono">Зв'язків: ${t.threatRelations ? t.threatRelations.length : 0}</div>
            </div>
            <div class="flex gap-2 shrink-0">
                <button onclick="event.stopPropagation(); deleteTool(${idx})" title="Видалити" class="p-1 rounded bg-slate-800 text-red-400 hover:text-red-300 hover:bg-slate-700 active:scale-95 transition-all">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function populateToolEditForm() {
    const editContainer = document.getElementById('settings-tool-edit-pane');
    if (!editContainer) return;
    if (editingToolIndex === null || editingToolIndex >= opsafeDb.identTools.length) {
        editContainer.innerHTML = `
            <div class="flex-1 flex items-center justify-center text-slate-500 italic text-xs">
                Оберіть інструмент з лівого списку для редагування або натисніть "+ Додати"
            </div>
        `;
        return;
    }
    
    const t = opsafeDb.identTools[editingToolIndex];
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400');
    const saveBtnClass = isEmerald ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
    const accentBorder = isEmerald ? 'focus:border-emerald-500' : 'focus:border-blue-500';
    
    if (!t.threatRelations) t.threatRelations = [];
    
    let html = `
        <h4 class="text-white font-bold text-xs uppercase tracking-wider mb-4 border-b border-white/10 pb-2">Редагування інструменту</h4>
        <div class="space-y-4">
            <div>
                <label class="block text-[10px] text-slate-400 uppercase mb-1 font-bold">Назва інструменту / шару</label>
                <textarea id="edit-tool-name" class="w-full bg-slate-900 border border-slate-700 p-2 text-white rounded text-xs outline-none ${accentBorder} min-h-[60px] resize-y">${t.name}</textarea>
            </div>
            
            <div>
                <label class="block text-[10px] text-slate-400 uppercase mb-2 font-bold">Зв'язок з загрозами (активує цей шар/інструмент для загрози)</label>
                <div class="border border-white/5 bg-black/20 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
    `;
    
    html += `<div class="text-[9px] text-emerald-400 font-bold uppercase tracking-wider border-b border-white/5 pb-0.5 mb-1.5">Основні загрози:</div>`;
    opsafeDb.primaryThreats.forEach(pt => {
        const checked = t.threatRelations.includes(pt.name) ? 'checked' : '';
        html += `
            <label class="flex items-start gap-2 text-[11px] text-slate-300 hover:text-white cursor-pointer select-none">
                <input type="checkbox" name="edit-tool-threat" value="${pt.name}" ${checked} class="mt-0.5 accent-emerald-500">
                <span>${pt.name}</span>
            </label>
        `;
    });
    
    html += `<div class="text-[9px] text-orange-400 font-bold uppercase tracking-wider border-b border-white/5 pb-0.5 mt-3 mb-1.5">Вторинні загрози:</div>`;
    opsafeDb.secondaryThreats.forEach(stName => {
        const checked = t.threatRelations.includes(stName) ? 'checked' : '';
        html += `
            <label class="flex items-start gap-2 text-[11px] text-slate-300 hover:text-white cursor-pointer select-none">
                <input type="checkbox" name="edit-tool-threat" value="${stName}" ${checked} class="mt-0.5 accent-orange-500">
                <span>${stName}</span>
            </label>
        `;
    });
    
    html += `
                </div>
            </div>
            
            <div class="flex gap-2 pt-2 border-t border-white/10 shrink-0">
                <button onclick="cancelToolEdit()" class="flex-1 py-2 text-[10px] uppercase font-bold border border-white/10 text-slate-400 rounded">Скасувати</button>
                <button onclick="saveToolEdit(${editingToolIndex})" class="flex-1 py-2 text-[10px] uppercase font-bold ${saveBtnClass} text-white rounded">Зберегти зміни</button>
            </div>
        </div>
    `;
    
    editContainer.innerHTML = html;
}

function cancelToolEdit() {
    editingToolIndex = null;
    renderSettingsTabContent();
}

function saveToolEdit(idx) {
    const name = document.getElementById('edit-tool-name').value.trim();
    if (name === "") return alert("Назва інструменту не може бути порожньою!");
    
    const checkBoxes = document.getElementsByName('edit-tool-threat');
    const threatRelations = [];
    Array.from(checkBoxes).forEach(cb => {
        if (cb.checked) threatRelations.push(cb.value);
    });
    
    const t = opsafeDb.identTools[idx];
    t.name = name;
    t.threatRelations = threatRelations;
    
    saveOpsafeDb();
    editingToolIndex = null;
    renderSettingsTabContent();
    if (currentMissionId) handleMissionChange(currentMissionId);
}

function addNewTool() {
    const name = prompt("Введіть назву нового інструменту / шару:");
    if (!name) return;
    const cleaned = name.trim();
    if (cleaned === "") return;
    
    if (!opsafeDb.identTools) opsafeDb.identTools = [];
    
    if (opsafeDb.identTools.some(t => t.name.toLowerCase() === cleaned.toLowerCase())) {
        alert("Такий інструмент вже існує!");
        return;
    }
    
    opsafeDb.identTools.push({
        name: cleaned,
        threatRelations: []
    });
    
    editingToolIndex = opsafeDb.identTools.length - 1;
    saveOpsafeDb();
    renderSettingsTabContent();
}

function deleteTool(idx) {
    if (confirm("Ви дійсно хочете видалити цей інструмент?")) {
        opsafeDb.identTools.splice(idx, 1);
        if (editingToolIndex === idx) {
            editingToolIndex = null;
        } else if (editingToolIndex > idx) {
            editingToolIndex--;
        }
        saveOpsafeDb();
        renderSettingsTabContent();
        if (currentMissionId) handleMissionChange(currentMissionId);
    }
}

function renderConnectionsSettings(container) {
    const isEmerald = document.getElementById('settings-tab-threats').classList.contains('text-emerald-400') ||
                      document.getElementById('settings-tab-threats').classList.contains('border-emerald-500');
    const accentColorClass = isEmerald ? 'accent-emerald-500' : 'accent-blue-500';
    
    const wrapper = document.createElement('div');
    wrapper.className = "space-y-4 max-h-[55vh] overflow-y-auto pr-2";
    
    opsafeDb.primaryThreats.forEach(pt => {
        let conn = opsafeDb.threatConnections.find(tc => tc.primaryThreat === pt.name);
        if (!conn) {
            conn = { primaryThreat: pt.name, secondaryThreats: [] };
            opsafeDb.threatConnections.push(conn);
        }
        
        const ptCard = document.createElement('div');
        const borderClass = isEmerald ? 'border-emerald-950/20 bg-slate-900/40' : 'border-blue-950/20 bg-slate-900/40';
        ptCard.className = `border p-4 rounded-xl ${borderClass}`;
        ptCard.innerHTML = `
            <h5 class="text-white font-bold text-xs uppercase tracking-wider mb-3 pb-1.5 border-b border-white/5 flex justify-between items-center">
                <span>${pt.name}</span>
                <span class="text-[8.5px] px-2 py-0.5 bg-black/40 text-slate-400 font-mono tracking-tight lowercase">зв'язано вторинних: ${conn.secondaryThreats.length}</span>
            </h5>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                ${opsafeDb.secondaryThreats.map(st => {
                    const checked = conn.secondaryThreats.includes(st) ? 'checked' : '';
                    return `
                        <label class="flex items-start gap-2 text-[11px] text-slate-300 hover:text-white cursor-pointer select-none bg-black/10 p-1.5 rounded hover:bg-black/25 transition-colors">
                            <input type="checkbox" onchange="toggleThreatConnection('${pt.name}', '${st}', this.checked)" ${checked} class="mt-0.5 ${accentColorClass}">
                            <span>${st}</span>
                        </label>
                    `;
                }).join('')}
            </div>
        `;
        wrapper.appendChild(ptCard);
    });
    
    container.appendChild(wrapper);
}

function toggleThreatConnection(primaryName, secondaryName, isChecked) {
    let conn = opsafeDb.threatConnections.find(tc => tc.primaryThreat === primaryName);
    if (!conn) {
        conn = { primaryThreat: primaryName, secondaryThreats: [] };
        opsafeDb.threatConnections.push(conn);
    }
    
    if (isChecked) {
        if (!conn.secondaryThreats.includes(secondaryName)) {
            conn.secondaryThreats.push(secondaryName);
        }
    } else {
        conn.secondaryThreats = conn.secondaryThreats.filter(n => n !== secondaryName);
    }
    
    missions.forEach(mission => {
        mission.data.database.forEach(d => {
            if (d.name === primaryName) {
                const secondaryNames = conn.secondaryThreats;
                const allSecondaryNames = opsafeDb.secondaryThreats;
                d.rel = secondaryNames.map(name => allSecondaryNames.indexOf(name)).filter(idx => idx !== -1);
            }
        });
    });
    
    saveOpsafeDb();
    saveMissions();
    renderMarkers();
}
