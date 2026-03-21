<p align="center">
  <img src="assets/icon/icon.png" width="100" alt="Связь" />
</p>

<h1 align="center">Связь</h1>

<p align="center">
  Защищённый P2P-мессенджер с шифрованием на устройстве.<br/>
  Flutter · Go · libp2p · NaCl · SQLCipher
</p>

<p align="center">
  <a href="PROTOCOL.md"><strong>$Proto Specification</strong></a>
</p>

---

## Что это

**Связь** (кодовое имя *Parley*) — мессенджер, в котором сообщения идут напрямую между устройствами через libp2p. Сервер-реле не видит содержимое — он только маршрутизирует зашифрованные пакеты и хранит их для оффлайн-доставки.

Репозиторий содержит два компонента:

| Компонент | Путь | Стек |
|---|---|---|
| **Мобильное приложение** | `lib/` | Flutter, Riverpod, Drift, SQLCipher |
| **P2P-библиотека и реле-сервер** | `p2p_network/go/` | Go, libp2p, BoltDB, OPRF |

---

## Возможности

- **E2E-шифрование** — NaCl Box (X25519 + XSalsa20-Poly1305) для каждого сообщения
- **Зашифрованное хранилище** — SQLCipher с аппаратным ключом (Secure Enclave / Titan M)
- **Звонки** — VoIP через P2P-стрим, Opus-кодек, CallKit / Android-уведомления
- **Файлы до 1 ГБ** — загрузка через реле, потоковая передача с прогрессом
- **Голосовые сообщения** — запись и воспроизведение в чате
- **Группы** — relay fan-out, без хранения групп на сервере
- **Реакции, ответы, пересылка, удаление** — полноценный набор действий над сообщениями
- **Приватный поиск контактов** — OPRF (P-256), сервер не видит номера телефонов
- **Блокировка приложения** — пароль + Face ID / Touch ID
- **Push-уведомления** — OneSignal (APNs + FCM), VoIP push для звонков
- **Self-hosted** — реле — один Go-бинарник, разворачивается за 5 минут

---

## Архитектура

```
┌──────────────────────────────────────────────────┐
│                  Flutter App                      │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Chats   │  │ Contacts │  │   Settings     │  │
│  │  Calls   │  │  Groups  │  │   Lock Screen  │  │
│  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       │              │                │           │
│  ┌────┴──────────────┴────────────────┴────────┐  │
│  │         Riverpod + Clean Architecture        │  │
│  └────────────────────┬────────────────────────┘  │
│                       │ FFI                       │
├───────────────────────┼──────────────────────────┤
│                       ▼                           │
│  ┌─────────────────────────────────────────────┐  │
│  │            p2p_network (Go)                  │  │
│  │                                              │  │
│  │  Node · Messaging · Calls · FileTransfer    │  │
│  │  Crypto (NaCl) · OPRF · Relay Client        │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │ libp2p                      │
└─────────────────────┼────────────────────────────┘
                      ▼
              ┌──────────────┐
              │ Relay Server │  (Go, self-hosted)
              │              │
              │  Circuit v2  │
              │  BoltDB      │
              │  File Store  │
              │  Push / OPRF │
              └──────────────┘
```

---

## Структура проекта

```
parley/
├── lib/                          # Flutter-приложение
│   ├── core/                     #   Тема, роутинг, P2P-провайдер
│   └── feature/
│       ├── chats/                #   Чаты, группы, пузыри, меню
│       │   ├── data/             #     Repository, SQLCipher storage
│       │   ├── domain/           #     Модели (ChatMessage, Group)
│       │   └── presentation/     #     Экраны, провайдеры
│       ├── contacts/             #   Контакты, QR-сканер, аватары
│       ├── calls/                #   Экран звонка, AudioController
│       └── settings/             #   Настройки, блокировка, номер
│
├── p2p_network/
│   ├── go/
│   │   ├── p2p/                  # P2P-библиотека (Go package)
│   │   │   ├── node.go           #   libp2p host, DHT, relay
│   │   │   ├── messaging.go      #   Отправка/приём сообщений
│   │   │   ├── call.go           #   VoIP-звонки (Opus поток)
│   │   │   ├── file_transfer.go  #   Файлы через реле
│   │   │   ├── crypto.go         #   NaCl Box (E2E)
│   │   │   ├── phone.go          #   OPRF-клиент
│   │   │   ├── relay.go          #   Relay store/retrieve
│   │   │   ├── peers.go          #   Peer tracking
│   │   │   └── protocols.go      #   Protocol ID константы
│   │   │
│   │   ├── relay/                # Relay-сервер (Go binary)
│   │   │   ├── main.go           #   Точка входа, CLI-флаги
│   │   │   ├── handlers.go       #   12 stream-хэндлеров
│   │   │   ├── host.go           #   libp2p host setup
│   │   │   ├── store_messages.go #   BoltDB message store
│   │   │   ├── store_files.go    #   Disk file store
│   │   │   ├── push.go           #   OneSignal push service
│   │   │   ├── phone.go          #   OPRF + SMS + OTP
│   │   │   ├── tracker.go        #   Online/offline tracker
│   │   │   └── config.go         #   Лимиты и константы
│   │   │
│   │   └── bridge/               # FFI-мост (Go → Dart)
│   │
│   └── lib/                      # Dart FFI bindings
│
├── PROTOCOL.md                   # $Proto — спецификация протокола
└── README.md
```

---

## Быстрый старт

### Требования

- Flutter 3.22+
- Go 1.22+
- Xcode 15+ (iOS) / Android NDK (Android)

### Сборка и запуск

```bash
# 1. Собрать Go-библиотеку
make go

# 2. Запустить приложение
flutter run
```

### Развернуть свой реле-сервер

```bash
cd p2p_network/go
GOOS=linux GOARCH=amd64 go build -o relay-server ./relay

# На сервере:
./relay-server \
  -listen /ip4/0.0.0.0/tcp/8443 \
  -announce-ip <YOUR_IP> \
  -key /opt/parley/relay.key \
  -data /opt/parley/data
```

Укажите адрес реле в `p2p_network/go/p2p/node.go` → `OwnRelayAddr`,
пересоберите Go-библиотеку.

---

## P2P-библиотека (`p2p_network/go/p2p`)

Самостоятельный Go-пакет, который можно использовать отдельно от Flutter:

```go
import "parley/p2p_network/go/p2p"

node, _ := p2p.NewNode("/path/to/storage")
node.SetMessageHandler(func(msg *p2p.Message) {
    fmt.Printf("From %s: %s\n", msg.From, msg.Content)
})
node.Start()

node.SendMessage(peerID, "Hello!", "text", "")

transferID, _ := node.SendFile(peerID, "/path/to/file.pdf", "file.pdf")

node.StartCall(peerID)
```

**Что умеет:**

| Метод | Описание |
|---|---|
| `SendMessage` | Текст/изображение с оффлайн-fallback на реле |
| `SendMultiMessage` | Групповая отправка (relay fan-out) |
| `SendFile` / `SendFileMulti` | Файлы до 1 ГБ через реле |
| `StartCall` / `AnswerCall` / `EndCall` | VoIP-звонки (Opus) |
| `SendAudio` | Отправка аудио-фреймов |
| `DiscoverContacts` | OPRF-поиск контактов по номерам |
| `RequestPhoneVerification` | SMS OTP через sms.ru |
| `GetConnectLink` | Ссылка для добавления в контакты |

---

## Протокол

Подробная спецификация — **[$Proto](PROTOCOL.md)**: транспорт, шифрование, wire format, сравнение с MTProto.

---

## Лендинг

Статический сайт в каталоге **`site/`**: главная, безопасность, федерация, поддержка (FAQ-бот на клиенте). Стили — `css/styles.css`, поведение и анимации секций/`data-ai` — `js/site.js` (учитывается `prefers-reduced-motion`). Откройте `site/index.html` в браузере или поднимите любой статический сервер. Старые URL `cooperation.html` и `advantages.html` перенаправляют на `support.html` и `index.html`.

## Лицензия

Proprietary. All rights reserved.
