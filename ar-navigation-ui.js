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
            animation: arnJumpSmall 1.2s ease infinite;
        }
        @keyframes arnJumpSmall {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
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

        // Callback'ler
        this.onCompleted = options.onCompleted ?? null;
        this.onPopupDismiss = options.onPopupDismiss ?? null;
        this.onCompassUpdate = options.onCompassUpdate ?? null;
        this.onAligned = options.onAligned ?? null;
        this.onMisaligned = options.onMisaligned ?? null;
        this.onStart = options.onStart ?? null;
        this.onStop = options.onStop ?? null;
        this.onError = options.onError ?? null;

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
     * AR navigasyonu başlatır: kamera açılır, pusula dinlenir, oklar gösterilir
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
        this._compassReady = false;

        // Root'u göster
        this._els.root.classList.add('arn-active');

        // Loading ekranını göster
        this._els.loading.classList.add('arn-show');

        // Kamera başlat
        if (this.manageCamera) {
            await this._startCamera();
        }

        // Pusula dinlemeye başla
        this._startCompass();

        if (this.onStart) this.onStart();
    }

    /**
     * AR navigasyonu durdurur: kamera kapatılır, pusula dinlemesi biter, UI gizlenir
     */
    stop() {
        if (!this._running) return;
        this._running = false;

        this._stopCompass();
        this._stopCamera();
        this._hideAllArrows();
        this._resetProgress();
        this._hidePopup();
        this._els.loading.classList.remove('arn-show');

        this._els.root.classList.remove('arn-active');

        if (this.onStop) this.onStop();
    }

    /**
     * Bileşeni tamamen kaldırır. stop() çağrılır ve DOM temizlenir.
     * Bu çağrıdan sonra instance tekrar kullanılamaz.
     */
    destroy() {
        this.stop();
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
        `;

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

    _startCompass() {
        if (!window.DeviceOrientationEvent) {
            this._emitError('DeviceOrientation API desteklenmiyor');
            return;
        }

        // Android: tilt-kompanzasyonlu pusula
        this._compassAbs = (e) => {
            if (!e.absolute || e.alpha == null || e.beta == null || e.gamma == null) return;
            let heading = -(e.alpha + e.beta * e.gamma / 90);
            heading -= Math.floor(heading / 360) * 360;
            this._handleCompass(heading, e.beta);
        };

        // iOS: webkit pusula
        this._compassWk = (e) => {
            if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
                this._handleCompass(e.webkitCompassHeading, e.beta || 90);
            }
        };

        const addListeners = () => {
            window.addEventListener('deviceorientationabsolute', this._compassAbs, true);
            window.addEventListener('deviceorientation', this._compassWk, true);
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
    }

    _handleCompass(heading, beta) {
        if (!this._running || this._completed) return;

        // İlk pusula verisi geldiğinde loading'i gizle
        if (!this._compassReady) {
            this._compassReady = true;
            this._els.loading.classList.remove('arn-show');
        }

        this._currentHeading = heading;
        this._currentBeta = beta;

        // Callback
        if (this.onCompassUpdate) {
            this.onCompassUpdate({
                heading: heading,
                beta: beta,
                targetAngle: this.targetAngle
            });
        }

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
            this._completed = true;
            this._stopCompass();
            this._hideAllArrows();

            if (this.onCompleted) this.onCompleted();

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
    }
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARNavigationUI;
}

