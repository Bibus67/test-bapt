            let currentSVG = null;
            let originalSVGContent = ''; // Pour le reset
            let currentRotation = 0;
            let mirrorHorizontal = false;
            let mirrorVertical = false;
            let lastDetectedMainColors = []; // Store main colors for fallback
            let gradientGroups = []; // Store groups of similar stops
            let mainColorGroups = []; // Store groups of similar main color elements
            // --- EDIT MODE ---
            let editModeActive = false;
            let editOverlaySVG = null;
            let _undoStack = []; // pile des états SVG pour undo
            let _redoStack = []; // pile des états SVG pour redo
            let _renderEditRafId = null; // RAF throttle pour renderEditPoints pendant le drag
            let _overlayGeoCache = null; // cache géométrie overlay (évite reflow à chaque pan/zoom)
            let editDragState = null;
            let editShapeData = [];
            let selectedAnchor = null; // { shapeIdx, anchorIdx }
            let _editNaturalW  = 500;  // largeur naturelle du SVG sans zoom, mémorisée à l'entrée en édition
            // --- ZOOM / PAN (viewBox-based) ---
            let canvasZoom = 1;
            let canvasPanX = 0;   // en unités viewBox
            let canvasPanY = 0;
            let isPanning  = false;
            let panStartX  = 0;
            let panStartY  = 0;
            const fileInput = document.getElementById('fileInput');
            const svgDisplay = document.getElementById('svgDisplay');
            const emptyState = document.getElementById('emptyState');
            const colorPalette = document.getElementById('colorPalette');
            const exportBtn = document.getElementById('exportBtn');
            const rotationSlider = document.getElementById('rotationSlider');
            const rotationValue = document.getElementById('rotationValue');
            fileInput.addEventListener('change', handleFileUpload);

            // Drag & drop sur le cadre d'import (emptyState)
            const emptyStateDrop = document.getElementById('emptyState');
            emptyStateDrop.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.stopPropagation();
                emptyStateDrop.classList.add('sve-drag-over');
            });
            emptyStateDrop.addEventListener('dragleave', function(e) {
                // Ne retirer la classe que si on quitte vraiment le cadre (pas un enfant)
                if (!emptyStateDrop.contains(e.relatedTarget)) {
                    emptyStateDrop.classList.remove('sve-drag-over');
                }
            });
            emptyStateDrop.addEventListener('drop', function(e) {
                e.preventDefault();
                e.stopPropagation();
                emptyStateDrop.classList.remove('sve-drag-over');
                handleFile(e.dataTransfer.files[0]);
            });

            if (rotationSlider) {
                rotationSlider.addEventListener('input', function (e) {
                    currentRotation = parseInt(e.target.value);
                    rotationValue.textContent = currentRotation;
                    applyTransform();
                });
            }
            // ── Modal export ──────────────────────────────────────────────
            // Init lazy : la modal est dans le DOM APRÈS le script, donc on
            // ne peut pas la requêter au moment de l'exécution du script.
            let _exportModalReady = false;
            function _initExportModal() {
                if (_exportModalReady) return;
                _exportModalReady = true;
                const modal     = document.getElementById('sve-export-modal');
                const scaleWrap = document.getElementById('sve-emod-scale-wrap');

                // Sélection format
                modal.querySelectorAll('.sve-emod-fmt-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        modal.querySelectorAll('.sve-emod-fmt-btn').forEach(b => b.classList.remove('sve-active'));
                        btn.classList.add('sve-active');
                        const isBitmap = btn.dataset.fmt !== 'svg';
                        scaleWrap.classList.toggle('sve-hidden', !isBitmap);
                        _updateExportInfo();
                    });
                });

                // Sélection scale
                modal.querySelectorAll('.sve-emod-scale-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        modal.querySelectorAll('.sve-emod-scale-btn').forEach(b => b.classList.remove('sve-active'));
                        btn.classList.add('sve-active');
                        _updateExportInfo();
                    });
                });

                // Clic sur l'overlay (fond) → fermer
                modal.addEventListener('click', (e) => { if (e.target === modal) closeExportModal(); });

                // Échap → fermer
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && modal.classList.contains('sve-active')) closeExportModal();
                });
            }

            function _updateExportInfo() {
                const modal   = document.getElementById('sve-export-modal');
                const dimEl   = document.getElementById('sve-emod-dimensions');
                const extEl   = document.getElementById('sve-emod-filename-ext');
                const fmt     = modal.querySelector('.sve-emod-fmt-btn.sve-active')?.dataset.fmt || 'svg';
                const scale   = parseInt(modal.querySelector('.sve-emod-scale-btn.sve-active')?.dataset.scale || '2', 10);
                const ext     = fmt === 'jpeg' ? '.jpg' : '.' + fmt;
                if (extEl) extEl.textContent = ext;
                if (!dimEl) return;
                if (fmt === 'svg' || !currentSVG) { dimEl.textContent = ''; return; }
                try {
                    const vb = currentSVG.getAttribute('viewBox');
                    let w, h;
                    if (vb) {
                        const p = vb.trim().split(/[\s,]+/);
                        w = parseFloat(p[2]); h = parseFloat(p[3]);
                    } else {
                        w = parseFloat(currentSVG.getAttribute('width'))  || 500;
                        h = parseFloat(currentSVG.getAttribute('height')) || 500;
                    }
                    dimEl.textContent = Math.round(w * scale) + ' × ' + Math.round(h * scale) + ' px';
                } catch(e) { dimEl.textContent = ''; }
            }

            function openExportModal() {
                _initExportModal();
                _updateExportInfo();
                document.getElementById('sve-export-modal').classList.add('sve-active');
            }
            function closeExportModal() {
                document.getElementById('sve-export-modal').classList.remove('sve-active');
            }
            function confirmExport() {
                const modal    = document.getElementById('sve-export-modal');
                const fmt      = modal.querySelector('.sve-emod-fmt-btn.sve-active')?.dataset.fmt || 'svg';
                const scale    = parseInt(modal.querySelector('.sve-emod-scale-btn.sve-active')?.dataset.scale || '2', 10);
                const baseName = document.getElementById('sve-emod-filename-input')?.value.trim() || 'edited-image';
                const ext      = fmt === 'jpeg' ? 'jpg' : fmt;
                closeExportModal();
                exportAs(fmt, scale, baseName + '.' + ext);
            }
            function rotateImage(degrees) {
                currentRotation = (currentRotation + degrees) % 360;
                if (currentRotation < 0) currentRotation += 360;
                rotationSlider.value = currentRotation;
                rotationValue.textContent = currentRotation;
                applyTransform();
            }
            function resetRotation() {
                currentRotation = 0;
                rotationSlider.value = 0;
                rotationValue.textContent = 0;
                applyTransform();
            }
            function resetMirrors() {
                mirrorHorizontal = false;
                mirrorVertical = false;
                const buttons = document.querySelectorAll('.sve-btn-mirror');
                buttons.forEach(btn => btn.classList.remove('sve-active'));
                applyTransform();
            }
            function resetColors() {
                if (!originalSVGContent) {
                    return;
                }
                // Quitter le mode édition proprement avant de recharger le SVG
                if (editModeActive) exitEditMode();

                // Vider complètement la palette
                colorPalette.innerHTML = '<div class="sve-no-colors">Chargement...</div>';

                // Recharger le SVG original
                svgDisplay.innerHTML = originalSVGContent;
                currentSVG = svgDisplay.querySelector('svg');

                if (currentSVG && !currentSVG.hasAttribute('viewBox') && !currentSVG.hasAttribute('width')) {
                    const bbox = currentSVG.getBBox();
                    currentSVG.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
                }

                // Réappliquer les transformations (rotation/miroirs)
                applyTransform();

                // Re-détecter les couleurs après un délai
                setTimeout(() => {
                    detectColors();
                }, 150);
            }
            function applyTransform() {
                if (!currentSVG) return;
                const scaleX = (mirrorHorizontal ? -1 : 1) * canvasZoom;
                const scaleY = (mirrorVertical ? -1 : 1) * canvasZoom;
                const parts = [`translate(${canvasPanX}px, ${canvasPanY}px)`, `scale(${scaleX}, ${scaleY})`];
                if (currentRotation !== 0) parts.splice(1, 0, `rotate(${currentRotation}deg)`);
                currentSVG.style.transform = parts.join(' ');
                currentSVG.style.transformOrigin = 'center center';
                if (editModeActive) { syncOverlayToSVG(); scheduleRenderEditPoints(); }
            }
            function toggleMirror(direction) {
                const buttons = document.querySelectorAll('.sve-btn-mirror');
                if (direction === 'horizontal') {
                    mirrorHorizontal = !mirrorHorizontal;
                    buttons[0].classList.toggle('sve-active', mirrorHorizontal);
                } else if (direction === 'vertical') {
                    mirrorVertical = !mirrorVertical;
                    buttons[1].classList.toggle('sve-active', mirrorVertical);
                }
                applyTransform();
            }
            function handleFile(file) {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function(e) { loadSVG(e.target.result); };
                reader.onerror = function() { alert('Erreur lors de la lecture du fichier'); };
                reader.readAsText(file);
            }

            function handleFileUpload(event) {
                handleFile(event.target.files[0]);
            }
            function loadSVG(content) {
                content = content.trim();
                originalSVGContent = content;
                // Si on était en mode édition, on le quitte proprement
                if (editModeActive) exitEditMode();
                // Nouveau fichier → vider l'historique de l'ancien SVG
                _undoStack = [];
                _redoStack = [];
                _syncUndoRedoBtns();
                svgDisplay.innerHTML = content;
                emptyState.style.display = 'none';
                svgDisplay.classList.add('sve-active');
                // Boutons désactivés jusqu'à ce que currentSVG soit prêt
                exportBtn.disabled = true;
                document.getElementById('editModeBtn').disabled = true;

                // Attendre que le navigateur ait rendu le SVG pour que getBoundingClientRect soit correct
                setTimeout(() => {
                    currentSVG = svgDisplay.querySelector('svg');
                    if (!currentSVG) {
                        console.error('Aucun élément SVG trouvé dans le fichier');
                        alert('Le fichier ne contient pas de SVG valide');
                        return;
                    }
                    if (!currentSVG.hasAttribute('viewBox') && !currentSVG.hasAttribute('width')) {
                        currentSVG.setAttribute('viewBox', '0 0 500 500');
                    }
                    exportBtn.disabled = false;
                    document.getElementById('editModeBtn').disabled = false;
                    // Zoom initial : adapter le SVG à la taille du canvas avec un grand padding
                    canvasZoom = 1; canvasPanX = 0; canvasPanY = 0;
                    // Mesurer le SVG SANS transform pour avoir ses dimensions naturelles
                    currentSVG.style.transform = 'none';
                    const canvasEl = document.querySelector('.sve-canvas-area');
                    const svgRect  = currentSVG.getBoundingClientRect();
                    const canvRect = canvasEl.getBoundingClientRect();
                    // Padding = 15% de chaque dimension pour laisser de l'espace autour
                    const padW = canvRect.width  * 0.15;
                    const padH = canvRect.height * 0.15;
                    const availW = canvRect.width  - padW * 2;
                    const availH = canvRect.height - padH * 2;
                    if (svgRect.width > 0 && svgRect.height > 0) {
                        // À 90° ou 270°, les dimensions affichées sont inversées
                        const rotNorm = ((currentRotation % 360) + 360) % 360;
                        const effW = (rotNorm === 90 || rotNorm === 270) ? svgRect.height : svgRect.width;
                        const effH = (rotNorm === 90 || rotNorm === 270) ? svgRect.width  : svgRect.height;
                        canvasZoom = Math.min(availW / effW, availH / effH);
                    }
                    applyTransform(); // applique rotation + miroir + zoom final
                    detectColors();
                }, 500);
            }

            function detectColors() {
                // Sauvegarder les flags persistants avant de reconstruire
                const prevByGradientId = new Map(
                    gradientGroups
                        .filter(g => g.gradientElement.id)
                        .map(g => [g.gradientElement.id, { smoothed: g.smoothed, _originalStops: g._originalStops || null }])
                );

                mainColorGroups = [];
                gradientGroups = [];

                if (currentSVG) {
                    // 1. Process Gradients — regroupés par gradient parent (un encart par gradient)
                    const gradients = currentSVG.querySelectorAll('linearGradient, radialGradient');
                    let gradientCounter = 0;
                    gradients.forEach(gradient => {
                        const stops = gradient.querySelectorAll('stop');

                        // 1. Collecter tous les stops avec leur couleur normalisée, dans l'ordre
                        const allStopsData = [];
                        stops.forEach(stop => {
                            let stopColor = stop.getAttribute('stop-color');
                            const style = stop.getAttribute('style');
                            if (style && !stopColor) {
                                const match = style.match(/stop-color:\s*([^;]+)/);
                                if (match) stopColor = match[1];
                            }
                            if (stopColor && stopColor !== 'none' && stopColor !== 'transparent') {
                                const normalized = normalizeColor(stopColor);
                                if (normalized) {
                                    allStopsData.push({ stop, color: normalized });
                                }
                            }
                        });

                        if (allStopsData.length === 0) return;

                        // 2. Identifier les couleurs "clés" du dégradé :
                        //    - Premier et dernier stop (toujours clés)
                        //    - Stops avec un changement significatif de teinte vs le précédent
                        const keyIndices = new Set();
                        keyIndices.add(0);                              // premier
                        keyIndices.add(allStopsData.length - 1);        // dernier

                        const HUE_SHIFT_THRESHOLD = 15; // degrés de teinte (sur 360)

                        // Passe 1 : comparaison stop-à-stop (teinte / sat / val)
                        for (let i = 1; i < allStopsData.length; i++) {
                            const prevHsv = hexToHsvHelper(allStopsData[i - 1].color);
                            const currHsv = hexToHsvHelper(allStopsData[i].color);

                            // Calcul du delta de teinte (circulaire)
                            let hueDelta = Math.abs(currHsv.h - prevHsv.h);
                            if (hueDelta > 180) hueDelta = 360 - hueDelta;

                            // Aussi considérer un grand changement de saturation ou de luminosité
                            const satDelta = Math.abs(currHsv.s - prevHsv.s) * 100;
                            const valDelta = Math.abs(currHsv.v - prevHsv.v) * 100;

                            if (hueDelta > HUE_SHIFT_THRESHOLD || satDelta > 25 || valDelta > 25) {
                                keyIndices.add(i);
                            }
                        }

                        // Passe 2 : Douglas-Peucker sur les stops
                        // → marque seulement le stop le plus déviant dans chaque plage,
                        //   puis récursion — donne le minimum de clés pour fidèlement
                        //   représenter la courbe couleur (ni sur-détection, ni sous-détection).
                        if (allStopsData.length > 2) {
                            const _hexToRgb = (hex) => {
                                hex = hex.replace('#', '');
                                return {
                                    r: parseInt(hex.substring(0,2), 16),
                                    g: parseInt(hex.substring(2,4), 16),
                                    b: parseInt(hex.substring(4,6), 16)
                                };
                            };
                            const DP_THRESHOLD = 60; // ~24 % de 255

                            const dpFindKeys = (si, ei) => {
                                if (ei - si <= 1) return;
                                const s = _hexToRgb(allStopsData[si].color);
                                const e = _hexToRgb(allStopsData[ei].color);
                                let maxDev = 0, maxIdx = -1;
                                for (let i = si + 1; i < ei; i++) {
                                    const t   = (i - si) / (ei - si);
                                    const act = _hexToRgb(allStopsData[i].color);
                                    const dev = Math.max(
                                        Math.abs(act.r - (s.r + (e.r - s.r) * t)),
                                        Math.abs(act.g - (s.g + (e.g - s.g) * t)),
                                        Math.abs(act.b - (s.b + (e.b - s.b) * t))
                                    );
                                    if (dev > maxDev) { maxDev = dev; maxIdx = i; }
                                }
                                if (maxDev > DP_THRESHOLD && maxIdx >= 0) {
                                    keyIndices.add(maxIdx);
                                    dpFindKeys(si, maxIdx);
                                    dpFindKeys(maxIdx, ei);
                                }
                            };
                            dpFindKeys(0, allStopsData.length - 1);
                        }

                        // 3. Construire les stopGroups à partir des couleurs clés
                        //    Chaque stop non-clé est rattaché au groupe de la clé la plus proche
                        const sortedKeys = [...keyIndices].sort((a, b) => a - b);
                        const stopGroups = sortedKeys.map(ki => ({
                            color: allStopsData[ki].color,
                            stops: []
                        }));

                        // Rattacher chaque stop au groupe de la clé la plus proche
                        allStopsData.forEach((sd, i) => {
                            let bestIdx = 0;
                            let bestDist = Infinity;
                            for (let k = 0; k < sortedKeys.length; k++) {
                                const dist = Math.abs(i - sortedKeys[k]);
                                if (dist < bestDist) {
                                    bestDist = dist;
                                    bestIdx = k;
                                }
                            }
                            stopGroups[bestIdx].stops.push(sd.stop);
                        });

                        if (stopGroups.length > 0) {
                            gradientCounter++;
                            const prev = gradient.id ? (prevByGradientId.get(gradient.id) || {}) : {};
                            gradientGroups.push({
                                gradientElement: gradient,
                                label: 'Dégradé ' + gradientCounter,
                                stopGroups: stopGroups,
                                smoothed:       prev.smoothed       || false,
                                _originalStops: prev._originalStops || null,
                            });
                        }
                    });

                    // 2. Process Main Colors (Shapes)
                    // Liste stricte des éléments qui ont un rendu visuel direct
                    const shapeSelectors = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text'];
                    const allElements = currentSVG.querySelectorAll(shapeSelectors.join(','));

                    allElements.forEach(element => {
                        const computed = window.getComputedStyle(element);

                        // Helper to process a property (fill or stroke)
                        const processProperty = (prop, value, isStyle = false) => {
                            if (value && value !== 'none' && !value.startsWith('url(') && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') {
                                const normalized = normalizeColor(value);
                                if (normalized) {
                                    // Grouping Logic
                                    let foundGroup = false;
                                    for (let group of mainColorGroups) {
                                        if (getColorDistance(normalized, group.color) < 40) {
                                            group.refs.push({ element: element, property: prop, isStyle: isStyle });
                                            foundGroup = true;
                                            break;
                                        }
                                    }
                                    if (!foundGroup) {
                                        mainColorGroups.push({
                                            color: normalized,
                                            refs: [{ element: element, property: prop, isStyle: isStyle }]
                                        });
                                    }
                                }
                            }
                        };

                        // Check attributes first, then computed style if needed
                        // Actually, trusting computed style is safer for what is visibly rendered, 
                        // but updating attributes is better for cleanliness.
                        // We will store the ELEMENT reference and update both attribute and style to be safe.

                        // Fill
                        const fill = computed.fill;
                        processProperty('fill', fill);

                        // Stroke
                        const stroke = computed.stroke;
                        processProperty('stroke', stroke);
                    });
                }

                // Create a temporary simplified list for background adaptation
                const simpleGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                const mainColorArray = mainColorGroups.map(g => g.color);

                // Combiner pour l'adaptation du background
                const allColors = [...mainColorArray, ...simpleGradientColors];

                lastDetectedMainColors = mainColorArray; // Save for fallback behavior which depends on detection
                adaptBackgroundColor(allColors);
                displayColors(mainColorGroups, gradientGroups);
            }
            let _currentBgIsLight = false; // État mémorisé du background
            let _isHighlighting = false;   // Bloque adaptBackgroundColor pendant le survol

            function adaptBackgroundColor(colors) {
                if (_isHighlighting) return; // Ne pas changer le mode pendant un survol
                const canvasArea = document.querySelector('.sve-canvas-area');
                if (colors.length === 0) {
                    _currentBgIsLight = false;
                    canvasArea.classList.remove('sve-light-bg');
                    return;
                }

                // Calculer la luminosité moyenne pondérée
                const brightnessValues = colors.map(c => getColorBrightness(c));
                const avgBrightness = brightnessValues.reduce((a, b) => a + b, 0) / brightnessValues.length;

                // Hystérésis : on ne swap que si la luminosité moyenne franchit
                // un seuil significatif par rapport à l'état actuel.
                // - Pour passer en fond clair (couleurs sombres) : avgBrightness < 85
                // - Pour revenir en fond sombre (couleurs claires) : avgBrightness > 170
                // Cela crée une zone morte [85-170] où le fond ne change pas,
                // évitant les basculements intempestifs.
                const THRESHOLD_TO_LIGHT = 85;   // Couleurs très sombres → fond clair
                const THRESHOLD_TO_DARK = 170;   // Couleurs très claires → fond sombre

                if (!_currentBgIsLight && avgBrightness < THRESHOLD_TO_LIGHT) {
                    _currentBgIsLight = true;
                    canvasArea.classList.add('sve-light-bg');
                } else if (_currentBgIsLight && avgBrightness > THRESHOLD_TO_DARK) {
                    _currentBgIsLight = false;
                    canvasArea.classList.remove('sve-light-bg');
                }
                // Sinon : on ne change rien (hystérésis)
            }
            // Convertit un hex (#rrggbb) en { h (0-360), s (0-1), v (0-1) }
            function hexToHsvHelper(hex) {
                hex = hex.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const d = max - min;
                let h = 0, s = max === 0 ? 0 : d / max, v = max;
                if (d !== 0) {
                    switch (max) {
                        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
                        case g: h = ((b - r) / d + 2) * 60; break;
                        case b: h = ((r - g) / d + 4) * 60; break;
                    }
                }
                return { h, s, v };
            }
            function getColorBrightness(hexColor) {
                const hex = hexColor.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                return (r * 299 + g * 587 + b * 114) / 1000;
            }
            function getColorDistance(color1, color2) {
                const hex1 = color1.replace('#', '');
                const hex2 = color2.replace('#', '');
                const r1 = parseInt(hex1.substr(0, 2), 16);
                const g1 = parseInt(hex1.substr(2, 2), 16);
                const b1 = parseInt(hex1.substr(4, 2), 16);
                const r2 = parseInt(hex2.substr(0, 2), 16);
                const g2 = parseInt(hex2.substr(2, 2), 16);
                const b2 = parseInt(hex2.substr(4, 2), 16);
                return Math.sqrt(
                    Math.pow(r2 - r1, 2) +
                    Math.pow(g2 - g1, 2) +
                    Math.pow(b2 - b1, 2)
                );
            }
            function normalizeColor(color) {
                if (!color) return null;
                color = color.trim().toLowerCase();
                if (color.startsWith('#')) {
                    if (color.length === 4) {
                        return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
                    }
                    return color;
                }
                if (color.startsWith('rgb')) {
                    return rgbToHex(color);
                }
                try {
                    const temp = document.createElement('div');
                    temp.style.color = color;
                    document.body.appendChild(temp);
                    let computed;
                    try { computed = window.getComputedStyle(temp).color; }
                    finally { document.body.removeChild(temp); }
                    if (computed && computed !== 'rgba(0, 0, 0, 0)') {
                        return rgbToHex(computed);
                    }
                } catch (e) { /* couleur non reconnue */ }
                return null;
            }
            function rgbToHex(rgb) {
                const match = rgb.match(/\d+/g);
                if (!match || match.length < 3) return null;
                const r = parseInt(match[0]);
                const g = parseInt(match[1]);
                const b = parseInt(match[2]);
                return '#' + [r, g, b].map(x => {
                    const hex = x.toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                }).join('');
            }
            // Parse une couleur (hex ou rgba) et retourne { hex, alpha }
            function parseColorValue(value) {
                if (!value) return { hex: '#000000', alpha: 1 };
                const rgbaMatch = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
                if (rgbaMatch) {
                    const r = parseInt(rgbaMatch[1]);
                    const g = parseInt(rgbaMatch[2]);
                    const b = parseInt(rgbaMatch[3]);
                    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
                    const hex = '#' + [r, g, b].map(x => {
                        const h = x.toString(16);
                        return h.length === 1 ? '0' + h : h;
                    }).join('');
                    return { hex, alpha: a };
                }
                // C'est un hex
                return { hex: value, alpha: 1 };
            }

            // --- HIGHLIGHT : mise en avant des formes sur hover palette ---

            // Vérifie si un élément est descendant de <defs>
            function isInDefs(el) {
                let p = el.parentNode;
                while (p && p !== currentSVG) {
                    if (p.tagName && p.tagName.toLowerCase() === 'defs') return true;
                    p = p.parentNode;
                }
                return false;
            }

            // Trouve les formes qui utilisent un gradient donné (par son id)
            function getShapesUsingGradient(gradientElement) {
                const allLeaves = getAllLeafShapes();
                if (!currentSVG || !gradientElement) return allLeaves;

                const gradientId = gradientElement.id || gradientElement.getAttribute('id');

                // Construire l'ensemble des ids à chercher :
                // le gradient lui-même + tous les gradients qui en héritent via xlink:href ou href
                const idsToSearch = new Set();
                if (gradientId) idsToSearch.add(gradientId);

                // Gradients alias qui pointent vers celui-ci
                currentSVG.querySelectorAll('linearGradient, radialGradient').forEach(g => {
                    const href = g.getAttribute('xlink:href') || g.getAttribute('href') || '';
                    const refId = href.startsWith('#') ? href.slice(1) : '';
                    if (refId && idsToSearch.has(refId)) {
                        const aliasId = g.id || g.getAttribute('id');
                        if (aliasId) idsToSearch.add(aliasId);
                    }
                });

                if (idsToSearch.size === 0) return allLeaves;

                const escapedIds = [...idsToSearch].map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                const urlRegex = new RegExp(`url\\(["']?[^)]*#(${escapedIds.join('|')})["']?\\)`);

                const matchedElements = new Set();

                // 1. Scanner tous les éléments hors defs (fill/stroke/style en attribut)
                const allEls = [...currentSVG.querySelectorAll('*')];
                for (const el of allEls) {
                    if (isInDefs(el)) continue;
                    const attrFill   = el.getAttribute('fill')   || '';
                    const attrStroke = el.getAttribute('stroke') || '';
                    const attrStyle  = el.getAttribute('style')  || '';
                    if (urlRegex.test(attrFill) || urlRegex.test(attrStroke) || urlRegex.test(attrStyle)) {
                        matchedElements.add(el);
                    }
                }

                // 2. Chercher dans les <style> internes SVG
                currentSVG.querySelectorAll('style').forEach(styleEl => {
                    const text = styleEl.textContent;
                    const cssRegex = new RegExp(`([^{}]+)\\{[^}]*url\\(["']?[^)]*#(${escapedIds.join('|')})["']?\\)[^}]*\\}`, 'g');
                    let m;
                    while ((m = cssRegex.exec(text)) !== null) {
                        m[1].trim().split(',').forEach(sel => {
                            try {
                                currentSVG.querySelectorAll(sel.trim()).forEach(el => {
                                    if (!isInDefs(el)) matchedElements.add(el);
                                });
                            } catch(e) {}
                        });
                    }
                });

                // Rien trouvé → fallback toutes les feuilles
                if (matchedElements.size === 0) return allLeaves;

                // Collecter les feuilles dont elles-mêmes ou un ancêtre est dans matchedElements
                const result = [];
                for (const leaf of allLeaves) {
                    if (matchedElements.has(leaf)) { result.push(leaf); continue; }
                    let ancestor = leaf.parentNode;
                    while (ancestor && ancestor !== currentSVG) {
                        if (matchedElements.has(ancestor)) { result.push(leaf); break; }
                        ancestor = ancestor.parentNode;
                    }
                }

                return result.length > 0 ? result : allLeaves;
            }

            // Collecte toutes les formes feuilles (éléments de dessin) du SVG
            function getAllLeafShapes() {
                if (!currentSVG) return [];
                const selectors = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use'];
                return [...currentSVG.querySelectorAll(selectors.join(','))].filter(el => {
                    // Exclure celles qui sont dans <defs>
                    let p = el.parentNode;
                    while (p && p !== currentSVG) {
                        if (p.tagName === 'defs') return false;
                        p = p.parentNode;
                    }
                    return true;
                });
            }

            // Palette items indexed by element for reverse lookup
            // paletteMap : SVG element → palette DOM node
            let paletteMap = new Map();

            function highlightFromShape(hoveredLeaf) {
                if (editModeActive) return;
                if (!currentSVG || !hoveredLeaf) return;

                _isHighlighting = true;

                const allLeaves = getAllLeafShapes();

                // Trouver le groupe palette associé à cette forme
                let paletteNode = null;

                // Chercher dans paletteMap : remonte aux ancêtres si besoin
                let el = hoveredLeaf;
                while (el && el !== currentSVG) {
                    if (paletteMap.has(el)) { paletteNode = paletteMap.get(el); break; }
                    el = el.parentNode;
                }

                // Highlight l'élément palette uniquement (pas d'assombrissement des formes)
                if (paletteNode) {
                    paletteNode.classList.add('sve-palette-highlighted');
                    paletteNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }

            function clearHighlight() {
                if (!currentSVG) return;
                document.querySelectorAll('.sve-palette-highlighted').forEach(el => el.classList.remove('sve-palette-highlighted'));
                _isHighlighting = false;
            }

            // Attache les listeners hover sur toutes les formes SVG du canvas.
            // Utilise un flag dataset pour éviter d'empiler les listeners à chaque rebuild.
            function attachShapeHoverListeners() {
                if (!currentSVG) return;
                if (editModeActive) return;
                const allLeaves = getAllLeafShapes();
                allLeaves.forEach(leaf => {
                    if (leaf.dataset.hoverBound === '1') return; // déjà attaché
                    leaf.dataset.hoverBound = '1';
                    leaf.addEventListener('mouseenter', () => highlightFromShape(leaf));
                    leaf.addEventListener('mouseleave', () => clearHighlight());
                    leaf.style.cursor = 'crosshair';
                });
            }

            // Attache les handlers HTML5 drag-and-drop sur une nuance de dégradé.
            // swatchEl    : élément draggable (compact swatch ou mini-swatch-wrapper)
            // gradientIndex: index du dégradé dans gradientGroups
            // displayIdx  : position d'affichage de cette nuance (0 = gauche)
            // container   : parent direct (pour cibler les indicateurs voisins)
            function attachSwatchDragHandlers(swatchEl, gradientIndex, displayIdx, container) {
                swatchEl.setAttribute('draggable', 'true');

                swatchEl.addEventListener('dragstart', (e) => {
                    _dragState = { gradientIndex, displayIdx };
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(displayIdx));
                    // Délai pour que le ghost browser soit rendu avant d'appliquer l'opacité
                    setTimeout(() => swatchEl.classList.add('drag-source'), 0);
                });

                swatchEl.addEventListener('dragover', (e) => {
                    if (!_dragState || _dragState.gradientIndex !== gradientIndex) return;
                    if (_dragState.displayIdx === displayIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    // Retirer tous les indicateurs existants dans ce container
                    container.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
                        el.classList.remove('drag-over-left', 'drag-over-right');
                    });
                    const rect = swatchEl.getBoundingClientRect();
                    swatchEl.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drag-over-left' : 'drag-over-right');
                });

                swatchEl.addEventListener('dragleave', () => {
                    swatchEl.classList.remove('drag-over-left', 'drag-over-right');
                });

                swatchEl.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (!_dragState || _dragState.gradientIndex !== gradientIndex) return;
                    const fromDisplayIdx = _dragState.displayIdx;
                    if (fromDisplayIdx === displayIdx) { _dragState = null; return; }
                    const rect = swatchEl.getBoundingClientRect();
                    const insertBefore = e.clientX < rect.left + rect.width / 2;
                    let toDisplayIdx = insertBefore ? displayIdx : displayIdx + 1;
                    // Ajustement : si on retire fromDisplayIdx < toDisplayIdx, l'index cible glisse de -1
                    if (fromDisplayIdx < toDisplayIdx) toDisplayIdx--;
                    _dragState = null;
                    reorderGradientStopGroup(gradientIndex, fromDisplayIdx, toDisplayIdx);
                });

                swatchEl.addEventListener('dragend', () => {
                    swatchEl.classList.remove('drag-source');
                    document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
                        el.classList.remove('drag-over-left', 'drag-over-right');
                    });
                    _dragState = null;
                });
            }

            function displayColors(mainColorGroups, gradientGroups) {
                if (mainColorGroups.length === 0 && gradientGroups.length === 0) {
                    colorPalette.innerHTML = '<div class="sve-no-colors">Aucune couleur détectée</div>';
                    return;
                }
                colorPalette.innerHTML = '';
                paletteMap = new Map(); // Réinitialiser la map à chaque rebuild

                // MAIN COLORS
                mainColorGroups.forEach((group, groupIndex) => {
                    const rawColor = group.color;
                    const initParsed = parseColorValue(rawColor);
                    const colorItem = document.createElement('div');
                    colorItem.className = 'sve-color-item';
                    colorItem.dataset.originalColor = rawColor;

                    // Swatch avec damier + overlay couleur
                    const swatch = document.createElement('div');
                    swatch.className = 'sve-color-swatch';
                    swatch.dataset.currentColor = rawColor;
                    swatch.dataset.currentAlpha = String(initParsed.alpha);

                    const checker = document.createElement('div');
                    checker.className = 'sve-color-swatch-checker';
                    if (initParsed.alpha < 1) checker.classList.add('sve-visible');
                    const colorOverlay = document.createElement('div');
                    colorOverlay.className = 'sve-color-swatch-color';
                    colorOverlay.style.backgroundColor = initParsed.hex;
                    colorOverlay.style.opacity = initParsed.alpha;
                    swatch.appendChild(checker);
                    swatch.appendChild(colorOverlay);

                    const code = document.createElement('div');
                    code.className = 'sve-color-code';
                    code.textContent = initParsed.hex.toUpperCase();
                    colorItem.appendChild(swatch);
                    colorItem.appendChild(code);

                    // Helper pour mettre à jour l'affichage du swatch
                    function updateSwatchDisplay(hex, alpha) {
                        swatch.dataset.currentColor = (alpha < 1)
                            ? `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`
                            : hex;
                        swatch.dataset.currentAlpha = String(alpha);
                        colorOverlay.style.backgroundColor = hex;
                        colorOverlay.style.opacity = alpha;
                        checker.classList.toggle('sve-visible', alpha < 1);
                        code.textContent = hex.toUpperCase();
                    }

                    // Enregistrer dans paletteMap : chaque élément SVG → colorItem
                    group.refs.forEach(ref => paletteMap.set(ref.element, colorItem));

                    colorItem.onclick = function (e) {
                        if (e.target.closest('.sve-color-to-gradient-btn')) return;
                        const currentColor = swatch.dataset.currentColor || rawColor;
                        const target = swatch || colorItem || document.activeElement;

                        CustomColorPicker.open(target, currentColor, (newColor) => {
                            const parsed = parseColorValue(newColor);
                            updateSwatchDisplay(parsed.hex, parsed.alpha);

                            // DIRECT DOM UPDATE
                            updateMainColorGroup(groupIndex, newColor);
                        }, e.clientX, e.clientY);
                    };

                    // Bouton → dégradé
                    const toGradBtn = document.createElement('button');
                    toGradBtn.className = 'sve-color-to-gradient-btn';
                    toGradBtn.innerHTML = '◑';
                    Tooltip.attach(toGradBtn, 'Convertir en dégradé');
                    toGradBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        Tooltip.hide();
                        convertMainColorToGradient(groupIndex);
                    });
                    colorItem.appendChild(toGradBtn);
                    colorPalette.appendChild(colorItem);
                });

                // GRADIENT COLORS — mode compact si > 3 gradients, sinon un encart par gradient
                const isCompact = gradientGroups.length > 3;

                if (isCompact && gradientGroups.length > 0) {
                    // --- MODE COMPACT : un seul conteneur scrollable avec une ligne par gradient ---
                    const container = document.createElement('div');
                    container.className = 'sve-gradients-compact-container';
                    const title = document.createElement('div');
                    title.className = 'sve-gradients-compact-title';
                    title.textContent = `DÉGRADÉS (${gradientGroups.length})`;
                    container.appendChild(title);

                    gradientGroups.forEach((gradientEntry, gradientIndex) => {
                        const row = document.createElement('div');
                        row.className = 'sve-gradient-compact-row';

                        // Enregistrer dans paletteMap : formes du gradient → row
                        getShapesUsingGradient(gradientEntry.gradientElement).forEach(shape => paletteMap.set(shape, row));

                        const label = document.createElement('div');
                        label.className = 'sve-gradient-compact-label';
                        label.textContent = '#' + (gradientIndex + 1);

                        const swatches = document.createElement('div');
                        swatches.className = 'sve-gradient-compact-swatches';

                        const reversed = isGradientReversed(gradientEntry.gradientElement);
                        const orderedGroups = reversed ? [...gradientEntry.stopGroups].reverse() : gradientEntry.stopGroups;
                        orderedGroups.forEach((stopGroup, displayIdx) => {
                            const stopGroupIndex = reversed ? gradientEntry.stopGroups.length - 1 - displayIdx : displayIdx;
                            const rawColor = stopGroup.color;
                            const initP = parseColorValue(rawColor);
                            const swatch = document.createElement('div');
                            swatch.className = 'sve-gradient-compact-swatch';
                            swatch.dataset.currentColor = rawColor;

                            const csChecker = document.createElement('div');
                            csChecker.className = 'sve-swatch-checker';
                            if (initP.alpha < 1) csChecker.classList.add('sve-visible');
                            const csOverlay = document.createElement('div');
                            csOverlay.className = 'sve-swatch-overlay';
                            csOverlay.style.backgroundColor = initP.hex;
                            csOverlay.style.opacity = initP.alpha;
                            swatch.appendChild(csChecker);
                            swatch.appendChild(csOverlay);

                            Tooltip.attach(swatch, () => {
                                const parsed = parseColorValue(swatch.dataset.currentColor || rawColor);
                                return `<span class="sve-tooltip-color-dot" style="background:${parsed.hex}"></span>${parsed.hex.toUpperCase()}`;
                            });

                            swatch.addEventListener('click', (e) => {
                                e.stopPropagation();
                                Tooltip.hide();
                                const currentColor = swatch.dataset.currentColor || rawColor;
                                CustomColorPicker.open(swatch, currentColor, (newColor) => {
                                    const parsed = parseColorValue(newColor);
                                    csOverlay.style.backgroundColor = parsed.hex;
                                    csOverlay.style.opacity = parsed.alpha;
                                    csChecker.classList.toggle('sve-visible', parsed.alpha < 1);
                                    swatch.dataset.currentColor = newColor;
                                    updateGradientColorGroup(gradientIndex, stopGroupIndex, newColor);
                                }, e.clientX, e.clientY);
                            });

                            attachSwatchDragHandlers(swatch, gradientIndex, displayIdx, swatches);
                            swatches.appendChild(swatch);
                        });

                        // Bouton + pour ajouter une nuance
                        const addBtn = document.createElement('button');
                        addBtn.className = 'sve-gradient-add-btn';
                        addBtn.innerHTML = '+';
                        Tooltip.attach(addBtn, 'Ajouter une nuance');
                        addBtn.addEventListener('click', (e) => { e.stopPropagation(); addGradientColorGroup(gradientIndex); });

                        // Bouton lisser (étoile) à droite
                        const smoothBtn = document.createElement('button');
                        smoothBtn.className = 'sve-gradient-compact-smooth' + (gradientEntry.smoothed ? ' sve-active' : '');
                        smoothBtn.innerHTML = '✦';
                        Tooltip.attach(smoothBtn, 'Lisser ce dégradé');
                        smoothBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const nowActive = !gradientEntry.smoothed;
                            smoothBtn.classList.toggle('sve-active', nowActive);
                            if (nowActive) smoothSingleGradient(gradientIndex);
                            else unsmoothedSingleGradient(gradientIndex);
                        });

                        // Bouton - pour convertir le dégradé en couleur unie
                        const removeGradBtn = document.createElement('button');
                        removeGradBtn.className = 'sve-gradient-remove-btn';
                        removeGradBtn.innerHTML = '−';
                        Tooltip.attach(removeGradBtn, 'Convertir en couleur unie');
                        removeGradBtn.addEventListener('click', (e) => { e.stopPropagation(); Tooltip.hide(); convertGradientToMainColor(gradientIndex); });

                        row.appendChild(label);
                        row.appendChild(swatches);
                        row.appendChild(addBtn);
                        row.appendChild(removeGradBtn);
                        row.appendChild(smoothBtn);
                        container.appendChild(row);
                    });

                    colorPalette.appendChild(container);

                } else {
                    // --- MODE NORMAL : un encart par gradient ---
                    gradientGroups.forEach((gradientEntry, gradientIndex) => {
                        const gradientBlock = document.createElement('div');
                        gradientBlock.className = 'sve-gradient-block';

                        // Enregistrer dans paletteMap : formes du gradient → gradientBlock
                        getShapesUsingGradient(gradientEntry.gradientElement).forEach(shape => paletteMap.set(shape, gradientBlock));

                        const gradientHeader = document.createElement('div');
                        gradientHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

                        const gradientLabel = document.createElement('div');
                        gradientLabel.className = 'sve-gradient-label';
                        gradientLabel.style.marginBottom = '0';
                        gradientLabel.textContent = gradientEntry.label.toUpperCase();

                        const smoothBtn = document.createElement('button');
                        smoothBtn.className = 'sve-gradient-compact-smooth' + (gradientEntry.smoothed ? ' sve-active' : '');
                        smoothBtn.innerHTML = '✦';
                        Tooltip.attach(smoothBtn, 'Lisser ce dégradé');
                        smoothBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const nowActive = !gradientEntry.smoothed;
                            smoothBtn.classList.toggle('sve-active', nowActive);
                            if (nowActive) smoothSingleGradient(gradientIndex);
                            else unsmoothedSingleGradient(gradientIndex);
                        });

                        const removeGradBtnN = document.createElement('button');
                        removeGradBtnN.className = 'sve-gradient-remove-btn';
                        removeGradBtnN.innerHTML = '−';
                        Tooltip.attach(removeGradBtnN, 'Convertir en couleur unie');
                        removeGradBtnN.addEventListener('click', (e) => { e.stopPropagation(); Tooltip.hide(); convertGradientToMainColor(gradientIndex); });

                        const headerBtns = document.createElement('div');
                        headerBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';
                        headerBtns.appendChild(removeGradBtnN);
                        headerBtns.appendChild(smoothBtn);

                        gradientHeader.appendChild(gradientLabel);
                        gradientHeader.appendChild(headerBtns);

                        const gradientSwatches = document.createElement('div');
                        gradientSwatches.className = 'sve-gradient-swatches';

                        const reversedN = isGradientReversed(gradientEntry.gradientElement);
                        const orderedGroupsN = reversedN ? [...gradientEntry.stopGroups].reverse() : gradientEntry.stopGroups;
                        orderedGroupsN.forEach((stopGroup, displayIdx) => {
                            const stopGroupIndex = reversedN ? gradientEntry.stopGroups.length - 1 - displayIdx : displayIdx;
                            const rawColor = stopGroup.color;
                            const initP = parseColorValue(rawColor);
                            const miniSwatchWrapper = document.createElement('div');
                            miniSwatchWrapper.className = 'sve-gradient-mini-swatch-wrapper';
                            const miniSwatch = document.createElement('div');
                            miniSwatch.className = 'sve-gradient-mini-swatch';
                            miniSwatch.dataset.currentColor = rawColor;

                            const msChecker = document.createElement('div');
                            msChecker.className = 'sve-swatch-checker';
                            if (initP.alpha < 1) msChecker.classList.add('sve-visible');
                            const msOverlay = document.createElement('div');
                            msOverlay.className = 'sve-swatch-overlay';
                            msOverlay.style.backgroundColor = initP.hex;
                            msOverlay.style.opacity = initP.alpha;
                            miniSwatch.appendChild(msChecker);
                            miniSwatch.appendChild(msOverlay);

                            Tooltip.attach(miniSwatch, () => {
                                const parsed = parseColorValue(miniSwatch.dataset.currentColor || rawColor);
                                return `<span class="sve-tooltip-color-dot" style="background:${parsed.hex}"></span>${parsed.hex.toUpperCase()}`;
                            });

                            miniSwatch.addEventListener('click', (e) => {
                                e.stopPropagation();
                                Tooltip.hide();
                                const currentColor = miniSwatch.dataset.currentColor || rawColor;
                                CustomColorPicker.open(miniSwatch, currentColor, (newColor) => {
                                    const parsed = parseColorValue(newColor);
                                    msOverlay.style.backgroundColor = parsed.hex;
                                    msOverlay.style.opacity = parsed.alpha;
                                    msChecker.classList.toggle('sve-visible', parsed.alpha < 1);
                                    miniSwatch.dataset.currentColor = newColor;
                                    updateGradientColorGroup(gradientIndex, stopGroupIndex, newColor);
                                }, e.clientX, e.clientY);
                            });

                            const deleteBtn = document.createElement('button');
                            deleteBtn.className = 'sve-gradient-delete-btn';
                            deleteBtn.innerHTML = '×';
                            Tooltip.attach(deleteBtn, 'Supprimer cette nuance');
                            deleteBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                deleteGradientColorGroup(gradientIndex, stopGroupIndex);
                            });
                            miniSwatchWrapper.appendChild(miniSwatch);
                            miniSwatchWrapper.appendChild(deleteBtn);
                            attachSwatchDragHandlers(miniSwatchWrapper, gradientIndex, displayIdx, gradientSwatches);
                            gradientSwatches.appendChild(miniSwatchWrapper);
                        });

                        // Bouton + pour ajouter une nuance
                        const addBtnN = document.createElement('button');
                        addBtnN.className = 'sve-gradient-add-btn';
                        addBtnN.innerHTML = '+';
                        Tooltip.attach(addBtnN, 'Ajouter une nuance');
                        addBtnN.addEventListener('click', (e) => { e.stopPropagation(); addGradientColorGroup(gradientIndex); });
                        gradientSwatches.appendChild(addBtnN);

                        gradientBlock.appendChild(gradientHeader);
                        gradientBlock.appendChild(gradientSwatches);
                        colorPalette.appendChild(gradientBlock);
                    });
                }

                // Attacher les listeners hover sur les formes SVG après rebuild de la palette
                attachShapeHoverListeners();
            }

            // --- NEW DIRECT UPDATE FUNCTIONS ---

            // Throttle : ne rebuild la palette qu'en fin de drag (pas à chaque pixel)
            let _displayColorsPending = false;
            let _dragState = null; // { gradientIndex, displayIdx } lors d'un drag de nuance
            function scheduleDisplayColors() {
                if (_displayColorsPending) return;
                _displayColorsPending = true;
                requestAnimationFrame(() => {
                    _displayColorsPending = false;
                    displayColors(mainColorGroups, gradientGroups);
                });
            }

            function convertMainColorToGradient(groupIndex) {
                if (!currentSVG || !mainColorGroups[groupIndex]) return;
                const group = mainColorGroups[groupIndex];
                const color = group.color;
                const parsed = parseColorValue(color);

                // Créer une version plus claire (+30% luminosité) pour le 2e stop
                const r = parseInt(parsed.hex.slice(1,3), 16);
                const g = parseInt(parsed.hex.slice(3,5), 16);
                const b = parseInt(parsed.hex.slice(5,7), 16);
                const lighten = v => Math.min(255, Math.round(v + (255 - v) * 0.4));
                const color2 = '#' + [r,g,b].map(lighten).map(v => v.toString(16).padStart(2,'0')).join('');

                // Créer un id unique pour le gradient
                const gradId = 'sve-grad-' + Date.now();

                // Créer le linearGradient dans le <defs>
                let defs = currentSVG.querySelector('defs');
                if (!defs) {
                    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                    currentSVG.insertBefore(defs, currentSVG.firstChild);
                }
                const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                grad.setAttribute('id', gradId);
                grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
                grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
                const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', color);
                const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', color2);
                grad.appendChild(stop1); grad.appendChild(stop2);
                defs.appendChild(grad);

                // Remplacer toutes les refs de couleur par url(#gradId)
                const urlRef = `url(#${gradId})`;
                group.refs.forEach(({ element, property }) => {
                    // Supprimer totalement le style inline (qui peut avoir !important et bloquer setAttribute)
                    element.removeAttribute('style');
                    // Maintenant setAttribute fonctionne sans interférence
                    element.setAttribute(property, urlRef);
                    // Re-appliquer aussi via style !important pour écraser n'importe quel CSS externe
                    element.style.setProperty(property, urlRef, 'important');
                });

                // Supprimer la couleur principale du groupe (elle est maintenant un dégradé)
                mainColorGroups.splice(groupIndex, 1);

                detectColors();
            }

            function updateMainColorGroup(groupIndex, newColor) {
                if (!mainColorGroups[groupIndex]) return;
                const group = mainColorGroups[groupIndex];

                group.color = newColor;
                group.refs.forEach(({ element, property }) => {
                    element.setAttribute(property, newColor);
                    element.style.setProperty(property, newColor, 'important');
                });

                lastDetectedMainColors = mainColorGroups.map(g => g.color);
                const currentGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ...currentGradientColors]);

                scheduleDisplayColors();
            }

            function redistributeStopOffsets(gradient) {
                const stops = gradient.querySelectorAll('stop');
                const n = stops.length;
                if (n === 1) { stops[0].setAttribute('offset', '0%'); return; }
                stops.forEach((stop, i) => {
                    stop.setAttribute('offset', `${Math.round((i / (n - 1)) * 10000) / 100}%`);
                });
            }

            // Réordonne une nuance d'un dégradé (indices en espace affichage, gère reversed)
            function reorderGradientStopGroup(gradientIndex, fromDisplayIdx, toDisplayIdx) {
                if (fromDisplayIdx === toDisplayIdx) return;
                const gradientEntry = gradientGroups[gradientIndex];
                if (!gradientEntry) return;
                const gradient = gradientEntry.gradientElement;
                const groups = gradientEntry.stopGroups;
                const reversed = isGradientReversed(gradient);
                const n = groups.length;

                // Travailler en espace affichage, puis reconvertir en ordre interne
                const displayOrder = reversed ? [...groups].reverse() : [...groups];
                const [moved] = displayOrder.splice(fromDisplayIdx, 1);
                displayOrder.splice(toDisplayIdx, 0, moved);
                gradientEntry.stopGroups = reversed ? displayOrder.reverse() : displayOrder;

                // Ré-ordonner les <stop> dans le DOM selon le nouvel ordre interne
                gradientEntry.stopGroups.forEach(sg => sg.stops.forEach(stop => gradient.appendChild(stop)));
                redistributeStopOffsets(gradient);

                // Mettre à jour _originalStops si le dégradé est lissé
                if (gradientEntry.smoothed && gradientEntry._originalStops) {
                    gradientEntry._originalStops = gradientEntry.stopGroups.map((sg, i) => ({
                        offset: n === 1 ? '0%' : (i / (n - 1) * 100).toFixed(2) + '%',
                        color: sg.color, opacity: null, style: null,
                    }));
                }

                const _gColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ..._gColors]);
                scheduleDisplayColors();
            }

            function updateGradientColorGroup(gradientIndex, stopGroupIndex, newColor) {
                if (!gradientGroups[gradientIndex]) return;
                const gradientEntry = gradientGroups[gradientIndex];
                if (!gradientEntry.stopGroups[stopGroupIndex]) return;
                const stopGroup = gradientEntry.stopGroups[stopGroupIndex];

                // Update cached color
                stopGroup.color = newColor;

                stopGroup.stops.forEach(stop => {
                    stop.setAttribute('stop-color', newColor);

                    // Also update inline style which often overrides attribute
                    if (stop.style && stop.style.stopColor) {
                        stop.style.stopColor = newColor;
                    }
                    const style = stop.getAttribute('style');
                    if (style && style.includes('stop-color')) {
                        stop.style.stopColor = newColor;
                    }
                });

                redistributeStopOffsets(gradientEntry.gradientElement);

                lastDetectedMainColors = mainColorGroups.map(g => g.color);
                const currentGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ...currentGradientColors]);

                scheduleDisplayColors();
            }

            function smoothSingleGradient(gradientIndex) {
                if (!currentSVG || !gradientGroups[gradientIndex]) return;

                const gradientEntry = gradientGroups[gradientIndex];
                const gradient = gradientEntry.gradientElement;

                // Utiliser stopGroups comme source de vérité pour les couleurs-clés.
                // stopGroups reflète exactement ce que l'utilisateur voit : ajouts, suppressions,
                // modifications de couleur. Lire les stops DOM bruts risquerait de ramener
                // des stops intermédiaires orphelins (ex : après suppression de 2 nuances).
                const detectedColors = gradientEntry.stopGroups.map(sg => sg.color);

                if (detectedColors.length === 0) return;

                // Sauvegarder les couleurs-clés actuelles pour permettre de "dé-lisser" ensuite.
                // On les prend depuis stopGroups (source de vérité), pas depuis le DOM brut.
                const n0 = detectedColors.length;
                gradientEntry._originalStops = detectedColors.map((color, i) => ({
                    offset:  n0 === 1 ? '0%' : (i / (n0 - 1) * 100).toFixed(2) + '%',
                    color,
                    opacity: null,
                    style:   null,
                }));

                // Supprimer tous les stops existants et recréer uniformément
                gradient.querySelectorAll('stop').forEach(s => s.remove());
                const n = detectedColors.length;
                detectedColors.forEach((color, i) => {
                    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                    const offset = n === 1 ? 0 : Math.round((i / (n - 1)) * 10000) / 100;
                    stop.setAttribute('offset', `${offset}%`);
                    stop.setAttribute('stop-color', color);
                    gradient.appendChild(stop);
                });

                gradientEntry.smoothed = true;
                setTimeout(() => { detectColors(); }, 50);
            }

            function unsmoothedSingleGradient(gradientIndex) {
                if (!currentSVG || !gradientGroups[gradientIndex]) return;

                const gradientEntry = gradientGroups[gradientIndex];
                const gradient = gradientEntry.gradientElement;

                gradient.querySelectorAll('stop').forEach(s => s.remove());

                if (gradientEntry._originalStops && gradientEntry._originalStops.length > 0) {
                    // Restaurer les stops originaux sauvegardés au moment du lissage
                    // (inclut tous les stops intermédiaires, pas seulement les clés détectées)
                    gradientEntry._originalStops.forEach(savedStop => {
                        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                        stop.setAttribute('stop-color', savedStop.color);
                        if (savedStop.opacity !== null && savedStop.opacity !== undefined) {
                            stop.setAttribute('stop-opacity', savedStop.opacity);
                        }
                        if (savedStop.offset) stop.setAttribute('offset', savedStop.offset);
                        gradient.appendChild(stop);
                    });
                    redistributeStopOffsets(gradient);
                } else {
                    // Fallback si _originalStops n'existe pas
                    gradientEntry.stopGroups.forEach(group => {
                        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                        stop.setAttribute('stop-color', group.color);
                        gradient.appendChild(stop);
                        group.stops = [stop];
                    });
                    redistributeStopOffsets(gradient);
                }

                gradientEntry._originalStops = null;
                gradientEntry.smoothed = false;
                setTimeout(() => { detectColors(); }, 50);
            }

            // Retourne true si le dégradé est visuellement de droite→gauche
            // (x2 < x1 pour un linearGradient, ou rotation > 90° via gradientTransform)
            function isGradientReversed(gradientEl) {
                if (gradientEl.tagName !== 'linearGradient') return false;
                // Vérifier gradientTransform rotate
                const gt = gradientEl.getAttribute('gradientTransform') || '';
                const rotMatch = gt.match(/rotate\(\s*([-\d.]+)/);
                if (rotMatch) {
                    const deg = parseFloat(rotMatch[1]) % 360;
                    const norm = (deg + 360) % 360;
                    if (norm > 90 && norm <= 270) return true;
                }
                const x1 = parseFloat(gradientEl.getAttribute('x1') || '0');
                const x2 = parseFloat(gradientEl.getAttribute('x2') || '1');
                return x2 < x1;
            }

            function addGradientColorGroup(gradientIndex) {
                if (!currentSVG || !gradientGroups[gradientIndex]) return;
                const gradientEntry = gradientGroups[gradientIndex];
                const gradient = gradientEntry.gradientElement;
                const groups = gradientEntry.stopGroups;

                const reversed = isGradientReversed(gradient);

                // La nuance "visuellement à droite" correspond au dernier stop DOM si normal,
                // ou au premier stop DOM si reversed
                const rightIdx = reversed ? 0 : groups.length - 1;
                const prevIdx  = reversed ? 1 : groups.length - 2;

                // Calculer une couleur intermédiaire entre les deux derniers stops côté droit
                let newColor = '#ffffff';
                if (groups.length >= 2) {
                    const c1 = parseColorValue(groups[prevIdx].color);
                    const c2 = parseColorValue(groups[rightIdx].color);
                    const mix = (a, b) => Math.round((a + b) / 2);
                    const r = mix(parseInt(c1.hex.slice(1,3),16), parseInt(c2.hex.slice(1,3),16));
                    const g = mix(parseInt(c1.hex.slice(3,5),16), parseInt(c2.hex.slice(3,5),16));
                    const b = mix(parseInt(c1.hex.slice(5,7),16), parseInt(c2.hex.slice(5,7),16));
                    newColor = '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
                } else if (groups.length === 1) {
                    newColor = groups[0].color;
                }

                // Créer le stop DOM : à la fin si normal, au début si reversed
                const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                stop.setAttribute('stop-color', newColor);
                if (reversed) {
                    gradient.insertBefore(stop, gradient.querySelector('stop'));
                    groups.unshift({ color: newColor, stops: [stop] });
                } else {
                    gradient.appendChild(stop);
                    groups.push({ color: newColor, stops: [stop] });
                }
                redistributeStopOffsets(gradient);

                // Si le dégradé est déjà lissé, mettre à jour _originalStops pour que
                // le retrait du lissage conserve cette nouvelle couleur ajoutée manuellement.
                if (gradientEntry.smoothed && gradientEntry._originalStops) {
                    const newEntry = { offset: '', color: newColor, opacity: null, style: null };
                    if (reversed) gradientEntry._originalStops.unshift(newEntry);
                    else gradientEntry._originalStops.push(newEntry);
                    // Redistribuer les offsets dans _originalStops
                    const n = gradientEntry._originalStops.length;
                    if (n > 1) {
                        gradientEntry._originalStops.forEach((s, i) => {
                            s.offset = (i / (n - 1) * 100).toFixed(2) + '%';
                        });
                    }
                }

                lastDetectedMainColors = mainColorGroups.map(g => g.color);
                const currentGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ...currentGradientColors]);
                scheduleDisplayColors();
            }

            // Supprime le gradient entier et remplace ses références par une couleur unie
            // (la première couleur du gradient, ou la dernière couleur détectée si vide)
            function convertGradientToMainColor(gradientIndex) {
                if (!currentSVG || !gradientGroups[gradientIndex]) return;
                const gradientEntry = gradientGroups[gradientIndex];
                const gradient = gradientEntry.gradientElement;
                const gradientId = gradient.id;

                // Couleur à utiliser : premier stopGroup du gradient
                const flatColor = gradientEntry.stopGroups.length > 0
                    ? gradientEntry.stopGroups[0].color
                    : (lastDetectedMainColors.length > 0 ? lastDetectedMainColors[0] : '#000000');

                if (gradientId) {
                    // Collecter l'ID du gradient + tous les alias (gradients qui pointent vers lui via href)
                    const idsToReplace = new Set([gradientId]);
                    currentSVG.querySelectorAll('linearGradient, radialGradient').forEach(g => {
                        const href = g.getAttribute('xlink:href') || g.getAttribute('href') || '';
                        const refId = href.startsWith('#') ? href.slice(1) : '';
                        if (refId && idsToReplace.has(refId)) {
                            const aliasId = g.id || g.getAttribute('id');
                            if (aliasId) idsToReplace.add(aliasId);
                        }
                    });

                    const allEls = [...currentSVG.querySelectorAll('*')];
                    for (const el of allEls) {
                        if (el.closest('defs')) continue;

                        // 1. Attributs fill / stroke directs  ex: fill="url(#id)"
                        ['fill', 'stroke'].forEach(prop => {
                            const attrVal = el.getAttribute(prop) || '';
                            let hit = false;
                            idsToReplace.forEach(id => { if (attrVal.includes('#' + id)) hit = true; });
                            if (hit) el.setAttribute(prop, flatColor);
                        });

                        // 2. Attribut style brut  ex: style="fill:url(#id);..."
                        // C'est le cas principal des SVG exportés par Illustrator !
                        const rawStyle = el.getAttribute('style') || '';
                        if (rawStyle) {
                            let newStyle = rawStyle;
                            idsToReplace.forEach(id => {
                                const needle = '#' + id;
                                if (newStyle.includes(needle)) {
                                    newStyle = newStyle
                                        .split('url(#' + id + ')').join(flatColor)
                                        .split("url('#" + id + "')").join(flatColor)
                                        .split('url("#' + id + '")').join(flatColor);
                                }
                            });
                            if (newStyle !== rawStyle) el.setAttribute('style', newStyle);
                        }
                    }

                    // 3. Balises <style> internes au SVG
                    currentSVG.querySelectorAll('style').forEach(styleEl => {
                        let txt = styleEl.textContent;
                        let changed = false;
                        idsToReplace.forEach(id => {
                            const needle = '#' + id;
                            if (txt.includes(needle)) {
                                txt = txt
                                    .split('url(#' + id + ')').join(flatColor)
                                    .split("url('#" + id + "')").join(flatColor)
                                    .split('url("#' + id + '")').join(flatColor);
                                changed = true;
                            }
                        });
                        if (changed) styleEl.textContent = txt;
                    });
                }

                gradient.remove();
                gradientGroups.splice(gradientIndex, 1);

                // Refresh
                detectColors();
                lastDetectedMainColors = mainColorGroups.map(g => g.color);
                const currentGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ...currentGradientColors]);
            }

            function deleteGradientColorGroup(gradientIndex, stopGroupIndex) {
                if (!currentSVG || !gradientGroups[gradientIndex]) return;
                const gradientEntry = gradientGroups[gradientIndex];
                if (!gradientEntry.stopGroups[stopGroupIndex]) return;

                const stopGroup = gradientEntry.stopGroups[stopGroupIndex];
                const gradient = gradientEntry.gradientElement;
                let deletedCount = 0;

                // Supprimer les stops du DOM
                stopGroup.stops.forEach(stop => {
                    if (stop.parentNode) {
                        stop.remove();
                        deletedCount++;
                    }
                });

                if (deletedCount === 0) return;

                // Retirer le stopGroup de l'entrée gradient
                gradientEntry.stopGroups.splice(stopGroupIndex, 1);

                // Si le gradient n'a plus qu'une couleur ou aucune → basculer en couleur principale
                if (gradientEntry.stopGroups.length <= 1) {
                    convertGradientToMainColor(gradientIndex);
                    return; // detectColors() est appelé dans convertGradientToMainColor
                } else {
                    redistributeStopOffsets(gradient);
                }

                // Refresh UI
                displayColors(mainColorGroups, gradientGroups);

                // Update background
                lastDetectedMainColors = mainColorGroups.map(g => g.color);
                const currentGradientColors = gradientGroups.flatMap(g => g.stopGroups.map(sg => sg.color));
                adaptBackgroundColor([...lastDetectedMainColors, ...currentGradientColors]);
            }

            function exportAs(format, scale = 2, filename = null) {
                if (!currentSVG) return;
                setTimeout(() => {
                    switch (format) {
                        case 'svg':  exportSVG(filename); break;
                        case 'png':  exportRaster('png',  scale, filename); break;
                        case 'jpeg': exportRaster('jpeg', scale, filename); break;
                    }
                }, 100);
            }
            function exportSVG(filename = null) {
                if (!currentSVG) return;

                const serializer = new XMLSerializer();
                let svgClone = currentSVG.cloneNode(true);

                // Si transformations appliquées
                if (currentRotation !== 0 || mirrorHorizontal || mirrorVertical) {
                    const originalBBox = currentSVG.getBBox();
                    const cx = originalBBox.x + originalBBox.width / 2;
                    const cy = originalBBox.y + originalBBox.height / 2;

                    // Créer un groupe wrapper avec les transformations
                    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                    let transforms = [];
                    // Ordre important : translate centre -> rotate/scale -> translate back
                    transforms.push(`translate(${cx} ${cy})`);

                    if (currentRotation !== 0) {
                        transforms.push(`rotate(${currentRotation})`);
                    }

                    let scaleX = mirrorHorizontal ? -1 : 1;
                    let scaleY = mirrorVertical ? -1 : 1;
                    if (scaleX !== 1 || scaleY !== 1) {
                        transforms.push(`scale(${scaleX} ${scaleY})`);
                    }

                    transforms.push(`translate(${-cx} ${-cy})`);

                    g.setAttribute('transform', transforms.join(' '));

                    // Déplacer tout le contenu dans le groupe
                    while (svgClone.firstChild) {
                        g.appendChild(svgClone.firstChild);
                    }
                    svgClone.appendChild(g);

                    // Ajuster le viewBox pour inclure toute l'image transformée
                    const angleRad = currentRotation * Math.PI / 180;
                    const cos = Math.abs(Math.cos(angleRad));
                    const sin = Math.abs(Math.sin(angleRad));

                    const newWidth = originalBBox.width * cos + originalBBox.height * sin;
                    const newHeight = originalBBox.width * sin + originalBBox.height * cos;

                    // Centrer le contenu dans le nouveau viewBox
                    const newX = cx - newWidth / 2;
                    const newY = cy - newHeight / 2;

                    svgClone.setAttribute('viewBox', `${newX} ${newY} ${newWidth} ${newHeight}`);
                    svgClone.setAttribute('width', newWidth);
                    svgClone.setAttribute('height', newHeight);
                }

                const svgString = serializer.serializeToString(svgClone);
                const blob = new Blob([svgString], { type: 'image/svg+xml' });
                downloadBlob(blob, filename || 'edited-image.svg');
            }
            function exportRaster(format, exportScale = 2, filename = null) {
                if (!currentSVG) {
                    console.error('No SVG found');
                    alert('Aucun SVG chargé');
                    return;
                }

                try {
                    const originalBBox = currentSVG.getBBox();

                    // Facteur d'échelle choisi par l'utilisateur (x1 / x2 / x4 / x8)
                    const scale = exportScale;

                    // Calcul des dimensions transformées
                    const angleRad = currentRotation * Math.PI / 180;
                    const cos = Math.abs(Math.cos(angleRad));
                    const sin = Math.abs(Math.sin(angleRad));

                    // Dimensions du bounding box après rotation
                    const newWidth = (originalBBox.width * cos + originalBBox.height * sin);
                    const newHeight = (originalBBox.width * sin + originalBBox.height * cos);

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Padding pour JPEG : 5% de chaque côté
                    const padRatio = format === 'jpeg' ? 0.05 : 0;
                    const padX = newWidth  * padRatio * scale;
                    const padY = newHeight * padRatio * scale;

                    // Configurer le canvas avec la taille finale HD + padding
                    canvas.width  = newWidth  * scale + padX * 2;
                    canvas.height = newHeight * scale + padY * 2;

                    if (format === 'jpeg') {
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }

                    // Préparer le SVG pour le rendu
                    const serializer = new XMLSerializer();
                    let svgClone = currentSVG.cloneNode(true);

                    // Nettoyer les styles qui pourraient gêner
                    svgClone.style.transform = '';
                    svgClone.style.margin = '0';

                    // Créer un groupe wrapper pour appliquer les transformations
                    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                    const cx = originalBBox.x + originalBBox.width / 2;
                    const cy = originalBBox.y + originalBBox.height / 2;

                    // Construction de la matrice de transformation
                    let transforms = [];

                    // Rotation autour du centre de l'objet
                    transforms.push(`translate(${cx} ${cy})`);

                    if (currentRotation !== 0) {
                        transforms.push(`rotate(${currentRotation})`);
                    }

                    // Miroir
                    let scaleX = mirrorHorizontal ? -1 : 1;
                    let scaleY = mirrorVertical ? -1 : 1;
                    if (scaleX !== 1 || scaleY !== 1) {
                        transforms.push(`scale(${scaleX} ${scaleY})`);
                    }

                    transforms.push(`translate(${-cx} ${-cy})`);

                    g.setAttribute('transform', transforms.join(' '));

                    while (svgClone.firstChild) {
                        g.appendChild(svgClone.firstChild);
                    }
                    svgClone.appendChild(g);

                    // Ajuster le viewBox du SVG cloné pour qu'il englobe *exactement* la forme transformée
                    // Le coin haut-gauche du viewBox doit être :
                    const vbX = cx - newWidth / 2;
                    const vbY = cy - newHeight / 2;

                    svgClone.setAttribute('viewBox', `${vbX} ${vbY} ${newWidth} ${newHeight}`);
                    svgClone.setAttribute('width', newWidth * scale); // On force la taille de rendu ici
                    svgClone.setAttribute('height', newHeight * scale);

                    let svgString = serializer.serializeToString(svgClone);

                    // Fix namespace
                    if (!svgString.includes('xmlns')) {
                        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                    }

                    const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

                    const img = new Image();
                    img.onload = function () {
                        try {
                            ctx.drawImage(img, padX, padY, newWidth * scale, newHeight * scale);

                            canvas.toBlob(function (blob) {
                                if (!blob) {
                                    alert('Erreur creation blob image');
                                    return;
                                }
                                const extension = format === 'jpeg' ? 'jpg' : 'png';
                                downloadBlob(blob, filename || `edited-image-x${exportScale}.${extension}`);
                            }, `image/${format}`, 0.95);
                        } catch (err) {
                            console.error('Canvas draw error:', err);
                            alert('Erreur dessin canvas: ' + err.message);
                        }
                    };
                    img.onerror = function (e) {
                        console.error('Img load error', e);
                        alert('Erreur chargement SVG pour export');
                    };
                    img.src = svgDataUrl;

                } catch (err) {
                    console.error('Export error total:', err);
                    alert('Erreur export: ' + err.message);
                }
            }
            function downloadBlob(blob, filename) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            // --- TOOLTIP CUSTOM (instantané, stylisé) ---
            const Tooltip = {
                el: null,
                init() {
                    if (this.el) return;
                    const t = document.createElement('div');
                    t.id = 'sve-tooltip';
                    document.body.appendChild(t);
                    this.el = t;
                    // Cache le tooltip dès qu'un clic survient n'importe où,
                    // en phase de capture (avant que le DOM soit modifié par le handler)
                    document.addEventListener('mousedown', () => this.hide(), true);
                },
                show(target, html, e) {
                    this.init();
                    this.el.innerHTML = html;
                    this.el.classList.add('sve-visible');
                    this.position(e);
                },
                position(e) {
                    if (!this.el) return;
                    const pad = 10;
                    let x = e.clientX + pad;
                    let y = e.clientY + pad;
                    // Forcer un reflow pour obtenir les dimensions
                    const rect = this.el.getBoundingClientRect();
                    if (x + rect.width > window.innerWidth - pad) {
                        x = e.clientX - rect.width - pad;
                    }
                    if (y + rect.height > window.innerHeight - pad) {
                        y = e.clientY - rect.height - pad;
                    }
                    this.el.style.left = x + 'px';
                    this.el.style.top = y + 'px';
                },
                move(e) {
                    if (!this.el || !this.el.classList.contains('sve-visible')) return;
                    this.position(e);
                },
                hide() {
                    if (this.el) this.el.classList.remove('sve-visible');
                },
                // Helper : attache les events sur un élément
                attach(el, htmlOrFn) {
                    el.addEventListener('mouseenter', (e) => {
                        const html = typeof htmlOrFn === 'function' ? htmlOrFn() : htmlOrFn;
                        this.show(el, html, e);
                    });
                    el.addEventListener('mousemove', (e) => this.move(e));
                    el.addEventListener('mouseleave', () => this.hide());
                }
            };

            const CustomColorPicker = {
                picker: null,
                svContainer: null,
                hueBar: null,
                satBar: null,
                opacityBar: null,
                svCursor: null,
                hueCursor: null,
                satCursor: null,
                opaCursor: null,
                hexInput: null,
                alphaInput: null,
                preview: null,
                hueValueEl: null,
                satValueEl: null,
                opaValueEl: null,

                hsv: { h: 0, s: 1, v: 1 },
                alpha: 1,
                currentHex: '#000000',
                callback: null,
                targetElement: null,
                dragging: null, // 'sv' | 'hue' | 'sat' | 'opa'

                init() {
                    if (this.picker) return;

                    const root = document.createElement('div');
                    root.id = 'sve-color-picker';
                    root.innerHTML = `
                        <div class="sve-picker-sv">
                            <div class="sve-picker-sv-white"></div>
                            <div class="sve-picker-sv-black"></div>
                            <div class="sve-picker-cursor"></div>
                        </div>
                        <div class="sve-picker-slider-row">
                            <span class="sve-picker-slider-label">H</span>
                            <div class="sve-picker-hue">
                                <div class="sve-picker-slider-cursor"></div>
                            </div>
                            <span class="sve-picker-slider-value sve-hue-value">0°</span>
                        </div>
                        <div class="sve-picker-slider-row">
                            <span class="sve-picker-slider-label">S</span>
                            <div class="sve-picker-saturation-bar">
                                <div class="sve-picker-slider-cursor"></div>
                            </div>
                            <span class="sve-picker-slider-value sve-sat-value">100%</span>
                        </div>
                        <div class="sve-picker-slider-row">
                            <span class="sve-picker-slider-label">A</span>
                            <div class="sve-picker-opacity-bar">
                                <div class="sve-picker-opacity-checkerboard"></div>
                                <div class="sve-picker-opacity-gradient"></div>
                                <div class="sve-picker-slider-cursor"></div>
                            </div>
                            <span class="sve-picker-slider-value sve-opa-value">100%</span>
                        </div>
                        <div class="sve-picker-controls">
                            <div class="sve-picker-preview-wrap">
                                <div class="sve-picker-preview-checker"></div>
                                <div class="sve-picker-preview"></div>
                            </div>
                            <div class="sve-picker-inputs">
                                <div class="sve-picker-input-group sve-hex-group">
                                    <input type="text" class="sve-picker-input sve-hex-input" maxlength="7" spellcheck="false" placeholder="#HEX" value="#FFFFFF">
                                </div>
                                <div class="sve-picker-input-group sve-alpha-group">
                                    <input type="text" class="sve-picker-input sve-alpha-input" maxlength="4" spellcheck="false" placeholder="%" value="100%">
                                </div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(root);

                    this.picker = root;
                    this.svContainer = root.querySelector('.sve-picker-sv');
                    this.hueBar = root.querySelector('.sve-picker-hue');
                    this.satBar = root.querySelector('.sve-picker-saturation-bar');
                    this.opacityBar = root.querySelector('.sve-picker-opacity-bar');
                    this.svCursor = root.querySelector('.sve-picker-sv .sve-picker-cursor');
                    this.hueCursor = this.hueBar.querySelector('.sve-picker-slider-cursor');
                    this.satCursor = this.satBar.querySelector('.sve-picker-slider-cursor');
                    this.opaCursor = this.opacityBar.querySelector('.sve-picker-slider-cursor');
                    this.hexInput = root.querySelector('.sve-hex-input');
                    this.alphaInput = root.querySelector('.sve-alpha-input');
                    this.preview = root.querySelector('.sve-picker-preview');
                    this.hueValueEl = root.querySelector('.sve-hue-value');
                    this.satValueEl = root.querySelector('.sve-sat-value');
                    this.opaValueEl = root.querySelector('.sve-opa-value');
                    this.opacityGradient = root.querySelector('.sve-picker-opacity-gradient');

                    // Events — drag start
                    this.svContainer.addEventListener('mousedown', (e) => { this.dragging = 'sv'; this.handleSV(e); });
                    this.hueBar.addEventListener('mousedown', (e) => { this.dragging = 'hue'; this.handleHue(e); });
                    this.satBar.addEventListener('mousedown', (e) => { this.dragging = 'sat'; this.handleSat(e); });
                    this.opacityBar.addEventListener('mousedown', (e) => { this.dragging = 'opa'; this.handleOpa(e); });

                    window.addEventListener('mousemove', (e) => {
                        if (!this.dragging) return;
                        if (this.dragging === 'sv') this.handleSV(e);
                        else if (this.dragging === 'hue') this.handleHue(e);
                        else if (this.dragging === 'sat') this.handleSat(e);
                        else if (this.dragging === 'opa') this.handleOpa(e);
                    });
                    window.addEventListener('mouseup', () => { this.dragging = null; });

                    // Inputs
                    this.hexInput.addEventListener('input', (e) => {
                        let val = e.target.value;
                        if (val.startsWith('#') && val.length === 7) {
                            this.setFromHex(val, this.alpha);
                        }
                    });
                    this.hexInput.addEventListener('change', (e) => {
                        let val = e.target.value;
                        if (!val.startsWith('#')) val = '#' + val;
                        const normalized = normalizeColor(val);
                        if (normalized) {
                            this.setFromHex(normalized, this.alpha);
                        } else {
                            this.hexInput.value = this.currentHex.toUpperCase();
                        }
                    });
                    this.alphaInput.addEventListener('change', (e) => {
                        let val = e.target.value.replace('%', '').trim();
                        let num = parseInt(val, 10);
                        if (isNaN(num)) num = 100;
                        num = Math.max(0, Math.min(100, num));
                        this.alpha = num / 100;
                        this.updateUI(true);
                    });

                    // Close on click outside
                    document.addEventListener('mousedown', (e) => {
                        if (this.picker.classList.contains('sve-visible') &&
                            !this.picker.contains(e.target) &&
                            e.target !== this.targetElement) {
                            this.close();
                        }
                    });
                },

                open(target, color, cb, mouseX, mouseY) {
                    this.init();
                    this.targetElement = target;
                    this.callback = cb;
                    this.mouseX = mouseX || 0;
                    this.mouseY = mouseY || 0;

                    // Parse alpha si la couleur est en rgba
                    let alpha = 1;
                    let hex = color;
                    const rgbaMatch = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
                    if (rgbaMatch) {
                        hex = this.rgbToHex(+rgbaMatch[1], +rgbaMatch[2], +rgbaMatch[3]);
                        alpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
                    }

                    this.setFromHex(hex, alpha);
                    this.updatePosition();
                    this.picker.classList.add('sve-visible');
                },

                close() {
                    if (this.picker) {
                        this.picker.classList.remove('sve-visible');
                    }
                },

                updatePosition() {
                    const pickerWidth = 260;
                    const pickerHeight = 310;

                    let top = this.mouseY;
                    let left = this.mouseX + 15;

                    if (left + pickerWidth > window.innerWidth) {
                        left = this.mouseX - pickerWidth - 15;
                    }
                    if (top + pickerHeight > window.innerHeight) {
                        top = window.innerHeight - pickerHeight - 10;
                    }
                    if (top < 10) top = 10;
                    if (left < 10) left = 10;

                    this.picker.style.top = top + 'px';
                    this.picker.style.left = left + 'px';
                },

                setFromHex(hex, alpha) {
                    this.currentHex = normalizeColor(hex) || '#000000';
                    this.hsv = this.hexToHsv(this.currentHex);
                    if (alpha !== undefined) this.alpha = Math.max(0, Math.min(1, alpha));
                    this.updateUI(true);
                },

                updateUI(updateInput = false) {
                    const h = this.hsv.h;
                    const s = this.hsv.s;
                    const v = this.hsv.v;
                    const a = this.alpha;

                    // SV panel background = pure hue
                    const hueRgb = this.hsvToRgb(h, 1, 1);
                    this.svContainer.style.background = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;

                    // SV cursor
                    this.svCursor.style.left = (s * 100) + '%';
                    this.svCursor.style.top = ((1 - v) * 100) + '%';

                    // Hue cursor + value
                    this.hueCursor.style.left = (h * 100) + '%';
                    this.hueValueEl.textContent = Math.round(h * 360) + '°';

                    // Saturation bar gradient : de désaturé à saturé (à la hue et value actuelles)
                    const desat = this.hsvToRgb(h, 0, v);
                    const fullsat = this.hsvToRgb(h, 1, v);
                    this.satBar.style.background = `linear-gradient(to right, rgb(${desat.r},${desat.g},${desat.b}), rgb(${fullsat.r},${fullsat.g},${fullsat.b}))`;
                    this.satCursor.style.left = (s * 100) + '%';
                    this.satValueEl.textContent = Math.round(s * 100) + '%';

                    // Opacity bar gradient
                    const rgb = this.hsvToRgb(h, s, v);
                    const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
                    this.currentHex = hex;
                    this.opacityGradient.style.background = `linear-gradient(to right, transparent, ${hex})`;
                    this.opaCursor.style.left = (a * 100) + '%';
                    this.opaValueEl.textContent = Math.round(a * 100) + '%';

                    // Preview (avec transparence)
                    this.preview.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;

                    // Inputs
                    if (updateInput) {
                        this.hexInput.value = hex.toUpperCase();
                        this.alphaInput.value = Math.round(a * 100) + '%';
                    }

                    // Callback — retourne hex si opaque, rgba sinon
                    if (this.callback) {
                        if (a >= 1) {
                            this.callback(hex);
                        } else {
                            this.callback(`rgba(${rgb.r},${rgb.g},${rgb.b},${parseFloat(a.toFixed(2))})`);
                        }
                    }
                },

                handleSV(e) {
                    const rect = this.svContainer.getBoundingClientRect();
                    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    let y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
                    this.hsv.s = x / rect.width;
                    this.hsv.v = 1 - (y / rect.height);
                    this.updateUI(true);
                },

                handleHue(e) {
                    const rect = this.hueBar.getBoundingClientRect();
                    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    this.hsv.h = x / rect.width;
                    this.updateUI(true);
                },

                handleSat(e) {
                    const rect = this.satBar.getBoundingClientRect();
                    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    this.hsv.s = x / rect.width;
                    this.updateUI(true);
                },

                handleOpa(e) {
                    const rect = this.opacityBar.getBoundingClientRect();
                    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    this.alpha = x / rect.width;
                    this.updateUI(true);
                },

                // — Helpers —
                hexToHsv(hex) {
                    const { h, s, v } = hexToHsvHelper(hex);
                    // hexToHsvHelper retourne h en 0-360, normaliser en 0-1
                    return { h: h / 360, s, v };
                },

                hsvToRgb(h, s, v) {
                    let r, g, b;
                    const i = Math.floor(h * 6);
                    const f = h * 6 - i;
                    const p = v * (1 - s);
                    const q = v * (1 - f * s);
                    const t = v * (1 - (1 - f) * s);
                    switch (i % 6) {
                        case 0: r = v; g = t; b = p; break;
                        case 1: r = q; g = v; b = p; break;
                        case 2: r = p; g = v; b = t; break;
                        case 3: r = p; g = q; b = v; break;
                        case 4: r = t; g = p; b = v; break;
                        case 5: r = v; g = p; b = q; break;
                    }
                    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
                },

                rgbToHex(r, g, b) {
                    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                }
            };
            // Initialiser les tooltips sur les éléments HTML statiques [data-tooltip]
            document.querySelectorAll('[data-tooltip]').forEach(el => {
                Tooltip.attach(el, el.getAttribute('data-tooltip'));
            });

            // =====================================================================
            // ZOOM / PAN DU CANVAS
            // =====================================================================

            (function initCanvasZoomPan() {
                const canvasArea = document.querySelector('.sve-canvas-area');

                // Zoom/pan : applyTransform gère déjà l'overlay en mode édition
                function applyZoomPan() { applyTransform(); }

                // --- Smooth zoom ---
                let _zoomTarget = null; // { zoom, panX, panY }
                let _zoomRafId  = null;

                function _animateZoom() {
                    if (!_zoomTarget) return;
                    const SPEED = 0.18; // 0..1 : plus grand = plus rapide
                    canvasZoom += (_zoomTarget.zoom - canvasZoom) * SPEED;
                    canvasPanX += (_zoomTarget.panX - canvasPanX) * SPEED;
                    canvasPanY += (_zoomTarget.panY - canvasPanY) * SPEED;
                    applyZoomPan();
                    const dz = Math.abs(_zoomTarget.zoom - canvasZoom);
                    const dp = Math.abs(_zoomTarget.panX - canvasPanX) + Math.abs(_zoomTarget.panY - canvasPanY);
                    if (dz < 0.0005 && dp < 0.05) {
                        canvasZoom = _zoomTarget.zoom;
                        canvasPanX = _zoomTarget.panX;
                        canvasPanY = _zoomTarget.panY;
                        _zoomTarget = null;
                        applyZoomPan();
                    } else {
                        _zoomRafId = requestAnimationFrame(_animateZoom);
                    }
                }

                // Molette : zoom centré sur la souris (style Adobe)
                canvasArea.addEventListener('wheel', (e) => {
                    if (!currentSVG) return;
                    e.preventDefault();

                    // Point cible : position de la souris relative au centre du canvas
                    const canvasRect = canvasArea.getBoundingClientRect();
                    const cx = canvasRect.left + canvasRect.width  / 2;
                    const cy = canvasRect.top  + canvasRect.height / 2;
                    const mx = e.clientX - cx;
                    const my = e.clientY - cy;

                    // Partir du zoom cible courant (pas du zoom réel, pour accumuler les ticks molette)
                    const fromZoom = _zoomTarget ? _zoomTarget.zoom : canvasZoom;
                    const fromPanX = _zoomTarget ? _zoomTarget.panX : canvasPanX;
                    const fromPanY = _zoomTarget ? _zoomTarget.panY : canvasPanY;

                    const factor  = e.deltaY > 0 ? 0.88 : 1.14;
                    const newZoom = Math.min(40, Math.max(0.05, fromZoom * factor));
                    const ratio   = newZoom / fromZoom;

                    // Le point sous la souris doit rester fixe : p' = mouse + (p - mouse) * ratio
                    _zoomTarget = {
                        zoom: newZoom,
                        panX: mx + (fromPanX - mx) * ratio,
                        panY: my + (fromPanY - my) * ratio,
                    };

                    if (_zoomRafId) cancelAnimationFrame(_zoomRafId);
                    _zoomRafId = requestAnimationFrame(_animateZoom);
                }, { passive: false });

                // Cibles valides pour pan : fond canvas, svgDisplay, SVG et ses formes,
                // overlay edit (mais PAS les points d'ancrage/handle)
                function isPanTarget(el) {
                    if (!el) return false;
                    // Jamais les points d'édition
                    if (el.classList && (el.classList.contains('sve-anchor-point') ||
                                         el.classList.contains('sve-control-point'))) return false;
                    if (el === canvasArea) return true;
                    if (el.id === 'svgDisplay') return true;
                    if (el.id === 'edit-overlay-svg') return true;
                    // Tout élément à l'intérieur du SVG courant (formes, groupes…)
                    if (currentSVG && currentSVG.contains(el)) return true;
                    return false;
                }

                // Double-clic sur le fond : reset (annule l'animation en cours)
                canvasArea.addEventListener('dblclick', (e) => {
                    if (!isPanTarget(e.target)) return;
                    if (_zoomRafId) { cancelAnimationFrame(_zoomRafId); _zoomRafId = null; }
                    _zoomTarget = null;
                    canvasZoom = 1; canvasPanX = 0; canvasPanY = 0;
                    applyZoomPan();
                });

                // Pan : clic-glisser sur le fond
                canvasArea.addEventListener('mousedown', (e) => {
                    if (!isPanTarget(e.target)) return;
                    // Annuler l'animation zoom en cours pour que le pan parte du zoom actuel
                    if (_zoomRafId) { cancelAnimationFrame(_zoomRafId); _zoomRafId = null; }
                    if (_zoomTarget) { canvasZoom = _zoomTarget.zoom; canvasPanX = _zoomTarget.panX; canvasPanY = _zoomTarget.panY; _zoomTarget = null; }
                    isPanning = true;
                    panStartX = e.clientX - canvasPanX;
                    panStartY = e.clientY - canvasPanY;
                    canvasArea.classList.add('sve-panning');
                    e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isPanning) return;
                    canvasPanX = e.clientX - panStartX;
                    canvasPanY = e.clientY - panStartY;
                    applyZoomPan();
                });

                window.addEventListener('mouseup', () => {
                    if (!isPanning) return;
                    isPanning = false;
                    canvasArea.classList.remove('sve-panning');
                });

                canvasArea.classList.add('sve-zoom-active');
            })();

            // =====================================================================
            // MODE ÉDITION — points d'ancrage et tangentes Bézier
            // =====================================================================

            // --- Undo / Redo ---

            function pushUndo() {
                if (!currentSVG) return;
                _undoStack.push(currentSVG.outerHTML);
                if (_undoStack.length > 50) _undoStack.shift(); // limite 50 états
                _redoStack = [];
                _syncUndoRedoBtns();
            }

            function _applyHistoryState(html) {
                svgDisplay.innerHTML = html;
                currentSVG = svgDisplay.querySelector('svg');
                if (currentSVG) {
                    applyTransform();
                    // En mode édition, le SVG doit laisser le contenu déborder de la viewBox
                    if (editModeActive) currentSVG.setAttribute('overflow', 'visible');
                }
                // Resynchroniser la palette sur les nouveaux nœuds DOM
                detectColors();
                if (editModeActive) { buildEditShapeData(); renderEditPoints(); }
                _syncUndoRedoBtns();
            }

            function _syncUndoRedoBtns() {
                document.getElementById('undoBtn').disabled = _undoStack.length === 0;
                document.getElementById('redoBtn').disabled = _redoStack.length === 0;
            }

            function undoEdit() {
                if (!_undoStack.length || !currentSVG) return;
                _redoStack.push(currentSVG.outerHTML);
                _applyHistoryState(_undoStack.pop());
            }

            function redoEdit() {
                if (!_redoStack.length || !currentSVG) return;
                _undoStack.push(currentSVG.outerHTML);
                _applyHistoryState(_redoStack.pop());
            }

            // Ctrl+Z / Ctrl+Y global (actif en mode édition ET après avoir quitté le mode édition)
            document.addEventListener('keydown', (e) => {
                const tag = document.activeElement ? document.activeElement.tagName : '';
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                    e.preventDefault(); undoEdit();
                } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                    e.preventDefault(); redoEdit();
                }
            });

            function _setEditUIActive(active) {
                const root = document.getElementById('sve-root');
                root.classList.toggle('sve-edit-active', active);
                const btn = document.getElementById('editModeBtn');
                btn.classList.toggle('sve-active', active);
                btn.innerHTML = active ? '✏️ Quitter l\'édition' : '✏️ Édition';
                _syncUndoRedoBtns();
            }

            function toggleEditMode() {
                if (!currentSVG) return;
                editModeActive = !editModeActive;
                if (editModeActive) enterEditMode();
                else exitEditMode();
            }

            function enterEditMode() {
                clearHighlight();
                _setEditUIActive(true);
                getAllLeafShapes().forEach(leaf => { leaf.style.cursor = 'default'; });
                // Mémoriser la taille naturelle du SVG (sans zoom CSS) pour computePointRadius
                if (currentSVG) {
                    const saved = currentSVG.style.transform;
                    currentSVG.style.transform = 'none';
                    _editNaturalW = currentSVG.getBoundingClientRect().width || 500;
                    currentSVG.style.transform = saved;
                    // Laisser les formes déborder hors de la viewBox pendant l'édition
                    currentSVG.setAttribute('overflow', 'visible');
                }
                _overlayGeoCache = null; // invalider le cache au démarrage du mode édition
                createEditOverlay();
                buildEditShapeData();
                renderEditPoints();
                initEditDragEvents();
            }

            function exitEditMode() {
                editModeActive = false;
                selectedAnchor = null;
                if (_renderEditRafId) { cancelAnimationFrame(_renderEditRafId); _renderEditRafId = null; }
                _setEditUIActive(false);
                if (editOverlaySVG && editOverlaySVG.parentNode) {
                    editOverlaySVG.parentNode.removeChild(editOverlaySVG);
                }
                editOverlaySVG = null;
                editShapeData = [];
                editDragState = null;
                removeEditDragEvents();
                window.removeEventListener('resize', onEditResize);
                // Recalculer la viewBox pour englober tout le contenu modifié,
                // puis retirer overflow="sve-visible" pour que le clip normal reprenne
                if (currentSVG) {
                    try {
                        const bbox = currentSVG.getBBox();
                        if (bbox && bbox.width > 0 && bbox.height > 0) {
                            const pad = 2; // petite marge en unités SVG
                            currentSVG.setAttribute('viewBox',
                                `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
                        }
                    } catch (_) {}
                    currentSVG.removeAttribute('overflow');
                }
                attachShapeHoverListeners();
            }

            // --- Overlay SVG ---

            function createEditOverlay() {
                const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                overlay.id = 'edit-overlay-svg';
                // Dans sve-canvas-area en position absolue — indépendant du zoom CSS du SVG
                document.querySelector('.sve-canvas-area').appendChild(overlay);
                // Clic sur le fond de l'overlay = désélectionner
                overlay.addEventListener('mousedown', (e) => {
                    if (e.target === overlay) {
                        selectedAnchor = null;
                        renderEditPoints();
                    }
                });
                editOverlaySVG = overlay;
                syncOverlayToSVG();
                window.addEventListener('resize', onEditResize);
            }

            function syncOverlayToSVG() {
                if (!currentSVG || !editOverlaySVG) return;
                const parentRect = document.querySelector('.sve-canvas-area').getBoundingClientRect();

                // La position naturelle du SVG (sans transform) ne change pas pendant le pan/zoom
                // CSS — seul le transform change. On met en cache pour éviter le double reflow
                // getBoundingClientRect à chaque frame d'animation.
                // Capturer le transform courant avant toute modification (nécessaire dans et hors cache)
                const savedTransform = currentSVG.style.transform;
                const savedOrigin    = currentSVG.style.transformOrigin;

                let svgLeft, svgTop, naturalW, naturalH;
                if (_overlayGeoCache &&
                    _overlayGeoCache.parentW === Math.round(parentRect.width) &&
                    _overlayGeoCache.parentH === Math.round(parentRect.height)) {
                    ({ svgLeft, svgTop, naturalW, naturalH } = _overlayGeoCache);
                } else {
                    currentSVG.style.transform = 'none';
                    const naturalRect = currentSVG.getBoundingClientRect();
                    currentSVG.style.transform       = savedTransform;
                    currentSVG.style.transformOrigin = savedOrigin;
                    svgLeft  = naturalRect.left - parentRect.left;
                    svgTop   = naturalRect.top  - parentRect.top;
                    naturalW = naturalRect.width;
                    naturalH = naturalRect.height;
                    _overlayGeoCache = { svgLeft, svgTop, naturalW, naturalH,
                        parentW: Math.round(parentRect.width),
                        parentH: Math.round(parentRect.height) };
                }
                const naturalRect = { left: svgLeft + parentRect.left, top: svgTop + parentRect.top,
                    width: naturalW, height: naturalH };

                // L'overlay couvre tout le sve-canvas-area pour que les points hors-SVG
                // restent visibles jusqu'aux bords du canvas (overflow:hidden du canvas fait le clip final)
                // Marge = espace disponible autour du SVG dans le canvas, au moins 200px
                const marginL = Math.max(200, svgLeft);
                const marginT = Math.max(200, svgTop);
                const marginR = Math.max(200, parentRect.width  - svgLeft - naturalRect.width);
                const marginB = Math.max(200, parentRect.height - svgTop  - naturalRect.height);

                const overlayW = naturalRect.width  + marginL + marginR;
                const overlayH = naturalRect.height + marginT + marginB;

                editOverlaySVG.style.left   = (svgLeft - marginL) + 'px';
                editOverlaySVG.style.top    = (svgTop  - marginT) + 'px';
                editOverlaySVG.style.width  = overlayW + 'px';
                editOverlaySVG.style.height = overlayH + 'px';

                // Même transform CSS que le SVG, mais transform-origin recalculé
                // pour pointer vers le centre du SVG dans les coords de l'overlay
                editOverlaySVG.style.transform = savedTransform || '';
                editOverlaySVG.style.transformOrigin =
                    (marginL + naturalRect.width  / 2) + 'px ' +
                    (marginT + naturalRect.height / 2) + 'px';

                // viewBox élargie proportionnellement aux marges
                let vx = 0, vy = 0, vw = naturalRect.width || 500, vh = naturalRect.height || 500;
                const svgVb = currentSVG.getAttribute('viewBox');
                if (svgVb) {
                    [vx, vy, vw, vh] = svgVb.trim().split(/[\s,]+/).map(parseFloat);
                } else {
                    vw = parseFloat(currentSVG.getAttribute('width'))  || 500;
                    vh = parseFloat(currentSVG.getAttribute('height')) || 500;
                }
                // Convertir les marges pixels → unités viewBox
                const scaleX = vw / naturalRect.width;
                const scaleY = vh / naturalRect.height;
                editOverlaySVG.setAttribute('viewBox',
                    `${vx - marginL * scaleX} ${vy - marginT * scaleY} ${vw + (marginL + marginR) * scaleX} ${vh + (marginT + marginB) * scaleY}`);
            }

            function onEditResize() {
                _overlayGeoCache = null; // invalider le cache géométrie au resize
                if (editModeActive) { syncOverlayToSVG(); renderEditPoints(); }
            }

            // --- Conversion coordonnées écran → espace viewBox ---

            // Conversion écran → viewBox.
            // Inverse exactement applyTransform() : dé-pan → dé-rotation → dé-miroir → dé-zoom → viewBox.
            function screenToEditCoords(clientX, clientY) {
                if (!currentSVG || !editOverlaySVG) return { x: 0, y: 0 };

                // Rect naturel du SVG (sans CSS transform) — taille et position stables
                const savedT = currentSVG.style.transform;
                currentSVG.style.transform = 'none';
                const nat = currentSVG.getBoundingClientRect();
                currentSVG.style.transform = savedT;

                // viewBox originale du SVG (l'overlay a une viewBox élargie, ne pas l'utiliser)
                const svgVbRaw = currentSVG.getAttribute('viewBox');
                let vx = 0, vy = 0, vw = nat.width || 500, vh = nat.height || 500;
                if (svgVbRaw) {
                    [vx, vy, vw, vh] = svgVbRaw.trim().split(/[\s,]+/).map(parseFloat);
                } else {
                    vw = parseFloat(currentSVG.getAttribute('width'))  || nat.width  || 500;
                    vh = parseFloat(currentSVG.getAttribute('height')) || nat.height || 500;
                }

                // applyTransform applique : translate(panX,panY) [rotate] scale(mirrorX*zoom, mirrorY*zoom)
                // avec transformOrigin = "center center" du SVG dans le canvas.
                // Le centre de rotation/scale CSS est le centre du SVG naturel + pan.
                const canvasRect = document.querySelector('.sve-canvas-area').getBoundingClientRect();
                // Centre du canvas (= transform-origin du SVG dans son conteneur)
                const originX = canvasRect.left + canvasRect.width  / 2 + canvasPanX;
                const originY = canvasRect.top  + canvasRect.height / 2 + canvasPanY;

                // 1. Dé-pan : vecteur depuis l'origine de transform
                let dx = clientX - originX;
                let dy = clientY - originY;

                // 2. Dé-rotation
                if (currentRotation !== 0) {
                    const rad = -currentRotation * Math.PI / 180;
                    const cos = Math.cos(rad), sin = Math.sin(rad);
                    const rx = dx * cos - dy * sin;
                    const ry = dx * sin + dy * cos;
                    dx = rx; dy = ry;
                }

                // 3. Dé-miroir
                if (mirrorHorizontal) dx = -dx;
                if (mirrorVertical)   dy = -dy;

                // 4. Dé-zoom
                dx /= canvasZoom;
                dy /= canvasZoom;

                // 5. Pixel naturel → viewBox
                // Le centre naturel du SVG correspond au centre du viewBox
                const natCx = nat.width  / 2;
                const natCy = nat.height / 2;
                const scaleX = vw / nat.width;
                const scaleY = vh / nat.height;

                const x = vx + (natCx + dx) * scaleX;
                const y = vy + (natCy + dy) * scaleY;

                return { x, y };
            }

            // --- Parsers de formes ---

            function buildEditShapeData() {
                editShapeData = [];
                if (!currentSVG) return;
                const selectors = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline'];
                const shapes = [...currentSVG.querySelectorAll(selectors.join(','))].filter(el => !isInDefs(el));
                shapes.forEach(el => {
                    const tag = el.tagName.toLowerCase();
                    let data;
                    if (tag === 'path')                       data = parsePath(el);
                    else if (tag === 'rect')                  data = parseRect(el);
                    else if (tag === 'circle')                data = parseCircle(el);
                    else if (tag === 'ellipse')               data = parseEllipse(el);
                    else if (tag === 'polygon' || tag === 'polyline') data = parsePolyShape(el);
                    if (data) editShapeData.push(data);
                });
            }

            function parseRect(el) {
                const x = parseFloat(el.getAttribute('x') || 0);
                const y = parseFloat(el.getAttribute('y') || 0);
                const w = parseFloat(el.getAttribute('width') || 0);
                const h = parseFloat(el.getAttribute('height') || 0);
                return {
                    element: el, type: 'rect',
                    anchors: [
                        { x,     y,     role: 'tl' },
                        { x:x+w, y,     role: 'tr' },
                        { x:x+w, y:y+h, role: 'br' },
                        { x,     y:y+h, role: 'bl' },
                    ],
                    controls: [], controlLines: [], pathSegments: []
                };
            }

            function parseCircle(el) {
                return {
                    element: el, type: 'circle',
                    anchors: [{ x: parseFloat(el.getAttribute('cx')||0), y: parseFloat(el.getAttribute('cy')||0) }],
                    controls: [], controlLines: [], pathSegments: []
                };
            }

            function parseEllipse(el) {
                const cx = parseFloat(el.getAttribute('cx')||0);
                const cy = parseFloat(el.getAttribute('cy')||0);
                const rx = parseFloat(el.getAttribute('rx')||0);
                const ry = parseFloat(el.getAttribute('ry')||0);
                return {
                    element: el, type: 'ellipse',
                    anchors: [
                        { x: cx,    y: cy,    role: 'center' },
                        { x: cx+rx, y: cy,    role: 'rx' },
                        { x: cx,    y: cy+ry, role: 'ry' },
                    ],
                    controls: [], controlLines: [], pathSegments: []
                };
            }

            function parsePolyShape(el) {
                const pts = (el.getAttribute('points')||'').trim().split(/[\s,]+/);
                const anchors = [];
                for (let i = 0; i+1 < pts.length; i+=2)
                    anchors.push({ x: parseFloat(pts[i]), y: parseFloat(pts[i+1]) });
                return {
                    element: el, type: el.tagName.toLowerCase(),
                    anchors, controls: [], controlLines: [], pathSegments: []
                };
            }

            // Tokeniseur du path `d` — normalise tout en coordonnées absolues
            function parsePathData(d) {
                const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
                const tokens = [];
                let m;
                while ((m = re.exec(d)) !== null) {
                    if (m[1]) tokens.push({ type: 'cmd', val: m[1] });
                    else      tokens.push({ type: 'num', val: parseFloat(m[2]) });
                }

                const segs = [];
                let i = 0;
                let cx = 0, cy = 0, sx = 0, sy = 0; // current, subpath start
                let prevCtrlX = null, prevCtrlY = null, prevUpper = '';

                function num() { return tokens[i++]?.val ?? 0; }
                function hasNum() { return i < tokens.length && tokens[i].type === 'num'; }

                while (i < tokens.length) {
                    if (tokens[i].type !== 'cmd') { i++; continue; }
                    const cmd = tokens[i++].val;
                    let upper = cmd.toUpperCase();
                    const rel   = cmd !== cmd.toUpperCase() && upper !== 'Z';

                    const ax = (v) => rel ? cx + v : v;
                    const ay = (v) => rel ? cy + v : v;

                    do {
                        const seg = { upper, prevX: cx, prevY: cy, absArgs: [] };

                        if (upper === 'M') {
                            const nx = ax(num()), ny = ay(num());
                            seg.absArgs = [nx, ny];
                            cx = nx; cy = ny; sx = nx; sy = ny;
                        } else if (upper === 'L') {
                            const nx = ax(num()), ny = ay(num());
                            seg.absArgs = [nx, ny]; cx = nx; cy = ny;
                        } else if (upper === 'H') {
                            const nx = ax(num());
                            // Stocker comme L pour simplifier l'édition
                            seg.upper = 'L'; seg.absArgs = [nx, cy]; cx = nx;
                        } else if (upper === 'V') {
                            const ny = ay(num());
                            seg.upper = 'L'; seg.absArgs = [cx, ny]; cy = ny;
                        } else if (upper === 'C') {
                            const x1 = ax(num()), y1 = ay(num());
                            const x2 = ax(num()), y2 = ay(num());
                            const nx = ax(num()), ny = ay(num());
                            seg.absArgs = [x1, y1, x2, y2, nx, ny];
                            prevCtrlX = x2; prevCtrlY = y2;
                            cx = nx; cy = ny;
                        } else if (upper === 'S') {
                            const implX = (prevUpper === 'C' || prevUpper === 'S') ? 2*cx - prevCtrlX : cx;
                            const implY = (prevUpper === 'C' || prevUpper === 'S') ? 2*cy - prevCtrlY : cy;
                            const x2 = ax(num()), y2 = ay(num());
                            const nx = ax(num()), ny = ay(num());
                            seg.upper = 'C'; seg.absArgs = [implX, implY, x2, y2, nx, ny];
                            prevCtrlX = x2; prevCtrlY = y2;
                            cx = nx; cy = ny;
                        } else if (upper === 'Q') {
                            const x1 = ax(num()), y1 = ay(num());
                            const nx = ax(num()), ny = ay(num());
                            seg.absArgs = [x1, y1, nx, ny];
                            prevCtrlX = x1; prevCtrlY = y1;
                            cx = nx; cy = ny;
                        } else if (upper === 'T') {
                            const implX = (prevUpper === 'Q' || prevUpper === 'T') ? 2*cx - prevCtrlX : cx;
                            const implY = (prevUpper === 'Q' || prevUpper === 'T') ? 2*cy - prevCtrlY : cy;
                            const nx = ax(num()), ny = ay(num());
                            seg.upper = 'Q'; seg.absArgs = [implX, implY, nx, ny];
                            prevCtrlX = implX; prevCtrlY = implY;
                            cx = nx; cy = ny;
                        } else if (upper === 'A') {
                            const rx=num(),ry=num(),xr=num(),la=num(),sw=num();
                            const nx = ax(num()), ny = ay(num());
                            seg.absArgs = [rx, ry, xr, la, sw, nx, ny];
                            cx = nx; cy = ny;
                        } else if (upper === 'Z') {
                            seg.absArgs = []; cx = sx; cy = sy;
                        }

                        prevUpper = upper;
                        segs.push(seg);
                        // Spec SVG : après un M, les paires suivantes sont des L implicites
                        if (upper === 'M') upper = cmd === cmd.toLowerCase() ? 'l' : 'L';
                    // Répétition implicite de la commande si d'autres nombres suivent
                    } while (upper !== 'Z' && hasNum());
                }
                return segs;
            }

            function pointToLineDistance(px, py, ax, ay, bx, by) {
                const dx = bx - ax, dy = by - ay;
                const len2 = dx*dx + dy*dy;
                if (len2 === 0) return Math.hypot(px-ax, py-ay);
                const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
                return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
            }


            function parsePath(el) {
                const segs = parsePathData(el.getAttribute('d') || '');
                const anchors = [], controls = [], controlLines = [];

                segs.forEach((seg, segIdx) => {
                    const args = seg.absArgs;
                    const u = seg.upper;

                    if (u === 'M' || u === 'L') {
                        anchors.push({ x: args[0], y: args[1], segIdx, argIdxX: 0, argIdxY: 1 });
                    } else if (u === 'C') {
                        anchors.push({ x: args[4], y: args[5], segIdx, argIdxX: 4, argIdxY: 5 });
                        controls.push({ x: args[0], y: args[1], segIdx, argIdxX: 0, argIdxY: 1 });
                        controls.push({ x: args[2], y: args[3], segIdx, argIdxX: 2, argIdxY: 3 });
                        controlLines.push({ from: { x: seg.prevX, y: seg.prevY }, to: { x: args[0], y: args[1] }, segIdx });
                        controlLines.push({ from: { x: args[4], y: args[5] }, to: { x: args[2], y: args[3] }, segIdx });
                    } else if (u === 'Q') {
                        anchors.push({ x: args[2], y: args[3], segIdx, argIdxX: 2, argIdxY: 3 });
                        controls.push({ x: args[0], y: args[1], segIdx, argIdxX: 0, argIdxY: 1 });
                        controlLines.push({ from: { x: seg.prevX, y: seg.prevY }, to: { x: args[0], y: args[1] }, segIdx });
                        controlLines.push({ from: { x: args[2], y: args[3] }, to: { x: args[0], y: args[1] }, segIdx });
                    } else if (u === 'A') {
                        anchors.push({ x: args[5], y: args[6], segIdx, argIdxX: 5, argIdxY: 6 });
                    }
                    // Z : pas de point
                });

                return { element: el, type: 'path', anchors, controls, controlLines, pathSegments: segs };
            }

            // --- Rendu des points dans l'overlay ---

            // Rayon fixe ~4px écran → unités viewBox.
            // Retourne { r, stroke } en unités viewBox compensées par le zoom CSS de l'overlay.
            function computePointMetrics() {
                if (!currentSVG || !editOverlaySVG) return { r: 5, stroke: 1.5, lineW: 1 };
                // L'overlay utilise la même viewBox que le SVG source, calculée depuis
                // naturalRect (taille CSS sans zoom). Les points sont dessinés en unités viewBox.
                // On doit exprimer "5px écran" en unités viewBox, en sachant combien de pixels
                // écran = 1 unité viewBox APRÈS application du canvasZoom.
                //
                // Étape 1 : taille naturelle CSS du SVG — déjà mémorisée à l'entrée en mode édition,
                // évite un getBoundingClientRect() (reflow) à chaque frame de drag.
                const naturalW = _editNaturalW || (_overlayGeoCache && _overlayGeoCache.naturalW) || 500;
                // Étape 2 : viewBox width du SVG
                const vb = currentSVG.getAttribute('viewBox');
                let vbW = parseFloat(currentSVG.getAttribute('width')) || 500;
                if (vb) vbW = parseFloat(vb.trim().split(/[\s,]+/)[2]) || vbW;
                // L'overlay a le même transform CSS scale(canvasZoom) que le SVG.
                // La viewBox overlay est en px naturels (sans zoom).
                // 1 unité viewBox → naturalW/vbW px CSS → ×canvasZoom px écran.
                // Pour avoir r = 5px écran : r = 5 / (naturalW/vbW * canvasZoom)
                const pxPerUnit = (naturalW / vbW) * canvasZoom;
                // Cible : r = 5px écran, stroke = 1.5px écran, lineW = 1px écran → en unités viewBox
                const r      = 5   / pxPerUnit;
                const stroke = 1.5 / pxPerUnit;
                const lineW  = 1   / pxPerUnit;
                // Les minimums sont exprimés en px écran puis convertis en unités viewBox,
                // sinon Math.max(0.3, r) gonfle les points quand r est très petit (SVG très zoomé).
                const minR      = 2   / pxPerUnit;
                const minStroke = 0.5 / pxPerUnit;
                const minLine   = 0.3 / pxPerUnit;
                return {
                    r:      Math.max(minR,      r),
                    stroke: Math.max(minStroke, stroke),
                    lineW:  Math.max(minLine,   lineW),
                };
            }

            // Throttle RAF pour le rendu pendant le drag
            function scheduleRenderEditPoints() {
                if (_renderEditRafId) return;
                _renderEditRafId = requestAnimationFrame(() => {
                    _renderEditRafId = null;
                    renderEditPoints();
                });
            }

            function renderEditPoints() {
                if (!editOverlaySVG) return;
                editOverlaySVG.innerHTML = '';

                const { r, stroke, lineW } = computePointMetrics();
                const rc = r * 0.9;

                editShapeData.forEach((shape, shapeIdx) => {
                    const isSel     = selectedAnchor && selectedAnchor.shapeIdx === shapeIdx;
                    const selAIdx   = isSel ? selectedAnchor.anchorIdx : -1;
                    const selSegIdx = (isSel && selAIdx >= 0 && shape.anchors[selAIdx])
                                      ? shape.anchors[selAIdx].segIdx : -1;

                    // Lignes de tangente
                    shape.controlLines.forEach((line) => {
                        if (line.segIdx !== selSegIdx) return;
                        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        halo.setAttribute('x1', line.from.x); halo.setAttribute('y1', line.from.y);
                        halo.setAttribute('x2', line.to.x);   halo.setAttribute('y2', line.to.y);
                        halo.setAttribute('stroke', 'rgba(0,0,0,0.4)');
                        halo.setAttribute('stroke-width', String(lineW * 2.5));
                        halo.setAttribute('stroke-linecap', 'round');
                        halo.style.pointerEvents = 'none';
                        editOverlaySVG.appendChild(halo);

                        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        l.setAttribute('x1', line.from.x); l.setAttribute('y1', line.from.y);
                        l.setAttribute('x2', line.to.x);   l.setAttribute('y2', line.to.y);
                        l.setAttribute('class', 'sve-control-line');
                        l.setAttribute('stroke-width', String(lineW));
                        editOverlaySVG.appendChild(l);
                    });

                    // Handles Bézier
                    shape.controls.forEach((ctrl, ctrlIdx) => {
                        if (ctrl.segIdx !== selSegIdx) return;
                        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                        c.setAttribute('cx', ctrl.x); c.setAttribute('cy', ctrl.y);
                        c.setAttribute('r', rc);
                        c.setAttribute('class', 'sve-control-point');
                        c.setAttribute('stroke-width', String(stroke));
                        c.style.pointerEvents = 'all';
                        attachEditPointListeners(c, shapeIdx, ctrlIdx, 'control');
                        editOverlaySVG.appendChild(c);
                    });

                    // Points d'ancrage
                    shape.anchors.forEach((anchor, anchorIdx) => {
                        const isSelected = isSel && anchorIdx === selAIdx;
                        const s = r;
                        const sq = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        sq.setAttribute('x', anchor.x - s); sq.setAttribute('y', anchor.y - s);
                        sq.setAttribute('width', s * 2);    sq.setAttribute('height', s * 2);
                        sq.setAttribute('class', 'sve-anchor-point' + (isSelected ? ' selected' : ''));
                        sq.setAttribute('stroke-width', String(stroke));
                        sq.style.pointerEvents = 'all';
                        attachEditPointListeners(sq, shapeIdx, anchorIdx, 'anchor');
                        editOverlaySVG.appendChild(sq);
                    });
                });
            }

            // --- Drag & Drop ---

            let _undoPushedForDrag = false;

            function attachEditPointListeners(circleEl, shapeIdx, pointIdx, pointType) {
                circleEl.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    _undoPushedForDrag = false; // sera pushé au premier mousemove
                    // Sélectionner l'ancre au clic
                    if (pointType === 'anchor') {
                        selectedAnchor = { shapeIdx, anchorIdx: pointIdx };
                        renderEditPoints();
                    }
                    editDragState = { shapeIdx, pointIdx, pointType, circleEl };
                    circleEl.classList.add('dragging');
                });
            }

            function initEditDragEvents() {
                window.addEventListener('mousemove', onEditMouseMove);
                window.addEventListener('mouseup',   onEditMouseUp);
            }

            function removeEditDragEvents() {
                window.removeEventListener('mousemove', onEditMouseMove);
                window.removeEventListener('mouseup',   onEditMouseUp);
            }

            function onEditMouseMove(e) {
                if (!editDragState || !editModeActive) return;
                // Sauvegarder l'état avant la première modification du drag
                if (!_undoPushedForDrag) {
                    pushUndo();
                    _undoPushedForDrag = true;
                }
                const { x, y } = screenToEditCoords(e.clientX, e.clientY);
                const shape = editShapeData[editDragState.shapeIdx];
                if (!shape) return;

                if (editDragState.pointType === 'anchor') {
                    const anchor = shape.anchors[editDragState.pointIdx];
                    anchor.x = x; anchor.y = y;
                    if (anchor.segIdx !== undefined) {
                        shape.pathSegments[anchor.segIdx].absArgs[anchor.argIdxX] = x;
                        shape.pathSegments[anchor.segIdx].absArgs[anchor.argIdxY] = y;
                    }
                } else {
                    const ctrl = shape.controls[editDragState.pointIdx];
                    ctrl.x = x; ctrl.y = y;
                    if (ctrl.segIdx !== undefined) {
                        shape.pathSegments[ctrl.segIdx].absArgs[ctrl.argIdxX] = x;
                        shape.pathSegments[ctrl.segIdx].absArgs[ctrl.argIdxY] = y;
                    }
                }

                if (shape.type === 'path') rebuildControlLines(shape);
                applyShapeEdit(shape);
                scheduleRenderEditPoints();
            }

            function onEditMouseUp(e) {
                if (!editDragState) return;
                if (editDragState.circleEl) editDragState.circleEl.classList.remove('dragging');
                editDragState = null;
            }

            // Recalcule les controlLines depuis les segments (après drag d'un anchor ou handle)
            function rebuildControlLines(shape) {
                shape.controlLines = [];
                shape.pathSegments.forEach((seg, segIdx) => {
                    if (seg.upper === 'C') {
                        const args = seg.absArgs;
                        shape.controlLines.push({ from: { x: seg.prevX, y: seg.prevY }, to: { x: args[0], y: args[1] }, segIdx });
                        shape.controlLines.push({ from: { x: args[4],  y: args[5]  }, to: { x: args[2], y: args[3] }, segIdx });
                    } else if (seg.upper === 'Q') {
                        const args = seg.absArgs;
                        shape.controlLines.push({ from: { x: seg.prevX, y: seg.prevY }, to: { x: args[0], y: args[1] }, segIdx });
                        shape.controlLines.push({ from: { x: args[2],  y: args[3]  }, to: { x: args[0], y: args[1] }, segIdx });
                    }
                });
                // Mettre à jour prevX/prevY des segments après un déplacement d'anchor
                let px = 0, py = 0, spx = 0, spy = 0;
                shape.pathSegments.forEach(seg => {
                    seg.prevX = px; seg.prevY = py;
                    const u = seg.upper, a = seg.absArgs;
                    if (u === 'M') { px = a[0]; py = a[1]; spx = a[0]; spy = a[1]; }
                    else if (u === 'L') { px = a[0]; py = a[1]; }
                    else if (u === 'C') { px = a[4]; py = a[5]; }
                    else if (u === 'Q') { px = a[2]; py = a[3]; }
                    else if (u === 'A') { px = a[5]; py = a[6]; }
                    else if (u === 'Z') { px = spx; py = spy; }
                });
            }

            // --- Reconstruction et application des attributs SVG ---


            function applyShapeEdit(shape) {
                const el = shape.element;
                switch (shape.type) {
                    case 'rect':     applyRectEdit(el, shape.anchors);    break;
                    case 'circle':   el.setAttribute('cx', shape.anchors[0].x); el.setAttribute('cy', shape.anchors[0].y); break;
                    case 'ellipse':  applyEllipseEdit(el, shape.anchors); break;
                    case 'polygon':
                    case 'polyline': el.setAttribute('points', shape.anchors.map(a => `${a.x},${a.y}`).join(' ')); break;
                    case 'path':     el.setAttribute('d', reconstructPathD(shape.pathSegments)); break;
                }
            }

            function applyRectEdit(el, anchors) {
                const xs = anchors.map(a => a.x), ys = anchors.map(a => a.y);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                el.setAttribute('x', minX);
                el.setAttribute('y', minY);
                el.setAttribute('width',  maxX - minX);
                el.setAttribute('height', maxY - minY);
            }

            function applyEllipseEdit(el, anchors) {
                // anchors: [center, rx-handle, ry-handle]
                const cx = anchors[0].x, cy = anchors[0].y;
                el.setAttribute('cx', cx);
                el.setAttribute('cy', cy);
                if (anchors[1]) el.setAttribute('rx', Math.abs(anchors[1].x - cx));
                if (anchors[2]) el.setAttribute('ry', Math.abs(anchors[2].y - cy));
            }

            function reconstructPathD(segs) {
                return segs.map(seg => {
                    const a = seg.absArgs;
                    switch (seg.upper) {
                        case 'M': return `M ${a[0]},${a[1]}`;
                        case 'L': return `L ${a[0]},${a[1]}`;
                        case 'C': return `C ${a[0]},${a[1]} ${a[2]},${a[3]} ${a[4]},${a[5]}`;
                        case 'Q': return `Q ${a[0]},${a[1]} ${a[2]},${a[3]}`;
                        case 'A': return `A ${a[0]},${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]},${a[6]}`;
                        case 'Z': return 'Z';
                        default:  return '';
                    }
                }).join(' ');
            }