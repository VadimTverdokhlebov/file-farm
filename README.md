## Install Environment Development Mode

```bash
make env-dev
```

```bash
make init
```

### Start Services

```bash
make up-postgres
```

```bash
make up-envoy
```

### Start Clint and Server

```bash
cd server && npm run dev
```

```bash
cd client && npm run dev
```

### How Generate Proto Files

```bash
cd server && npm run gen:proto
```

```bash
cd client && npm run gen:proto
```
## Install Environment Production Mode

```bash
make env-prod
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