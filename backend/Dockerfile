ARG BASE_IMAGE=python:3.12-slim-bookworm
FROM ${BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    TZ=Asia/Shanghai

WORKDIR /app

# 数据库备份模块需要：独立 Git 仓库操作、SSH 免密推送、mariadb-dump 文本导出
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client mariadb-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --retries 5 --timeout 60 -r requirements.txt

COPY app ./app

RUN mkdir -p /app/uploads /app/logs /home/app/.ssh \
    && addgroup --gid 1000 app \
    && adduser --uid 1000 --ingroup app --disabled-password --gecos "" app \
    && chown -R app:app /app /home/app/.ssh

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=40s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1

CMD ["sh", "-c", "exec uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers ${WORKERS:-2} --proxy-headers --forwarded-allow-ips=127.0.0.1"]
