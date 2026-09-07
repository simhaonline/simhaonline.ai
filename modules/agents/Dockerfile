FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py engine_contract.py ./
ENV AGENTS_DATABASE_URL="postgresql://simha:simha_dev_password@postgres:5432/simhaonline"
EXPOSE 8117
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8117/healthz', timeout=3)"
CMD ["uvicorn", "engine:app", "--host", "0.0.0.0", "--port", "8117"]