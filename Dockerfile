# Builds the React app, then serves it and the API from one Django process.

FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_DEBUG=0
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
EXPOSE 8000
# Runs as root on purpose: Railway mounts the SQLite volume at /data owned by
# root, and a non-root user could not write to it.
# The timeout covers the slowest planning path: geocode, route, then label
# stops within GEO_LABEL_BUDGET_SECONDS.
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi -b 0.0.0.0:${PORT:-8000} --workers 2 --threads 4 --timeout 90 --access-logfile -"]
