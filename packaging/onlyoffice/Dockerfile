ARG ONLYOFFICE_BASE_IMAGE=onlyoffice/documentserver:latest
FROM ${ONLYOFFICE_BASE_IMAGE}

USER root

RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      fonts-noto-cjk \
      fonts-wqy-microhei \
      fonts-wqy-zenhei \
      fonts-arphic-ukai \
      fonts-arphic-uming && \
    rm -rf /var/lib/apt/lists/*

COPY packaging/onlyoffice/99-openwork-cjk-aliases.conf /etc/fonts/conf.d/99-openwork-cjk-aliases.conf

RUN fc-cache -f >/dev/null && \
    if command -v documentserver-generate-allfonts.sh >/dev/null 2>&1; then \
      documentserver-generate-allfonts.sh >/dev/null 2>&1 || true; \
    fi
