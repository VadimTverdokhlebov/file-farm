## How Generate Proto Files

```bash
cd server && npm run gen:proto
```

```bash
cd client && npm run gen:proto
```

## How run to Development Mode

### Install Environment

```bash
make build-env-dev
```

### Install Dependencies

```bash
make init
```

### Start Infra

```bash
make up-postgres
```

```bash
make up-prometheus
```

```bash
make up-cadvisor
```

```bash
make up-grafana
```

```bash
make up-envoy
```

### Start Services

```bash
cd server && npm run dev
```

```bash
cd lb-controller && python3 main.py
```

```bash
cd load-stand && go run .
```

```bash
cd client && npm run dev
```

## How run to Production Mode

### Install Environment

```bash
make build-env-prod
```

### Start Services

```bash
make build
```

```bash
make up
```

### Stop Services

```bash
make down
```