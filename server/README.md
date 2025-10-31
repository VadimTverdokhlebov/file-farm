## </b>Local Deployment</b>
### Step 1 : To install all the dependencies
 
 ```bash
 npm install
 ```

### If needed update dependencies

```bash
npm update -g npm
```

### Step 2 : To set .env variables on a Linux machine or a UNIX machine
 
 ```bash
 export $(cat .env | xargs)
 ```
### Step 3 : To run the Server in devlopment mode
 
 ```bash
 npm run dev
 ```

### Step 3 : To run the Server in production mode
 
 ```bash
 npm start
 ```
---
## <b>Production Deployment using Docker</b>

```csharp
Note :'Dont Forget to add your env variables.'
```
### Step 1 : Build your Docker image by running the following command 
```bash
docker build -t <your-project-name> .
```

### Step 2 : Run your Docker image by running the following command 
```bash
docker run -p <project-port>:<mapping-port> <your-project-name>
```
----
© 2022 Silicon Ninja
