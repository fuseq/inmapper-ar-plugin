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

    /**
     * Heading filtreleme sabitleri.
     *
     * Filtre örnekleme hızından bağımsız çalışır: buffer uzunluğu yerine zaman
     * sabiti, sabit derece yerine açısal hız limiti kullanılır. Böylece 60Hz
     * ateşleyen bir iPhone ile 15Hz ateşleyen bir Android aynı davranışı gösterir.
     */
    static HEADING = {
        // Yatay düzleme projeksiyon büyüklüğü (0-1). Kamera ufka paralelken 1,
        // tavana/zemine bakarken 0. Sensör gürültüsü heading'e 1/confidence
        // oranında yansır, dolayısıyla bu değer okumanın güvenilirliğidir.
        MIN_CONFIDENCE: 0.15,        // Altında heading anlamsız (~9° hata/0.5° gürültü)
        LOW_CONFIDENCE: 0.40,        // Altında kullanıcı uyarılır ("telefonu dikleştir")

        SMOOTHING_MS: 150,           // Dairesel ortalama zaman penceresi
        MAX_BUFFER: 30,              // Güvenlik tavanı (çok yüksek örnekleme hızı için)

        // Fiziksel olarak mümkün max açısal hız. Bunu aşan değişim sensör
        // sıçramasıdır, gerçek hareket değil.
        MAX_TURN_RATE_DPS: 600,
        JUMP_GRACE_MS: 250,          // Bu süre boyunca ısrar eden sıçrama kabul edilir
    };

    /** Kalibrasyon tespit eşik değerleri */
    static CALIBRATION_THRESHOLDS = {
        // Heading standart sapma eşikleri (dairesel, derece cinsinden).
        // Sadece cihaz durağanken ölçülür — kullanıcı dönerken sapma doğal olarak
        // yükselir ve sensör kalitesi hakkında hiçbir şey söylemez.
        HEADING_STD_POOR: 15,        // > 15° std dev → POOR
        HEADING_STD_FAIR: 8,         // > 8° std dev → FAIR

        // Durağanlık eşiği: bunun üzerinde dönüş varsa örnek analize alınmaz
        STILL_RATE_DPS: 8,

        // Analiz penceresi
        SAMPLE_WINDOW: 40,           // Kaç durağan sample üzerinden analiz
        CHECK_INTERVAL_MS: 2000,     // Kalibrasyon kontrol sıklığı (ms)
        WARMUP_SAMPLES: 10,          // İlk bu kadar sample'dan sonra kontrol başla

        // Sıçrama oranı eşiği (kayan pencere üzerinden)
        JUMP_WINDOW: 120,            // Sıçrama oranının hesaplandığı örnek sayısı
        JUMP_RATE_POOR: 0.30,        // > %30 sıçrama oranı → POOR
        JUMP_RATE_FAIR: 0.15,        // > %15 sıçrama oranı → FAIR

        // iOS webkitCompassAccuracy (±derece). Negatif = kalibre değil.
        IOS_ACCURACY_POOR: 25,
        IOS_ACCURACY_FAIR: 12,
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

        /* ===== HINT (düşük güven / durum uyarısı) ===== */
        .arn-hint {
            position: fixed;
            bottom: 60px;
            left: 50%;
            transform: translateX(-50%);
            max-width: 80%;
            padding: 10px 18px;
            border-radius: 20px;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            font-size: 14px;
            font-weight: 500;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 9015;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .arn-hint.arn-visible {
            opacity: 1;
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
     * @param {number}  [options.targetAngle=0]        - Hedef açı, harita çerçevesinde (0-360)
     * @param {number}  [options.tolerance=20]          - Hizalanma toleransı (derece)
     * @param {number}  [options.mapNorthOffset=0]      - Harita kuzeyinin gerçek kuzeye göre sapması (derece)
     * @param {number}  [options.magneticDeclination=0] - Manyetik sapma, doğuya pozitif (derece)
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
     * @param {Function} [options.onCalibrationNeeded]   - Kalibrasyon bozulduğunda ({quality, stdDev, jumpRate, iosAccuracy})
     * @param {Function} [options.onCalibrationImproved] - Kalibrasyon iyileştiğinde ({quality, stdDev, jumpRate, iosAccuracy})
     */
    constructor(options = {}) {
        // Konfigürasyon
        this.targetAngle = options.targetAngle ?? 0;
        this.tolerance = options.tolerance ?? 20;

        // ── Harita çerçevesi → pusula çerçevesi dönüşümü ──
        // targetAngle harita çerçevesindedir (SVG'de yukarı = 0°). Kat planları
        // gerçek kuzeye hizalı çizilmez, dolayısıyla bu offset mekan başına bir
        // kez ölçülüp verilmelidir. Ölçmeden bırakılırsa oklar sabit bir hatayla
        // çalışır. Kaynak SVG'lerde kuzey referansı bulunmadığı için otomatik
        // türetilemez.
        this.mapNorthOffset = options.mapNorthOffset ?? 0;

        // Manyetik sapma (declination): gerçek kuzey ile manyetik kuzey arasındaki
        // açı, doğuya doğru pozitif. Cihaz sensörleri manyetik kuzeyi referans alır
        // (W3C: deviceorientationabsolute ve AbsoluteOrientationSensor). Türkiye
        // için ~+6°. NOAA hesaplayıcısından mekan koordinatıyla alınabilir.
        this.magneticDeclination = options.magneticDeclination ?? 0;
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
        this._currentConfidence = 1;
        this._compassReady = false;
        this._hintText = null;

        // DOM & listener referansları
        this._els = {};
        this._compassAbs = null;
        this._compassWk = null;
        this._progressTimer = null;
        this._onProgressEnd = null;
        this._destroyed = false;
        this._compassActive = false;
        this._hasAbsoluteSource = false;
        this._isIOSFamily = false;
        this._headingBuffer = [];
        this._lastRawHeading = null;
        this._lastSampleTime = 0;
        this._jumpRejectMs = 0;

        // Pusula kaynak takibi
        // 'none' | 'absolute-event' | 'webkit-compass' | 'absolute-flag' | 'sensor-api'
        this._compassSource = 'none';
        this._compassTimeout = null;
        this._orientationSensor = null; // AbsoluteOrientationSensor (Generic Sensor API)

        // Kalibrasyon durumu
        this._calibration = {
            quality: ARNavigationUI.CALIBRATION_QUALITY.UNKNOWN,
            stillSamples: [],       // Cihaz durağanken alınan ham heading değerleri
            totalSamples: 0,        // Toplam alınan sample sayısı
            jumpFlags: [],          // Son N örnek için sıçrama bayrağı (kayan pencere)
            lastCheckTime: 0,       // Son kalibrasyon kontrolü zamanı
            iosAccuracy: null,      // webkitCompassAccuracy (±derece, iOS'a özel)
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

    /** Mevcut okumanın güvenilirliği (0-1); kamera ufka yaklaştıkça 1'e gider */
    get currentConfidence() { return this._currentConfidence; }

    /**
     * Hedef açının cihaz pusulasıyla karşılaştırılabilir hali.
     *
     * targetAngle harita çerçevesindedir; cihaz ise manyetik kuzeyi ölçer.
     * Zincir: harita açısı → (mapNorthOffset) → gerçek kuzey → (−declination)
     * → manyetik kuzey.
     */
    get effectiveTargetAngle() {
        return ((this.targetAngle + this.mapNorthOffset - this.magneticDeclination) % 360 + 360) % 360;
    }

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

        this._setHint(null);

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
            target: this.effectiveTargetAngle.toFixed(0) + '°'
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
        this._setHint(null);
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
            <div class="arn-hint"></div>
            <div class="arn-popup">
                <div class="arn-popup-content">
                    <div class="arn-popup-icon">${this._getPopupIcon()}</div>
                    <div class="arn-popup-message"></div>
                    <button class="arn-popup-btn"></button>
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
                    <div class="arn-debug-row"><span class="arn-debug-label">Güven</span><span class="arn-debug-value arn-dbg-conf">–</span></div>
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
            this._els.dbgConf    = dbg.querySelector('.arn-dbg-conf');
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
        this._els.hint = root.querySelector('.arn-hint');

        // Kullanıcıdan/sunucudan gelebilecek metinler innerHTML'e değil
        // textContent'e yazılır
        this._els.popupMessage.textContent = this.popupMessage;
        this._els.popupBtn.textContent = this.popupButtonText;

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
     * HTML attribute değerini kaçırır.
     * Görsel yolları dışarıdan (konfigürasyon, sunucu) geldiği için
     * innerHTML'e ham gömülmemeli.
     */
    static _escapeAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Ok içeriğini döndürür: özel resim varsa <img>, yoksa inline SVG
     */
    _getArrowContent(type) {
        if (this.arrowImages && this.arrowImages[type]) {
            const src = ARNavigationUI._escapeAttr(this.arrowImages[type]);
            return `<img src="${src}" class="arn-arrow-icon" alt="${ARNavigationUI._escapeAttr(type)}">`;
        }
        return ARNavigationUI.ARROW_SVGS[type] || '';
    }

    /**
     * Popup ikonu döndürür: özel resim varsa <img>, yoksa emoji
     */
    _getPopupIcon() {
        if (this.popupImage) {
            const src = ARNavigationUI._escapeAttr(this.popupImage);
            return `<img src="${src}" class="arn-popup-img" alt="completed">`;
        }
        return '✅';
    }

    /**
     * Loading görseli döndürür: özel resim varsa <img>, yoksa spinner
     */
    _getLoadingContent() {
        if (this.loadingImage) {
            const src = ARNavigationUI._escapeAttr(this.loadingImage);
            return `<img src="${src}" class="arn-loading-img" alt="loading">`;
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
     * W3C rotation matrix yöntemiyle kameranın baktığı yönün pusula açısını hesaplar.
     *
     * Cihazın -Z ekseni (arka kamera doğrultusu) Dünya çerçevesine taşınır ve
     * yatay düzleme izdüşürülür. Telefon hangi açıda tutulursa tutulsun —
     * portre, yatay, eğik — kameranın gerçekten baktığı yön elde edilir.
     * Ekran yönünden (portre/yatay) tamamen bağımsızdır; doğrulaması
     * tools/compass-math-check.js TEST 1 ve TEST 2'de.
     *
     * Dönen `confidence`, izdüşüm vektörünün büyüklüğüdür (0-1):
     * kamera ufka paralelken 1, tavana veya zemine bakarken 0'a iner.
     * Sıfıra yaklaştıkça heading tanımsızlaşır — sensör gürültüsü heading'e
     * 1/confidence oranında büyüyerek yansır. Euler açılarındaki klasik
     * gimbal lock (beta ≈ ±90) bu yöntemde sorun değildir; orada confidence
     * 1'e çıkar, yani okuma en güvenilir haldedir.
     *
     * @param {number} alpha - DeviceOrientation alpha (0-360)
     * @param {number} beta  - DeviceOrientation beta (-180..180)
     * @param {number} gamma - DeviceOrientation gamma (-90..90)
     * @returns {{heading: number, confidence: number}}
     */
    static _computeHeadingFromRotationMatrix(alpha, beta, gamma) {
        const degToRad = Math.PI / 180;
        const cA = Math.cos(alpha * degToRad);
        const sA = Math.sin(alpha * degToRad);
        const sB = Math.sin(beta * degToRad);
        const cG = Math.cos(gamma * degToRad);
        const sG = Math.sin(gamma * degToRad);

        // Kamera doğrultusunun (-Z) Dünya çerçevesindeki doğu ve kuzey bileşenleri
        const east  = -cA * sG - sA * sB * cG;
        const north = -sA * sG + cA * sB * cG;

        let heading = Math.atan2(east, north) * (180 / Math.PI);
        if (heading < 0) heading += 360;

        return { heading, confidence: Math.hypot(east, north) };
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

        // iOS ailesi tespiti. iOS'ta alpha MUTLAK DEĞİLDİR: Apple'ın kendi
        // dokümantasyonuna göre "cihazın ilk okuma anındaki yönünden ölçülen
        // keyfi bir offset". Bu yüzden iOS'ta alpha tabanlı fallback'e asla
        // düşülmemeli — kullanıcıya sessizce rastgele bir yön gösterirdi.
        this._isIOSFamily =
            typeof DeviceOrientationEvent.requestPermission === 'function' ||
            (DeviceOrientationEvent.prototype &&
             'webkitCompassHeading' in DeviceOrientationEvent.prototype);

        // ══════════════════════════════════════════════════════
        //  KAYNAK 1: deviceorientationabsolute (Chrome Android)
        //  Tarayıcı absolute garanti eder. e.absolute === false ise
        //  event göreceli → yoksay.
        // ══════════════════════════════════════════════════════
        this._compassAbs = (e) => {
            // AbsoluteOrientationSensor devraldıysa bu kaynağı kullanma.
            // İkisi birden beslerse aynı buffer iki farklı hesaptan dolar,
            // örnekleme hızı ikiye katlanır ve heading salınır.
            if (this._compassSource === 'sensor-api') return;
            // Bazı tarayıcılar bu eventi göreceli değerlerle ateşler
            if (e.absolute === false) return;
            if (e.alpha == null || e.beta == null || e.gamma == null) return;

            this._hasAbsoluteSource = true;
            this._ingestOrientation(e.alpha, e.beta, e.gamma, 'absolute-event');
        };

        // ══════════════════════════════════════════════════════
        //  KAYNAK 2: deviceorientation (iOS + Firefox fallback)
        //  Öncelik: webkitCompassHeading > e.absolute=true > son çare
        // ══════════════════════════════════════════════════════
        this._compassWk = (e) => {
            // Absolute kaynak zaten aktifse → çakışma önle
            if (this._hasAbsoluteSource) return;

            // ── iOS: webkitCompassHeading ──
            // Bu değer kamera yönü DEĞİL, alpha ile aynı ailedendir: dünya
            // dikey ekseni etrafındaki azimut (alpha'nın tersi yönde artar).
            // Doğrudan heading olarak kullanılırsa portrede doğru, yatay modda
            // ~90° yanlış olur. Bu yüzden mutlak alpha'ya çevirip Android ile
            // aynı rotasyon matrisinden geçiriyoruz.
            if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
                this._compassSource = 'webkit-compass';
                this._recordIOSAccuracy(e.webkitCompassAccuracy);
                const alpha = (360 - e.webkitCompassHeading) % 360;
                this._ingestOrientation(alpha, e.beta ?? 90, e.gamma ?? 0, 'webkit-compass');
                return;
            }

            // ── Firefox / bazı Android tarayıcılar: e.absolute === true ──
            if (e.absolute === true && e.alpha != null && e.beta != null && e.gamma != null) {
                this._ingestOrientation(e.alpha, e.beta, e.gamma, 'absolute-flag');
                return;
            }

            // ── Son çare: 5s timeout sonrası göreceli rotasyon matrisi ──
            // Sadece iOS DIŞINDA. Android'de alpha genelde manyetik kuzeye
            // referanslıdır; iOS'ta keyfidir ve bu dal açılırsa ok yanlış yönü
            // gösterirken kullanıcı doğru sanır.
            if (this._compassFallbackEnabled && !this._isIOSFamily &&
                e.alpha != null && e.beta != null && e.gamma != null) {
                if (this._compassSource === 'none') {
                    console.warn('ARNavigationUI: Absolute pusula bulunamadı, ' +
                        'deviceorientation rotation matrix fallback kullanılıyor — ' +
                        'yön doğruluğu garanti edilemez');
                }
                this._ingestOrientation(e.alpha, e.beta, e.gamma, 'fallback-rotation');
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
                if (this._compassSource !== 'none') return;

                if (this._isIOSFamily) {
                    // iOS'ta alpha keyfi olduğu için fallback yok. Pusula yoksa
                    // yön üretmek yerine dürüstçe hata veriyoruz.
                    this._emitError('Pusula verisi alınamıyor — Ayarlar > Gizlilik > ' +
                        'Konum Servisleri > Sistem Servisleri altından Pusula ' +
                        'Ayarlama seçeneğini açın');
                    return;
                }

                console.warn('ARNavigationUI: 5s içinde absolute pusula verisi alınamadı');
                this._compassFallbackEnabled = true;
                // Hâlâ veri gelmezse hata yayınla
                setTimeout(() => {
                    if (this._compassSource === 'none') {
                        this._emitError('Pusula verisi alınamıyor — cihaz sensörleri kontrol edin');
                    }
                }, 3000);
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

                // ── Birincil kaynak olarak devral ──
                // deviceorientationabsolute dinleyicisi bu noktadan sonra
                // gereksiz; kaldırılmazsa iki kaynak aynı buffer'ı besler.
                if (this._compassSource !== 'sensor-api' && this._compassAbs) {
                    window.removeEventListener('deviceorientationabsolute', this._compassAbs, true);
                }
                this._hasAbsoluteSource = true;
                this._compassSource = 'sensor-api';
                this._handleCompass(heading, beta, Math.hypot(projEast, projNorth));
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
        this._lastSampleTime = 0;
        this._jumpRejectMs = 0;

        // Kalibrasyon izlemeyi durdur
        this._stopCalibrationMonitor();
    }

    /**
     * Ham yönelim verisini heading'e çevirip işleme hattına verir.
     * Tüm kaynaklar (Android absolute event, iOS webkitCompass, fallback)
     * buradan geçer — böylece platformlar arasında tek bir matematik kullanılır.
     */
    _ingestOrientation(alpha, beta, gamma, source) {
        const { heading, confidence } =
            ARNavigationUI._computeHeadingFromRotationMatrix(alpha, beta, gamma);
        this._compassSource = source;
        this._handleCompass(heading, beta, confidence);
    }

    /**
     * Heading smoothing — örnekleme hızından bağımsız.
     *
     * 1. Jump Rejection — Sıçrama eşiği sabit derece değil, açısal hız limitidir.
     *    Böylece 60Hz ile 15Hz cihazlarda aynı fiziksel davranış elde edilir.
     *    Sıçrama JUMP_GRACE_MS boyunca ısrar ederse gerçek hareket kabul edilir.
     * 2. Zaman Pencereli Buffer — Sabit örnek sayısı yerine SMOOTHING_MS'lik
     *    pencere. Yavaş ateşleyen cihazlarda gereksiz gecikme oluşmaz.
     * 3. Güven Ağırlıklı Dairesel Ortalama — Her örnek confidence² ile
     *    ağırlıklandırılır. Bu ters-varyans ağırlıklandırmasıdır: heading
     *    gürültüsü 1/confidence ile büyüdüğü için varyans 1/confidence²'dir.
     *
     * @param {number} rawHeading - Ham heading (0-360)
     * @param {number} confidence - Yatay izdüşüm büyüklüğü (0-1)
     * @param {number} dtMs       - Bir önceki örnekten geçen süre
     * @returns {number|null} Kararlı heading, veya sıçrama reddedildiyse null
     */
    _smoothHeading(rawHeading, confidence, dtMs) {
        const H = ARNavigationUI.HEADING;
        const now = Date.now();

        // ── Jump Rejection (açısal hız tabanlı) ──
        if (this._lastRawHeading !== null && dtMs > 0) {
            const diff = Math.abs(
                ((rawHeading - this._lastRawHeading + 180) % 360 + 360) % 360 - 180
            );
            // Çok kısa dt'lerde alt sınır koy, aksi halde eşik sıfıra yaklaşır
            const maxJump = Math.max(15, H.MAX_TURN_RATE_DPS * (dtMs / 1000));

            if (diff > maxJump) {
                this._jumpRejectMs += dtMs;
                this._recordCalibrationJump();
                if (this._jumpRejectMs < H.JUMP_GRACE_MS) {
                    return null; // sıçramayı reddet, mevcut heading korunur
                }
                // Sıçrama ısrar etti → gerçek hareket, buffer'ı sıfırla
                this._headingBuffer = [];
                this._jumpRejectMs = 0;
            } else {
                this._jumpRejectMs = 0;
            }
        }

        this._lastRawHeading = rawHeading;

        // ── Zaman pencereli buffer ──
        const weight = confidence * confidence;
        this._headingBuffer.push({ heading: rawHeading, weight, time: now });

        const cutoff = now - H.SMOOTHING_MS;
        while (this._headingBuffer.length > 1 &&
               (this._headingBuffer[0].time < cutoff ||
                this._headingBuffer.length > H.MAX_BUFFER)) {
            this._headingBuffer.shift();
        }

        // ── Güven ağırlıklı dairesel ortalama ──
        const degToRad = Math.PI / 180;
        let sinSum = 0, cosSum = 0;
        for (const s of this._headingBuffer) {
            sinSum += Math.sin(s.heading * degToRad) * s.weight;
            cosSum += Math.cos(s.heading * degToRad) * s.weight;
        }
        if (sinSum === 0 && cosSum === 0) return null;

        let avg = Math.atan2(sinSum, cosSum) * (180 / Math.PI);
        if (avg < 0) avg += 360;
        return avg;
    }

    /**
     * @param {number} rawHeading - Ham heading (0-360)
     * @param {number} beta       - Cihaz eğimi
     * @param {number} confidence - Okumanın güvenilirliği (0-1)
     */
    _handleCompass(rawHeading, beta, confidence = 1) {
        const now = Date.now();
        const dtMs = this._lastSampleTime ? now - this._lastSampleTime : 0;
        this._lastSampleTime = now;

        this._currentBeta = beta;
        this._currentConfidence = confidence;

        // ── Güven eşiğinin altında heading tanımsız ──
        // Kamera tavana veya zemine bakıyor; yatay izdüşüm sıfıra yaklaştığı için
        // en ufak sensör gürültüsü heading'i 180°'ye kadar savurur. Bu okumaları
        // işlemek yerine son kararlı heading'i koruyup kullanıcıyı uyarıyoruz.
        if (confidence < ARNavigationUI.HEADING.MIN_CONFIDENCE) {
            this._lastRawHeading = null; // süreklilik koptu, sıçrama sayacını sıfırla
            if (this._running && !this._completed) {
                this._setHint('Telefonu dikleştirin');
                this._updateDebugPanel({ conf: 'düşük (' + confidence.toFixed(2) + ')' });
            }
            return;
        }

        // Dönüş hızı — kalibrasyon analizinin sadece durağan anları kullanması için
        let turnRate = 0;
        if (this._lastRawHeading !== null && dtMs > 0) {
            const d = Math.abs(
                ((rawHeading - this._lastRawHeading + 180) % 360 + 360) % 360 - 180
            );
            turnRate = d / (dtMs / 1000);
        }
        this._recordCalibrationSample(rawHeading, turnRate);

        // ── HER ZAMAN heading'i güncelle (stop durumunda bile) ──
        // Sensör referans çerçevesi canlı tutulur, tekrar start'ta
        // heading zaten güncel ve kararlıdır.
        const smoothed = this._smoothHeading(rawHeading, confidence, dtMs);
        if (smoothed !== null) this._currentHeading = smoothed;

        // ── Navigasyon aktif değilse sadece heading takibi yap ──
        if (!this._running || this._completed) return;

        // İlk pusula verisi geldiğinde loading'i gizle
        if (!this._compassReady) {
            this._compassReady = true;
            this._els.loading.classList.remove('arn-show');
        }

        this._setHint(
            confidence < ARNavigationUI.HEADING.LOW_CONFIDENCE
                ? 'Telefonu biraz dikleştirin'
                : null
        );

        // Compass callback — dış kodun heading'i izleyebilmesi için
        if (this.onCompassUpdate) {
            this.onCompassUpdate({
                heading: this._currentHeading,
                beta: beta,
                confidence: confidence,
                targetAngle: this.targetAngle,
                effectiveTargetAngle: this.effectiveTargetAngle,
                source: this._compassSource
            });
        }

        this._updateDebugPanel({
            heading: this._currentHeading.toFixed(0) + '°',
            source: ARNavigationUI._SOURCE_LABELS[this._compassSource] || this._compassSource,
            conf: confidence.toFixed(2)
        });

        this._updateArrows();
    }

    // ================================================================
    //  PRIVATE: OK GÖSTERİMİ & İLERLEME
    // ================================================================

    _updateArrows() {
        const target = this.effectiveTargetAngle;
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
        const bar = this._els.progressBar;
        this._clearProgressWatch();

        this._els.progress.classList.add('arn-grow');
        bar.style.transition = `stroke-dashoffset ${this.progressDuration}s linear`;
        bar.style.strokeDashoffset = '0';

        // Eskiden her karede getComputedStyle okunuyordu; bu her karede zorunlu
        // layout tetikliyordu. transitionend aynı bilgiyi bedavaya veriyor.
        this._onProgressEnd = (e) => {
            if (e && e.propertyName && e.propertyName !== 'stroke-dashoffset') return;
            this._completeProgress();
        };
        bar.addEventListener('transitionend', this._onProgressEnd);

        // Emniyet payı: transitionend bazı tarayıcılarda gizlenmiş elemanlarda
        // ateşlenmeyebilir.
        this._progressTimer = setTimeout(
            () => this._completeProgress(),
            this.progressDuration * 1000 + 1000
        );
    }

    _resetProgress() {
        const bar = this._els.progressBar;
        this._clearProgressWatch();
        this._els.progress.classList.remove('arn-grow');

        // Geri sarma anlık olmalı — aynı transition ile dönerse progressDuration
        // kadar sürer ve kullanıcı yeniden hizalandığında yarım dolu başlar.
        bar.style.transition = 'none';
        bar.style.strokeDashoffset = '283';
        if (typeof bar.getBoundingClientRect === 'function') bar.getBoundingClientRect();
        bar.style.transition = `stroke-dashoffset ${this.progressDuration}s linear`;
    }

    _clearProgressWatch() {
        if (this._progressTimer) {
            clearTimeout(this._progressTimer);
            this._progressTimer = null;
        }
        if (this._onProgressEnd && this._els.progressBar) {
            this._els.progressBar.removeEventListener('transitionend', this._onProgressEnd);
        }
        this._onProgressEnd = null;
    }

    _completeProgress() {
        if (!this._aligned || this._completed || !this._running) return;
        this._clearProgressWatch();

        // ❗ Pusula DURDURULMAZ — _completed = true heading takibini durdurmaz,
        //    sadece ok güncellemesini durdurur (_handleCompass içindeki kontrol).
        //    Böylece popup açıkken kullanıcı döndüğünde heading güncel kalır
        //    ve tekrar start() çağrıldığında doğru yönü gösterir.
        this._completed = true;
        this._hideAllArrows();
        this._setHint(null);

        if (this.onCompleted) this.onCompleted();
        this._updateDebugPanel({ status: 'Hedefe ulaşıldı ✅' });

        if (this.showPopup) {
            this._showPopup();
        } else {
            this.stop();
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

    /**
     * Ekranın altındaki ipucu balonunu günceller.
     * @param {string|null} text - null verilirse balon gizlenir
     */
    _setHint(text) {
        if (this._hintText === text) return; // gereksiz DOM dokunuşunu önle
        this._hintText = text;
        if (!this._els.hint) return;
        if (text) {
            this._els.hint.textContent = text;
            this._els.hint.classList.add('arn-visible');
        } else {
            this._els.hint.classList.remove('arn-visible');
        }
    }

    _emitError(message) {
        console.error('ARNavigationUI:', message);

        // Yükleniyor ekranı pusula verisini bekliyordu; veri hiç gelmeyecekse
        // kullanıcı sonsuza kadar "Pusula başlatılıyor..." ekranında kalırdı.
        if (this._els.loading) this._els.loading.classList.remove('arn-show');
        this._setHint(message);

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
        if (fields.conf    !== undefined && this._els.dbgConf)    this._els.dbgConf.textContent    = fields.conf;
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
        return {
            quality: cal.quality,
            headingStdDev: Math.round(this._computeCircularStdDev(cal.stillSamples) * 100) / 100,
            jumpRate: Math.round(this._computeJumpRate() * 1000) / 1000,
            iosAccuracy: cal.iosAccuracy,
            stillSamples: cal.stillSamples.length,
            totalSamples: cal.totalSamples,
            confidence: this._currentConfidence,
            source: this._compassSource,
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

        const cal = this._calibration;
        cal.stillSamples = [];
        cal.totalSamples = 0;
        cal.jumpFlags = [];
        cal.lastCheckTime = 0;
        cal.iosAccuracy = null;
        cal.quality = ARNavigationUI.CALIBRATION_QUALITY.UNKNOWN;
    }

    /**
     * Kalibrasyon izleme sistemini durdurur.
     * _stopCompass() içinden çağrılır.
     */
    _stopCalibrationMonitor() {
        this._calibration.stillSamples = [];
        this._calibration.jumpFlags = [];
    }

    /**
     * iOS'un bildirdiği pusula doğruluğunu kaydeder.
     *
     * webkitCompassAccuracy sensörün kendi hata payını ±derece cinsinden verir;
     * negatif değer "kalibre değil" demektir. Bu, heading dağılımından kalite
     * tahmin etmeye çalışmaktan çok daha güvenilirdir. Android'de standart bir
     * karşılığı yok, orada istatistiksel sezgisele mecburuz.
     *
     * @param {number|null|undefined} accuracy
     */
    _recordIOSAccuracy(accuracy) {
        if (typeof accuracy !== 'number' || isNaN(accuracy)) return;
        this._calibration.iosAccuracy = accuracy;
    }

    // ────────────────────────────────────────
    //  PRIVATE: Kalibrasyon Kalite Analizi
    // ────────────────────────────────────────

    /**
     * Her compass update'inde çağrılır.
     * Ham heading'i kaydeder ve periyodik olarak kalite kontrolü yapar.
     * @param {number} rawHeading - Filtrelenmemiş ham heading (0-360)
     */
    _recordCalibrationSample(rawHeading, turnRate) {
        if (!this.calibrationCheck) return;

        const cal = this._calibration;
        const T = ARNavigationUI.CALIBRATION_THRESHOLDS;

        cal.totalSamples++;
        cal.jumpFlags.push(0);
        if (cal.jumpFlags.length > T.JUMP_WINDOW) cal.jumpFlags.shift();

        // ── Sadece cihaz durağanken örnek topla ──
        // Kullanıcı hedefe hizalanmak için döndüğünde heading dağılımı doğal
        // olarak genişler; bu sensör kalitesi hakkında hiçbir şey söylemez.
        // Ölçüm tools/compass-math-check.js TEST 4'te: 15Hz'de 20°/s'lik sıradan
        // bir dönüş bile filtresiz metrikte POOR üretiyordu.
        if (turnRate > T.STILL_RATE_DPS) return;

        cal.stillSamples.push(rawHeading);
        if (cal.stillSamples.length > T.SAMPLE_WINDOW) cal.stillSamples.shift();

        // Warmup süresi — yeterli veri toplanmadan kontrol yapma
        if (cal.stillSamples.length < T.WARMUP_SAMPLES) return;

        // Periyodik kontrol (her CHECK_INTERVAL_MS'de bir)
        const now = Date.now();
        if (now - cal.lastCheckTime < T.CHECK_INTERVAL_MS) return;
        cal.lastCheckTime = now;

        this._evaluateCalibrationQuality();
    }

    /**
     * Sıçrama (jump rejection) olduğunda kalibrasyon istatistiğini günceller.
     * Kayan pencere kullanılır — kümülatif oran oturum uzadıkça duyarsızlaşırdı.
     */
    _recordCalibrationJump() {
        if (!this.calibrationCheck) return;
        const flags = this._calibration.jumpFlags;
        if (flags.length > 0) flags[flags.length - 1] = 1;
    }

    /** Kayan pencere üzerinden sıçrama oranı (0-1) */
    _computeJumpRate() {
        const flags = this._calibration.jumpFlags;
        if (flags.length === 0) return 0;
        let sum = 0;
        for (const f of flags) sum += f;
        return sum / flags.length;
    }

    /**
     * Kalibrasyon kalitesini çoklu metriklerle değerlendirir.
     *
     * Metrikler:
     * 1. Heading standart sapması (dairesel) — sensör gürültüsü/tutarsızlık
     * 2. Sıçrama oranı — reddedilen reading'lerin toplama oranı
     * 3. iOS webkitCompassAccuracy — sensörün kendi bildirdiği hata payı
     */
    _evaluateCalibrationQuality() {
        const cal = this._calibration;
        const T = ARNavigationUI.CALIBRATION_THRESHOLDS;
        const Q = ARNavigationUI.CALIBRATION_QUALITY;

        const stdDev = this._computeCircularStdDev(cal.stillSamples);
        const jumpRate = this._computeJumpRate();
        const iosAccuracy = cal.iosAccuracy;

        // ── Kalite seviyesini belirle (en kötü metrik kazanır) ──
        let quality = Q.GOOD;

        // 1. iOS'un bildirdiği doğruluk — varsa en güvenilir sinyal budur
        if (iosAccuracy !== null) {
            if (iosAccuracy < 0 || iosAccuracy > T.IOS_ACCURACY_POOR) {
                quality = Q.POOR;
            } else if (iosAccuracy > T.IOS_ACCURACY_FAIR) {
                quality = this._worseQuality(quality, Q.FAIR);
            }
        }

        // 2. Durağan heading standart sapması
        if (stdDev > T.HEADING_STD_POOR) {
            quality = Q.POOR;
        } else if (stdDev > T.HEADING_STD_FAIR) {
            quality = this._worseQuality(quality, Q.FAIR);
        }

        // 3. Sıçrama oranı
        if (jumpRate > T.JUMP_RATE_POOR) {
            quality = Q.POOR;
        } else if (jumpRate > T.JUMP_RATE_FAIR) {
            quality = this._worseQuality(quality, Q.FAIR);
        }

        const prevQuality = cal.quality;
        cal.quality = quality;

        // ── Paneli her değerlendirmede güncelle ──
        // Eskiden yalnızca "POOR'a düştü" ve "yükseldi" dallarında yazılıyordu;
        // ilk değerlendirmede prevQuality daima UNKNOWN olduğu için iyi durumda
        // panel kalıcı olarak boş kalıyordu.
        this._updateDebugPanel({
            calib: (ARNavigationUI._CALIB_LABELS[quality] || '?') +
                   ' (σ=' + stdDev.toFixed(1) + '°)'
        });

        if (quality === prevQuality) return;

        const detail = { quality, stdDev, jumpRate, iosAccuracy };
        if (this._isQualityBetter(quality, prevQuality)) {
            if (prevQuality !== Q.UNKNOWN && this.onCalibrationImproved) {
                this.onCalibrationImproved(detail);
            }
        } else if (this.onCalibrationNeeded) {
            this.onCalibrationNeeded(detail);
        }
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

