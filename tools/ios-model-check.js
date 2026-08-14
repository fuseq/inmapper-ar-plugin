/**
 * iOS heading modeli doğrulaması.
 *
 * 14.08.2026'da iPhone (iOS 26.6, CriOS 151) ile alınan gerçek ölçümleri
 * iki model üzerinden geçirir:
 *
 *   ESKI: alpha = 360 - webkitCompassHeading, sonra rotasyon matrisi
 *   YENI: webkitCompassHeading doğrudan kamera yönü olarak kullanılır
 *
 * Beklenti: eski modelin hatası gamma ile birebir örtüşür, yeni model
 * gerçek yöne yakın kalır.
 *
 * Çalıştırma: node tools/ios-model-check.js
 */

function makeElement() {
    const el = {
        style: {}, textContent: '', innerHTML: '', className: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector: () => makeElement(),
        appendChild: (c) => c, insertBefore: (c) => c,
        removeChild() {}, remove() {}, setAttribute() {},
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        get firstChild() { return null; }
    };
    return el;
}
global.document = { createElement: makeElement, getElementById: () => null,
                    head: makeElement(), body: makeElement() };
global.window = { addEventListener() {}, removeEventListener() {} };
global.getComputedStyle = () => ({ strokeDashoffset: '283' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.navigator = { mediaDevices: null };

const ARNavigationUI = require('../ar-navigation-ui.js');

// Sahadan alınan ham ölçümler (sensor-lab-1786735749023.json)
const MARKS = [
    { truth: 233, alpha: 0.817,   beta: 86.816, gamma: 0.052,  wk: 232.476 },
    { truth: 324, alpha: 328.900, beta: 83.731, gamma: 34.687, wk: 323.365 },
    { truth: 47,  alpha: 339.255, beta: 84.239, gamma: 23.755, wk: 47.916  },
    { truth: 119, alpha: 5.794,   beta: 82.477, gamma: -5.978, wk: 117.722 },
    { truth: 170, alpha: 332.551, beta: 84.655, gamma: 31.062, wk: 173.418 },
    { truth: 280, alpha: 344.293, beta: 76.915, gamma: 18.307, wk: 281.238 }
];

const signed = (a, b) => ((a - b + 180) % 360 + 360) % 360 - 180;
const fmt = (v, w = 8) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°'.padEnd(0);
const pad = (s, w) => String(s).padStart(w);

let pass = true;

console.log('\niOS heading modeli — saha verisiyle doğrulama\n');
console.log('  gamma |  gerçek |  ESKI model  hata |  YENI model  hata');
console.log('  ' + '-'.repeat(62));

const oldErrs = [], newErrs = [], gammaVsErr = [];

for (const m of MARKS) {
    const oldModel = ARNavigationUI._computeHeadingFromRotationMatrix(
        (360 - m.wk) % 360, m.beta, m.gamma).heading;
    const newModel = m.wk;

    const oldErr = signed(oldModel, m.truth);
    const newErr = signed(newModel, m.truth);
    oldErrs.push(oldErr); newErrs.push(newErr);
    gammaVsErr.push({ gamma: m.gamma, err: oldErr });

    console.log(
        `  ${pad(m.gamma.toFixed(1), 5)} | ${pad(m.truth, 6)}° | ` +
        `${pad(oldModel.toFixed(1), 7)}° ${pad(fmt(oldErr), 7)} | ` +
        `${pad(newModel.toFixed(1), 7)}° ${pad(fmt(newErr), 7)}`
    );
}

const absMean = (a) => a.reduce((s, v) => s + Math.abs(v), 0) / a.length;
const oldMean = absMean(oldErrs), newMean = absMean(newErrs);

console.log('  ' + '-'.repeat(62));
console.log(`  Ortalama mutlak hata:  ESKI ${oldMean.toFixed(1)}°   YENI ${newMean.toFixed(1)}°\n`);

// ── Test 1: iki model arasındaki fark gamma'nın kendisi mi? ──
// Gerçek yön elle girildiği için birkaç derece okuma hatası taşıyor.
// Teşhisi insan hatasından arındırmak adına eski model doğrudan sensörün
// kendi değeriyle karşılaştırılır. Beklenen fark tam -gamma'dır; beta 90'dan
// uzaklaştıkça küçük bir sapma kalır (matriste sin(beta) çarpanı).
console.log('Eski model ile sensör değeri arasındaki fark:');
let maxResidual = 0;
for (const m of MARKS) {
    const oldModel = ARNavigationUI._computeHeadingFromRotationMatrix(
        (360 - m.wk) % 360, m.beta, m.gamma).heading;
    const delta = signed(oldModel, m.wk);
    const residual = Math.abs(delta - (-m.gamma));
    maxResidual = Math.max(maxResidual, residual);
    console.log(`  gamma ${pad(m.gamma.toFixed(1), 6)}°  beta ${pad(m.beta.toFixed(1), 5)}°` +
                `  ->  fark ${pad(delta.toFixed(2), 7)}°   artık ${residual.toFixed(2)}°`);
}
if (maxResidual < 2) {
    console.log(`\n  ✓ Fark tam olarak -gamma (en büyük artık ${maxResidual.toFixed(2)}°).`);
    console.log('    Matris, webkitCompassHeading üzerinde gamma\'yı ikinci kez uyguluyordu.');
} else {
    pass = false;
    console.log(`\n  ✗ Örtüşme zayıf (en büyük artık ${maxResidual.toFixed(2)}°) — teşhis eksik.`);
}

// Elle girilen gerçek yönün kendi gürültüsü — eşikleri yorumlarken gerekli
const truthNoise = MARKS.map(m => Math.abs(signed(m.wk, m.truth)));
console.log(`\n  Elle girilen gerçek yönün sensörden sapması: ` +
            `ortalama ${absMean(truthNoise).toFixed(1)}°, en büyük ${Math.max(...truthNoise).toFixed(1)}°`);

// ── Test 2: yeni model kabul edilebilir doğrulukta mı? ──
console.log('');
if (newMean < 5 && newMean < oldMean) {
    console.log(`  ✓ Yeni model ortalama ${newMean.toFixed(1)}° hatayla çalışıyor ` +
                `(eski model ${oldMean.toFixed(1)}°).`);
} else {
    pass = false;
    console.log(`  ✗ Yeni model beklenen doğruluğu vermedi (${newMean.toFixed(1)}°).`);
}

// ── Test 3: güven metriği alpha'dan bağımsız mı? ──
// Düzeltme, güveni alpha=0 ile hesaplıyor; bu ancak izdüşüm büyüklüğü
// alpha'dan bağımsızsa doğru olur.
let confMax = 0;
for (const m of MARKS) {
    const a = ARNavigationUI._computeHeadingFromRotationMatrix(0, m.beta, m.gamma).confidence;
    const b = ARNavigationUI._computeHeadingFromRotationMatrix(
        (360 - m.wk) % 360, m.beta, m.gamma).confidence;
    confMax = Math.max(confMax, Math.abs(a - b));
}
console.log('');
if (confMax < 1e-9) {
    console.log('  ✓ Güven metriği alpha\'dan bağımsız, alpha=0 ile hesaplamak güvenli.');
} else {
    pass = false;
    console.log(`  ✗ Güven alpha'ya bağlı (fark ${confMax}) — düzeltme hatalı.`);
}

console.log('');
process.exit(pass ? 0 : 1);
