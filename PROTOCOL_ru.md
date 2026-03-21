# $Proto — Спецификация Svyaz Wire Protocol

**Версия:** 1.0.0  
**Статус:** Production  
**Транспорт:** libp2p (TCP + QUIC-v1, Noise/TLS 1.3)  
**Кодирование:** JSON + двоичный формат с префиксом длины

---

## 1. Обзор

$Proto — гибридный p2p‑протокол обмена сообщениями поверх libp2p.
Он сочетает прямую связь «устройство‑устройство» с доставкой через релей‑сервер
по модели store‑and‑forward для офлайн‑получателей. Вся идентичность пиров
основана на парах ключей Ed25519; хэш публичного ключа (multihash) служит
глобально уникальным Peer ID.

```
┌─────────┐      libp2p stream       ┌─────────┐
│ Client A ├─────────────────────────►│ Client B │  (direct / relayed)
└────┬─────┘                          └─────────┘
     │  libp2p stream
     ▼
┌─────────┐
│  Relay   │   store-and-forward, file storage,
│  Server  │   push notifications, OPRF, SMS
└─────────┘
```

**Принципы дизайна:**

- **Без аккаунтов.** Идентичность = пара ключей Ed25519, генерируемая на устройстве.
- **E2E‑шифрование по умолчанию.** Сообщения 1‑на‑1 запечатываются NaCl Box до сохранения на реле.
- **Реле ничего не видит.** Зашифрованная полезная нагрузка — непрозрачный blob; реле хранит/пересылает без расшифровки.
- **Fan‑out на стороне клиента → fan‑out на стороне реле.** Групповые сообщения отправляются на реле один раз со списком получателей; реле размножает по получателям.
- **Транспорт‑агностичность.** Протокол работает поверх любого транспорта libp2p (TCP, QUIC-v1, WebSocket, WebTransport, WebRTC).

---

## 2. Идентичность и криптография

### 2.1 Генерация ключей

Каждое устройство генерирует пару ключей **Ed25519** при первом запуске. Приватный
ключ сохраняется локально (`identity.key`). Peer ID выводится из публичного ключа
с использованием libp2p multihash identity scheme:

```
PeerID = multihash(Ed25519PublicKey)
Example: 12D3KooWAphJWXzb5iaWzyVSxrHKaB2ZzNNGKLREJNhvsJg6g3NM
```

### 2.2 Шифрование транспорта

Все соединения libp2p шифруются на транспортном уровне с использованием одного из:

| Протокол | Шифр | Обмен ключами |
|----------|------|---------------|
| Noise XX | ChaChaPoly | X25519 ECDH |
| TLS 1.3 | AES-256-GCM | X25519 ECDH |

Протокол выбирается автоматически; взаимная аутентификация выполняется через
ключ идентичности Ed25519, встроенный в handshake.

### 2.3 Шифрование на уровне сообщения (NaCl Box)

Для хранения офлайн‑сообщений на реле $Proto применяет дополнительный слой
end‑to‑end шифрования с использованием **NaCl Box** (X25519 + XSalsa20-Poly1305):

```
1. Convert Ed25519 keys → X25519 (RFC 7748 clamping)
2. Generate random 24-byte nonce
3. Encrypt: ciphertext = NaCl.Box.Seal(plaintext, nonce, recipientX25519Pub, senderX25519Priv)
4. Wire format: nonce(24) || ciphertext(N + 16)
```

Реле хранит этот непрозрачный blob и не может его расшифровать.

### 2.4 Шифрование локального хранилища

История чатов на клиенте хранится в базе **SQLCipher**
(AES-256-CBC, полностраничное шифрование). 256‑битный ключ базы хранится
в платформенных аппаратно‑защищённых хранилищах ключей:

| Платформа | Хранилище | Аппаратная защита |
|----------|-----------|-------------------|
| iOS | Keychain (Secure Enclave) | SEP |
| Android | EncryptedSharedPreferences (Android Keystore) | Titan M / StrongBox |

---

## 3. Сетевая архитектура

### 3.1 Транспорты

Клиенты одновременно слушают на всех доступных транспортах:

```
/ip4/0.0.0.0/tcp/0
/ip4/0.0.0.0/udp/0/quic-v1
/ip6/::/tcp/0
/ip6/::/udp/0/quic-v1
```

Релей‑сервер дополнительно поддерживает тот же стек с
`ForceReachabilityPublic` и `NullResourceManager` для неограниченного числа
соединений.

### 3.2 Релейный канал (Relay Circuit)

Клиенты за NAT используют протокол **libp2p Circuit Relay v2** для поддержания
доступности:

```
Client A ──► Relay ◄── Client B
              │
         p2p-circuit
```

Каждый клиент периодически резервирует слот на реле (каждые 60 секунд).
Формат адреса реле:

```
/ip4/<RELAY_IP>/udp/8443/quic-v1/p2p/<RELAY_PEER_ID>/p2p-circuit/p2p/<CLIENT_PEER_ID>
```

### 3.3 Обнаружение пиров

- **Bootstrap:** захардкоженные адреса реле как стартовые bootstrap‑ноды.
- **Kademlia DHT:** `ModeAutoServer` для распределённого обнаружения пиров.
- **Ручное подключение:** Peer ID или multiaddr для добавления контактов.
- **Поиск контактов через OPRF:** приватное сопоставление по телефону (см. §7).

### 3.4 Жизненный цикл соединения

```
App Launch → Load identity.key → Create libp2p Host
           → Connect to bootstrap relay(s)
           → Reserve Circuit Relay slot
           → Bootstrap Kademlia DHT
           → Sync VoIP push token
           → Retrieve stored offline messages
           → Enter steady state (relay renewal every 60s)

App Background → Close all connections (relay marks peer offline)
App Foreground → Reconnect + re-reserve relay slot
```

---

## 4. Идентификаторы протоколов

Все протоколы $Proto находятся в пространстве имён `/Svyaz/` и версионируются семантически:

### 4.1 Клиент ↔ Клиент (прямое соединение)

| Protocol ID | Назначение |
|---|---|
| `/Svyaz/messaging/1.0.0` | Текст, изображение, реакция, удаление, статусы, метаданные групп |
| `/Svyaz/call/1.0.0` | Сигналинг VoIP‑звонка + аудио‑поток |

### 4.2 Клиент → Реле (сервисы)

| Protocol ID | Назначение |
|---|---|
| `/Svyaz/store/1.0.0` | Сохранить зашифрованное сообщение для офлайн‑получателя |
| `/Svyaz/store-multi/1.0.0` | Сохранить сообщение для нескольких получателей (group fan‑out) |
| `/Svyaz/retrieve/1.0.0` | Получить сохранённые сообщения |
| `/Svyaz/file-upload/1.0.0` | Загрузить файл для одного получателя |
| `/Svyaz/file-upload-multi/1.0.0` | Загрузить файл для нескольких получателей |
| `/Svyaz/file-download/1.0.0` | Скачать сохранённый файл |
| `/Svyaz/push-notify/1.0.0` | Запросить push‑уведомление офлайн‑пиру |
| `/Svyaz/voip-token/1.0.0` | Зарегистрировать VoIP push‑токен APNs/FCM |
| `/Svyaz/phone-verify-request/1.0.0` | Запросить SMS OTP |
| `/Svyaz/phone-verify-confirm/1.0.0` | Подтвердить OTP и зарегистрировать phone token |
| `/Svyaz/phone-oprf-evaluate/1.0.0` | Серверная оценка OPRF |
| `/Svyaz/phone-lookup/1.0.0` | Поиск phone tokens → Peer IDs |

---

## 5. Протокол обмена сообщениями

### 5.1 Wire format

Сообщения кодируются в JSON и передаются одной записью в однонаправленный
libp2p‑stream (макс. 4 MB):

```json
{
  "id":        "1709312345-12D3KooW",
  "from":      "<sender_peer_id>",
  "to":        "<recipient_peer_id>",
  "content":   "<payload>",
  "timestamp": 1709312345,
  "type":      "text"
}
```

### 5.2 Типы сообщений

| Type | Формат content | Хранится на реле |
|---|---|---|
| `text` | Текст | Да |
| `image` | Base64‑JPEG/PNG | Да |
| `file_offer` | `<transfer_id>\|<filename>\|<size>` | Да |
| `file_progress` | `<transfer_id>\|<name>\|<progress>\|<bytes>\|<total>\|<direction>` | Нет |
| `file_complete` | `<transfer_id>\|<name>\|<path>\|<size>` | Нет |
| `file_error` | `<transfer_id>\|<name>\|error\|<reason>` | Нет |
| `reaction` | `<message_id>\|<emoji>` | Да |
| `delete` | `<message_id>` | Да |
| `group_meta` | `<group_id>\|<group_name>\|<member1,member2,...>` | Да |
| `group_delete` | `<group_id>` | Да |
| `delivery_receipt` | `<original_message_id>` | Нет |
| `read_receipt` | `<message_id>` | Да |
| `ping` | (пусто) | Нет |

### 5.3 Доставка

```
Sender                          Recipient
  │                                 │
  ├── Open stream ────────────────►│
  ├── Write JSON message ─────────►│
  │                                 ├── Parse message
  │                                 ├── Emit to UI
  │◄── delivery_receipt ───────────┤
  │                                 │
```

**Fallback для офлайна:**

```
Sender                    Relay                   Recipient (offline)
  │                         │                          │
  ├── stream fails ──X      │                          │
  ├── NaCl.Seal(msg) ──────►│                          │
  │   /store/1.0.0          ├── BoltDB persist         │
  ├── push-notify ─────────►│                          │
  │                         ├── OneSignal push ───────►│ (wakes app)
  │                         │                          ├── Connect to relay
  │                         │◄── /retrieve/1.0.0 ─────┤
  │                         ├── Return sealed msgs ───►│
  │                         │                          ├── NaCl.Open(sealed)
  │                         │                          ├── Process messages
```

### 5.4 Групповые сообщения

Групповые сообщения используют модель **relay fan‑out**. Отправитель передаёт одну
полезную нагрузку со списком Peer ID получателей; реле размножает её
по получателям:

```
Sender → /store-multi/1.0.0 → Relay
                                 ├── Store for Peer B
                                 ├── Store for Peer C
                                 ├── Push notify offline peers
```

Контент групповых сообщений имеет префикс `[group:<group_id>]`, чтобы клиент мог
маршрутизировать сообщения в правильную беседу:

```
Content: [group:abc123]Hello everyone!
```

### 5.5 Лимиты хранения на реле

| Параметр | Значение |
|---|---|
| Максимум сообщений на пира | 1,000 |
| TTL сообщения | 30 дней |
| Максимальный размер payload | 4 MB |
| Интервал очистки | 1 час |

---

## 6. Протокол передачи файлов

$Proto использует модель передачи файлов через реле для надёжности и доставки
офлайн‑получателям.

### 6.1 Upload (один получатель)

```
Client                           Relay
  │                                │
  ├── Open /file-upload/1.0.0 ────►│
  ├── [4B header_len][JSON header]►│  {"transfer_id", "file_name", "file_size", "to"}
  │◄── [4B ACK = 1] ──────────────┤
  ├── [binary file data] ─────────►│  (streamed, 256KB chunks, 1MB buffer)
  ├── CloseWrite ─────────────────►│
  │◄── {"status": "stored"} ──────┤
  │                                │
  ├── Send file_offer message ────►│  (direct or via /store/1.0.0)
```

### 6.2 Upload (несколько получателей)

```
/file-upload-multi/1.0.0

Header: {"transfer_id", "file_name", "file_size", "recipients": ["peer1", "peer2", ...]}

File is stored once on disk; relay creates per-recipient metadata entries
with IDs: "<base_transfer_id>-<peer_prefix_8chars>"
```

### 6.3 Download

```
Client                           Relay
  │                                │
  ├── Open /file-download/1.0.0 ──►│
  ├── [4B req_len][JSON] ─────────►│  {"transfer_id": "..."}
  │◄── [4B hdr_len][JSON header] ──┤  {"status", "transfer_id", "file_name", "file_size", "from"}
  │◄── [binary file data] ─────────┤  (streamed)
  │                                ├── Delete file from store
```

### 6.4 Лимиты файлового хранилища

| Параметр | Значение |
|---|---|
| Максимальный размер файла | 1 GB |
| TTL файла | 7 дней |
| Размер буфера | 4 MB |

---

## 7. Протокол VoIP‑звонков

### 7.1 Сигналинг звонка

Звонки используют отдельный libp2p‑stream (`/Svyaz/call/1.0.0`) и для сигналинга,
и для аудио в рамках одного постоянного соединения:

```
Caller                                     Callee
  │                                          │
  ├── Open stream ──────────────────────────►│
  ├── [0x01] Call Offer ────────────────────►│
  │                                          ├── Ring / Show UI
  │◄── [0x02] Accept ──────────────────────-┤
  │          (or [0x04] Busy)                │
  │                                          │
  ├════ Bidirectional Audio Stream ═════════►│
  │◄═════════════════════════════════════════┤
  │                                          │
  ├── [0x03] Hangup ────────────────────────►│
```

### 7.2 Байты сигналинга

| Byte | Значение |
|------|----------|
| `0x01` | Предложение звонка (инициатор → получатель) |
| `0x02` | Звонок принят |
| `0x03` | Завершение |
| `0x04` | Занято (уже в звонке) |
| `0xFE` | Маркер синхронизации аудио‑кадра |

### 7.3 Формат аудио‑кадра

Аудио передаётся как Opus‑закодированные кадры с простым протоколом фрейминга:

```
┌──────┬────────┬────────────────┐
│ 0xFE │ Len(2) │ Opus Data (N)  │
│ sync │ BE u16 │ raw opus frame │
└──────┴────────┴────────────────┘
```

- Sync byte: `0xFE`
- Length: Big-endian `uint16` (max 8192 bytes per frame)
- Data: Raw Opus-encoded audio

Читатель пересинхронизируется, сканируя поток на `0xFE`, если фрейминг потерян.

### 7.4 Пробуждение офлайн‑получателя

Если получатель офлайн, вызывающий:

1. Отправляет push‑уведомление через `/Svyaz/push-notify/1.0.0` (type: `"call"`)
2. Ждёт 5 секунд на cold boot
3. Повторяет подключение stream до 10 раз (интервал 3s, ~30s всего)
4. Сбрасывает libp2p dial backoff (`ClosePeer`) между попытками

---

## 8. Push‑уведомления

### 8.1 Регистрация токена

Клиенты регистрируют свои OneSignal push‑токены (APNs / FCM) через
`/Svyaz/voip-token/1.0.0`. Реле хранит соответствие:

```
Peer ID → OneSignal Subscription ID
```

### 8.2 Запрос push

```json
{
  "to":        "<target_peer_id>",
  "from_name": "Alice",
  "type":      "message" | "call" | "file"
}
```

Реле проверяет:
1. Цель онлайн? → Push не нужен
2. Push включён? → Если нет, пропустить
3. Throttle (cooldown 10s на пира) → Если недавно, пропустить

Для типа `"call"` реле отправляет VoIP push (APNs `voip` push type),
чтобы запустить iOS CallKit или Android‑уведомление с accept/decline.

---

## 9. Приватное обнаружение контактов (OPRF)

$Proto использует **Oblivious Pseudo-Random Function** (OPRF, P-256, BaseMode)
для приватного обнаружения контактов по телефонным номерам. Реле не узнаёт,
какие номера запрашивает клиент.

### 9.1 Поток верификации телефона

```
Client                    Relay                    sms.ru
  │                         │                         │
  ├── phone-verify-request ►│                         │
  │   {"phone": "7999..."}  ├── Generate OTP ────────►│ (SMS)
  │◄── {"status": "sent"} ──┤                         │
  │                         │                         │
  ├── phone-verify-confirm ►│                         │
  │   {"phone", "code"}     ├── Verify OTP            │
  │                         ├── OPRF.FullEvaluate(phone)
  │                         ├── Store token→PeerID    │
  │◄── {"status": "verified"}                        │
```

### 9.2 Поток обнаружения контактов

```
Client                         Relay
  │                              │
  │  For each contact phone:     │
  ├── OPRF.Blind(phones[]) ─────►│
  │   /phone-oprf-evaluate/      │
  │                              ├── OPRF.Evaluate(blinded[])
  │◄── evaluated[] ──────────────┤
  │                              │
  ├── OPRF.Finalize(evaluated) ──│  (client-side)
  ├── tokens[] ─────────────────►│
  │   /phone-lookup/             │
  │                              ├── Match tokens → PeerIDs
  │◄── {"matches": {...}} ───────┤
```

Реле никогда не видит «сырые» телефонные номера — только blinded/evaluated
точки эллиптической кривой и финальные OPRF‑токены.

---

## 10. Архитектура релей‑сервера

### 10.1 Компоненты

```
┌─────────────────────────────────────────────┐
│                Relay Server                  │
├──────────────┬───────────────────────────────┤
│ libp2p Host  │ TCP + QUIC-v1 listeners       │
│              │ Circuit Relay v2               │
│              │ NullResourceManager            │
├──────────────┼───────────────────────────────┤
│ Peer Tracker │ Online/offline status          │
├──────────────┼───────────────────────────────┤
│ Message Store│ BoltDB (per-peer buckets)      │
│              │ TTL: 30 days, max 1000/peer    │
├──────────────┼───────────────────────────────┤
│ File Store   │ Disk storage + in-memory index │
│              │ TTL: 7 days, max 1 GB/file     │
├──────────────┼───────────────────────────────┤
│ Push Service │ OneSignal (APNs + FCM)         │
│              │ VoIP push for calls            │
│              │ 10s per-peer throttle           │
├──────────────┼───────────────────────────────┤
│ OPRF Service │ P-256 BaseMode server          │
│              │ Persistent key                 │
├──────────────┼───────────────────────────────┤
│ Phone Tokens │ BoltDB (token → PeerID)        │
├──────────────┼───────────────────────────────┤
│ SMS Service  │ sms.ru API                     │
│ OTP Store    │ In-memory, 5 min TTL           │
└──────────────┴───────────────────────────────┘
```

### 10.2 Self‑hosting

Реле — это один Go‑бинарник с CLI‑флагами:

```bash
./relay-server \
  -listen /ip4/0.0.0.0/tcp/8443 \
  -key /opt/Svyaz/relay.key \
  -announce-ip 155.212.160.71 \
  -data /opt/Svyaz/data \
  -onesignal-app-id <APP_ID> \
  -onesignal-api-key <API_KEY> \
  -sms-api-key <SMS_RU_KEY>
```

Минимальные требования к серверу: 1 vCPU, 1 GB RAM, 20 GB disk.

---

## 11. Сравнение с MTProto

| Фича | $Proto | MTProto 2.0 |
|---|---|---|
| Identity | Пара ключей Ed25519 (без аккаунта) | Аккаунт на основе номера телефона |
| Transport | libp2p (TCP, QUIC, WS, WebRTC) | TCP, HTTP/2 |
| Transport encryption | Noise XX / TLS 1.3 | Транспортный слой MTProto |
| E2E encryption | NaCl Box (всегда для 1‑на‑1) | Опционально (только Secret Chats) |
| E2E cipher | X25519 + XSalsa20-Poly1305 | DH-2048 + AES-256-IGE |
| Key derivation | Ed25519 → X25519 (RFC 7748) | DH‑обмен через сервер |
| Server trust | Zero trust (реле — тупая труба) | Сервер видит plaintext для cloud‑чатов |
| Peer discovery | DHT (Kademlia) + OPRF | Контакты по телефону через сервер |
| NAT traversal | Circuit Relay v2, AutoNAT, UPnP | Через сервер (без P2P) |
| Voice calls | Прямой P2P‑stream (Opus) | Через сервер (проприетарно) |
| File transfer | Релейный store‑and‑forward | Серверное хранилище |
| Group delivery | Relay fan‑out (список получателей) | Server fan‑out |
| Offline delivery | Шифрованное хранение на реле | Сервер хранит plaintext |
| Push notifications | OneSignal (APNs/FCM) | Проприетарный push |
| Self-hostable | Да (один Go‑бинарник) | Нет |
| Federation-ready | Да (multi‑relay через DHT) | Нет |
| Open source | Да | Частично |

---

## 12. Свойства безопасности

| Свойство | Механизм |
|---|---|
| **Конфиденциальность** | NaCl Box E2E + шифрование транспорта |
| **Аутентичность** | Подписи Ed25519 в libp2p handshake |
| **Целостность** | MAC Poly1305 (NaCl) + транспортный MAC |
| **Forward secrecy** | Случайный nonce на сообщение; FS на транспорте через ephemeral DH |
| **Слепота реле** | Payload зашифрован; реле не может расшифровать |
| **Приватность контактов** | OPRF — реле не видит телефонные номера |
| **Локальное хранилище** | SQLCipher (AES-256) с аппаратно‑защищённым ключом |
| **Переносимость идентичности** | Экспорт/импорт файла `identity.key` |

---

## 13. Сводка wire format

### Текст/изображение (direct)
```
[libp2p stream: /Svyaz/messaging/1.0.0]
→ JSON Message object (≤ 4 MB)
← (stream closes)
```

### Зашифрованное хранение (relay)
```
[libp2p stream: /Svyaz/store/1.0.0]
→ JSON { "from", "to", "payload": base64(nonce || NaCl.Seal(JSON)), "timestamp" }
← JSON { "status": "stored" }
```

### Загрузка файла (relay)
```
[libp2p stream: /Svyaz/file-upload/1.0.0]
→ [uint32 header_len] [JSON header] 
← [uint32 ACK]
→ [raw file bytes, streamed]
→ CloseWrite
← JSON { "status": "stored" }
```

### Звонок (direct)
```
[libp2p stream: /Svyaz/call/1.0.0]
→ [0x01]           (offer)
← [0x02]           (accept)
⟷ [0xFE][u16 len][opus data]...  (bidirectional audio)
→ [0x03]           (hangup)
```

---

*$Proto v1.0.0 — Svyaz Messenger — 2026*
