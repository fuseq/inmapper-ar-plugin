/**
 * ARDirectionCalculator v2.0
 * 
 * SVG segment verilerinden pusula yönü hesaplayan bağımsız modül.
 * DOM, UI veya cihaz API bağımlılığı yoktur. Tamamen saf matematik.
 * 
 * Tek başına veya ARNavigationUI ile birlikte kullanılabilir.
 * 
 * @example
 * // Segment ile kullanım
 * const calc = new ARDirectionCalculator({
 *     segments: [{x1: 100, y1: 200, x2: 150, y2: 180}],
 *     maxSegments: 5
 * });
 * const result = calc.calculate();
 * console.log(result.compassAngle); // 0-360 derece
 * console.log(result.compass);      // "Kuzeydoğu"
 * 
 * @example
 * // Nokta dizisi ile kullanım
 * const calc = new ARDirectionCalculator();
 * calc.setPathFromPoints([[100, 200], [150, 180], [200, 160]]);
 * const result = calc.calculate();
 * 
 * @example
 * // Statik yardımcı metodlar
 * ARDirectionCalculator.checkAlignment(currentHeading, targetAngle, tolerance);
 * ARDirectionCalculator.getTurnDirection(currentHeading, targetAngle);
 * ARDirectionCalculator.angleToCompass(45); // "Kuzeydoğu"
 */
class ARDirectionCalculator {

    constructor(options = {}) {
        this.segments = options.segments || [];
        this.maxSegments = options.maxSegments || 5;
        // Bu açıdan fazla sapan segment "köşe" sayılır ve ortalamaya katılmaz.
        this.maxTurnDeg = options.maxTurnDeg ?? 35;
    }

    // ================================================================
    //  STATIC YARDIMCI METODLAR
    // ================================================================

    /**
     * Line segment dizisini nokta dizisine dönüştürür
     * @param {Array<{x1,y1,x2,y2}>} segments
     * @returns {Array<[number,number]>}
     */
    static segmentsToPoints(segments) {
        if (!segments || segments.length === 0) return [];
        const points = [[segments[0].x1, segments[0].y1]];
        for (const seg of segments) {
            points.push([seg.x2, seg.y2]);
        }
        return points;
    }

    /**
     * Nokta dizisini line segment dizisine dönüştürür
     * @param {Array<[number,number]>} points
     * @returns {Array<{x1,y1,x2,y2}>}
     */
    static pointsToSegments(points) {
        if (!points || points.length < 2) return [];
        const segments = [];
        for (let i = 0; i < points.length - 1; i++) {
            segments.push({
                x1: points[i][0], y1: points[i][1],
                x2: points[i + 1][0], y2: points[i + 1][1]
            });
        }
        return segments;
    }

    /**
     * Derece açıyı 16 yönlü pusula karşılığına çevirir
     * @param {number} angle - 0-360 derece
     * @returns {string} Pusula yönü (ör: "Kuzeydoğu")
     */
    static angleToCompass(angle) {
        const dirs = [
            'Kuzey', 'Kuzey-Kuzeydoğu', 'Kuzeydoğu', 'Doğu-Kuzeydoğu',
            'Doğu', 'Doğu-Güneydoğu', 'Güneydoğu', 'Güney-Güneydoğu',
            'Güney', 'Güney-Güneybatı', 'Güneybatı', 'Batı-Güneybatı',
            'Batı', 'Batı-Kuzeybatı', 'Kuzeybatı', 'Kuzey-Kuzeybatı'
        ];
        return dirs[Math.round(angle / 22.5) % 16];
    }

    /**
     * İki açı arasında hizalanma kontrolü yapar
     * @param {number} current - Mevcut pusula açısı (0-360)
     * @param {number} target  - Hedef açı (0-360)
     * @param {number} [tolerance=20] - Tolerans derecesi
     * @returns {boolean}
     */
    static checkAlignment(current, target, tolerance = 20) {
        const upper = (target + tolerance) % 360;
        const lower = (target - tolerance + 360) % 360;
        if (lower > upper) {
            return current >= lower || current <= upper;
        }
        return current >= lower && current <= upper;
    }

    /**
     * Hedefe ulaşmak için dönülmesi gereken yönü hesaplar
     * @param {number} current - Mevcut pusula açısı
     * @param {number} target  - Hedef açı
     * @param {number} [tolerance=20] - Tolerans
     * @returns {'left'|'right'|'aligned'}
     */
    static getTurnDirection(current, target, tolerance = 20) {
        if (ARDirectionCalculator.checkAlignment(current, target, tolerance)) {
            return 'aligned';
        }
        const clockwise = (target - current + 360) % 360;
        const counterclockwise = (current - target + 360) % 360;
        return clockwise <= counterclockwise ? 'right' : 'left';
    }

    /**
     * İki açı arasındaki açısal farkı hesaplar (0-180)
     * @param {number} a - Açı 1
     * @param {number} b - Açı 2
     * @returns {number} 0-180 arası fark
     */
    static angleDifference(a, b) {
        const diff = Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
        return diff;
    }

    /**
     * Bir kapı çizgisinin baktığı yönü harita çerçevesinde hesaplar.
     *
     * SVG'de kapılar nokta değil çizgi segmentidir, dolayısıyla geometrik bir
     * yönleri vardır. Kapının normali iki yöne bakabilir; hangisinin dışarı
     * (koridora) baktığı `towardPoint` ile belirlenir — tipik olarak güzergâhın
     * kapıdan sonraki ilk noktası verilir.
     *
     * Jiroskop çapası için kullanışlıdır: kullanıcı kapıdan çıkarken doğal
     * olarak bu yöne bakar, dolayısıyla harita ile cihaz arasındaki ilişki
     * manyetometreye hiç dokunmadan kurulabilir.
     *
     * @param {{x1:number,y1:number,x2:number,y2:number}} door - Kapı çizgisi
     * @param {[number,number]} towardPoint - Normalin bakması istenen taraftaki nokta
     * @returns {number|null} 0-360 derece harita açısı, dejenere geometride null
     */
    static doorFacing(door, towardPoint) {
        if (!door || !towardPoint) return null;

        const dx = door.x2 - door.x1;
        const dy = door.y2 - door.y1;
        if (Math.hypot(dx, dy) < 1e-9) return null;

        const cx = (door.x1 + door.x2) / 2;
        const cy = (door.y1 + door.y2) / 2;

        // Kapı çizgisine dik iki adaydan biri
        let nx = -dy;
        let ny = dx;

        // Hedef noktanın bulunduğu tarafa çevir
        const towardX = towardPoint[0] - cx;
        const towardY = towardPoint[1] - cy;
        const projection = nx * towardX + ny * towardY;
        if (Math.abs(projection) < 1e-9) return null; // nokta kapı çizgisi üzerinde
        if (projection < 0) { nx = -nx; ny = -ny; }

        // SVG'de Y aşağı artar; kuzey = yukarı
        return (Math.atan2(nx, -ny) * 180 / Math.PI + 360) % 360;
    }

    // ================================================================
    //  INSTANCE METODLARI
    // ================================================================

    /**
     * Segment verilerini ayarlar
     * @param {Array<{x1,y1,x2,y2}>} segments
     * @param {number} [maxSegments] - Kullanılacak max segment sayısı
     * @returns {this} Chaining için
     */
    setSegments(segments, maxSegments = null) {
        this.segments = segments || [];
        if (maxSegments !== null) this.maxSegments = maxSegments;
        return this;
    }

    /**
     * Nokta dizisinden segment oluşturur
     * @param {Array<[number,number]>} points
     * @param {number} [maxSegments]
     * @returns {this} Chaining için
     */
    setPathFromPoints(points, maxSegments = null) {
        this.segments = ARDirectionCalculator.pointsToSegments(points);
        if (maxSegments !== null) this.maxSegments = maxSegments;
        return this;
    }

    /**
     * Segmentlerden içinde bulunulan bacağın yönünü hesaplar.
     *
     * SVG koordinat sistemi kullanılır (Y aşağı doğru artar) ve ekranda yukarı
     * yön 0° (kuzey) kabul edilir. Dikkat: bu, harita çerçevesindeki bir açıdır.
     * Kat planları gerçek kuzeye hizalı çizilmediği için ARNavigationUI'a
     * mekana ait `mapNorthOffset` değeri verilmeden ok gerçek dünyada sabit bir
     * hatayla çalışır.
     *
     * @returns {Object|null} Hesaplama sonucu veya null
     * @returns {number} result.compassAngle - 0-360 derece, harita çerçevesinde
     * @returns {string} result.compass - Pusula yönü adı
     * @returns {Array}  result.startPoint - Başlangıç noktası [x, y]
     * @returns {Array}  result.endPoint - Bacağın bittiği nokta [x, y]
     * @returns {number} result.dx - X değişimi
     * @returns {number} result.dy - Y değişimi
     * @returns {number} result.distance - Bacağın uzunluğu
     * @returns {number} result.straightness - 0-1; 1 = düz koridor, düşük = zikzak
     * @returns {number} result.segmentsUsed - Kullanılan segment sayısı
     * @returns {Object|null} result.turnAhead - Bacak sonundaki dönüş
     *   ({angle, relative: 'left'|'right', afterDistance}) veya köşe yoksa null
     */
    calculate() {
        if (!this.segments || this.segments.length === 0) {
            return null;
        }

        const window = this.segments.slice(0, this.maxSegments);
        const start = [window[0].x1, window[0].y1];

        // ── Köşeye kadar olan bacağı seç ──
        // Baştan sona düz kiriş çekmek, güzergâh pencere içinde dönüyorsa
        // kullanıcıya iki bacağın ortalamasını gösterir — koridor dönemecinde
        // duvarı işaret edebilir. Bunun yerine ilk segmentten belirgin şekilde
        // sapan ilk segmentte duruyoruz: gösterilen yön daima içinde bulunulan
        // bacağın yönü olur, dönüş bir sonraki adımda anlatılır.
        const accepted = [];
        let refAngle = null;
        let turnAhead = null;

        for (const seg of window) {
            const sdx = seg.x2 - seg.x1;
            const sdy = seg.y2 - seg.y1;
            const len = Math.hypot(sdx, sdy);
            if (len < 1) continue; // gürültü segmenti

            const angle = (Math.atan2(sdx, -sdy) * 180 / Math.PI + 360) % 360;
            if (refAngle === null) {
                refAngle = angle;
            } else if (ARDirectionCalculator.angleDifference(angle, refAngle) > this.maxTurnDeg) {
                // Köşe bulundu — buradan sonrası bir sonraki bacak
                turnAhead = {
                    angle,
                    relative: ARDirectionCalculator.getTurnDirection(refAngle, angle, this.maxTurnDeg),
                    afterDistance: accepted.reduce((s, a) => s + a.len, 0)
                };
                break;
            }
            accepted.push({ seg, sdx, sdy, len, angle });
        }

        if (accepted.length === 0) return null;

        const last = accepted[accepted.length - 1].seg;
        const end = [last.x2, last.y2];

        // Kabul edilen bacak boyunca uzunlukla ağırlıklı ortalama yön.
        // Segmentler eşdoğrusalsa bu, baştan sona kirişle birebir aynıdır.
        const dx = accepted.reduce((s, a) => s + a.sdx, 0);
        const dy = accepted.reduce((s, a) => s + a.sdy, 0);

        // SVG koordinat sisteminde Y aşağı doğru artar
        // atan2(dx, -dy) ile kuzey=0° referanslı açı hesaplanır
        const angleDeg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

        // Düzlük: birim segment yönlerinin bileşke uzunluğu (0-1).
        // 1'e yakın = düz koridor, düşük = zikzak, yön daha az anlamlı.
        const totalLen = accepted.reduce((s, a) => s + a.len, 0);
        const straightness = totalLen > 0 ? Math.hypot(dx, dy) / totalLen : 0;

        return {
            compassAngle: angleDeg,
            compass: ARDirectionCalculator.angleToCompass(angleDeg),
            startPoint: start,
            endPoint: end,
            dx: dx,
            dy: dy,
            distance: totalLen,
            straightness: straightness,
            segmentsUsed: accepted.length,
            turnAhead: turnAhead
        };
    }

    /**
     * Mevcut durumu döndürür (debug için)
     */
    getState() {
        return {
            segmentCount: this.segments.length,
            maxSegments: this.maxSegments
        };
    }
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARDirectionCalculator;
}
