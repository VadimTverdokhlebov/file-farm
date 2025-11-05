## Install Environment Development Mode

```bash
make init-development
```

### Start Services

```bash
make build-postgres
```

```bash
make build-envoy
```

```bash
make up-postgres
```

```bash
make up-envoy
```

## Install Environment Production Mode

```bash
make init-production
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
