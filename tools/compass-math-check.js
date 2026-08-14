/**
 * Pusula matematiği doğrulama harness'i.
 *
 * ar-navigation-ui.js içindeki heading hesabının hangi ekseni ölçtüğünü,
 * hangi yönelimlerde dejenere olduğunu ve filtre parametrelerinin gerçekçi
 * örnekleme hızlarında nasıl davrandığını ölçer.
 *
 * Çalıştırma: node tools/compass-math-check.js
 */
const D = Math.PI / 180;
const R2D = 180 / Math.PI;

// ── Projedeki formül (ar-navigation-ui.js:777) ──
function projectHeading(alpha, beta, gamma) {
    const cA = Math.cos(alpha * D), sA = Math.sin(alpha * D);
    const sB = Math.sin(beta * D);
    const cG = Math.cos(gamma * D), sG = Math.sin(gamma * D);
    const rA = -cA * sG - sA * sB * cG;
    const rB = -sA * sG + cA * sB * cG;
    let h = Math.atan2(rA, rB) * R2D;
    if (h < 0) h += 360;
    return { heading: h, magnitude: Math.hypot(rA, rB) };
}

// ── W3C referans rotasyon matrisi: R = Rz(alpha)·Rx(beta)·Ry(gamma) ──
// Cihaz koordinatlarını Dünya koordinatlarına (X=Doğu, Y=Kuzey, Z=Yukarı) taşır.
function eulerToMatrix(alpha, beta, gamma) {
    const cA = Math.cos(alpha * D), sA = Math.sin(alpha * D);
    const cB = Math.cos(beta * D), sB = Math.sin(beta * D);
    const cG = Math.cos(gamma * D), sG = Math.sin(gamma * D);
    return [
        [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
        [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
        [-cB * sG, sB, cB * cG]
    ];
}

function headingOfAxis(east, north) {
    let h = Math.atan2(east, north) * R2D;
    if (h < 0) h += 360;
    return { heading: h, magnitude: Math.hypot(east, north) };
}

// Kameranın baktığı yön = cihaz -Z ekseni
const cameraHeading = (R) => headingOfAxis(-R[0][2], -R[1][2]);
// Ekranın üst yönü = cihaz +Y ekseni
const screenTopHeading = (R) => headingOfAxis(R[0][1], R[1][1]);

function matrixToEuler(R) {
    const beta = Math.atan2(R[2][1], Math.hypot(R[2][0], R[2][2])) * R2D;
    const alpha = Math.atan2(-R[0][1], R[1][1]) * R2D;
    const gamma = Math.atan2(-R[2][0], R[2][2]) * R2D;
    return [(alpha + 360) % 360, beta, gamma];
}

function matMul(A, B) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
    return C;
}

const angDiff = (a, b) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
const line = (n) => '='.repeat(n);

console.log(line(78));
console.log('TEST 1 - Formul hangi ekseni olcuyor?');
console.log(line(78));
{
    let maxCam = 0, maxTop = 0;
    for (let i = 0; i < 20000; i++) {
        const a = Math.random() * 360;
        const b = Math.random() * 360 - 180;
        const g = Math.random() * 180 - 90;
        const R = eulerToMatrix(a, b, g);
        const f = projectHeading(a, b, g);
        const cam = cameraHeading(R);
        const top = screenTopHeading(R);
        if (cam.magnitude > 0.05) maxCam = Math.max(maxCam, angDiff(f.heading, cam.heading));
        if (top.magnitude > 0.05) maxTop = Math.max(maxTop, angDiff(f.heading, top.heading));
    }
    console.log('20000 rastgele yonelim:');
    console.log('  kamera ekseni (-Z) ile max fark :', maxCam.toExponential(2), 'derece');
    console.log('  ekran ustu    (+Y) ile max fark :', maxTop.toFixed(1), 'derece');
    console.log();
    console.log('  -> Formul KAMERA yonunu veriyor (AR icin dogru olan bu).');
}

console.log();
console.log(line(78));
console.log('TEST 2 - Ekran yonu (portre / yatay) heading\'i etkiliyor mu?');
console.log(line(78));
{
    const base = eulerToMatrix(0, 90, 0); // kamera kuzeye bakan dik pozisyon
    console.log('taban: alpha=0 beta=90 gamma=0  ->  heading', projectHeading(0, 90, 0).heading.toFixed(3));
    console.log();
    console.log(' ekran donusu | alpha    beta   gamma | formul heading | 360-alpha');
    console.log(' ' + '-'.repeat(68));
    for (const roll of [0, 45, 90, 180, 270]) {
        const c = Math.cos(roll * D), s = Math.sin(roll * D);
        const R = matMul(base, [[c, -s, 0], [s, c, 0], [0, 0, 1]]);
        const [a, b, g] = matrixToEuler(R);
        const f = projectHeading(a, b, g);
        console.log('  ' + String(roll).padStart(4) + ' derece  |' +
            a.toFixed(1).padStart(7) + b.toFixed(1).padStart(8) + g.toFixed(1).padStart(8) +
            ' |' + f.heading.toFixed(3).padStart(14) + ' |' +
            ((360 - a) % 360).toFixed(1).padStart(10));
    }
    console.log();
    console.log('  -> formul sutunu sabit kaliyorsa matris yontemi ekran yonunden bagimsiz.');
    console.log('  -> "360-alpha" sutunu degisiyorsa iOS webkitCompassHeading yolu ayrisiyor.');
}

console.log();
console.log(line(78));
console.log('TEST 3 - Dejenerasyon: 0.5 derece sensor gurultusu -> heading hatasi');
console.log(line(78));
{
    console.log(' beta | proj.buyukluk | max hata  | mevcut kod bu bolgeyi ne sayiyor');
    console.log(' ' + '-'.repeat(70));
    for (const b of [0, 3, 10, 20, 40, 60, 75, 90, 105, 140, 170, 180]) {
        const f = projectHeading(30, b, 0);
        let worst = 0;
        for (let k = 0; k < 500; k++) {
            const n = () => (Math.random() - 0.5);
            worst = Math.max(worst, angDiff(projectHeading(30 + n(), b + n(), n()).heading, f.heading));
        }
        const inZone = Math.abs(b - 90) < 15;
        console.log(String(b).padStart(5) + ' |' + f.magnitude.toFixed(3).padStart(14) +
            ' |' + (worst.toFixed(1) + ' d').padStart(10) + ' | ' +
            (inZone ? 'GIMBAL BOLGESI -> agir filtre' : 'normal -> hafif filtre'));
    }
}

console.log();
console.log(line(78));
console.log('TEST 4 - Kullanici donerken kalibrasyon "POOR" damgasi yiyor mu?');
console.log(line(78));
{
    function circStdDev(samples) {
        let sin = 0, cos = 0;
        for (const s of samples) { sin += Math.sin(s * D); cos += Math.cos(s * D); }
        const n = samples.length;
        const R = Math.hypot(sin / n, cos / n);
        if (R >= 1) return 0;
        if (R <= 0) return 180;
        return Math.sqrt(-2 * Math.log(R)) * R2D;
    }
    const WINDOW = 40; // CALIBRATION_THRESHOLDS.SAMPLE_WINDOW
    console.log('esikler: >15 derece POOR, >8 derece FAIR   (pencere 40 ornek, sensor gurultusu YOK)');
    console.log();
    console.log(' donus hizi | 60Hz            | 15Hz');
    console.log(' ' + '-'.repeat(52));
    for (const rate of [10, 20, 30, 45, 60, 90, 120]) {
        const out = [];
        for (const hz of [60, 15]) {
            const s = [];
            for (let i = 0; i < WINDOW; i++) s.push((i * rate / hz) % 360);
            const sd = circStdDev(s);
            out.push((sd.toFixed(1) + ' d -> ' + (sd > 15 ? 'POOR' : sd > 8 ? 'FAIR' : 'GOOD')).padEnd(15));
        }
        console.log(String(rate).padStart(6) + ' d/s |', out[0], '|', out[1]);
    }
    console.log();
    console.log('  -> Bu tablodaki POOR/FAIR sonuclari TAMAMEN kullanici donusunden,');
    console.log('     sensor bozuklugundan degil.');
}

console.log();
console.log(line(78));
console.log('TEST 5 - Smoothing buffer gecikmesi');
console.log(line(78));
{
    console.log(' ornekleme | buffer 5 | buffer 12 | buffer 12 ile 90 d/s donuste geri kalma');
    console.log(' ' + '-'.repeat(72));
    for (const hz of [60, 30, 15, 10]) {
        const lag5 = (5 - 1) / 2 / hz;
        const lag12 = (12 - 1) / 2 / hz;
        console.log(String(hz).padStart(7) + 'Hz |' +
            (lag5 * 1000).toFixed(0).padStart(7) + 'ms |' +
            (lag12 * 1000).toFixed(0).padStart(8) + 'ms |' +
            (lag12 * 90).toFixed(0).padStart(12) + ' derece');
    }
}
