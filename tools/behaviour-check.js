/**
 * ARNavigationUI davranış testleri.
 *
 * Pusula hattı saf fonksiyonlardan oluştuğu için tarayıcı olmadan test
 * edilebilir. Minimal bir DOM taklidi ve kontrol edilebilir bir saat kurup
 * heading işleme hattını doğrudan besliyoruz.
 *
 * Çalıştırma: node tools/behaviour-check.js
 */

// ────────────────────────────────────────────────────────────
//  Minimal DOM taklidi
// ────────────────────────────────────────────────────────────
function makeElement() {
    const el = {
        _classes: new Set(),
        _children: [],
        style: {},
        textContent: '',
        innerHTML: '',
        className: '',
        classList: {
            add: (c) => el._classes.add(c),
            remove: (c) => el._classes.delete(c),
            toggle: (c) => el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c),
            contains: (c) => el._classes.has(c)
        },
        _queried: new Map(),
        querySelector(sel) {
            if (!this._queried.has(sel)) this._queried.set(sel, makeElement());
            return this._queried.get(sel);
        },
        appendChild(c) { el._children.push(c); return c; },
        insertBefore(c) { el._children.unshift(c); return c; },
        removeChild() {},
        remove() {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        get firstChild() { return el._children[0] || null; }
    };
    return el;
}

global.document = {
    createElement: makeElement,
    getElementById: () => null,
    head: makeElement(),
    body: makeElement()
};
// DeviceOrientationEvent'in yalnizca varligi kontrol ediliyor; iOS'a ozgu
// requestPermission ve webkitCompassHeading bilerek yok, boylece test ortami
// Android benzeri davranir.
function DeviceOrientationEventStub() {}
global.DeviceOrientationEvent = DeviceOrientationEventStub;
global.window = {
    addEventListener() {}, removeEventListener() {},
    DeviceOrientationEvent: DeviceOrientationEventStub
};
global.getComputedStyle = () => ({ strokeDashoffset: '283' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.navigator = { mediaDevices: null };

// Kontrol edilebilir saat — zaman pencereli filtreyi deterministik test etmek için
let clock = 1_000_000;
const realNow = Date.now;
Date.now = () => clock;

const ARNavigationUI = require('../ar-navigation-ui.js');

// ────────────────────────────────────────────────────────────
//  Test altyapısı
// ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, condition, detail) {
    if (condition) {
        passed++;
        console.log('  PASS  ' + name);
    } else {
        failed++;
        console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
    }
}
function section(t) { console.log('\n' + t); console.log('-'.repeat(t.length)); }

const angDiff = (a, b) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);

function makeNav(opts = {}) {
    const nav = new ARNavigationUI(Object.assign({ showDebugPanel: false }, opts));
    nav._running = true;
    nav._compassReady = true;
    return nav;
}

/** Belirli bir örnekleme hızında heading akışı besler */
function feed(nav, headings, hz, confidence = 1) {
    const stepMs = 1000 / hz;
    for (const h of headings) {
        clock += stepMs;
        nav._handleCompass(((h % 360) + 360) % 360, 90, confidence);
    }
}

// ────────────────────────────────────────────────────────────
section('1. Harita cercevesi -> pusula cercevesi donusumu');
// ────────────────────────────────────────────────────────────
{
    const nav = makeNav({ targetAngle: 10, mapNorthOffset: 30, magneticDeclination: 6 });
    check('effectiveTargetAngle = target + mapNorthOffset - declination',
        Math.abs(nav.effectiveTargetAngle - 34) < 1e-9,
        'beklenen 34, gelen ' + nav.effectiveTargetAngle);

    const wrap = makeNav({ targetAngle: 350, mapNorthOffset: 30, magneticDeclination: 0 });
    check('360 gecisinde sarma dogru',
        Math.abs(wrap.effectiveTargetAngle - 20) < 1e-9,
        'beklenen 20, gelen ' + wrap.effectiveTargetAngle);
}

// ────────────────────────────────────────────────────────────
section('2. Hizalanma efektif hedefe gore yapiliyor');
// ────────────────────────────────────────────────────────────
{
    const nav = makeNav({ targetAngle: 0, mapNorthOffset: 90, tolerance: 10 });
    feed(nav, Array(20).fill(90), 30);
    check('harita 0 + offset 90 iken cihaz 90 gosterirken hizali', nav.isAligned === true);

    const nav2 = makeNav({ targetAngle: 0, mapNorthOffset: 90, tolerance: 10 });
    feed(nav2, Array(20).fill(0), 30);
    check('ayni kurulumda cihaz 0 gosterirken hizali degil', nav2.isAligned === false);
}

// ────────────────────────────────────────────────────────────
section('3. Dusuk guvenli okumalar heading i bozmuyor');
// ────────────────────────────────────────────────────────────
{
    const nav = makeNav({ targetAngle: 0 });
    feed(nav, Array(20).fill(45), 30, 1.0);
    const stable = nav.currentHeading;
    check('once kararli heading olustu', angDiff(stable, 45) < 2,
        'heading ' + stable.toFixed(1));

    // Kamera zemine dogrulmus: guven cok dusuk, heading anlamsiz savruluyor
    feed(nav, [200, 350, 80, 260], 30, 0.05);
    check('guven esiginin altinda heading korunuyor', angDiff(nav.currentHeading, stable) < 1e-9,
        'heading ' + nav.currentHeading.toFixed(1) + ' (onceki ' + stable.toFixed(1) + ')');
    check('kullaniciya ipucu gosteriliyor', nav._hintText !== null,
        'hint: ' + nav._hintText);
}

// ────────────────────────────────────────────────────────────
section('4. Sicrama reddi: tek seferlik gurultu vs gercek donus');
// ────────────────────────────────────────────────────────────
{
    const nav = makeNav({ targetAngle: 0 });
    feed(nav, Array(20).fill(100), 30);
    const before = nav.currentHeading;

    // Tek karelik 150 derecelik sicrama — fiziksel olarak imkansiz
    feed(nav, [250], 30);
    check('tek seferlik sicrama reddedildi', angDiff(nav.currentHeading, before) < 3,
        'heading ' + nav.currentHeading.toFixed(1));

    // Ayni yon israr ederse gercek hareket kabul edilmeli
    feed(nav, Array(20).fill(250), 30);
    check('israr eden yon degisikligi kabul edildi', angDiff(nav.currentHeading, 250) < 10,
        'heading ' + nav.currentHeading.toFixed(1));
}

// ────────────────────────────────────────────────────────────
section('5. Filtre gecikmesi ornekleme hizindan bagimsiz');
// ────────────────────────────────────────────────────────────
{
    // 90 derece/s hizla 90 derecelik donus, iki farkli ornekleme hizinda.
    // Yakinsama suresi (ms) benzer olmali.
    function convergenceMs(hz) {
        const nav = makeNav({ targetAngle: 0 });
        feed(nav, Array(40).fill(0), hz);
        const start = clock;
        const stepMs = 1000 / hz;
        const rate = 90; // derece/saniye
        let t = 0, converged = null;
        while (t < 4000) {
            t += stepMs;
            clock += stepMs;
            const truth = Math.min(90, rate * (t / 1000));
            nav._handleCompass(truth, 90, 1);
            if (truth >= 90 && converged === null && angDiff(nav.currentHeading, 90) < 5) {
                converged = clock - start - 1000; // donus 1s surdu
            }
        }
        return converged;
    }
    const at60 = convergenceMs(60);
    const at15 = convergenceMs(15);
    console.log('    60Hz yakinsama: ' + at60 + 'ms, 15Hz yakinsama: ' + at15 + 'ms');
    check('iki hizda gecikme farki 120ms den az', Math.abs(at60 - at15) < 120,
        '60Hz ' + at60 + 'ms vs 15Hz ' + at15 + 'ms');
    check('gecikme her iki hizda da 250ms altinda', at60 < 250 && at15 < 250);
}

// ────────────────────────────────────────────────────────────
section('6. Kullanici donusu sahte POOR kalibrasyon uretmiyor');
// ────────────────────────────────────────────────────────────
{
    // 15Hz de 30 derece/s donus — eski kodda bu kesin POOR uretiyordu
    const nav = makeNav({ targetAngle: 0 });
    const headings = [];
    for (let i = 0; i < 200; i++) headings.push(i * (30 / 15));
    feed(nav, headings, 15);
    check('surekli donuste kalibrasyon POOR degil',
        nav.calibrationQuality !== 'poor',
        'quality: ' + nav.calibrationQuality);

    // Duragan ve temiz veri -> GOOD
    const nav2 = makeNav({ targetAngle: 0 });
    const still = [];
    for (let i = 0; i < 200; i++) still.push(70 + Math.sin(i) * 0.5);
    feed(nav2, still, 15);
    clock += 2500;
    feed(nav2, still, 15);
    check('duragan temiz veride kalibrasyon GOOD',
        nav2.calibrationQuality === 'good',
        'quality: ' + nav2.calibrationQuality);
}

// ────────────────────────────────────────────────────────────
section('7. Heading formulu: kamera ekseni ve guven degeri');
// ────────────────────────────────────────────────────────────
{
    const upright = ARNavigationUI._computeHeadingFromRotationMatrix(0, 90, 0);
    check('dik telefon, alpha=0 -> kuzey', angDiff(upright.heading, 0) < 1e-9,
        'heading ' + upright.heading);
    check('dik telefonda guven 1', Math.abs(upright.confidence - 1) < 1e-9,
        'confidence ' + upright.confidence);

    const flat = ARNavigationUI._computeHeadingFromRotationMatrix(30, 0, 0);
    check('yatay telefonda guven 0 (heading tanimsiz)', flat.confidence < 1e-9,
        'confidence ' + flat.confidence);

    // Ekran yonunden bagimsizlik: kamera ekseni etrafinda dondurunce heading sabit
    const a = ARNavigationUI._computeHeadingFromRotationMatrix(90, 0, -90);
    check('yatay moda cevrilince heading korunuyor', angDiff(a.heading, 0) < 1e-6,
        'heading ' + a.heading);
}

// ────────────────────────────────────────────────────────────
section('8. ARDirectionCalculator: yon, duzluk ve kose tespiti');
// ────────────────────────────────────────────────────────────
{
    const ARDirectionCalculator = require('../ar-direction.js');

    // SVG de yukari = kuzey (y asagi dogru artar)
    const north = new ARDirectionCalculator({
        segments: [{ x1: 0, y1: 100, x2: 0, y2: 0 }]
    }).calculate();
    check('SVG de yukari giden guzergah kuzey (0 derece)',
        angDiff(north.compassAngle, 0) < 1e-9, 'gelen ' + north.compassAngle);

    const east = new ARDirectionCalculator({
        segments: [{ x1: 0, y1: 0, x2: 100, y2: 0 }]
    }).calculate();
    check('saga giden guzergah dogu (90 derece)',
        angDiff(east.compassAngle, 90) < 1e-9, 'gelen ' + east.compassAngle);

    // Duz koridor: birden fazla esdogrusal segment
    const straight = new ARDirectionCalculator({
        segments: [
            { x1: 0, y1: 300, x2: 0, y2: 200 },
            { x1: 0, y1: 200, x2: 0, y2: 100 },
            { x1: 0, y1: 100, x2: 0, y2: 0 }
        ]
    }).calculate();
    check('duz koridorda duzluk 1', Math.abs(straight.straightness - 1) < 1e-9,
        'straightness ' + straight.straightness);
    check('duz koridorda tum segmentler kullanildi', straight.segmentsUsed === 3);
    check('duz koridorda kose yok', straight.turnAhead === null);

    // L seklinde guzergah: once kuzeye, sonra doguya keskin donus
    const corner = new ARDirectionCalculator({
        segments: [
            { x1: 0, y1: 200, x2: 0, y2: 100 },
            { x1: 0, y1: 100, x2: 0, y2: 0 },
            { x1: 0, y1: 0, x2: 100, y2: 0 },
            { x1: 100, y1: 0, x2: 200, y2: 0 }
        ]
    }).calculate();
    check('kosede duruldu, sadece ilk bacak kullanildi', corner.segmentsUsed === 2,
        'segmentsUsed ' + corner.segmentsUsed);
    check('gosterilen yon ilk bacagin yonu (kuzey)',
        angDiff(corner.compassAngle, 0) < 1e-9, 'gelen ' + corner.compassAngle);
    check('sonraki donus saga olarak bildirildi',
        corner.turnAhead && corner.turnAhead.relative === 'right',
        'turnAhead ' + JSON.stringify(corner.turnAhead));

    // Eski davranis kiyasi: bastan sona duz kiris L yi ortalayip 45 derece verirdi
    const chord = (() => {
        const dx = 200 - 0, dy = 0 - 200;
        return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    })();
    check('eski kiris yontemi kosede yaniltici olurdu (45 derece)',
        angDiff(chord, 45) < 1e-9 && angDiff(corner.compassAngle, chord) > 40,
        'kiris ' + chord.toFixed(1) + ' vs yeni ' + corner.compassAngle.toFixed(1));
}

// ────────────────────────────────────────────────────────────
section('9. Esik civarinda salinan iOS dogrulugu durumu titretmiyor');
// ────────────────────────────────────────────────────────────
{
    // Saha olcumu: saglikli iPhone acik havada surekli ~12 bildiriyor ve
    // o anda gercek hata 1.3 derece. Bu deger FAIR sayilmamali.
    const nav = makeNav({ targetAngle: 0 });
    let degraded = 0, improved = 0;
    nav.onCalibrationNeeded = () => degraded++;
    nav.onCalibrationImproved = () => improved++;

    const still = [];
    for (let i = 0; i < 40; i++) still.push(70 + Math.sin(i) * 0.5);

    // accuracy 11.9 ile 12.3 arasinda salinirken 10 degerlendirme turu
    for (let round = 0; round < 10; round++) {
        nav._recordIOSAccuracy(round % 2 === 0 ? 11.9 : 12.3);
        feed(nav, still, 15);
        clock += 2500;
        feed(nav, still, 15);
    }

    check('normal iPhone dogrulugu (~12) GOOD sayiliyor',
        nav.calibrationQuality === 'good', 'quality: ' + nav.calibrationQuality);
    check('esik civarinda salinim uyari yagmuru uretmiyor',
        degraded === 0, 'degraded cagrisi: ' + degraded);

    // Gercekten bozuk sensor hala yakalanmali
    const bad = makeNav({ targetAngle: 0 });
    let badDegraded = 0;
    bad.onCalibrationNeeded = () => badDegraded++;
    for (let round = 0; round < 6; round++) {
        bad._recordIOSAccuracy(-1);   // negatif = kalibre degil
        feed(bad, still, 15);
        clock += 2500;
        feed(bad, still, 15);
    }
    check('kalibre olmamis sensor POOR olarak bildiriliyor',
        bad.calibrationQuality === 'poor', 'quality: ' + bad.calibrationQuality);
    check('gercek bozulma kullaniciya haber veriliyor', badDegraded > 0,
        'degraded cagrisi: ' + badDegraded);
}

// ────────────────────────────────────────────────────────────
section('10. Jiroskop capasi');
// ────────────────────────────────────────────────────────────
{
    // Goreli akisi taklit et: capa kurulmadan once referans olusmali
    function feedRelative(nav, alpha, beta = 90, gamma = 0) {
        clock += 33;
        nav._relOrient({ absolute: false, alpha, beta, gamma });
    }

    // Capa kurulmadan once
    {
        const nav = makeNav({ targetAngle: 0 });
        nav._startCompass();
        check('goreli akis gelmeden capa kurulamaz', nav.setAnchor(90) === false);
        check('capa yokken cerceve manyetik', nav.headingFrame === 'magnetic');
    }

    // Capa kurulumu ve takip
    {
        const nav = makeNav({ targetAngle: 40 });
        nav._startCompass();

        // Cihaz keyfi bir goreli yonde duruyor
        feedRelative(nav, 200);
        check('goreli akis hazir', nav.canAnchor === true);

        // Kullanici kapinin baktigi yone (harita cercevesinde 40) hizalanip capayi kurar
        check('capa kuruldu', nav.setAnchor(40) === true);
        check('capa sonrasi cerceve harita', nav.headingFrame === 'map');
        check('capa aninda heading tam hedef',
            angDiff(nav.currentHeading, 40) < 1e-9, 'heading ' + nav.currentHeading);
        check('capa kuruluyken hizali', nav.isAligned === true);

        // Cihaz 30 derece saga doner -> goreli alpha ters yonde artar.
        // Donus bitince filtrenin oturmasi icin birkac ornek daha beslenir;
        // aksi halde olculen fark sensorun degil yumusatma gecikmesinin olur.
        for (let i = 0; i < 30; i++) feedRelative(nav, 200 - (i + 1));
        for (let i = 0; i < 10; i++) feedRelative(nav, 170);
        check('jiroskop donusu harita cercevesinde takip ediliyor',
            angDiff(nav.currentHeading, 70) < 0.5, 'heading ' + nav.currentHeading);

        // Geri donunce eski degere oturmali
        for (let i = 29; i >= 0; i--) feedRelative(nav, 200 - i);
        for (let i = 0; i < 10; i++) feedRelative(nav, 200);
        check('geri donuste heading geri geliyor',
            angDiff(nav.currentHeading, 40) < 0.5, 'heading ' + nav.currentHeading);
    }

    // Pusula yeniden baslatilinca capa gecersiz olmali
    {
        const nav = makeNav({ targetAngle: 0 });
        nav._startCompass();
        feedRelative(nav, 50);
        nav.setAnchor(0);
        check('capa kurulu', nav.isAnchored === true);

        nav._stopCompass();
        check('pusula durunca capa dusuyor', nav.isAnchored === false);

        // Jiroskopun keyfi referansi degismis olabilir; eski offset kullanilmamali
        nav._startCompass();
        feedRelative(nav, 300);
        check('yeniden baslatmada cerceve manyetige donuyor',
            nav.headingFrame === 'magnetic');
    }

    // Manyetik bozulma capayi etkilememeli
    {
        const nav = makeNav({ targetAngle: 0 });
        nav._startCompass();
        feedRelative(nav, 100);
        nav.setAnchor(0);

        // Pusula tamamen sacmaliyor (kapali mekan celik yapi)
        for (let i = 0; i < 50; i++) {
            clock += 33;
            nav._handleCompass((i * 37) % 360, 90, 1);
        }
        check('manyetik bozulma capali heading i kaydirmiyor',
            angDiff(nav.currentHeading, 0) < 1e-9, 'heading ' + nav.currentHeading);
    }

    // Cerceve ayrimi: capa varken offsetler uygulanmamali
    {
        const nav = makeNav({ targetAngle: 10, mapNorthOffset: 30, magneticDeclination: 6 });
        check('capa yokken hedef manyetik cerceveye tasiniyor',
            Math.abs(nav.effectiveTargetAngle - 34) < 1e-9, 'gelen ' + nav.effectiveTargetAngle);

        nav._startCompass();
        feedRelative(nav, 0);
        nav.setAnchor(0);
        check('capa varken hedef ham harita acisi kaliyor',
            Math.abs(nav.effectiveTargetAngle - 10) < 1e-9, 'gelen ' + nav.effectiveTargetAngle);

        nav.clearAnchor();
        check('capa kaldirilinca offsetler geri geliyor',
            Math.abs(nav.effectiveTargetAngle - 34) < 1e-9, 'gelen ' + nav.effectiveTargetAngle);
    }

    // Kayma duzeltmesi: varsayilan kapali, acikken sinirli hizda
    {
        const nav = makeNav({ targetAngle: 0 });
        nav._startCompass();
        feedRelative(nav, 0);
        nav.setAnchor(0);
        const before = nav._anchor.offset;
        for (let i = 0; i < 100; i++) {
            clock += 33;
            nav._handleCompass(90, 90, 1);
        }
        check('kayma duzeltmesi varsayilan kapali',
            Math.abs(nav._anchor.offset - before) < 1e-9);

        const nav2 = makeNav({ targetAngle: 0, anchorDriftCorrection: true, anchorDriftRateDps: 1 });
        nav2._startCompass();
        feedRelative(nav2, 0);
        nav2.setAnchor(0);
        nav2._calibration.quality = 'good';
        const start = clock;
        for (let i = 0; i < 100; i++) {
            clock += 33;
            nav2._handleCompass(90, 90, 1);
        }
        const elapsedSec = (clock - start) / 1000;
        const moved = Math.abs(((nav2._anchor.offset + 180) % 360 + 360) % 360 - 180);
        check('kayma duzeltmesi acikken calisiyor', moved > 0.5, 'kayma ' + moved.toFixed(2));
        check('kayma duzeltmesi hiz sinirini asmiyor',
            moved <= elapsedSec * 1 + 1e-6,
            'kayma ' + moved.toFixed(2) + ' vs limit ' + elapsedSec.toFixed(2));
    }
}

// ────────────────────────────────────────────────────────────
section('11. Kapi cizgisinden capa acisi');
// ────────────────────────────────────────────────────────────
{
    const ARDirectionCalculator = require('../ar-direction.js');

    // Yatay kapi cizgisi; koridor yukarida (SVG de y kucuk = yukari = kuzey)
    const door = { x1: 0, y1: 100, x2: 50, y2: 100 };
    check('kapi normali koridora dogru bakiyor (kuzey)',
        angDiff(ARDirectionCalculator.doorFacing(door, [25, 0]), 0) < 1e-9,
        'gelen ' + ARDirectionCalculator.doorFacing(door, [25, 0]));
    check('koridor diger tarafta ise normal ters cevriliyor (guney)',
        angDiff(ARDirectionCalculator.doorFacing(door, [25, 200]), 180) < 1e-9,
        'gelen ' + ARDirectionCalculator.doorFacing(door, [25, 200]));

    // Dikey kapi cizgisi; koridor sagda = dogu
    const vertical = { x1: 100, y1: 0, x2: 100, y2: 50 };
    check('dikey kapida normal dogu',
        angDiff(ARDirectionCalculator.doorFacing(vertical, [200, 25]), 90) < 1e-9,
        'gelen ' + ARDirectionCalculator.doorFacing(vertical, [200, 25]));

    // Dejenere durumlar
    check('sifir uzunluklu kapi null donuyor',
        ARDirectionCalculator.doorFacing({ x1: 5, y1: 5, x2: 5, y2: 5 }, [10, 10]) === null);
    check('nokta kapi cizgisi uzerindeyse null donuyor',
        ARDirectionCalculator.doorFacing(door, [10, 100]) === null);
}

// ────────────────────────────────────────────────────────────
Date.now = realNow;
console.log('\n' + '='.repeat(50));
console.log(`Sonuc: ${passed} basarili, ${failed} basarisiz`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
