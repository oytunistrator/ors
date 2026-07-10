<div align="center">

<img src="media/icon.png" width="120" alt="Örs logosu" />

# Örs — Kodu tavında dövmeye geldik

**Kodun dövüldüğü yer.** Kendi **yerel Ollama** modellerinle çalışan; VSCode içinde
dosya okuyup düzenleyebilen, komut çalıştırabilen, web'de arayabilen, uzak sunuculara
bağlanabilen ve makineni yönetebilen **genel amaçlı agentic asistan.**

_sohbet → araç çağrısı → sonucu gör → devam_ — tamamen senindir:
**ara katman yok, buluta zorlama yok, kilitlenme yok.**

</div>

---

## Ekran Görüntüleri

| Karşılama | Ajan oturumu | Onay kapısı |
|:---:|:---:|:---:|
| ![Karşılama ekranı](media/screenshots/01-welcome.png) | ![Ajan oturumu](media/screenshots/02-session.png) | ![Diff onayı](media/screenshots/03-approval.png) |
| Yerel model + kalıcı hafıza | Oku → düzenle → çalıştır döngüsü, canlı araç kartları | Her yazma diff önizlemesiyle onaya sunulur |

---

## Neden?

### Mevcut araçların sorunu

Piyasadaki popüler AI kodlama uzantıları (Cline, Continue, Copilot vb.) görünürde
yerel modeli "destekler." Ama bu destek çoğunlukla işlevsel değil — ve mesele yalnızca
seni buluta "yönlendirmeleri" de değil. Kalıp daha keskin: yerel mod, gerçekten
kullanılamayacak kadar kötü bırakılıyor. Bu bir tecrübesizlik ya da tekil bir eksiklik
değil; sektörel bir tercih. "Açık kaynak" olduğunu iddia edenler de dahil, bu araçların
gelir modeli bulut API kullanımına bağlı — iyi çalışan bir yerel mod, kendi gelirlerini
yer. Sonuçta yerel mod "destekleniyormuş" gibi yapılır ama çalıştırılamaz halde tutulur;
kutucuk işaretlidir, deneyim kırıktır. Aşağıdakiler o kırıklığın nasıl inşa edildiğidir:

**Bağlam yönetimi bozuk:**
Cline bir istek için projenin tüm dosya ağacını, her açık dosyayı ve geçmiş konuşmayı
context'e doldurur. Bulut modellerinde bu "daha iyi sonuç" gibi görünür çünkü 200K token
penceresi var; yerel bir 7B modelde ise bağlamın büyük kısmı anlamsız gürültüdür, model
yönünü kaybeder ve kaliteli çıktı üretemez. Aynı uzantı GPT-4 ile iyi çalışır, Qwen ile
kötü — fark modelden değil, bağlam tasarımından kaynaklanıyor.

**Tool-calling OpenAI formatına bağlı:**
Çoğu araç tool-calling'i `/v1/chat/completions` OpenAI formatıyla yapar. Ollama'yı
"OpenAI uyumlu" modda kullanmak zorunda kalırsın (`/v1` endpoint), bu proxy katmanı
hataları sessizce yutar, streaming tutarsız çalışır, araç çağrı formatları uyumsuz gelir.
Yerel modelle saatlerce "neden çalışmıyor" diye debug edersin.

**`num_ctx` ayarlanmaz:**
Ollama varsayılan olarak düşük bir bağlam penceresiyle açılır. Araç bunu ayarlamazsa
Ollama sessizce kırpar — model yarım konuşmayla çalışır, hiçbir hata vermez. Cline ve
Continue bunu kullanıcıya bırakır; çoğu kullanıcı neden modelin "salaklık yaptığını"
anlayamaz.

**Onay mekanizması zayıf veya yok:**
Bulut modelleriyle çalışırken "ajan her şeyi otomatik yapsın" mantıklıdır çünkü modelin
kalitesine güvenirsin. Yerel 7B model bazen dosyayı tamamen yanlış içerikle üzerine yazar
ya da yanlış komutu çalıştırır — ama araç bunu önizlemeden direkt uygular. Hatayı ancak
sonra fark edersin.

**"Açık kaynak" ≠ yerel öncelikli:**
Bu araçların bir kısmı gerçekten açık kaynak (Cline, Continue, Aider, Roo Code gibi). Ama
kaynağın açık olması, tasarımın yerel modele göre yapıldığı anlamına gelmiyor. Aynı kalıp
burada da geçerli: mimari en baştan bulut frontier modelleri için kurulmuş,
yerel model sonradan eklenen bir "seçenek." Aider dokümantasyonu bile en iyi sonuç için
frontier modelleri önerir, kendi leaderboard'unu onların üstüne kurar; yerel modeller
listenin dibindedir. Cline'ın forkları (Roo Code vb.) aynı bağlam-doldurma mimarisini
miras alır. Sonuç: kodu okuyabilirsin ama araç yine seni buluta iter. Açık kaynak, kötü
yerel deneyimin mazereti değildir.

**Kilitlenme modeli:**
Cline'ın şirketi (bir bulut API ortağı) ve Continue'nun arkasındaki şirket abonelik veya
API kullanımından para kazanıyor. Yerel model desteği bu şirketlerin asıl gelir modeliyle
çelişiyor. Araç "çalışıyor" ama iyi çalışmıyor; bu da seni sonunda bulut frontier
modellerine yönlendiriyor.

### Örs nasıl farklı

Örs, başından yerel model için tasarlandı. Bulut desteği sonradan "eklenebilir" bir şey
değil; tersine, bulut modelini kullanmak için Örs'ü değiştirmen gerekir.

- **Native Ollama API** (`/api/chat`): proxy yok, format dönüşümü yok, OpenAI uyumu yok.
  Ollama'nın kendi tool-calling protokolüyle doğrudan konuşur.
- **`num_ctx` açıkça gönderilir**: her istekte `options.num_ctx` set edilir, Ollama
  sessizce kırpamaz.
- **Kasıtlı kısıtlı bağlam**: sisteme yalnızca aktif dosya ve seçim eklenir; projenin
  tamamı değil. 7B model için sinyal/gürültü oranı önemlidir.
- **Her yazma ve komut önizlemede**: diff görüntüleyici veya komut metni, onay olmadan
  hiçbir şey uygulanmaz. Modelin hatasını görmeden önce durdurabilirsin.
- **Zayıf model fallback**: model tool-calling'i JSON formatında üretemezse metin içinden
  araç çağrısını çıkaran ayrı bir parser devreye girer. Daha zayıf modeller de çalışır.
- **Sıfır kilitlenme**: MIT lisanslı, kendi makinanda, kendi modelinle, internet bağlantısı
  olmadan çalışır.

---

## Araçlar

| Araç | Açıklama | Onay |
|------|----------|------|
| `read_file` | Dosya okuma (offset/limit ile büyük dosyalar için) | otomatik |
| `write_file` | Dosya oluşturma / üzerine yazma | onay (diff) |
| `edit_file` | Bölüm düzenleme (benzersiz metin eşleşmesi) | onay (diff) |
| `list_dir` | Dizin listeleme | otomatik |
| `search` | Dosyalarda grep | otomatik |
| `glob` | Dosya adı / yol deseni eşleştirme | otomatik |
| `get_diagnostics` | VSCode lint/derleyici hataları ve uyarıları | otomatik |
| `run_command` | Kabuk komutu çalıştırma (PowerShell/sh) | onay |
| `run_in_terminal` | VSCode entegre terminalde görünür komut çalıştırma | onay |
| `start_process` | Arka planda uzun süren süreç başlatma | onay |
| `check_process` | Arka plan sürecinin çıktısını/durumunu okuma | otomatik |
| `stop_process` | Arka plan sürecini durdurma | onay |
| `ssh_run` | Uzak makinede SSH ile komut çalıştırma | onay |
| `web_search` | DuckDuckGo ile web araması (8 sonuç) | otomatik |
| `web_fetch` | Web sayfasını çekip düz metne çevirme | otomatik |
| `describe_image` | Resim dosyasını vision modeliyle oku/açıkla | otomatik |
| `read_pdf` | PDF dosyasından metin çıkarma | otomatik |
| `spawn_agent` | Alt-görevi bağımsız alt-ajanla çalıştırma | onay |
| `connect_mcp` | MCP sunucusuna bağlan | onay |
| `call_mcp_tool` | Bağlı MCP sunucusundaki aracı çağır | onay |
| `schedule_task` | Görev zamanla (cron / delay) | onay |
| `list_scheduled_tasks` | Aktif zamanlanmış görevleri listele | otomatik |
| `cancel_task` | Zamanlanmış görevi iptal et | onay |
| `ask_user` | Ajan döngüsü içinden kullanıcıya yapılandırılmış soru sor | otomatik |
| `manage_memory` | Oturumlar arası kalıcı not ekleme/okuma/silme | otomatik |
| `manage_todos` | Görev listesi yönetimi (panelde görünür) | otomatik |

**Onay politikası** ayarlardan özelleştirilebilir: `ors.autoApprove`, `ors.commandAllowlist`,
`ors.commandDenylist`.

---

## Özellikler

**Agentic döngü**
Oku → araç çağır → sonucu gör → devam. Native tool-calling ve zayıf modeller için
metin-format fallback (JSON onarımı dahil). Tekrarlayan döngüler ve ardışık başarısızlıklar
otomatik tespit edilip durdurulur.

**Plan / Act modu**
Plan modunda ajan yalnızca okuma araçlarına erişir, bir uygulama planı sunar, dosya
değiştirmez. Act modunda planı uygular. Paneldeki ⚡/📋 butonuyla geçiş.

**Görev takibi**
Çok adımlı işlerde ajan `manage_todos` aracıyla canlı yapılacaklar listesi tutar.
Tamamlananlar işaretlenir; panel kenar çubuğunda her zaman görünür.

**Native diff + geri-al**
Dosya değişiklikleri VSCode'un yan-yana diff editöründe onaya sunulur. Panelden tek tıkla
son turun tüm değişiklikleri geri alınır (checkpoint sistemi).

**Bağlam yönetimi**
Uzun sohbette eski kısım LLM ile özetlenerek `num_ctx` sınırı içinde tutulur. Özet
sisteme eklenir; önceki bağlam kaybolmaz, yalnızca sıkıştırılır.

**Editör bağlamı**
Aktif dosya ve seçili kod otomatik eklenir. `@göreli/yol` sözdizimi ile başka dosyaları
bağlama ekleyebilirsin.

**Kalıcı hafıza**
`manage_memory` aracıyla projeler arası notlar saklanır; her oturumun başında sistem
promptuna enjekte edilir. "Bu projede her zaman TypeScript strict modu kullan" gibi
talimatları bir kez yaz, hep hatırlasın.

**Komut güvenliği**
Allowlist'teki güvenli komutlar (`git status`, `ls`, `npm test`…) otomatik çalışır;
denylist'tekiler (`rm`, `git push`, `shutdown`…) her zaman onay ister. Listelerin dışındaki
komutlar varsayılan onay politikasına göre değerlendirilir.

**Arka plan süreçleri**
`start_process` ile `npm run dev`, `docker compose up` gibi uzun süren komutları arka
planda başlatabilirsin. `check_process` ile çıktıyı izlersin, `stop_process` ile durdurursun.

**SSH uzak çalıştırma**
`ssh_run` ile başka makinelerde komut çalıştırabilirsin. Anahtar tabanlı kimlik doğrulama;
şifre istemi yok.

**Web araçları**
Model bilmediği bir kütüphaneyi araştırmak isterse `web_search` ile DuckDuckGo'da arar,
`web_fetch` ile ilgili belge sayfasını çeker ve okur.

**Çoklu Ollama host**
Ayarlar üzerinden ya da komut paletiyle birden fazla Ollama sunucusu ekleyip aralarında
geçiş yapabilirsin. Güçlü bir model için uzaktaki sunucuya, hafif görevler için yerele geçiş.

**Diagnostics**
`get_diagnostics` ile VSCode'un TypeScript/ESLint/Python hata ve uyarılarını doğrudan okur.
Dosyayı kaydetmeden önce derleyici hatalarını görebilir, düzeltebilir.

**Görsel ve PDF**
`describe_image` ile ekran görüntüsü veya şema dosyasını vision modeliyle okur.
`read_pdf` ile düz metin içeren PDF'lerden içerik çıkarır.

**Alt-ajan**
`spawn_agent` ile uzun veya bölünebilir görevleri bağımsız bir alt-ajana devreder;
sonuç ana ajana döner, oturum geçmişi temiz kalır.

**MCP (Model Context Protocol)**
`connect_mcp` ile harici MCP sunucusuna bağlan, `call_mcp_tool` ile araçlarını kullan.
Kendi şirketin veya topluluk MCP sunucularını entegre ederek yetenekleri genişlet.

**Zamanlanmış görevler**
`schedule_task` ile cron ifadesi veya gecikme süresiyle görevler planla.
`list_scheduled_tasks` ile aktif zamanlamaları izle, `cancel_task` ile iptal et.

**Kullanıcıya soru sorma**
`ask_user` ile ajan döngüsü içinden çoklu seçenekli yapılandırılmış soru gönderir.
Kullanıcı seçene kadar ajan bekler; böylece kritik kararlar onaya açılır.

**Slash komutları**
`/test` · `/commit [not]` · `/explain [konu]` · `/fix [sorun]` · `/review [odak]` · `/help`

---

## Kurulum & Geliştirme

```bash
npm install
npm run compile     # geliştirme derlemesi (sourcemap)
npm run watch       # değişiklikleri izle + otomatik yeniden derleme
```

VSCode'da bu klasörü aç ve **F5** → Extension Development Host penceresi açılır.
Sol activity bar'da **Örs** ikonu görünür.

**VSIX paketi oluşturma:**

```bash
npm run package     # ors.vsix üretir
```

Kurulum: VSCode → Extensions → "…" → *Install from VSIX*.

---

## Ön koşul: Ollama

1. [ollama.com](https://ollama.com) üzerinden kur (ya da ağdaki başka bir makinada çalıştır).
2. Tool-calling destekli bir model çek:
   ```bash
   ollama pull qwen2.5-coder:7b
   # veya
   ollama pull qwen3:8b
   ```
3. Sunucuyu başlat: `ollama serve` (varsayılan `http://localhost:11434`).

Ollama başka makinadaysa: **Ayarlar → `ors.baseUrl`** değerini o adrese ayarla
(ör. `http://192.168.1.50:11434`) veya komut paleti üzerinden host ekle.

---

## Ayarlar

| Ayar | Varsayılan | Açıklama |
|------|-----------|----------|
| `ors.baseUrl` | `http://localhost:11434` | Aktif Ollama sunucu adresi |
| `ors.hosts` | `["http://localhost:11434"]` | Kayıtlı host listesi |
| `ors.model` | `""` | Model adı (panelden de seçilir) |
| `ors.temperature` | `0.2` | Örnekleme sıcaklığı |
| `ors.contextWindow` | `65536` | `num_ctx` — her istekte Ollama'ya gönderilir |
| `ors.maxIterations` | `25` | Tek istekte maksimum araç döngüsü |
| `ors.workspaceOnly` | `false` | `true` ise ajan workspace dışına çıkamaz |
| `ors.autoApprove` | read/search/list: `true`; write/command: `false` | Kategori bazlı otomatik onay |
| `ors.commandAllowlist` | `git status`, `ls`, `cat`, `npm test`… | Onaysız çalışacak komut önekleri |
| `ors.commandDenylist` | `rm`, `git push`, `shutdown`… | Her zaman onay isteyen komut önekleri |

**`ors.workspaceOnly` notu (güvenlik):** Varsayılan `false`, yani Örs **genel makine
ajanı** olarak çalışır ve mutlak yol / `..` ile diskin her yerine erişebilir. Bu bilinçli
bir seçimdir (sunucu yönetimi, çok-repo iş akışları). Ajanı yalnızca açık projeyle
sınırlamak istersen `true` yap — o zaman tüm dosya araçları ve `git_run` kök dizin dışına
çıkamaz (symlink kaçışı dahil engellenir). Güvenilmeyen bir modelle veya hassas bir makinede
çalışıyorsan `true` önerilir. Her durumda yazma ve komutlar onay kapısına tabidir.

**`ors.contextWindow` notu:** Ollama varsayılan olarak düşük bir pencereyle başlar ve
aşıldığında sessizce kırpar. Örs varsayılan olarak `65536` gönderir (büyük modeller için).
Bu ayarı modelin gerçekten kaldırabileceği değere set et — bellek/VRAM kısıtı varsa
`32768` veya `16384`'e düşür. Değer ne olursa olsun her istekte `options.num_ctx` olarak
gönderilir, yani Ollama sessizce kırpamaz.

---

## Önerilen modeller

Tool-calling desteği güçlü yerel modeller:

| Model | Boyut | Not |
|-------|-------|-----|
| `qwen2.5-coder:7b` | ~5 GB | Kodlama görevlerinde en kararlı |
| `qwen2.5-coder:14b` | ~10 GB | Daha iyi akıl yürütme, daha fazla RAM gerektirir |
| `qwen3:8b` | ~6 GB | Genel amaçlı, tool-calling güçlü |
| `llama3.1:8b` | ~5 GB | Dengeli; kodlama dışı görevlerde iyi |
| `mistral-small` | ~12 GB | Talimat takibinde güvenilir |

**Dikkat:** `base` modelleri değil, `instruct` veya `coder` varyantlarını kullan. Base
modeller talimat formatını tanımaz, tool çağrıları üretemez.

Küçük bağlam penceresi en yaygın "neden çalışmıyor" sorusunun kaynağıdır — `contextWindow`
ayarını en az `16384` tut (varsayılan `65536`; bellek kısıtı varsa `32768`).

---

## Mimari

```
src/
  llm/        LLMClient arayüzü + OllamaClient (stream + native tool-calling)
  tools/      Tool arayüzü + registry + araçlar + workspace güvenlik hapsi (opsiyonel)
  services/   ProcessManager · MemoryStore · TaskScheduler · MCPClient · ToolStats
  agent/      Ajan döngüsü + sistem promptu + bağlam yönetimi + fallback parser
  webview/    WebviewViewProvider (UI köprüsü) + editör bağlamı + slash + native diff
  shared/     Host↔webview tipli mesaj sözleşmesi
  edit/       Checkpoint sistemi (geri-al)
  extension.ts  composition root — tüm bağımlılıklar burada bağlanır
media/
  main.js     Webview istemci kodu (vanilla JS)
  style.css   VSCode tema değişkenleriyle otomatik tema
```

Her katman yalnızca alttakinin **arayüzüne** bağlıdır. Ollama'yı başka bir sağlayıcıyla
değiştirmek için yalnızca `LLMClient` arayüzünü implemente etmen yeter; agent, tools,
webview hiçbiri değişmez.

---

## Lisans

MIT.

## Simgeler

- Karşılama/wordmark örs simgesi: [Lucide](https://lucide.dev) (ISC).
- Karşılama mascotu ve "çalışıyor" göstergesi (örs+çekiç): "anvil-impact" — Lorc, [game-icons.net](https://game-icons.net), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
