#!/bin/bash
# Скрипт для автообновления проекта на сервере (VPS)
# Можно повесить на cron или вызывать через webhook

# Переходим в корень проекта
cd "$(dirname "$0")/.." || exit 1

echo "==> Запуск автообновления: $(date)"

# Получаем последние изменения
git fetch origin

# Сбрасываем локальные изменения и применяем версию из main
git reset --hard origin/main

# Если в будущем появится бэкенд на Go, здесь можно добавить команды сборки:
# echo "==> Сборка бэкенда..."
# cd p2p_network/go && go build -o parley-relay ./cmd/relay
# systemctl restart parley-relay

echo "==> Обновление успешно завершено!"
