# AR Direction Plugin

Kat planı güzergâhından hesaplanan yönü, kamera görüntüsü üzerinde oklarla
gösteren bağımsız bir web bileşeni. İki parçadan oluşur:

- **`ar-direction.js`** — `ARDirectionCalculator`: saf matematik. SVG segment
  verisinden yön hesaplar. DOM, UI veya sensör bağımlılığı yoktur.
- **`ar-navigation-ui.js`** — `ARNavigationUI`: kamera, pusula ve ok arayüzü.
  Harici bağımlılığı yoktur, stillerini kendisi enjekte eder.

`ar-navigation-ui.css` opsiyoneldir; yalnızca stilleri özelleştirmek isterseniz
gerekir.

## Hızlı başlangıç

```html
<script src="ar-direction.js"></script>
<script src="ar-navigation-ui.js"></script>
<script>
  const dir = new ARDirectionCalculator({ segments, maxSegments: 5 }).calculate();

  const nav = new ARNavigationUI({
      targetAngle: dir.compassAngle,
      mapNorthOffset: 137,        // mekana özel, aşağıya bakın
      magneticDeclination: 6,     // İstanbul için ~+6°
      tolerance: 12
  });

  // iOS izinleri yalnızca kullanıcı jesti içinde istenebilir
  startButton.addEventListener('click', () => nav.start());
</script>
```

## Kurulum gereksinimleri

Bunlar isteğe bağlı değildir; eksikse bileşen sessizce çalışmaz.

| Gereksinim | Neden |
|---|---|
| HTTPS (secure context) | `getUserMedia` ve hareket sensörleri secure context ister |
| Kullanıcı jesti | iOS'ta `DeviceOrientationEvent.requestPermission()` jest dışında reddedilir |
| iframe izinleri | Aşağıya bakın |

### iframe / WebView içinde kullanım

Sensör izinlerinin varsayılan allowlist'i `'self'`'tir. Bileşen başka bir
origin'den iframe içine gömülüyorsa üç izin de açıkça verilmelidir, aksi halde
`deviceorientationabsolute` olayı **hiç ateşlenmez**:

```html
<iframe src="https://..."
        allow="camera; accelerometer; gyroscope; magnetometer"></iframe>
```

W3C spesifikasyonuna göre `deviceorientationabsolute` için `accelerometer`,
`gyroscope` ve `magnetometer` izinlerinin üçü de gereklidir.

## Mekan kalibrasyonu — atlanamaz adım

`ARDirectionCalculator` **harita çerçevesinde** bir açı üretir: SVG'de yukarı
yön 0° kabul edilir. Kat planları gerçek kuzeye hizalı çizilmez ve incelenen
SVG dosyalarında kuzey referansı bulunmamaktadır. Bu yüzden her mekan için bir
kez ölçüm yapılmalıdır:

1. Mekanda, kat planında yönü net bilinen düz bir koridora geçin.
2. Telefonu koridor boyunca doğrultun, debug panelinden **Pusula** değerini okuyun.
3. `mapNorthOffset = cihazPusulası − haritaAçısı` (0-360 aralığına indirgeyin).
4. Farklı bir koridorda doğrulayın. İki ölçüm 10°'den fazla ayrışıyorsa bina
   içinde manyetik bozulma var demektir (aşağıya bakın).

`magneticDeclination` gerçek kuzey ile manyetik kuzey arasındaki açıdır
(doğuya pozitif); NOAA hesaplayıcısından mekan koordinatıyla alınır.
Cihaz sensörleri manyetik kuzeyi referans alır.

> **Not:** Rota motoru (`map-direction.js`) tarihsel olarak farklı bir kuzey
> tanımı kullanıyordu: `compassAngle = 90 − atan2(dy, dx)`. Bu, bu bileşenin
> kullandığı `atan2(dx, −dy)` ile doğu/batıda aynı, kuzey/güneyde tam ters
> sonuç verir. İki tarafı aynı tanımda birleştirmeden `compassAngle`
> aktarmayın.

## İç mekan manyetik bozulma uyarısı

Bina içindeki çelik konstrüksiyon, donatı, kablolar ve asansörler jeomanyetik
alanı bozar. Literatürde bina içi e-pusula hatası ortalama 45° mertebesinde
raporlanmıştır. Manyetik kuzeye dayanan herhangi bir pusula bazı koridorlarda
yanlış yön gösterecektir; bu bir yazılım hatası değil, yöntemin sınırıdır.

Bileşen bunu gizlemez: kalibrasyon kalitesi izlenir ve `onCalibrationNeeded`
ile bildirilir. Kalıcı çözüm için jiroskop tabanlı göreli takip ve bilinen bir
referansa çapalama gerekir (kapı yönü, QR, veya konum akışı).

## Seçenekler

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `targetAngle` | `0` | Hedef açı, harita çerçevesinde |
| `mapNorthOffset` | `0` | Harita kuzeyinin gerçek kuzeye sapması |
| `magneticDeclination` | `0` | Manyetik sapma, doğuya pozitif |
| `tolerance` | `20` | Hizalanma toleransı (derece) |
| `progressDuration` | `3` | İlerleme halkasının dolma süresi (saniye) |
| `manageCamera` | `true` | `false` ise kamerayı siz yönetirsiniz (A-Frame vb.) |
| `showDebugPanel` | `false` | Alt köşede tanılama paneli |
| `calibrationCheck` | `true` | Kalibrasyon kalitesi izlensin mi |
| `arrowImages` | `null` | Özel ok görselleri; verilmezse gömülü SVG kullanılır |

Geri çağrılar: `onStart`, `onStop`, `onCompleted`, `onPopupDismiss`,
`onCompassUpdate`, `onAligned`, `onMisaligned`, `onError`,
`onCalibrationNeeded`, `onCalibrationImproved`.

## Pusula kaynakları

Bileşen mevcut en güvenilir kaynağı seçer ve tek bir matematikte birleştirir
(kameranın baktığı yönün rotasyon matrisinden hesaplanması):

| Kaynak | Platform | Not |
|---|---|---|
| `AbsoluteOrientationSensor` | Chrome/Android | Quaternion tabanlı, tercih edilen |
| `deviceorientationabsolute` | Chrome/Android | Sensor API devralınca kapatılır |
| `webkitCompassHeading` | iOS Safari | `alpha = 360 − heading` ile normalize edilir |
| `deviceorientation` (fallback) | Android | Son çare; **iOS'ta kullanılmaz** |

iOS'ta `alpha` mutlak değildir (Apple: "keyfi bir yönden ölçülen offset"), bu
yüzden orada fallback'e düşmek yerine hata bildirilir.

`Magnetometer` API'si hiçbir tarayıcıda varsayılan olarak açık olmadığı için
kullanılmaz; iOS'ta bunun yerine `webkitCompassAccuracy` okunur.

## Testler

```bash
node tools/behaviour-check.js     # davranış regresyon testleri
node tools/compass-math-check.js  # pusula matematiği doğrulama raporu
```

`behaviour-check.js` minimal bir DOM taklidi ve kontrol edilebilir bir saat
kurarak heading işleme hattını tarayıcısız test eder.
