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
     * Segmentlerden yönü hesaplar
     * İlk noktadan son noktaya olan vektörü pusula açısına çevirir.
     * SVG koordinat sistemi kullanılır (Y aşağı doğru artar).
     * 
     * @returns {Object|null} Hesaplama sonucu veya null
     * @returns {number} result.compassAngle - 0-360 derece pusula açısı
     * @returns {string} result.compass - Pusula yönü adı
     * @returns {Array}  result.startPoint - Başlangıç noktası [x, y]
     * @returns {Array}  result.endPoint - Bitiş noktası [x, y]
     * @returns {number} result.dx - X değişimi
     * @returns {number} result.dy - Y değişimi
     * @returns {number} result.segmentsUsed - Kullanılan segment sayısı
     */
    calculate() {
        if (!this.segments || this.segments.length === 0) {
            return null;
        }

        const segs = this.segments.slice(0, this.maxSegments);
        const start = [segs[0].x1, segs[0].y1];
        const last = segs[segs.length - 1];
        const end = [last.x2, last.y2];

        const dx = end[0] - start[0];
        const dy = end[1] - start[1];

        // SVG koordinat sisteminde Y aşağı doğru artar
        // atan2(dx, -dy) ile kuzey=0° referanslı açı hesaplanır
        const angleRad = Math.atan2(dx, -dy);
        const angleDeg = (angleRad * 180 / Math.PI + 360) % 360;

        return {
            compassAngle: angleDeg,
            compass: ARDirectionCalculator.angleToCompass(angleDeg),
            startPoint: start,
            endPoint: end,
            dx: dx,
            dy: dy,
            segmentsUsed: segs.length
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
