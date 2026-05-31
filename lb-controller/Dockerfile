FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV EDS_PATH=/etc/envoy/dynamic/endpoints.yaml
ENV UPDATE_INTERVAL_SEC=1
ENV LB_ALGORITHM=round_robin
ENV CLUSTER_NAME=grpc_backend

CMD ["python", "main.py"]
