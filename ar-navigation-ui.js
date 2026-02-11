/**
 * ARNavigationUI v2.0
 * 
 * AR kamera + yön okları + ilerleme takibi UI bileşeni.
 * Verilen hedef pusula açısına göre kullanıcıyı yönlendirir.
 * 
 * Bağımsız çalışır, ARDirectionCalculator ile birlikte kullanılması zorunlu değildir.
 * Stiller otomatik inject edilir, harici CSS dosyası opsiyoneldir.
 * 
 * Bağımlılıklar: Yok (native getUserMedia + DeviceOrientation kullanır)
 * 
 * @example
 * // Temel kullanım
 * const nav = new ARNavigationUI({
 *     targetAngle: 45,
 *     onCompleted: () => console.log('Hedefe ulaşıldı!'),
 *     onCompassUpdate: (data) => console.log('Pusula:', data.heading)
 * });
 * nav.start();  // Kamera + pusula başlat
 * nav.stop();   // Durdur
 * nav.destroy(); // DOM temizle
 * 
 * @example
 * // Özel ok görselleri ile kullanım
 * const nav = new ARNavigationUI({
 *     targetAngle: 90,
 *     arrowImages: {
 *         left: './assets/left_arrow.png',
 *         right: './assets/right_arrow.png',
 *         forward: './assets/ileri.png',
 *         forwardPerspective: './assets/arrow-up.png'
 *     }
 * });
 * 
 * @example
 * // Kamerayı kendiniz yönetin (A-Frame vb.)
 * const nav = new ARNavigationUI({
 *     targetAngle: 180,
 *     manageCamera: false  // Plugin kamera açmaz, sadece overlay gösterir
 * });
 */
class ARNavigationUI {

    // ================================================================
    //  STATIC: STILLER
    // ================================================================

    static _stylesInjected = false;

    // ================================================================
    //  STATIC: KALİBRASYON SABİTLERİ
    // ================================================================

    /** Kalibrasyon kalite seviyeleri */
    static CALIBRATION_QUALITY = {
        UNKNOWN: 'unknown',   // Henüz yeterli veri yok
        POOR:    'poor',      // Kötü — 8 hareketi gerekli
        FAIR:    'fair',      // Kabul edilebilir ama ideal değil
        GOOD:    'good'       // İyi kalibrasyon
    };

    /** Kalibrasyon tespit eşik değerleri */
    static CALIBRATION_THRESHOLDS = {
        // Heading standart sapma eşikleri (dairesel, derece cinsinden)
        HEADING_STD_POOR: 15,        // > 15° std dev → POOR
        HEADING_STD_FAIR: 8,         // > 8° std dev → FAIR
        HEADING_STD_GOOD: 4,         // < 4° std dev → GOOD

        // Manyetik alan gücü (µT) — Dünya manyetik alanı: ~25-65 µT
        MAG_FIELD_MIN: 20,           // Altı → manyetik kalkan / bozulma
        MAG_FIELD_MAX: 70,           // Üstü → manyetik parazit

        // Analiz penceresi
        SAMPLE_WINDOW: 40,           // Kaç sample üzerinden analiz
        CHECK_INTERVAL_MS: 2000,     // Kalibrasyon kontrol sıklığı (ms)
        WARMUP_SAMPLES: 10,          // İlk bu kadar sample'dan sonra kontrol başla

        // Jump (sıçrama) oranı eşiği
        JUMP_RATE_POOR: 0.30,        // > %30 sıçrama oranı → POOR
        JUMP_RATE_FAIR: 0.15,        // > %15 sıçrama oranı → FAIR
    };

    static STYLES = `
        /* ===== ROOT ===== */
        .arn-root {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            z-index: 9000;
            overflow: hidden;
            background: #000;
            display: none;
        }
        .arn-root.arn-active {
            display: block;
        }

        /* ===== CAMERA ===== */
        .arn-camera {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            object-fit: cover;
            z-index: 0;
        }

        /* ===== ARROWS ===== */
        .arn-arrow {
            position: fixed;
            top: 33%;
            transform: translateY(-50%);
            opacity: 0;
            transition: opacity 0.15s ease;
            z-index: 9010;
            pointer-events: none;
        }
        .arn-arrow.arn-visible {
            opacity: 1;
        }
        .arn-arrow.arn-left {
            left: 25px;
        }
        .arn-arrow.arn-right {
            right: 25px;
        }
        .arn-arrow.arn-up {
            left: 50%;
            transform: translate(-50%, -50%) scale(1.5);
        }
        .arn-arrow.arn-up-perspective {
            left: 50%;
            transform: translate(-50%, -50%) scale(1.2);
        }

        /* Arrow icon sizing */
        .arn-arrow-icon {
            width: 60px;
            height: auto;
        }

        /* SVG arrow glow effect */
        .arn-arrow svg {
            filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
        }

        /* Arrow animations */
        .arn-anim-left {
            animation: arnMoveLeft 1.5s ease-in-out infinite;
        }
        @keyframes arnMoveLeft {
            0%, 100% { transform: translateX(0); }
            50% { transform: translateX(-25px); }
        }

        .arn-anim-right {
            animation: arnMoveRight 1.5s ease-in-out infinite;
        }
        @keyframes arnMoveRight {
            0%, 100% { transform: translateX(0); }
            50% { transform: translateX(25px); }
        }

        .arn-anim-forward {
            animation: arnJump 1s ease infinite;
        }
        @keyframes arnJump {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        .arn-anim-forwardPerspective {
            animation: arnApproach 1.8s ease-in-out infinite;
        }
        @keyframes arnApproach {
            0%   { transform: scale(0.7) translateY(12px); opacity: 0.4; }
            50%  { transform: scale(1.15) translateY(-4px); opacity: 1; }
            100% { transform: scale(0.7) translateY(12px); opacity: 0.4; }
        }

        /* ===== LOADING OVERLAY ===== */
        .arn-loading {
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9020;
        }
        .arn-loading.arn-show {
            display: flex;
        }
        .arn-loading-img {
            width: 100px;
            height: 100px;
            object-fit: contain;
        }
        .arn-loading-text {
            color: white;
            font-size: 16px;
            font-weight: 500;
            margin-top: 16px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .arn-loading-spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(255,255,255,0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            animation: arnSpin 1s linear infinite;
        }
        @keyframes arnSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* ===== PROGRESS CIRCLE ===== */
        .arn-progress {
            position: fixed;
            top: 25%;
            left: 50%;
            transform: translateX(-50%) scale(0.5);
            width: 100px;
            height: 100px;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: transform 1s ease;
            z-index: 9010;
            pointer-events: none;
        }
        .arn-progress.arn-grow {
            transform: translateX(-50%) scale(1);
        }
        .arn-progress-svg {
            transform: rotate(-90deg);
        }
        .arn-progress-bar {
            stroke-dasharray: 283;
            stroke-dashoffset: 283;
        }

        /* ===== POPUP ===== */
        .arn-popup {
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            z-index: 9999;
            display: none;
            justify-content: center;
            align-items: center;
        }
        .arn-popup.arn-show {
            display: flex;
        }
        .arn-popup-content {
            text-align: center;
            padding: 40px;
        }
        .arn-popup-icon {
            font-size: 80px;
            margin-bottom: 20px;
        }
        .arn-popup-img {
            width: 120px;
            height: 120px;
            object-fit: contain;
        }
        .arn-popup-message {
            font-size: 20px;
            font-weight: 600;
            color: #333;
            margin-bottom: 30px;
        }
        .arn-popup-btn {
            padding: 12px 30px;
            border: none;
            border-radius: 25px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            background: linear-gradient(135deg, #7daef1, #5c9de8);
            color: white;
            min-width: 150px;
            transition: transform 0.1s;
        }
        .arn-popup-btn:active {
            transform: scale(0.96);
        }

        /* Kalibrasyon UI kaldırıldı — bilgi sadece debug panelden izlenir */

        /* ===== DEBUG PANEL ===== */
        .arn-debug {
            position: fixed; bottom: 0; left: 0; right: 0; z-index: 9020;
            background: rgba(0,0,0,.82); backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            color: #fff; font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transform: translateY(calc(100% - 32px));
            transition: transform .25s ease;
        }
        .arn-debug.arn-debug-open { transform: translateY(0); }
        .arn-debug-toggle {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            height: 32px; cursor: pointer; user-select: none;
            color: rgba(255,255,255,.6); font-size: 11px; letter-spacing: .5px;
        }
        .arn-debug-toggle::before { content: '▲'; font-size: 8px; transition: transform .25s; }
        .arn-debug.arn-debug-open .arn-debug-toggle::before { content: '▼'; }
        .arn-debug-body { padding: 0 12px 10px; }
        .arn-debug-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.08);
        }
        .arn-debug-row:last-child { border-bottom: none; }
        .arn-debug-label { color: rgba(255,255,255,.5); }
        .arn-debug-value { font-weight: 600; color: #4fc3f7; font-variant-numeric: tabular-nums; }
    `;

    // ================================================================
    //  STATIC: VARSAYILAN SVG OKLARI (harici asset gerekmez)
    // ================================================================

    static ARROW_SVGS = {
        left: '<svg viewBox="0 0 60 60" width="60" height="60">' +
              '<path d="M42 5 L18 30 L42 55" stroke="white" stroke-width="5" ' +
              'fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        right: '<svg viewBox="0 0 60 60" width="60" height="60">' +
               '<path d="M18 5 L42 30 L18 55" stroke="white" stroke-width="5" ' +
               'fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        forward: '<svg viewBox="0 0 60 60" width="60" height="60">' +
                 '<path d="M10 48 L30 12 L50 48" stroke="white" stroke-width="5" ' +
                 'fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        forwardPerspective: '<svg viewBox="0 0 60 80" width="45" height="60">' +
                            '<path d="M10 70 L30 15 L50 70" stroke="white" stroke-width="4" ' +
                            'fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>' +
                            '<path d="M20 55 L30 30 L40 55" stroke="white" stroke-width="3" ' +
                            'fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></svg>'
    };

    // ================================================================
    //  CONSTRUCTOR
    // ================================================================

    /**
     * @param {Object} options
     * @param {number}  [options.targetAngle=0]        - Hedef pusula açısı (0-360)
     * @param {number}  [options.tolerance=20]          - Hizalanma toleransı (derece)
     * @param {number}  [options.progressDuration=3]    - İlerleme süresi (saniye)
     * @param {boolean} [options.showPopup=true]        - Tamamlandığında popup göster
     * @param {string}  [options.popupMessage]          - Popup mesajı
     * @param {string}  [options.popupButtonText]       - Popup buton metni
     * @param {string}  [options.popupImage]            - Popup görseli (resim yolu)
     * @param {boolean} [options.manageCamera=true]     - Kamerayı plugin yönetsin mi
     * @param {Object}  [options.arrowImages]           - Özel ok görselleri
     * @param {string}  [options.arrowImages.left]      - Sol ok resim yolu
     * @param {string}  [options.arrowImages.right]     - Sağ ok resim yolu
     * @param {string}  [options.arrowImages.forward]   - İleri ok resim yolu
     * @param {string}  [options.arrowImages.forwardPerspective] - Perspektif ok resim yolu
     * @param {string}  [options.loadingImage]          - Yükleniyor görseli (gif/png yolu)
     * @param {Function} [options.onCompleted]          - İlerleme tamamlandığında
     * @param {Function} [options.onPopupDismiss]       - Popup kapatıldığında
     * @param {Function} [options.onCompassUpdate]      - Her pusula güncellemesinde ({heading, beta, targetAngle})
     * @param {Function} [options.onAligned]            - Hizalanma başladığında
     * @param {Function} [options.onMisaligned]         - Hizalanma bozulduğunda
     * @param {Function} [options.onStart]              - AR başlatıldığında
     * @param {Function} [options.onStop]               - AR durdurulduğunda
     * @param {Function} [options.onError]              - Hata oluştuğunda (string)
     * @param {boolean}  [options.calibrationCheck=true] - Kalibrasyon kalitesi izlensin mi
     * @param {Function} [options.onCalibrationNeeded]   - Kalibrasyon gerektiğinde ({quality, stdDev, magField, jumpRate})
     * @param {Function} [options.onCalibrationImproved] - Kalibrasyon iyileştiğinde ({quality})
     */
    constructor(options = {}) {
        // Konfigürasyon
        this.targetAngle = options.targetAngle ?? 0;
        this.tolerance = options.tolerance ?? 20;
        this.progressDuration = options.progressDuration ?? 3;
        this.showPopup = options.showPopup !== false;
        this.popupMessage = options.popupMessage ?? 'Hedefe ulaştınız!';
        this.popupButtonText = options.popupButtonText ?? 'Tamam';
        this.popupImage = options.popupImage ?? null;
        this.loadingImage = options.loadingImage ?? null;
        this.manageCamera = options.manageCamera !== false;
        this.arrowImages = options.arrowImages ?? null;

        // Kalibrasyon konfigürasyonu
        this.calibrationCheck = options.calibrationCheck !== false;

        // Debug panel (varsayılan kapalı, açıkça true verilmeli)
        this.showDebugPanel = options.showDebugPanel === true;

        // Callback'ler
        this.onCompleted = options.onCompleted ?? null;
        this.onPopupDismiss = options.onPopupDismiss ?? null;
        this.onCompassUpdate = options.onCompassUpdate ?? null;
        this.onAligned = options.onAligned ?? null;
        this.onMisaligned = options.onMisaligned ?? null;
        this.onStart = options.onStart ?? null;
        this.onStop = options.onStop ?? null;
        this.onError = options.onError ?? null;
        this.onCalibrationNeeded = options.onCalibrationNeeded ?? null;
        this.onCalibrationImproved = options.onCalibrationImproved ?? null;

        // Dahili durum
        this._running = false;
        this._aligned = false;
        this._completed = false;
        this._currentHeading = 0;
        this._currentBeta = 90;

        // DOM & listener referansları
        this._els = {};
        this._compassAbs = null;
        this._compassWk = null;
        this._rafId = null;
        this._destroyed = false;
        this._compassActive = false;
        this._hasAbsoluteSource = false;
        this._headingBuffer = [];
        this._lastRawHeading = null;
        this._jumpRejectCount = 0;

        // Pusula kaynak takibi
        // 'none' | 'absolute-event' | 'webkit-compass' | 'absolute-flag' | 'sensor-api'
        this._compassSource = 'none';
        this._compassTimeout = null;
        this._orientationSensor = null; // AbsoluteOrientationSensor (Generic Sensor API)

        // Kalibrasyon kapısı (overlay kaldırıldı — sadece debug panel bilgi verir)
        this._calibrationGate = 'passed';

        // Kalibrasyon durumu
        this._calibration = {
            quality: ARNavigationUI.CALIBRATION_QUALITY.UNKNOWN,
            rawSamples: [],         // Son N ham heading değeri (std dev için)
            totalSamples: 0,        // Toplam alınan sample sayısı
            totalJumps: 0,          // Toplam reddedilen sıçrama sayısı
            lastCheckTime: 0,       // Son kalibrasyon kontrolü zamanı
            magField: null,         // Manyetik alan gücü (µT, Magnetometer varsa)
            magSensor: null,        // Magnetometer API instance
            prompted: false,        // Kalibrasyon ekranı gösterildi mi
        };

        // Başlat
        ARNavigationUI._ensureStyles();
        this._buildDOM();
    }

    // ================================================================
    //  PUBLIC API
    // ================================================================

    /** AR çalışıyor mu */
    get isRunning() { return this._running; }

    /** Kullanıcı doğru yönde mi */
    get isAligned() { return this._aligned; }

    /** Mevcut pusula açısı */
    get currentHeading() { return this._currentHeading; }

    /** Aktif pusula kaynağı ('absolute-event' | 'webkit-compass' | 'absolute-flag' | 'sensor-api' | 'fallback-rotation' | 'none') */
    get compassSource() { return this._compassSource; }

    /**
     * Hedef açıyı günceller (çalışırken de çağrılabilir)
     * @param {number} angle - 0-360 derece
     */
    setTargetAngle(angle) {
        this.targetAngle = angle;
    }

    /**
     * Popup mesajını günceller
     * @param {string} message
     * @param {string} [buttonText]
     */
    setPopupMessage(message, buttonText) {
        this.popupMessage = message;
        if (buttonText) this.popupButtonText = buttonText;
        if (this._els.popupMessage) {
            this._els.popupMessage.textContent = message;
        }
        if (buttonText && this._els.popupBtn) {
            this._els.popupBtn.textContent = buttonText;
        }
    }

    /**
     * AR navigasyonu başlatır: kamera açılır, pusula dinlenir, oklar gösterilir.
     * Aynı instance üzerinde birden fazla kez çağrılabilir (stop sonrası tekrar start).
     * Pusula listener'ları instance ömrü boyunca canlı tutulur — bu sayede
     * sensör referans çerçevesi korunur ve her start'ta tutarlı heading elde edilir.
     * @returns {Promise<void>}
     */
    async start() {
        if (this._destroyed) {
            console.warn('ARNavigationUI: destroy() çağrılmış, yeni instance oluşturun.');
            return;
        }
        if (this._running) return;

        this._running = true;
        this._completed = false;
        this._aligned = false;

        // Kalibrasyon kapısı artık yok — kalite bilgisi sadece debug panelde gösterilir
        this._calibrationGate = 'passed';

        // Root'u göster
        this._els.root.classList.add('arn-active');

        // Pusula zaten aktifse loading'i kısa tut, değilse ilk kez başlat
        if (this._compassActive) {
            // Pusula zaten çalışıyor, heading güncel — loading gereksiz
            this._compassReady = true;
        } else {
            // İlk başlatma: pusula henüz aktif değil, loading göster
            this._compassReady = false;
            this._els.loading.classList.add('arn-show');
            this._startCompass();
        }

        // Kamera başlat
        if (this.manageCamera) {
            await this._startCamera();
        }

        if (this.onStart) this.onStart();
        this._updateDebugPanel({
            status: 'AR Çalışıyor…',
            target: this.targetAngle.toFixed(0) + '°'
        });
    }

    /**
     * AR navigasyonu durdurur: kamera kapatılır, UI gizlenir.
     * Pusula listener'ları KALDIRILMAZ — sensör referans çerçevesini korumak için
     * arka planda heading takibi devam eder. Sadece destroy() pusulayı durdurur.
     */
    stop() {
        if (!this._running) return;
        this._running = false;

        // ❗ Pusula DURDURULMAZ — referans çerçevesi korunur
        // Heading arka planda güncellenmeye devam eder (_handleCompass içinde)
        this._stopCamera();
        this._hideAllArrows();
        this._resetProgress();
        this._hidePopup();
        this._els.loading.classList.remove('arn-show');

        this._els.root.classList.remove('arn-active');

        if (this.onStop) this.onStop();
        this._updateDebugPanel({ status: 'Durduruldu' });
    }

    /**
     * Bileşeni tamamen kaldırır. stop() + pusula durdurma + DOM temizleme.
     * Bu çağrıdan sonra instance tekrar kullanılamaz.
     */
    destroy() {
        this.stop();
        this._stopCompass(); // Pusula SADECE destroy'da durdurulur
        if (this._els.root && this._els.root.parentNode) {
            this._els.root.parentNode.removeChild(this._els.root);
        }
        this._els = {};
        this._destroyed = true;
    }

    // ================================================================
    //  PRIVATE: STIL INJECTION
    // ================================================================

    static _ensureStyles() {
        if (ARNavigationUI._stylesInjected) return;
        // Harici CSS zaten yüklenmişse tekrar inject etme
        if (document.getElementById('arn-styles')) {
            ARNavigationUI._stylesInjected = true;
            return;
        }
        const style = document.createElement('style');
        style.id = 'arn-styles';
        style.textContent = ARNavigationUI.STYLES;
        document.head.appendChild(style);
        ARNavigationUI._stylesInjected = true;
    }

    // ================================================================
    //  PRIVATE: DOM OLUŞTURMA
    // ================================================================

    _buildDOM() {
        const root = document.createElement('div');
        root.className = 'arn-root';

        root.innerHTML = `
            <div class="arn-loading">
                ${this._getLoadingContent()}
                <div class="arn-loading-text">Pusula başlatılıyor...</div>
            </div>
            <div class="arn-arrow arn-left">
                <div class="arn-anim-left">${this._getArrowContent('left')}</div>
            </div>
            <div class="arn-arrow arn-right">
                <div class="arn-anim-right">${this._getArrowContent('right')}</div>
            </div>
            <div class="arn-arrow arn-up">
                <div class="arn-anim-forward">${this._getArrowContent('forward')}</div>
            </div>
            <div class="arn-arrow arn-up-perspective">
                <div class="arn-anim-forwardPerspective">${this._getArrowContent('forwardPerspective')}</div>
            </div>
            <div class="arn-progress">
                <svg class="arn-progress-svg" width="100" height="100">
                    <circle cx="50" cy="50" r="45" stroke="#e0e0e0" stroke-width="8" fill="none"/>
                    <circle class="arn-progress-bar" cx="50" cy="50" r="45"
                            stroke="#4CAF50" stroke-width="8" fill="none"/>
                </svg>
            </div>
            <div class="arn-popup">
                <div class="arn-popup-content">
                    <div class="arn-popup-icon">${this._getPopupIcon()}</div>
                    <div class="arn-popup-message">${this.popupMessage}</div>
                    <button class="arn-popup-btn">${this.popupButtonText}</button>
                </div>
            </div>
            <!-- Kalibrasyon bilgisi debug panel üzerinden izlenir -->
        `;

        // ── Debug Panel (opsiyonel) ──
        if (this.showDebugPanel) {
            const dbg = document.createElement('div');
            dbg.className = 'arn-debug';
            dbg.innerHTML = `
                <div class="arn-debug-toggle">DEBUG</div>
                <div class="arn-debug-body">
                    <div class="arn-debug-row"><span class="arn-debug-label">Durum</span><span class="arn-debug-value arn-dbg-status">–</span></div>
                    <div class="arn-debug-row"><span class="arn-debug-label">Hedef Yön</span><span class="arn-debug-value arn-dbg-target">–</span></div>
                    <div class="arn-debug-row"><span class="arn-debug-label">Pusula</span><span class="arn-debug-value arn-dbg-heading">–</span></div>
                    <div class="arn-debug-row"><span class="arn-debug-label">Kaynak</span><span class="arn-debug-value arn-dbg-source">–</span></div>
                    <div class="arn-debug-row"><span class="arn-debug-label">Kalibrasyon</span><span class="arn-debug-value arn-dbg-calib">–</span></div>
                </div>
            `;
            dbg.querySelector('.arn-debug-toggle').addEventListener('click', () => {
                dbg.classList.toggle('arn-debug-open');
            });
            root.appendChild(dbg);

            this._els.dbgStatus  = dbg.querySelector('.arn-dbg-status');
            this._els.dbgTarget  = dbg.querySelector('.arn-dbg-target');
            this._els.dbgHeading = dbg.querySelector('.arn-dbg-heading');
            this._els.dbgSource  = dbg.querySelector('.arn-dbg-source');
            this._els.dbgCalib   = dbg.querySelector('.arn-dbg-calib');
        }

        document.body.appendChild(root);

        // Element referanslarını cache'le
        this._els.root = root;
        this._els.loading = root.querySelector('.arn-loading');
        this._els.arrowLeft = root.querySelector('.arn-left');
        this._els.arrowRight = root.querySelector('.arn-right');
        this._els.arrowUp = root.querySelector('.arn-up');
        this._els.arrowUpPersp = root.querySelector('.arn-up-perspective');
        this._els.progress = root.querySelector('.arn-progress');
        this._els.progressBar = root.querySelector('.arn-progress-bar');
        this._els.popup = root.querySelector('.arn-popup');
        this._els.popupMessage = root.querySelector('.arn-popup-message');
        this._els.popupBtn = root.querySelector('.arn-popup-btn');
        // İlerleme süresi ayarla
        this._els.progressBar.style.transition =
            `stroke-dashoffset ${this.progressDuration}s linear`;

        // Popup buton handler
        this._els.popupBtn.addEventListener('click', () => {
            this._hidePopup();
            this.stop();
            if (this.onPopupDismiss) this.onPopupDismiss();
        });
    }

    /**
     * Ok içeriğini döndürür: özel resim varsa <img>, yoksa inline SVG
     */
    _getArrowContent(type) {
        if (this.arrowImages && this.arrowImages[type]) {
            return `<img src="${this.arrowImages[type]}" class="arn-arrow-icon" alt="${type}">`;
        }
        return ARNavigationUI.ARROW_SVGS[type] || '';
    }

    /**
     * Popup ikonu döndürür: özel resim varsa <img>, yoksa emoji
     */
    _getPopupIcon() {
        if (this.popupImage) {
            return `<img src="${this.popupImage}" class="arn-popup-img" alt="completed">`;
        }
        return '✅';
    }

    /**
     * Loading görseli döndürür: özel resim varsa <img>, yoksa spinner
     */
    _getLoadingContent() {
        if (this.loadingImage) {
            return `<img src="${this.loadingImage}" class="arn-loading-img" alt="loading">`;
        }
        return `<div class="arn-loading-spinner"></div>`;
    }

    // ================================================================
    //  PRIVATE: KAMERA
    // ================================================================

    async _startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });

            const video = document.createElement('video');
            video.className = 'arn-camera';
            video.srcObject = stream;
            video.setAttribute('playsinline', '');
            video.setAttribute('autoplay', '');
            video.muted = true;

            // Kamerayı root'un ilk çocuğu olarak ekle (okların arkasında)
            this._els.root.insertBefore(video, this._els.root.firstChild);
            this._els.camera = video;

            await video.play();
        } catch (e) {
            console.warn('ARNavigationUI: Kamera başlatılamadı -', e.message);
            // Kamera olmadan devam et (siyah arka plan, oklar çalışır)
        }
    }

    _stopCamera() {
        if (this._els.camera) {
            if (this._els.camera.srcObject) {
                this._els.camera.srcObject.getTracks().forEach(track => track.stop());
                this._els.camera.srcObject = null;
            }
            this._els.camera.remove();
            this._els.camera = null;
        }
    }

    // ================================================================
    //  PRIVATE: PUSULA (DeviceOrientation)
    // ================================================================

    /**
     * W3C rotation matrix yöntemiyle absolute pusula açısı hesaplar.
     * Telefon hangi açıda tutulursa tutulsun (dikey, yatay, eğik)
     * daima doğru kuzeyi referans alan heading döndürür.
     *
     * @param {number} alpha - DeviceOrientation alpha (0-360)
     * @param {number} beta  - DeviceOrientation beta (-180..180)
     * @param {number} gamma - DeviceOrientation gamma (-90..90)
     * @returns {number} 0-360 derece pusula açısı (0=Kuzey, saat yönünde)
     */
    static _computeHeadingFromRotationMatrix(alpha, beta, gamma) {
        const degToRad = Math.PI / 180;
        const alphaRad = alpha * degToRad;
        const betaRad  = beta  * degToRad;
        const gammaRad = gamma * degToRad;

        // Rotation matrix bileşenleri
        const cA = Math.cos(alphaRad);
        const sA = Math.sin(alphaRad);
        const cB = Math.cos(betaRad);
        const sB = Math.sin(betaRad);
        const cG = Math.cos(gammaRad);
        const sG = Math.sin(gammaRad);

        // Kuzey vektörünün cihaz ekranına projeksiyonu
        const rA = -cA * sG - sA * sB * cG;
        const rB = -sA * sG + cA * sB * cG;

        // atan2 ile pusula açısı (radyan → derece, 0-360 aralığında)
        let compassHeading = Math.atan2(rA, rB) * (180 / Math.PI);
        if (compassHeading < 0) compassHeading += 360;

        return compassHeading;
    }

    _startCompass() {
        // Zaten aktifse tekrar başlatma (referans çerçevesini koru)
        if (this._compassActive) return;

        if (!window.DeviceOrientationEvent) {
            this._emitError('DeviceOrientation API desteklenmiyor');
            return;
        }

        // Hangi kaynaktan veri geldiğini takip et
        this._hasAbsoluteSource = false;
        this._compassSource = 'none';
        this._headingBuffer = [];  // Smoothing için son heading değerleri

        // ══════════════════════════════════════════════════════
        //  KAYNAK 1: deviceorientationabsolute (Chrome Android)
        //  En güvenilir kaynak: tarayıcı absolute garanti eder.
        //  e.absolute === false ise event göreceli → yoksay.
        // ══════════════════════════════════════════════════════
        this._compassAbs = (e) => {
            // Bazı tarayıcılar bu eventi göreceli değerlerle ateşler
            if (e.absolute === false) return;
            if (e.alpha == null || e.beta == null || e.gamma == null) return;

            this._hasAbsoluteSource = true;
            this._compassSource = 'absolute-event';

            const heading = ARNavigationUI._computeHeadingFromRotationMatrix(
                e.alpha, e.beta, e.gamma
            );
            this._handleCompass(heading, e.beta);
        };

        // ══════════════════════════════════════════════════════
        //  KAYNAK 2: deviceorientation (iOS + Firefox fallback)
        //  Öncelik: webkitCompassHeading > e.absolute=true > son çare
        // ══════════════════════════════════════════════════════
        this._compassWk = (e) => {
            // Absolute kaynak zaten aktifse → çakışma önle
            if (this._hasAbsoluteSource) return;

            // ── iOS: webkitCompassHeading (tilt-kompanzasyonlu, absolute) ──
            if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
                this._compassSource = 'webkit-compass';
                this._handleCompass(e.webkitCompassHeading, e.beta || 90);
                return;
            }

            // ── Firefox / bazı Android tarayıcılar: e.absolute === true ──
            if (e.absolute === true && e.alpha != null && e.beta != null && e.gamma != null) {
                this._compassSource = 'absolute-flag';
                const heading = ARNavigationUI._computeHeadingFromRotationMatrix(
                    e.alpha, e.beta, e.gamma
                );
                this._handleCompass(heading, e.beta);
                return;
            }

            // ── Son çare: 5s timeout sonrası göreceli rotasyon matrisi ──
            // deviceorientationabsolute hiç ateşlenmediyse ve başka kaynak yoksa,
            // deviceorientation alpha değerini rotation matrix ile kullan.
            // Bu değer bazı tarayıcılarda absolute olmayabilir — uyarı gösterilir.
            if (this._compassFallbackEnabled && e.alpha != null && e.beta != null && e.gamma != null) {
                if (this._compassSource === 'none') {
                    this._compassSource = 'fallback-rotation';
                    console.warn('ARNavigationUI: Absolute pusula bulunamadı, ' +
                        'deviceorientation rotation matrix fallback kullanılıyor — ' +
                        'yön doğruluğu garanti edilemez');
                }
                const heading = ARNavigationUI._computeHeadingFromRotationMatrix(
                    e.alpha, e.beta, e.gamma
                );
                this._handleCompass(heading, e.beta);
            }
        };

        const addListeners = () => {
            window.addEventListener('deviceorientationabsolute', this._compassAbs, true);
            window.addEventListener('deviceorientation', this._compassWk, true);
            this._compassActive = true;

            // Kalibrasyon izlemeyi başlat
            this._startCalibrationMonitor();

            // ── Generic Sensor API: AbsoluteOrientationSensor ──
            // deviceorientationabsolute'den daha güvenilir (quaternion tabanlı).
            // Destekleniyorsa birincil kaynak olarak devralır.
            this._tryAbsoluteOrientationSensor();

            // ── Timeout: 5s içinde absolute kaynak bulunamazsa fallback aç ──
            this._compassFallbackEnabled = false;
            this._compassTimeout = setTimeout(() => {
                if (this._compassSource === 'none') {
                    console.warn('ARNavigationUI: 5s içinde absolute pusula verisi alınamadı');
                    this._compassFallbackEnabled = true;
                    // Hâlâ veri gelmezse hata yayınla
                    setTimeout(() => {
                        if (this._compassSource === 'none') {
                            this._emitError('Pusula verisi alınamıyor — cihaz sensörleri kontrol edin');
                        }
                    }, 3000);
                }
            }, 5000);
        };

        // iOS izin kontrolü
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        addListeners();
                    } else {
                        this._emitError('Cihaz yönü izni reddedildi');
                    }
                })
                .catch(e => {
                    this._emitError('İzin hatası: ' + e.message);
                });
        } else {
            addListeners();
        }
    }

    /**
     * Generic Sensor API — AbsoluteOrientationSensor
     * Quaternion tabanlı absolute yön sensörü.
     * deviceorientationabsolute'den daha güvenilir (sensor fusion, gyro+accel+mag).
     * Destekleniyorsa birincil kaynak olarak kullanılır.
     */
    _tryAbsoluteOrientationSensor() {
        if (!('AbsoluteOrientationSensor' in window)) return;

        try {
            const sensor = new AbsoluteOrientationSensor({ frequency: 30 });

            sensor.addEventListener('reading', () => {
                const [qx, qy, qz, qw] = sensor.quaternion;

                // ── Quaternion → Heading ──
                // Cihazın -Z ekseni (kamera yönü) dünya koordinat sistemine dönüştürülür.
                // Earth frame: X=Doğu, Y=Kuzey, Z=Yukarı
                // Rotation matrix R sütun 2 (Z ekseni): R * (0,0,-1) = (-R02, -R12, -R22)
                const R02 = 2 * (qx * qz + qw * qy);
                const R12 = 2 * (qy * qz - qw * qx);

                // Yatay düzleme projeksiyon
                const projEast  = -R02;
                const projNorth = -R12;

                let heading = Math.atan2(projEast, projNorth) * (180 / Math.PI);
                if (heading < 0) heading += 360;

                // Beta tahmini: cihaz eğim açısı
                const R22 = 1 - 2 * (qx * qx + qy * qy);
                const R21 = 2 * (qy * qz + qw * qx);
                const beta = Math.atan2(R21, R22) * (180 / Math.PI);

                // Sensor API'yi birincil kaynak olarak işaretle
                this._hasAbsoluteSource = true;
                this._compassSource = 'sensor-api';
                this._handleCompass(heading, beta);
            });

            sensor.addEventListener('error', (e) => {
                console.warn('ARNavigationUI: AbsoluteOrientationSensor hatası -', e.error.message);
                // Sensor API çalışmazsa diğer kaynaklara devam et
            });

            sensor.start();
            this._orientationSensor = sensor;

        } catch (e) {
            // İzin yok veya desteklenmiyor — diğer kaynaklara devam
            console.info('ARNavigationUI: AbsoluteOrientationSensor kullanılamıyor -', e.message);
        }
    }

    _stopCompass() {
        if (this._compassAbs) {
            window.removeEventListener('deviceorientationabsolute', this._compassAbs, true);
            this._compassAbs = null;
        }
        if (this._compassWk) {
            window.removeEventListener('deviceorientation', this._compassWk, true);
            this._compassWk = null;
        }
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._compassTimeout) {
            clearTimeout(this._compassTimeout);
            this._compassTimeout = null;
        }
        if (this._orientationSensor) {
            try { this._orientationSensor.stop(); } catch (_) { /* ignore */ }
            this._orientationSensor = null;
        }
        this._compassActive = false;
        this._compassSource = 'none';
        this._headingBuffer = [];
        this._lastRawHeading = null;
        this._jumpRejectCount = 0;

        // Kalibrasyon izlemeyi durdur
        this._stopCalibrationMonitor();
    }

    /**
     * Gimbal Lock korumalı heading smoothing.
     *
     * Gimbal Lock: Euler açılarında beta ≈ ±90° olduğunda alpha ve gamma
     * eksenleri çakışır, sensör verileri anlık 180° sıçrar. Bu metod:
     *
     * 1. Jump Rejection  — Gimbal bölgesinde ani büyük sıçramaları reddeder,
     *    gerçek yön değişikliğini (ardışık tutarlı okuma) ise kabul eder.
     * 2. Adaptive Buffer — Gimbal bölgesinde smoothing buffer'ını büyütür,
     *    normal bölgede küçük tutar (tepki hızı için).
     * 3. Circular Mean   — 0°/360° geçişinde doğru ortalama alır.
     *
     * @param {number} rawHeading - Ham heading değeri (0-360)
     * @param {number} beta       - Cihaz beta açısı (eğim)
     * @returns {number} Kararlı heading (0-360)
     */
    _smoothHeading(rawHeading, beta) {
        // ── Gimbal Lock bölgesi tespiti ──
        // beta=90° civarı (±GIMBAL_LOCK_ZONE) tehlike bölgesi
        const GIMBAL_LOCK_ZONE = 15;     // derece (90° ± bu değer)
        const BUFFER_NORMAL    = 5;      // normal smoothing penceresi
        const BUFFER_GIMBAL    = 12;     // gimbal bölgesinde daha ağır smoothing
        const MAX_JUMP_NORMAL  = 90;     // normal bölgede izin verilen max sıçrama
        const MAX_JUMP_GIMBAL  = 30;     // gimbal bölgesinde çok daha katı
        const REJECT_THRESHOLD_NORMAL = 3;  // kaç ardışık reject sonrası kabul et
        const REJECT_THRESHOLD_GIMBAL = 10; // gimbal bölgesinde daha sabırlı

        const betaFromVertical = Math.abs((beta || 0) - 90);
        const inGimbalZone = betaFromVertical < GIMBAL_LOCK_ZONE;

        const maxJump = inGimbalZone ? MAX_JUMP_GIMBAL : MAX_JUMP_NORMAL;
        const bufferSize = inGimbalZone ? BUFFER_GIMBAL : BUFFER_NORMAL;
        const rejectThreshold = inGimbalZone
            ? REJECT_THRESHOLD_GIMBAL
            : REJECT_THRESHOLD_NORMAL;

        // ── Jump Rejection ──
        // Önceki ham heading'e göre açısal fark hesapla
        if (this._lastRawHeading !== null) {
            const diff = Math.abs(
                ((rawHeading - this._lastRawHeading + 180) % 360 + 360) % 360 - 180
            );

            if (diff > maxJump) {
                this._jumpRejectCount++;
                this._recordCalibrationJump(); // Kalibrasyon istatistiği
                // Belirli sayıda ardışık reject → gerçek yön değişikliği, kabul et
                if (this._jumpRejectCount < rejectThreshold) {
                    // Sıçramayı reddet, mevcut kararlı heading'i döndür
                    return this._currentHeading || rawHeading;
                }
                // Eşik aşıldı: buffer'ı temizle, yeni yönü kabul et
                this._headingBuffer = [];
            } else {
                this._jumpRejectCount = 0;
            }
        }

        this._lastRawHeading = rawHeading;

        // ── Adaptive Buffer ──
        this._headingBuffer.push(rawHeading);
        while (this._headingBuffer.length > bufferSize) {
            this._headingBuffer.shift();
        }

        // ── Circular Mean (sin/cos yöntemi) ──
        // 0°/360° geçişinde yanlış ortalama almaz
        const degToRad = Math.PI / 180;
        let sinSum = 0, cosSum = 0;
        for (const h of this._headingBuffer) {
            sinSum += Math.sin(h * degToRad);
            cosSum += Math.cos(h * degToRad);
        }
        let avg = Math.atan2(sinSum, cosSum) * (180 / Math.PI);
        if (avg < 0) avg += 360;

        return avg;
    }

    _handleCompass(rawHeading, beta) {
        // ── Kalibrasyon sample kaydı (filtreleme öncesi ham veri) ──
        // _recordCalibrationSample → _evaluateCalibrationQuality zinciri
        // kalibrasyon kalitesini takip eder, debug panelde gösterir.
        this._recordCalibrationSample(rawHeading);

        // ── HER ZAMAN heading'i güncelle (stop durumunda bile) ──
        // Sensör referans çerçevesi canlı tutulur, tekrar start'ta
        // heading zaten güncel ve kararlıdır.
        const heading = this._smoothHeading(rawHeading, beta);
        this._currentHeading = heading;
        this._currentBeta = beta;

        // ── Navigasyon aktif değilse sadece heading takibi yap ──
        if (!this._running || this._completed) return;

        // İlk pusula verisi geldiğinde loading'i gizle
        if (!this._compassReady) {
            this._compassReady = true;
            this._els.loading.classList.remove('arn-show');
        }

        // Compass callback — kapı durumundan bağımsız her zaman çağrılır
        // (dış kodun heading'i izleyebilmesi için)
        if (this.onCompassUpdate) {
            this.onCompassUpdate({
                heading: heading,
                beta: beta,
                targetAngle: this.targetAngle,
                source: this._compassSource
            });
        }

        // Debug panel güncelle
        this._updateDebugPanel({
            heading: heading.toFixed(0) + '°',
            source: ARNavigationUI._SOURCE_LABELS[this._compassSource] || this._compassSource
        });

        // Okları güncelle
        this._updateArrows();
    }

    // ================================================================
    //  PRIVATE: OK GÖSTERİMİ & İLERLEME
    // ================================================================

    _updateArrows() {
        const target = this.targetAngle;
        const current = this._currentHeading;
        const beta = this._currentBeta;

        // Tüm okları gizle
        this._hideAllArrows();

        // Hizalanma kontrolü
        const isAligned = this._checkAlignment(current, target, this.tolerance);

        if (isAligned) {
            // İleri ok göster (telefon eğimine göre perspektif seç)
            if (beta < 30) {
                this._els.arrowUpPersp.classList.add('arn-visible');
            } else {
                this._els.arrowUp.classList.add('arn-visible');
            }

            // Yeni hizalanma başlangıcı
            if (!this._aligned) {
                this._aligned = true;
                this._startProgress();
                if (this.onAligned) this.onAligned();
                this._updateDebugPanel({ status: 'Doğru yön ✓' });
            }
        } else {
            // Dönülecek yönü hesapla
            const clockwise = (target - current + 360) % 360;
            const counterclockwise = (current - target + 360) % 360;

            if (clockwise <= counterclockwise) {
                this._els.arrowRight.classList.add('arn-visible');
            } else {
                this._els.arrowLeft.classList.add('arn-visible');
            }

            // Hizalanma bozulduysa progress'i sıfırla
            if (this._aligned) {
                this._aligned = false;
                this._resetProgress();
                if (this.onMisaligned) this.onMisaligned();
                this._updateDebugPanel({ status: 'Yönünüzü düzeltin…' });
            }
        }
    }

    _hideAllArrows() {
        if (this._els.arrowLeft) this._els.arrowLeft.classList.remove('arn-visible');
        if (this._els.arrowRight) this._els.arrowRight.classList.remove('arn-visible');
        if (this._els.arrowUp) this._els.arrowUp.classList.remove('arn-visible');
        if (this._els.arrowUpPersp) this._els.arrowUpPersp.classList.remove('arn-visible');
    }

    _startProgress() {
        this._els.progress.classList.add('arn-grow');
        this._els.progressBar.style.strokeDashoffset = '0';
        this._monitorProgress();
    }

    _resetProgress() {
        this._els.progress.classList.remove('arn-grow');
        this._els.progressBar.style.strokeDashoffset = '283';
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _monitorProgress() {
        if (!this._aligned || this._completed || !this._running) return;

        const offset = parseFloat(
            getComputedStyle(this._els.progressBar).strokeDashoffset
        );

        if (offset === 0) {
            // Tamamlandı!
            // ❗ Pusula DURDURULMAZ — _completed = true heading takibini durdurmaz,
            //    sadece ok güncellemesini durdurur (_handleCompass içindeki kontrol).
            //    Böylece popup açıkken kullanıcı döndüğünde heading güncel kalır
            //    ve tekrar start() çağrıldığında doğru yönü gösterir.
            this._completed = true;
            this._hideAllArrows();

            if (this.onCompleted) this.onCompleted();
            this._updateDebugPanel({ status: 'Hedefe ulaşıldı ✅' });

            if (this.showPopup) {
                this._showPopup();
            } else {
                this.stop();
            }
        } else {
            this._rafId = requestAnimationFrame(() => this._monitorProgress());
        }
    }

    // ================================================================
    //  PRIVATE: POPUP
    // ================================================================

    _showPopup() {
        if (this._els.popup) {
            // Mesajı güncelle (runtime'da değişmiş olabilir)
            if (this._els.popupMessage) {
                this._els.popupMessage.textContent = this.popupMessage;
            }
            if (this._els.popupBtn) {
                this._els.popupBtn.textContent = this.popupButtonText;
            }
            this._els.popup.classList.add('arn-show');
        }
    }

    _hidePopup() {
        if (this._els.popup) {
            this._els.popup.classList.remove('arn-show');
        }
    }

    // ================================================================
    //  PRIVATE: YARDIMCI
    // ================================================================

    /**
     * Hizalanma kontrolü (ARDirectionCalculator bağımlılığı olmadan)
     */
    _checkAlignment(current, target, tolerance) {
        const upper = (target + tolerance) % 360;
        const lower = (target - tolerance + 360) % 360;
        if (lower > upper) {
            return current >= lower || current <= upper;
        }
        return current >= lower && current <= upper;
    }

    _emitError(message) {
        console.error('ARNavigationUI:', message);
        if (this.onError) this.onError(message);
        this._updateDebugPanel({ status: '⚠ ' + message });
    }

    // ================================================================
    //  PRIVATE: DEBUG PANEL GÜNCELLEME
    // ================================================================

    /** @private */
    static _SOURCE_LABELS = {
        'sensor-api':        '🟢 Sensor API',
        'absolute-event':    '🟢 Absolute',
        'webkit-compass':    '🟢 WebKit',
        'absolute-flag':     '🟡 Abs Flag',
        'fallback-rotation': '🔴 Fallback',
        'none':              '⚫ –'
    };

    /** @private */
    static _CALIB_LABELS = { poor: '🔴 Kötü', fair: '🟡 Orta', good: '🟢 İyi' };

    /**
     * Debug paneli günceller.
     * @param {Object} fields - Güncellenecek alanlar { status, target, heading, source, calib }
     */
    _updateDebugPanel(fields = {}) {
        if (!this.showDebugPanel) return;
        if (fields.status  !== undefined && this._els.dbgStatus)  this._els.dbgStatus.textContent  = fields.status;
        if (fields.target  !== undefined && this._els.dbgTarget)  this._els.dbgTarget.textContent  = fields.target;
        if (fields.heading !== undefined && this._els.dbgHeading) this._els.dbgHeading.textContent = fields.heading;
        if (fields.source  !== undefined && this._els.dbgSource)  this._els.dbgSource.textContent  = fields.source;
        if (fields.calib   !== undefined && this._els.dbgCalib)   this._els.dbgCalib.textContent   = fields.calib;
    }

    // ================================================================
    //  KALİBRASYON SİSTEMİ
    // ================================================================

    // ────────────────────────────────────────
    //  PUBLIC API: Kalibrasyon
    // ────────────────────────────────────────

    /**
     * Mevcut kalibrasyon kalitesini döndürür
     * @returns {'unknown'|'poor'|'fair'|'good'}
     */
    get calibrationQuality() {
        return this._calibration.quality;
    }

    /**
     * Detaylı kalibrasyon raporunu döndürür
     * @returns {Object}
     */
    getCalibrationReport() {
        const cal = this._calibration;
        const stdDev = this._computeCircularStdDev(cal.rawSamples);
        const jumpRate = cal.totalSamples > 0
            ? cal.totalJumps / cal.totalSamples
            : 0;

        return {
            quality: cal.quality,
            headingStdDev: Math.round(stdDev * 100) / 100,
            jumpRate: Math.round(jumpRate * 1000) / 1000,
            magneticField: cal.magField,
            totalSamples: cal.totalSamples,
            totalJumps: cal.totalJumps,
            hasMagnetometer: cal.magSensor !== null,
            hasAbsoluteSource: this._hasAbsoluteSource
        };
    }

    /**
     * Kalibrasyon kalitesini rapor eder (artık overlay yok, debug panel bilgi verir)
     */
    requestCalibration() {
        this._evaluateCalibrationQuality();
    }

    // ────────────────────────────────────────
    //  PRIVATE: Kalibrasyon Başlatma / Durdurma
    // ────────────────────────────────────────

    /**
     * Kalibrasyon izleme sistemini başlatır.
     * _startCompass() içinden çağrılır.
     */
    _startCalibrationMonitor() {
        if (!this.calibrationCheck) return;

        // Kalibrasyon state'ini sıfırla
        this._calibration.rawSamples = [];
        this._calibration.totalSamples = 0;
        this._calibration.totalJumps = 0;
        this._calibration.lastCheckTime = 0;
        this._calibration.quality = ARNavigationUI.CALIBRATION_QUALITY.UNKNOWN;
        this._calibration.prompted = false;

        // Magnetometer API'yi dene (manyetik alan gücü kontrolü)
        this._startMagnetometer();
    }

    /**
     * Kalibrasyon izleme sistemini durdurur.
     * _stopCompass() içinden çağrılır.
     */
    _stopCalibrationMonitor() {
        this._stopMagnetometer();
    }

    // ────────────────────────────────────────
    //  PRIVATE: Magnetometer API (Generic Sensor)
    // ────────────────────────────────────────

    /**
     * Magnetometer Generic Sensor API'yi başlatır (varsa).
     * Ham manyetik alan gücünü (µT) okur.
     * Normal Dünya manyetik alanı: ~25-65 µT
     * Bu aralık dışı = manyetik parazit veya bozuk kalibrasyon.
     */
    _startMagnetometer() {
        if (!('Magnetometer' in window)) {
            // API desteklenmiyor — sorun değil, sadece heading analizi ile devam
            return;
        }

        try {
            const sensor = new Magnetometer({ frequency: 10 });

            sensor.addEventListener('reading', () => {
                const { x, y, z } = sensor;
                // Manyetik alan gücü (µT) = vektör büyüklüğü
                this._calibration.magField = Math.sqrt(x * x + y * y + z * z);
            });

            sensor.addEventListener('error', (e) => {
                console.warn('ARNavigationUI: Magnetometer erişilemedi -', e.error.message);
                this._calibration.magSensor = null;
            });

            sensor.start();
            this._calibration.magSensor = sensor;

        } catch (e) {
            // İzin yok veya desteklenmiyor
            console.warn('ARNavigationUI: Magnetometer API başlatılamadı -', e.message);
        }
    }

    _stopMagnetometer() {
        if (this._calibration.magSensor) {
            try { this._calibration.magSensor.stop(); } catch (e) { /* ignore */ }
            this._calibration.magSensor = null;
        }
    }

    // ────────────────────────────────────────
    //  PRIVATE: Kalibrasyon Kalite Analizi
    // ────────────────────────────────────────

    /**
     * Her compass update'inde çağrılır.
     * Ham heading'i kaydeder ve periyodik olarak kalite kontrolü yapar.
     * @param {number} rawHeading - Filtrelenmemiş ham heading (0-360)
     */
    _recordCalibrationSample(rawHeading) {
        if (!this.calibrationCheck) return;

        const cal = this._calibration;
        const T = ARNavigationUI.CALIBRATION_THRESHOLDS;

        // Sample'ı kaydet
        cal.rawSamples.push(rawHeading);
        cal.totalSamples++;
        if (cal.rawSamples.length > T.SAMPLE_WINDOW) {
            cal.rawSamples.shift();
        }

        // Warmup süresi — yeterli veri toplanmadan kontrol yapma
        if (cal.totalSamples < T.WARMUP_SAMPLES) return;

        // Periyodik kontrol (her CHECK_INTERVAL_MS'de bir)
        const now = Date.now();
        if (now - cal.lastCheckTime < T.CHECK_INTERVAL_MS) return;
        cal.lastCheckTime = now;

        // ── Kalite analizi ──
        this._evaluateCalibrationQuality();
    }

    /**
     * Sıçrama (jump rejection) olduğunda kalibrasyon istatistiğini günceller.
     */
    _recordCalibrationJump() {
        if (!this.calibrationCheck) return;
        this._calibration.totalJumps++;
    }

    /**
     * Kalibrasyon kalitesini çoklu metriklerle değerlendirir.
     *
     * Metrikler:
     * 1. Heading standart sapması (dairesel) — sensör gürültüsü/tutarsızlık
     * 2. Sıçrama oranı — reddedilen reading'lerin toplama oranı
     * 3. Manyetik alan gücü — normal aralıkta mı (Magnetometer varsa)
     */
    _evaluateCalibrationQuality() {
        const cal = this._calibration;
        const T = ARNavigationUI.CALIBRATION_THRESHOLDS;
        const Q = ARNavigationUI.CALIBRATION_QUALITY;

        const stdDev = this._computeCircularStdDev(cal.rawSamples);
        const jumpRate = cal.totalSamples > 0
            ? cal.totalJumps / cal.totalSamples
            : 0;
        const magField = cal.magField;

        // ── Kalite seviyesini belirle (en kötü metrik kazanır) ──
        let quality = Q.GOOD;

        // 1. Heading standart sapması
        if (stdDev > T.HEADING_STD_POOR) {
            quality = Q.POOR;
        } else if (stdDev > T.HEADING_STD_FAIR) {
            quality = this._worseQuality(quality, Q.FAIR);
        }

        // 2. Sıçrama oranı
        if (jumpRate > T.JUMP_RATE_POOR) {
            quality = Q.POOR;
        } else if (jumpRate > T.JUMP_RATE_FAIR) {
            quality = this._worseQuality(quality, Q.FAIR);
        }

        // 3. Manyetik alan gücü (Magnetometer API varsa)
        if (magField !== null) {
            if (magField < T.MAG_FIELD_MIN || magField > T.MAG_FIELD_MAX) {
                quality = Q.POOR;
            }
        }

        // ── Sonucu uygula ──
        const prevQuality = cal.quality;
        cal.quality = quality;

        // Kalite düştüyse → uyar
        if (quality === Q.POOR && prevQuality !== Q.POOR) {
            this._onCalibrationDegraded(quality, stdDev, jumpRate, magField);
        }
        // Kalite yükseldiyse → bildir
        if (this._isQualityBetter(quality, prevQuality) && prevQuality !== Q.UNKNOWN) {
            this._onCalibrationImproved(quality);
        }

        // Kalibrasyon durumunu debug panele yansıt (quality _onCalibrationDegraded/_onCalibrationImproved'da güncellenir)
    }

    // ────────────────────────────────────────
    //  PRIVATE: Dairesel Standart Sapma
    // ────────────────────────────────────────

    /**
     * Açısal verilerin dairesel standart sapmasını hesaplar.
     * 0°/360° geçişinde doğru çalışır (sin/cos yöntemi).
     *
     * @param {number[]} samples - Açı değerleri (0-360)
     * @returns {number} Standart sapma (derece)
     */
    _computeCircularStdDev(samples) {
        if (!samples || samples.length < 2) return 0;

        const degToRad = Math.PI / 180;
        let sinSum = 0, cosSum = 0;
        for (const s of samples) {
            sinSum += Math.sin(s * degToRad);
            cosSum += Math.cos(s * degToRad);
        }
        const n = samples.length;
        const R = Math.sqrt(
            (sinSum / n) * (sinSum / n) +
            (cosSum / n) * (cosSum / n)
        );

        // R → 1 = mükemmel tutarlılık, R → 0 = tamamen dağınık
        // Dairesel standart sapma = sqrt(-2 * ln(R))  (radyan → dereceye çevir)
        if (R >= 1) return 0;
        if (R <= 0) return 180;
        return Math.sqrt(-2 * Math.log(R)) * (180 / Math.PI);
    }

    // ────────────────────────────────────────
    //  PRIVATE: Kalibrasyon Kapısı (Gate) State Machine
    // ────────────────────────────────────────

    /**
     * Kalibrasyon kapısı geçişlerini yönetir.
     * _evaluateCalibrationQuality() içinden her değerlendirmede çağrılır.
     *
     * State geçişleri:
     *   'waiting'  → 'blocking'  (kalite POOR ise, overlay göster)
     *   'waiting'  → 'passed'    (kalite FAIR/GOOD ise, navigasyona geç)
     *   'blocking' → 'passed'    (kalite iyileşti, overlay kapat)
     *   'passed'   → 'passed'    (değişiklik yok, banner ile yönetilir)
     *
     * @param {string} quality - Yeni kalibrasyon kalite seviyesi
     */
    // ────────────────────────────────────────
    //  PRIVATE: Kalibrasyon Olayları
    // ────────────────────────────────────────

    _onCalibrationDegraded(quality, stdDev, jumpRate, magField) {
        const detail = { quality, stdDev, jumpRate, magField };

        this._updateDebugPanel({
            calib: `${ARNavigationUI._CALIB_LABELS[quality] || '?'} (σ=${stdDev.toFixed(1)}°)`
        });

        if (this.onCalibrationNeeded) {
            this.onCalibrationNeeded(detail);
        }
    }

    _onCalibrationImproved(quality) {
        this._updateDebugPanel({
            calib: ARNavigationUI._CALIB_LABELS[quality] || '?'
        });

        if (this.onCalibrationImproved) {
            this.onCalibrationImproved({ quality });
        }
    }

    // ────────────────────────────────────────
    //  PRIVATE: Kalite Karşılaştırma Yardımcıları
    // ────────────────────────────────────────

    /** İki kalite seviyesinden kötü olanını döndürür */
    _worseQuality(a, b) {
        const order = { good: 3, fair: 2, poor: 1, unknown: 0 };
        return (order[a] || 0) <= (order[b] || 0) ? a : b;
    }

    /** a, b'den daha iyi mi? */
    _isQualityBetter(a, b) {
        const order = { good: 3, fair: 2, poor: 1, unknown: 0 };
        return (order[a] || 0) > (order[b] || 0);
    }
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARNavigationUI;
}

