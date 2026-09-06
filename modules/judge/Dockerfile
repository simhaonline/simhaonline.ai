FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py engine_contract.py ./
EXPOSE 8116
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8116/healthz', timeout=3)"
CMD ["uvicorn", "engine:app", "--host", "0.0.0.0", "--port", "8116"]