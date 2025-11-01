# Показать все доступные команды
make help

# Пересобрать всё с нуля (без кеша)
make rebuild

# Пересобрать только сервер
make rebuild-server

# Пересобрать только envoy
make rebuild-envoy

# Запустить все сервисы
make up

# Остановить все сервисы
make down

# Перезапустить все сервисы
make restart

# Посмотреть логи
make logs-server
make logs-envoy

# Полная очистка
make clean

### Regenerate after proto changes:
```bash
# Update proto files in protos/
# Then regenerate for both:
cd server && npm run gen:proto && cd ../client && npm run gen:proto
```