FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir openai pydantic requests==2.31.0

COPY sandbox_agent.py .

ENTRYPOINT ["python", "sandbox_agent.py"]
