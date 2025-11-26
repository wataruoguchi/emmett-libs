FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie

RUN apt-get update \
    && apt-get install -y pgcli ack mkcert \
    && apt-get clean \
    && locale-gen en_US.UTF-8
